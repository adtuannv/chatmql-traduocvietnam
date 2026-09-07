/**
 * doc-library-routes.ts — HTTP cho thư viện tài liệu bán hàng.
 * Đọc: mọi nhân viên. Ghi: owner/admin/manager.
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import multipart from '@fastify/multipart'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'
import { logger } from '../../shared/logger.js'
import { sendImageCore } from '../chat/send-image-core.js'
import { sendMessageCore } from '../chat/send-core.js'
import { searchCrmProducts } from '../crm-products/crm-products-client.js'
import { DOC_ASSETS_DIR } from './doc-assets-store.js'
import {
  ASSET_KINDS, VISIBILITIES,
  listFolders, createFolder, updateFolder, deleteFolder,
  listAssets, createAsset, updateAsset, deleteAsset,
} from './doc-library-service.js'

export { DOC_ASSETS_DIR } from './doc-assets-store.js'

/** 25MB: đủ cho ảnh chất lượng cao và pdf tài liệu; video nên dán link thay vì tải lên. */
const MAX_FILE_SIZE = 25 * 1024 * 1024

/** Đuôi file cho phép, kèm loại tài nguyên suy ra từ đó. */
const EXT_KIND: Record<string, string> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image',
  '.pdf': 'pdf',
  '.doc': 'doc', '.docx': 'doc', '.xls': 'doc', '.xlsx': 'doc', '.ppt': 'doc', '.pptx': 'doc',
  '.txt': 'text', '.md': 'text', '.csv': 'text',
  '.mp4': 'video', '.webm': 'video',
}

type AuthUser = { orgId: string; role: string; id: string }

function canManage(role: string): boolean {
  return ['owner', 'admin', 'manager'].includes(role)
}
function fail(reply: FastifyReply, status: number, message: string) {
  return reply.status(status).send({ error: message })
}
function guard(request: { user: unknown }, reply: FastifyReply): AuthUser | null {
  const u = request.user as AuthUser
  if (!canManage(u.role)) {
    fail(reply, 403, 'Không có quyền chỉnh thư viện tài liệu')
    return null
  }
  return u
}


/** Tối đa 5 ảnh mỗi sản phẩm — gửi nhiều hơn là dội chuông khách. */
const MAX_IMAGES_PER_PRODUCT = 5

/**
 * Soạn tin giới thiệu sản phẩm để gửi khách.
 *
 * Zalo cá nhân KHÔNG hiểu markdown nên không dùng ** hay #; dùng emoji và
 * xuống dòng cho dễ đọc trên điện thoại. Giá lấy trực tiếp từ hệ thống nguồn
 * tại thời điểm gửi — không lưu bản sao nên không bao giờ báo giá cũ. Hệ thống
 * nguồn lỗi thì bỏ phần giá, phần còn lại vẫn gửi được.
 */
async function buildProductMessage(a: {
  title: string
  description: string | null
  textContent: string | null
  productCodes: string[]
  videoUrls: string[]
}, orgId: string): Promise<string> {
  const lines: string[] = [`🍵 ${a.title}`]

  for (const code of a.productCodes.slice(0, 3)) {
    try {
      const { products } = await searchCrmProducts(code, 10, orgId)
      const p = products.find((x) => x.code?.toUpperCase() === code.toUpperCase())
      if (!p) continue
      const price = p.price != null
        ? `${new Intl.NumberFormat('vi-VN').format(p.price)}đ${p.unit ? `/${p.unit}` : ''}`
        : 'liên hệ'
      // Không báo "hết hàng" cho khách: mọi sản phẩm đều nhận đơn, hàng đặt
      // trước hay gối vụ vẫn bán bình thường.
      lines.push(`💰 Giá: ${price}`)
    } catch {
      // Hệ thống nguồn không phản hồi — bỏ giá, vẫn gửi phần giới thiệu.
    }
  }

  const body = [a.description, a.textContent].filter(Boolean).join('\n\n')
  if (body) lines.push('', body)
  if (a.videoUrls.length) {
    lines.push('', '🎬 Video sản phẩm:')
    for (const v of a.videoUrls.slice(0, 3)) lines.push(v)
  }
  return lines.join('\n')
}

