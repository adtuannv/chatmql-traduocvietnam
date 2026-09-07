import { SenderType } from '../../shared/constants.js'
/**
 * message-handler.ts — persists incoming Zalo messages to the database.
 * Called from zalo-pool's startListener on every 'message' / 'undo' event.
 * Ported from ZaloCRM with adaptations for BizCRM.
 */
import { prisma } from '../../shared/prisma-client.js'
import { randomUUID } from 'node:crypto'
import { emitNewMessage } from '../realtime/socket-gateway.js'
import { runAutomationRules } from '../automation/automation-engine.js'
import { emitDomainEvent } from '../../shared/domain-events.js'
import { getPoolEntry } from '../zalo/zalo-pool.js'
import { transformMessageForFrontend } from './chat-routes.js'
import { logger } from '../../shared/logger.js'
import { resolveZaloAlias } from '../zalo/zalo-alias.js'
import { parseBirthdayFromContent } from '../zalo/zalo-event-handlers.js'
import { extractAvatarHash } from '../contacts/avatar-hash.js'
import { resetIdleCheckpoints } from '../automation/conversation-idle-poller.js'
import { extractPhoneFromName } from '../contacts/phone-extractor.js'
import { getAiReplyConfig, resolveConversationMode } from '../ai/ai-config-service.js'
import { enqueueAiReply } from '../../shared/queue.js'
import { duocPhepTraLoi } from '../ai/mention-rule.js'

export interface IncomingMessage {
  accountId: string
  senderUid: string
  senderName: string       // zaloName (from cache or dName fallback)
  content: string
  contentType: string      // text, image, sticker, video, voice, gif, link, file
  msgId: string
  timestamp: number        // epoch ms
  isSelf: boolean
  threadId: string          // For user: contact UID. For group: group ID
  threadType: 'user' | 'group'
  groupName?: string
  attachments?: any[]
  quote?: unknown
  albumKey?: string | null
  albumIndex?: number | null
  albumTotal?: number | null
  isBackfill?: boolean     // true for old_messages / sync backfill — skip automations
  // Which Contact column keys identity for this channel. Defaults to 'zaloUid'
  // (Zalo personal + Zalo OA reuse it); native Facebook Page uses 'fbPsid'; native TikTok Shop uses 'tiktokUid'.
  identityField?: 'zaloUid' | 'fbPsid' | 'tiktokUid'
  source?: string          // Contact.source label on first create (default 'Zalo')
}

export interface HandleMessageResult {
  message: {
    id: string
    conversationId: string
    externalMsgId: string | null
    senderType: string
    senderUid: string | null
    senderName: string | null
    content: string | null
    contentType: string
    attachments: any
    albumKey: string | null
    albumIndex: number | null
    albumTotal: number | null
    isDeleted: boolean
    deletedAt: Date | null
    sentAt: Date
    repliedByUserId: string | null
    createdAt: Date
  }
  conversationId: string
  orgId: string
  contactId: string | null
}

/**
 * Các giá trị `content` có thể ứng với cùng một sticker.
 *
 * Tin do CRM tạo lưu ID trần ("172"); tiếng vọng từ Zalo lưu nguyên payload
 * {"id":172,"catId":1,"type":2}. Trả về cả hai dạng để truy vấn khử trùng khớp
 * được bản ghi CRM vừa tạo trước đó vài chục mili-giây.
 */
function stickerIdCandidates(content?: string | null): string[] {
  const raw = (content || '').trim()
  if (!raw) return []
  const out = new Set<string>([raw])
  if (/^\d+$/.test(raw)) return [...out]
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const id = obj.id ?? obj.stickerId ?? obj.sticker_id
    if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))) out.add(String(id))
  } catch {
    /* không phải JSON — chỉ dùng chuỗi gốc */
  }
  return [...out]
}

