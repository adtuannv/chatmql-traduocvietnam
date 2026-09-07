import { describe, it, expect } from 'vitest'
import { anonymize } from './learn-history-routes.js'
import { buildGeneratorPrompt } from './prompts/auto-reply.js'
import type { HarnessContext, RouterDecision } from './harness/harness-types.js'

describe('anonymize — bảo mật thông tin khách hàng và ghi chú', () => {
  it('che số điện thoại Việt Nam trong tin nhắn và ghi chú', () => {
    const raw = 'Khách gọi từ số 0987654321 hoặc +84912345678 để đặt hàng'
    const masked = anonymize(raw)
    expect(masked).not.toContain('0987654321')
    expect(masked).not.toContain('+84912345678')
    expect(masked).toContain('[SĐT]')
  })

  it('che email và số tài khoản ngân hàng', () => {
    const raw = 'Email khach@gmail.com, STK chuyển khoản 19034567890123'
    const masked = anonymize(raw)
    expect(masked).not.toContain('khach@gmail.com')
    expect(masked).not.toContain('19034567890123')
    expect(masked).toContain('[email]')
    expect(masked).toContain('[số]')
  })

  it('che thông tin trong ghi chú nội bộ của nhân viên', () => {
    const note = '[GHI CHÚ NV (Chốt thành công)]: Khách dặn giao về số 0901234567, cọc qua STK 9876543210'
    const masked = anonymize(note)
    expect(masked).toContain('[GHI CHÚ NV (Chốt thành công)]')
    expect(masked).not.toContain('0901234567')
    expect(masked).not.toContain('9876543210')
    expect(masked).toContain('[SĐT]')
  })
})

describe('buildGeneratorPrompt — tích hợp ghi chú nhân viên vào auto-reply', () => {
  const dummyContext: HarnessContext = {
    orgId: 'org-test',
    convId: 'conv-test',
    logic: {
      index: null,
      persona: 'Bạn là chuyên viên tư vấn Trà Dược.',
      playbook: null,
      handoff_rules: null,
      mechanism: null,
      criteria: null,
    },
    scenarios: [],
    kbSnippets: [],
    products: [],
    productDocs: [],
    contact: {
      fullName: 'Anh Hoàng',
      lifecycleStage: 'customer',
      leadScore: 80,
      aiSentimentLabel: 'positive',
      aiIntent: 'order',
      tags: ['vip'],
      aiSummary: 'Khách quen thích trà hoa vàng',
    },
    threadMemory: [],
    recentMessages: [
      { role: 'customer', text: 'Shop còn trà hoa vàng không?' },
    ],
    turnText: 'Shop còn trà hoa vàng không?',
  }

  const decision: RouterDecision = {
    shouldReply: true,
    intents: ['product_inquiry'],
  }

  it('không có ghi chú thì không sinh mục Ghi chú nội bộ', () => {
    const prompt = buildGeneratorPrompt(dummyContext, decision)
    expect(prompt).not.toContain('Ghi chú nội bộ của nhân viên')
  })

  it('có ghi chú thì sinh mục Ghi chú nội bộ kèm trạng thái và nội dung', () => {
    const ctxWithNotes: HarnessContext = {
      ...dummyContext,
      staffNotes: [
        { content: 'Khách dặn chỉ gọi sau 17h chiều', status: 'consulting' },
        { content: 'Đã chốt 2 hộp, khách thanh toán COD', status: 'won' },
      ],
    }
    const prompt = buildGeneratorPrompt(ctxWithNotes, decision)
    expect(prompt).toContain('## Ghi chú nội bộ của nhân viên (lưu ý đặc biệt về khách)')
    expect(prompt).toContain('• [consulting]: Khách dặn chỉ gọi sau 17h chiều')
    expect(prompt).toContain('• [won]: Đã chốt 2 hộp, khách thanh toán COD')
    expect(prompt).toContain('LƯU Ý: Đây là ghi chú nội bộ từ nhân viên chăm sóc trước đó')
  })
})