export async function docLibraryRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })
  app.addHook('preHandler', authMiddleware)

  /** Hằng số cho giao diện — khỏi khai báo trùng ở frontend. */
  app.get('/api/v1/doc-library/meta', async () => ({
    kinds: ASSET_KINDS,
    visibilities: VISIBILITIES,
    maxFileSize: MAX_FILE_SIZE,
    allowedExtensions: Object.keys(EXT_KIND),
  }))

  // ── Thư mục ─────────────────────────────────────────────────────────
  app.get('/api/v1/doc-library/folders', async (request) => {
    const u = request.user as AuthUser
    return { folders: await listFolders(u.orgId) }
  })

  app.post('/api/v1/doc-library/folders', async (request, reply) => {
    const u = guard(request, reply); if (!u) return
    try {
      return { folder: await createFolder(u.orgId, request.body as never) }
    } catch (err) {
      return fail(reply, 400, err instanceof Error ? err.message : 'Không tạo được thư mục')
    }
  })

  app.patch<{ Params: { id: string } }>('/api/v1/doc-library/folders/:id', async (request, reply) => {
    const u = guard(request, reply); if (!u) return
    try {
      const folder = await updateFolder(u.orgId, request.params.id, request.body as never)
      if (!folder) return fail(reply, 404, 'Không tìm thấy thư mục')
      return { folder }
    } catch (err) {
      return fail(reply, 400, err instanceof Error ? err.message : 'Không sửa được thư mục')
    }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/doc-library/folders/:id', async (request, reply) => {
    const u = guard(request, reply); if (!u) return
    return { deleted: await deleteFolder(u.orgId, request.params.id) }
  })

  // ── Tài nguyên ──────────────────────────────────────────────────────
  app.get<{
    Querystring: {
      folderId?: string; unfiled?: string; kind?: string; productCode?: string
      q?: string; visibility?: string; page?: string; pageSize?: string
    }
  }>('/api/v1/doc-library/assets', async (request) => {
    const u = request.user as AuthUser
    const qy = request.query
    const int = (v?: string) => {
      const n = Number.parseInt(v ?? '', 10)
      return Number.isFinite(n) ? n : undefined
    }
    return listAssets(u.orgId, {
      folderId: qy.folderId,
      unfiled: qy.unfiled === 'true',
      kind: qy.kind,
      productCode: qy.productCode,
      q: qy.q,
      visibility: qy.visibility,
      page: int(qy.page),
      pageSize: int(qy.pageSize),
    })
  })

  app.post('/api/v1/doc-library/assets', async (request, reply) => {
    const u = guard(request, reply); if (!u) return
    try {
      return { asset: await createAsset(u.orgId, request.body as never, u.id) }
    } catch (err) {
      return fail(reply, 400, err instanceof Error ? err.message : 'Không tạo được tài nguyên')
    }
  })

  app.patch<{ Params: { id: string } }>('/api/v1/doc-library/assets/:id', async (request, reply) => {
    const u = guard(request, reply); if (!u) return
    try {
      const asset = await updateAsset(u.orgId, request.params.id, request.body as never)
      if (!asset) return fail(reply, 404, 'Không tìm thấy tài nguyên')
      return { asset }
    } catch (err) {
      return fail(reply, 400, err instanceof Error ? err.message : 'Không sửa được tài nguyên')
    }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/doc-library/assets/:id', async (request, reply) => {
    const u = guard(request, reply); if (!u) return
    return { deleted: await deleteAsset(u.orgId, request.params.id) }
  })

  /**
   * Tải tệp lên. Trả về URL + loại suy ra từ đuôi file, để giao diện điền sẵn
   * form tạo tài nguyên. Tách khỏi bước tạo bản ghi vì người dùng còn phải đặt
   * tiêu đề, chọn thư mục, gắn mã sản phẩm.
   */
  app.post('/api/v1/doc-library/upload', async (request, reply) => {
    const u = guard(request, reply); if (!u) return
    const file = await request.file()
    if (!file) return fail(reply, 400, 'Vui lòng chọn tệp')

    const ext = path.extname(file.filename || '').toLowerCase()
    const kind = EXT_KIND[ext]
    if (!kind) {
      return fail(reply, 400, `Định dạng không hỗ trợ. Chấp nhận: ${Object.keys(EXT_KIND).join(', ')}`)
    }
    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) {
      return fail(reply, 400, 'Tệp tối đa 25MB. Video dung lượng lớn nên dán link thay vì tải lên.')
    }

    const filename = `${u.orgId}-${randomUUID().slice(0, 8)}${ext}`
    await writeFile(path.join(DOC_ASSETS_DIR, filename), buffer)
    return {
      url: `/uploads/doc-assets/${filename}`,
      kind,
      mimeType: file.mimetype,
      fileSize: buffer.length,
      originalName: file.filename,
    }
  })

  /**
   * Gửi tài liệu vào hội thoại theo GÓI do nhân viên tự soạn.
   *
   * Sale không gửi "cả cục tài nguyên" — họ chọn đúng thứ khách đang hỏi: giới
   * thiệu kèm giá, hai ba tấm ảnh, có khi thêm video. Nên body nhận từng phần:
   *
   *   items: [{ assetId, includeIntro, imageUrls, videoUrls }]
   *
   * `imageUrls`/`videoUrls` được ĐỐI CHIẾU lại với chính tài liệu đó — client
   * không thể mượn endpoint này để gửi URL bất kỳ ra kênh khách.
   * Vẫn nhận `assetIds` (gửi trọn bộ) để không gãy chỗ gọi cũ.
   */
  app.post<{
    Body: {
      conversationId?: string
      assetIds?: string[]
      items?: Array<{
        assetId: string
        includeIntro?: boolean
        imageUrls?: string[]
        videoUrls?: string[]
      }>
      /** Lời nhắn của nhân viên, gửi TRƯỚC gói tài liệu. */
      note?: string
    }
  }>('/api/v1/doc-library/send', async (request, reply) => {
    const user = request.user as AuthUser
    const { conversationId, assetIds, items, note } = request.body || {}

    if (!conversationId?.trim()) return fail(reply, 400, 'Thiếu conversationId')

    // Chuẩn hoá về một dạng: gửi trọn bộ = bật hết các phần.
    const plan = items?.length
      ? items
      : (assetIds ?? []).map((assetId) => ({ assetId, includeIntro: true, imageUrls: undefined, videoUrls: undefined }))
    if (!plan.length) return fail(reply, 400, 'Chưa chọn tài liệu nào')

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId.trim(), orgId: user.orgId },
      select: { id: true },
    })
    if (!conv) return fail(reply, 404, 'Không tìm thấy hội thoại')

    const sentIds: string[] = []
    const skipped: Array<{ id: string; reason: string }> = []
    let messageCount = 0

    /**
     * Gửi một tin chữ qua ĐÚNG đường gửi của hệ thống.
     *
     * Không tự ghi thẳng vào bảng message: làm vậy tin chỉ nằm trong máy, không
     * ra được Zalo, và ghi sai `senderType` thì khung chat hiển thị tin của
     * nhân viên sang phía khách. `sendMessageCore` lo đẩy kênh, lưu đúng
     * senderType 'self', cập nhật trạng thái hội thoại và bắn socket.
     *
     * Tắt automation: cả gói tài liệu là MỘT thao tác bán hàng, không phải
     * nhiều lượt trả lời — đường gửi ảnh cũng không kích hoạt automation.
     */
    const sendText = async (text: string): Promise<boolean> => {
      const r = await sendMessageCore({
        orgId: user.orgId,
        conversationId: conv.id,
        text,
        sender: 'staff',
        repliedByUserId: user.id,
        triggerAutomation: false,
      })
      messageCount++
      return r.sentViaZalo
    }

    // Tin chữ ra được kênh hay không thì sale phải biết: tin nằm lại trong máy
    // mà báo "đã gửi" là để khách chờ. (Web Chat luôn tính là gửi được.)
    const failedText: string[] = []
    if (note?.trim() && !(await sendText(note.trim()))) failedText.push('lời nhắn mở đầu')

    for (const part of plan.slice(0, 20)) {
      try {
        const a = await prisma.docAsset.findFirst({ where: { id: part.assetId, orgId: user.orgId } })
        if (!a) { skipped.push({ id: part.assetId, reason: 'Không tìm thấy tài liệu' }); continue }
        if (a.visibility !== 'sales') {
          skipped.push({ id: part.assetId, reason: 'Tài liệu nội bộ — không được gửi khách' })
          continue
        }

        // Chỉ chấp nhận ảnh/video THUỘC tài liệu này.
        const pickedImages = part.imageUrls
          ? part.imageUrls.filter((u) => a.images.includes(u))
          : (a.kind === 'product' ? a.images.slice(0, MAX_IMAGES_PER_PRODUCT) : [])
        const pickedVideos = part.videoUrls
          ? part.videoUrls.filter((u) => a.videoUrls.includes(u))
          : a.videoUrls

        const wantIntro = part.includeIntro !== false

        if (a.kind === 'product') {
          if (wantIntro && !(await sendText(await buildProductMessage({ ...a, videoUrls: pickedVideos }, user.orgId)))) {
            failedText.push('tin giới thiệu sản phẩm')
          }
          let imgOk = 0
          for (const img of pickedImages.slice(0, MAX_IMAGES_PER_PRODUCT)) {
            const r = await sendImageCore({
              orgId: user.orgId,
              conversationId: conv.id,
              imageUrl: img,
              sender: 'staff',
              repliedByUserId: user.id,
            })
            if (r.sent) { imgOk++; messageCount++ }
          }
          if (pickedImages.length && imgOk === 0) {
            skipped.push({ id: part.assetId, reason: 'Đã gửi phần chữ nhưng không gửi được ảnh' })
          }
          if (!wantIntro && !pickedImages.length && !pickedVideos.length) {
            skipped.push({ id: part.assetId, reason: 'Không chọn phần nào để gửi' })
            continue
          }
          sentIds.push(part.assetId)
          continue
        }

        // Ảnh đơn: gửi ảnh kèm chú thích là tiêu đề.
        const image = a.kind === 'image' ? (a.fileUrl ?? a.images[0]) : null
        if (image) {
          const r = await sendImageCore({
            orgId: user.orgId,
            conversationId: conv.id,
            imageUrl: image,
            caption: a.title,
            sender: 'staff',
            repliedByUserId: user.id,
          })
          if (r.sent) { sentIds.push(part.assetId); messageCount++ }
          else skipped.push({ id: part.assetId, reason: r.error || 'Không gửi được ảnh' })
          continue
        }

        const link = a.sourceUrl || a.videoUrls[0] || a.fileUrl
        const body = [a.description, a.textContent].filter(Boolean).join('\n\n')
        await sendText([a.title, body, link].filter(Boolean).join('\n\n'))
        sentIds.push(part.assetId)
      } catch (err) {
        logger.error({ err, assetId: part.assetId }, '[doc-library] không gửi được tài liệu')
        skipped.push({ id: part.assetId, reason: 'Lỗi hệ thống' })
      }
    }

    logger.info(
      { conversationId: conv.id, userId: user.id, assets: sentIds.length, messages: messageCount },
      '[doc-library] nhân viên gửi tài liệu vào hội thoại',
    )
    return { sent: sentIds.length, sentIds, messages: messageCount, skipped, failedText }
  })
}