export async function handleIncomingMessage(
  msg: IncomingMessage,
): Promise<HandleMessageResult | null> {
  try {
    const account = await prisma.channelAccount.findUnique({
      where: { id: msg.accountId },
      select: { orgId: true, ownerUserId: true },
    })
    if (!account) return null

    const contactId = await upsertContact(msg, account.orgId)

    // Update lastActivity for lead scoring freshness
    if (contactId) {
      prisma.contact.update({
        where: { id: contactId },
        data: { lastActivity: new Date() },
      }).catch(() => {})
    }

    // For user threads, displayName = the CUSTOMER's name (not the sender when self-sent)
    let displayName: string | null = null
    if (msg.threadType === 'group') {
      displayName = msg.groupName || null
    } else if (!msg.isSelf) {
      // Inbound message: sender IS the customer
      displayName = msg.senderName || null
    } else if (contactId) {
      // Self-sent message: look up the contact's name
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { fullName: true },
      })
      displayName = (contact?.fullName && contact.fullName !== 'Unknown') ? contact.fullName : null
    }
    const conversation = await findOrCreateConversation(msg, account.orgId, contactId, displayName)

    const sentAt = new Date(msg.timestamp)

    // Universal dedup for backfill: old_messages can resend any previously saved message
    if (msg.isBackfill && msg.msgId) {
      const existingByMsgId = await prisma.message.findFirst({
        where: { conversationId: conversation.id, externalMsgId: msg.msgId },
        select: { id: true },
      })
      if (existingByMsgId) return null
    }

    // Dedup guard for self messages: selfListen echoes back CRM-sent messages.
    // Strategy: prefer exact externalMsgId match, fall back to content+time match.
    if (msg.isSelf && msg.msgId) {
      // 1) Exact externalMsgId match — most reliable, covers all cases
      const exactDupe = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          externalMsgId: msg.msgId,
        },
        select: { id: true },
      })
      if (exactDupe) {
        logger.info(`[message-handler] Skipping self echo: exact externalMsgId match`)
        return null
      }

      // 2) Content+time match — catch echoes where CRM record has no externalMsgId yet
      //    Use 15s window to minimize false positives on repeated short messages
      const isMedia = msg.contentType === 'image' || msg.contentType === 'file' || msg.contentType === 'video'
      // Sticker: bản ghi do CRM tạo lưu content là ID trần ("172"), còn tiếng vọng
      // từ Zalo lưu nguyên payload {"id":172,"catId":1,"type":2}. So sánh nguyên
      // chuỗi thì KHÔNG BAO GIỜ khớp → mỗi sticker gửi đi bị ghi thành hai tin và
      // nhân viên thấy sticker hiện hai lần. So theo ID mới nhận ra là một.
      const stickerIds = msg.contentType === 'sticker' ? stickerIdCandidates(msg.content) : []
      const recentDupe = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          senderType: SenderType.SELF,
          externalMsgId: null, // only match records missing externalMsgId (CRM-created)
          ...(isMedia
            ? { contentType: msg.contentType }
            : stickerIds.length > 0
              ? { contentType: 'sticker', content: { in: stickerIds } }
              : { content: msg.content || '' }),
          sentAt: { gte: new Date(Date.now() - 15_000) },
        },
        select: { id: true, content: true },
      })
      
      if (recentDupe) {
        let finalContent = msg.content || ''
        if (!finalContent && msg.attachments && msg.attachments.length > 0) {
          finalContent = JSON.stringify(msg.attachments[0])
        }

        const updated = await prisma.message.update({
          where: { id: recentDupe.id },
          data: { externalMsgId: msg.msgId, content: finalContent },
        }).catch(() => null)
        
        if (updated) {
          const io = require('../realtime/socket-gateway.js').getIO()
          io.to(`org:${account.orgId}`).emit('chat:message-updated', {
            conversationId: conversation.id,
            messageId: updated.id,
            updates: {
              externalMsgId: msg.msgId,
              content: finalContent,
            }
          })
        }
        
        logger.info(`[message-handler] Skipping self echo: matched within 15s (updated msgId and content)`)
        return null
      }
    }

    let message
    try {
      message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          externalMsgId: msg.msgId || null,
          senderType: msg.isSelf ? 'self' : 'contact',
          senderUid: msg.senderUid,
          senderName: msg.senderName || null,
          content: msg.content || '',
          contentType: msg.contentType || 'text',
          attachments: msg.attachments ?? [],
          quote: msg.quote ?? undefined,
          albumKey: msg.albumKey ?? null,
          albumIndex: msg.albumIndex ?? null,
          albumTotal: msg.albumTotal ?? null,
          sentAt,
        },
      })
    } catch (err) {
      // P2002 = unique constraint violation → duplicate externalMsgId, skip silently
      if ((err as any)?.code === 'P2002') {
        logger.info(`[message-handler] Skipping duplicate externalMsgId=${msg.msgId}`)
        return null
      }
      throw err
    }

    await updateConversationAfterMessage(conversation.id, sentAt, msg.isSelf)

    // Track first outbound contact date — set once when agent sends first message
    if (msg.isSelf && contactId) {
      prisma.contact.updateMany({
        where: { id: contactId, firstContactDate: null },
        data: { firstContactDate: new Date(msg.timestamp) },
      }).catch(() => {})
    }

    // Emit real-time event — transform DB `quote` → FE `reply` so the quote box
    // renders immediately, matching what /messages returns on a fresh page load.
    try {
      emitNewMessage(account.orgId, conversation.id, transformMessageForFrontend({
        ...message,
        senderType: msg.isSelf ? 'self' : 'contact',
        senderName: msg.senderName,
      }))
    } catch { /* socket not connected */ }

    // Run automation rules for non-backfill inbound messages
    if (!msg.isBackfill && !msg.isSelf) {
      runAutomationRules('message_received', {
        orgId: account.orgId,
        conversationId: conversation.id,
        contactId: contactId ?? undefined,
        messageText: msg.content,
      }).catch(err => logger.error({ err }, '[automation] message_received error'))

      // ── AI auto-reply harness (M2: debounced queue for both suggest + auto) ─
      // Fire-and-forget: never blocks message persistence or automation rules.
      try {
        const aiReplyCfg = await getAiReplyConfig(account.orgId)
        const effectiveMode = resolveConversationMode({
          orgId: account.orgId,
          autoReplyEnabled: aiReplyCfg.autoReplyEnabled,
          defaultAiMode: aiReplyCfg.defaultAiMode,
          convAiMode: conversation.aiMode ?? null,
          convAiModeReason: conversation.aiModeReason ?? null,
          schedule: aiReplyCfg.schedule,
        })

        const isPaused = !!(conversation.aiPausedUntil)
          && new Date(conversation.aiPausedUntil) > new Date()

        logger.info({
          orgId: account.orgId,
          convId: conversation.id,
          autoReplyEnabled: aiReplyCfg.autoReplyEnabled,
          convAiMode: conversation.aiMode,
          effectiveMode,
          isPaused,
          hasContent: !!msg.content?.trim(),
        }, '[ai-harness] evaluating inbound message trigger')

        // Nhóm: chờ có người gọi đích danh mới trả lời, nếu tổ chức bật luật.
        const luat = await duocPhepTraLoi({
          orgId: account.orgId,
          laNhom: conversation.threadType === 'group',
          noiDung: msg.content ?? '',
          batLuat: aiReplyCfg.groupRequireMention,
          tenTuDat: aiReplyCfg.mentionNames,
          ghiDe: conversation.requireMention,
        })

        if (
          aiReplyCfg.autoReplyEnabled
          && !isPaused
          && (effectiveMode === 'suggest' || effectiveMode === 'auto')
          && msg.content?.trim()
          && luat.duoc
        ) {
          enqueueAiReply(conversation.id, aiReplyCfg.debounceSeconds * 1000)
            .catch(err => logger.error({ err }, '[ai-harness] enqueue error'))
        } else if (!luat.duoc) {
          logger.debug({ convId: conversation.id, lyDo: luat.lyDo }, '[ai-harness] bỏ qua theo luật nhắc tên')
        }
      } catch (err) {
        logger.error({ err }, '[ai-harness] mode resolution error')
      }
      // ─────────────────────────────────────────────────────────────────────
    }

    // ── Birthday notification → CDP event + property auto-update ──────
    if (msg.contentType === 'birthday_notification' && contactId) {
      handleBirthdayNotification(account.orgId, contactId, conversation.id, msg.content)
        .catch(err => logger.error({ err }, '[birthday] handler error'))
    }

    return {
      message,
      conversationId: conversation.id,
      orgId: account.orgId,
      contactId,
    }
  } catch (err) {
    logger.error({ err }, '[message-handler] handleIncomingMessage error')
    return null
  }
}

// ── Contact upsert ────────────────────────────────────────────────────

async function upsertContact(msg: IncomingMessage, orgId: string): Promise<string | null> {
  // Group messages: create/update a "contact" record representing the group
  if (msg.threadType === 'group') {
    const groupUid = msg.threadId
    let groupContact = await prisma.contact.findFirst({
      where: { zaloUid: groupUid, orgId },
      select: { id: true, fullName: true },
    })

    if (!groupContact) {
      groupContact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: groupUid,
          fullName: msg.groupName || 'Nhóm',
          isGroup: true,
          metadata: { isGroup: true },
        },
        select: { id: true, fullName: true },
      })
    } else if (msg.groupName && groupContact.fullName !== msg.groupName) {
      await prisma.contact.update({
        where: { id: groupContact.id },
        data: { fullName: msg.groupName },
      })
    }
    return groupContact.id
  }

  // For self messages on user threads, the contact is the thread recipient
  const contactUid = msg.isSelf ? msg.threadId : msg.senderUid
  const contactName = msg.isSelf ? '' : msg.senderName

  // Channel-specific identity column: Zalo (personal + OA) → zaloUid, Facebook → fbPsid, TikTok Shop → tiktokUid.
  const identityField = msg.identityField ?? 'zaloUid'
  const isZalo = identityField === 'zaloUid'
  const idWhere = identityField === 'tiktokUid'
    ? { tiktokUid: contactUid }
    : identityField === 'fbPsid'
      ? { fbPsid: contactUid }
      : { zaloUid: contactUid }

  let contact = await prisma.contact.findFirst({
    where: { ...idWhere, orgId },
    select: { id: true, fullName: true, avatarUrl: true },
  })

  if (!contact) {
    // Auto-extract VN phone from the display name (e.g. "Anh Thảo An Giang - 0912649954")
    const extractedPhone = extractPhoneFromName(contactName)

    contact = await prisma.contact.create({
      data: {
        id: randomUUID(),
        orgId,
        ...idWhere,
        fullName: contactName || 'Unknown',
        ...(extractedPhone ? { phone: extractedPhone } : {}),
        source: msg.source ?? 'Zalo',
      },
      select: { id: true, fullName: true, avatarUrl: true },
    })

    // Fire-and-forget: one-time Zalo profile enrichment (phone, avatar). Zalo-only.
    if (isZalo) enrichContactFromZalo(msg.accountId, contactUid, contact.id).catch(() => {})

    // New contact → fire automation + domain event (Perfex sync etc.), matching
    // the OA/Pancake handlers so personal-channel (Zalo/FB) contacts aren't missed.
    runAutomationRules('contact_created', { orgId, contactId: contact.id })
      .catch(err => logger.error({ err }, '[message-handler] contact_created automation error'))
    emitDomainEvent({ type: 'contact.created', orgId, id: contact.id })
  } else {
    // Update name only if currently "Unknown" — don't overwrite user-edited names
    if (contactName && contact.fullName !== contactName && contact.fullName === 'Unknown') {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { fullName: contactName },
      })
    }
    // Re-enrich to pick up custom alias (displayName) or missing avatar (Zalo-only).
    // The enrichment function guards against overwriting user-edited names.
    if (isZalo && (!contact.avatarUrl || contact.fullName === contactName || contact.fullName === 'Unknown')) {
      enrichContactFromZalo(msg.accountId, contactUid, contact.id).catch(() => {})
    }
  }

  return contact.id
}

// ── One-time Zalo profile enrichment ──────────────────────────────────
// Fetches phone, avatar, displayName from Zalo via getUserInfo.
// Called fire-and-forget on first contact creation, or manually via sync button.

export async function enrichContactFromZalo(
  accountId: string,
  externalUid: string,
  contactId: string,
): Promise<{ phone?: string; avatarUrl?: string; displayName?: string } | null> {
  const entry = getPoolEntry(accountId)
  if (!entry?.api) return null

  try {
    const res = await entry.api.getUserInfo(externalUid)
    const profile = res?.changed_profiles?.[externalUid]
    if (!profile) return null

    const updates: Record<string, unknown> = {}
    const result: { phone?: string; avatarUrl?: string; displayName?: string } = {}

    // Phone: prefer Zalo profile phone, then try extracting from display name
    if (profile.phoneNumber && profile.phoneNumber.length >= 8) {
      updates.phone = profile.phoneNumber
      result.phone = profile.phoneNumber
    } else {
      // Fallback: extract phone from Zalo display name (e.g. "Anh Thảo An Giang - 0912649954")
      const namePhone = extractPhoneFromName(profile.displayName)
        || extractPhoneFromName(profile.zaloName)
      if (namePhone) {
        // Only set if contact doesn't already have a phone
        const currentContact = await prisma.contact.findUnique({
          where: { id: contactId },
          select: { phone: true },
        })
        if (!currentContact?.phone) {
          updates.phone = namePhone
          result.phone = namePhone
        }
      }
    }

    // Avatar: prefer HD avatar
    if (profile.avatar) {
      updates.avatarUrl = profile.avatar
      result.avatarUrl = profile.avatar
    }

    // ── Name resolution ─────────────────────────────────────────────
    // Zalo has 3 name layers:
    //   1. alias (biệt danh) — custom nickname set by the account owner via getAliasList()
    //   2. displayName — from getUserInfo (same as zaloName in practice)
    //   3. zaloName — the name the profile owner set for themselves
    // Priority: alias > displayName > zaloName
    const customAlias = await resolveZaloAlias(accountId, externalUid)
    if (customAlias) {
      logger.info(`[enrich] Found Zalo alias for ${externalUid}: "${customAlias}"`)
    }

    const bestName = customAlias || profile.displayName || profile.zaloName
    if (bestName) {
      result.displayName = bestName

      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { fullName: true },
      })
      const currentName = contact?.fullName ?? ''

      // Update fullName if it was auto-populated (not manually edited by CRM user).
      // Auto-populated names: 'Unknown', placeholder 'Zalo XXXX', original zaloName,
      // or previous displayName (which equals zaloName from getUserInfo).
      const isAutoName = !currentName
        || currentName === 'Unknown'
        || currentName === profile.zaloName                     // was set from original Zalo profile name
        || currentName === profile.displayName                  // was set from getUserInfo displayName
        || /^Zalo( OA Follower)? \S{2,8}$/.test(currentName)   // auto-generated placeholder

      if (isAutoName && bestName !== currentName) {
        updates.fullName = bestName

        // Propagate to conversation displayName for UI consistency
        prisma.conversation.updateMany({
          where: {
            contactId,
            OR: [
              { displayName: null },
              { displayName: 'Unknown' },
              ...(currentName ? [{ displayName: currentName }] : []),
            ],
          },
          data: { displayName: bestName },
        }).catch(() => {})
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.contact.update({
        where: { id: contactId },
        data: updates,
      })

      // After avatar enrichment: auto-merge if a matching contact exists
      if (updates.avatarUrl) {
        tryAutoMergeByAvatar(contactId, updates.avatarUrl as string)
          .catch(err => logger.warn({ err }, '[enrich] auto-merge by avatar failed'))
      }
    }

    return result
  } catch (err) {
    logger.warn(`[enrich] Failed to fetch Zalo profile for ${externalUid}: ${(err as Error).message}`)
    return null
  }
}

// ── Auto-merge by avatar hash ─────────────────────────────────────────
// When a new contact gets an avatar, check if any existing contact
// in the same org already has the same avatar hash. If so, merge the
// new contact into the older one automatically.

async function tryAutoMergeByAvatar(
  newContactId: string,
  avatarUrl: string,
): Promise<void> {
  const hash = extractAvatarHash(avatarUrl)
  if (!hash) return

  const newContact = await prisma.contact.findUnique({
    where: { id: newContactId },
    select: { id: true, orgId: true, createdAt: true, mergedInto: true, deletedAt: true },
  })
  if (!newContact || newContact.mergedInto || newContact.deletedAt) return

  // Find other contacts with the same avatar hash
  // We query all contacts with avatarUrl containing the hash
  const candidates = await prisma.contact.findMany({
    where: {
      orgId: newContact.orgId,
      id: { not: newContactId },
      deletedAt: null,
      mergedInto: null,
      isGroup: false,
      avatarUrl: { contains: hash },
    },
    select: { id: true, avatarUrl: true, createdAt: true },
  })

  // Double-check: verify the full extracted hash matches (not just substring)
  const matches = candidates.filter(c => extractAvatarHash(c.avatarUrl) === hash)
  if (matches.length === 0) return

  // Pick the oldest contact as the primary (merge INTO older account)
  const allContacts = [newContact, ...matches].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  const primaryId = allContacts[0].id
  const mergeId = primaryId === newContactId ? null : newContactId

  if (!mergeId) {
    // newContact is the oldest — merge the others into it
    // Don't auto-merge multiple at once; let the user confirm via the page
    logger.info(`[auto-merge] Contact ${newContactId} is oldest; skipping auto-merge, will suggest in Duplicate page`)
    return
  }

  // Auto-merge: move conversations and mark as merged
  logger.info(`[auto-merge] Merging ${mergeId} into ${primaryId} (avatar hash: ${hash})`)

  await prisma.$transaction(async (tx) => {
    // Snapshot displayName before re-assigning
    const mc = await tx.contact.findUnique({
      where: { id: mergeId },
      select: { fullName: true },
    })
    if (mc?.fullName) {
      await tx.conversation.updateMany({
        where: { contactId: mergeId, displayName: null },
        data: { displayName: mc.fullName },
      })
    }

    // Move conversations, appointments, CDP events, lifecycle logs
    await tx.conversation.updateMany({
      where: { contactId: mergeId },
      data: { contactId: primaryId },
    })
    await tx.appointment.updateMany({
      where: { contactId: mergeId },
      data: { contactId: primaryId },
    })
    await tx.cdpEvent.updateMany({
      where: { contactId: mergeId },
      data: { contactId: primaryId },
    })
    await tx.lifecycleLog.updateMany({
      where: { contactId: mergeId },
      data: { contactId: primaryId },
    })
    // Clean up property values
    await tx.contactPropertyValue.deleteMany({
      where: { contactId: mergeId },
    })
    // Mark as merged
    await tx.contact.update({
      where: { id: mergeId },
      data: { mergedInto: primaryId, deletedAt: new Date() },
    })
    // Resolve any DuplicateGroup that references the merged contact
    await tx.duplicateGroup.updateMany({
      where: {
        orgId: newContact.orgId,
        resolved: false,
        contactIds: { hasSome: [mergeId] },
      },
      data: { resolved: true },
    })
  })
}

// ── Conversation find/create ──────────────────────────────────────────

async function findOrCreateConversation(
  msg: IncomingMessage,
  orgId: string,
  contactId: string | null,
  displayName: string | null,
) {
  const externalThreadId = msg.threadId

  const existing = await prisma.conversation.findFirst({
    where: { channelAccountId: msg.accountId, externalThreadId },
    // threadType: luật "chỉ trả lời khi được nhắc tên" chỉ áp cho nhóm.
    select: { id: true, displayName: true, aiMode: true, aiModeReason: true, aiPausedUntil: true, threadType: true, requireMention: true },
  })

  if (existing) {
    // Self-heal: update displayName if currently null/Unknown and we have a valid name
    if (displayName && (!existing.displayName || existing.displayName === 'Unknown')) {
      prisma.conversation.update({
        where: { id: existing.id },
        data: { displayName },
      }).catch(() => {})
    }
    return existing
  }

  // Materialize the org's default AI mode at creation. Without this the schema
  // default ('auto') wins and "Chế độ mặc định cho hội thoại mới" never
  // applies to new conversations (resolveConversationMode only falls back on
  // NULL, and the column is non-null). Best-effort: fall back to 'auto'.
  let defaultAiMode = 'auto'
  try {
    defaultAiMode = (await getAiReplyConfig(orgId)).defaultAiMode || 'auto'
  } catch { /* config unreadable → safe default */ }

  return prisma.conversation.create({
    data: {
      id: randomUUID(),
      orgId,
      channelAccountId: msg.accountId,
      contactId,
      threadType: msg.threadType,
      externalThreadId,
      displayName,
      lastMessageAt: new Date(msg.timestamp),
      unreadCount: msg.isSelf ? 0 : 1,
      isReplied: msg.isSelf,
      aiMode: defaultAiMode,
    },
    select: { id: true, aiMode: true, aiModeReason: true, aiPausedUntil: true, threadType: true, requireMention: true },
  })
}

// ── Update conversation metadata after new message ────────────────────

async function updateConversationAfterMessage(
  conversationId: string,
  sentAt: Date,
  isSelf: boolean,
): Promise<void> {
  const updateData: any = { lastMessageAt: sentAt }
  if (isSelf) {
    updateData.isReplied = true
    updateData.unreadCount = 0
  } else {
    updateData.unreadCount = { increment: 1 }
    updateData.isReplied = false
  }
  await prisma.conversation.update({ where: { id: conversationId }, data: updateData })
  // Reset idle checkpoints so conversation_idle trigger restarts for all thresholds
  resetIdleCheckpoints(conversationId).catch(() => {})
}

// ── Message undo (soft-delete) ────────────────────────────────────────

export async function handleMessageUndo(accountId: string, externalMsgId: string): Promise<void> {
  try {
    await prisma.message.updateMany({
      where: { externalMsgId: String(externalMsgId) },
      data: { isDeleted: true, deletedAt: new Date() },
    })
    logger.info(`[message-handler] Undo message ${externalMsgId} for account ${accountId}`)
  } catch (err) {
    logger.error({ err }, '[message-handler] handleMessageUndo error')
  }
}

// ── Birthday notification → CDP event + property ──────────────────────

/**
 * Process a Zalo birthday notification:
 * 1. Fire 'birthday_detected' CDP event on the contact
 * 2. Auto-upsert the 'birthday' CDP custom property (if not already set)
 *
 * The 'birthday' property comes from the common CDP preset (fieldKey='birthday',
 * fieldType='date'). We store as ISO date string YYYY-MM-DD using year 2000
 * as a placeholder since Zalo only provides DD/MM.
 */
async function handleBirthdayNotification(
  orgId: string,
  contactId: string,
  conversationId: string,
  rawContent: string,
): Promise<void> {
  const birthday = parseBirthdayFromContent(rawContent)
  if (!birthday) return

  const { day, month, contactName } = birthday
  // Zalo only provides DD/MM — default year to 2000 as placeholder
  const birthdayDate = `2000-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  logger.info(`[birthday] Detected ${day}/${month} for contact ${contactId} (${contactName})`)

  // 1. Fire CDP event 'birthday_detected'
  try {
    // Auto-create event definition if it doesn't exist
    await prisma.cdpEventDefinition.upsert({
      where: { orgId_eventName: { orgId, eventName: 'birthday_detected' } },
      create: {
        orgId,
        eventName: 'birthday_detected',
        displayName: 'Phát hiện sinh nhật',
        isActive: true,
      },
      update: {}, // no-op if already exists
    })

    await prisma.cdpEvent.create({
      data: {
        orgId,
        contactId,
        eventName: 'birthday_detected',
        properties: { day, month, contactName, date: birthdayDate },
        source: 'zalo',
        timestamp: new Date(),
      },
    })

    // Fire automation rules for this event
    runAutomationRules('birthday_detected', {
      orgId,
      contactId,
      conversationId,
      triggerData: { day, month, contactName, date: birthdayDate },
    }).catch(err => logger.error({ err }, '[automation] birthday_detected trigger error'))

    logger.info(`[birthday] CDP event 'birthday_detected' created for contact ${contactId}`)
  } catch (err) {
    logger.error({ err }, '[birthday] Failed to create CDP event')
  }

  // 2. Auto-upsert birthday CDP custom property (only if not already set)
  try {
    const birthdayProp = await prisma.customProperty.findFirst({
      where: { orgId, fieldKey: 'birthday' },
      select: { id: true },
    })

    if (!birthdayProp) {
      logger.info(`[birthday] No 'birthday' custom property found for org ${orgId} — skipping property update. Install the "Thông tin chung" preset to enable.`)
      return
    }

    // Only upsert if value is currently empty (don't overwrite manual entries)
    const existing = await prisma.contactPropertyValue.findUnique({
      where: { contactId_propertyId: { contactId, propertyId: birthdayProp.id } },
      select: { value: true },
    })

    if (existing?.value) {
      logger.info(`[birthday] Birthday property already set for contact ${contactId}: ${existing.value}`)
      return
    }

    await prisma.contactPropertyValue.upsert({
      where: { contactId_propertyId: { contactId, propertyId: birthdayProp.id } },
      create: {
        orgId,
        contactId,
        propertyId: birthdayProp.id,
        value: birthdayDate,
      },
      update: { value: birthdayDate },
    })

    logger.info(`[birthday] Auto-set birthday=${birthdayDate} for contact ${contactId}`)
  } catch (err) {
    logger.error({ err }, '[birthday] Failed to upsert birthday property')
  }
}
