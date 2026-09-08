/**
 * Thay biến runtime.
 *
 * Khoá lại vì đây là chỗ AI lấy danh tính và thời gian. Sai một trong hai thì
 * khách nhắn nick A lại được giới thiệu là nhân viên B, hoặc AI nói sai tháng.
 */
import { describe, it, expect } from 'vitest'
import { thayBien, khoiRuntimeContext, MUI_GIO, type RuntimeContext } from './runtime-context.js'

const rc: RuntimeContext = {
  account_name: 'Hoài Chang Trà Dược Việt Nam',
  account_role: 'Nhân viên tư vấn bán hàng (+84344686862)',
  channel_name: 'Zalo cá nhân',
  current_datetime: 'Thứ Hai, 08/09/2026 10:30',
  timezone: MUI_GIO,
  customer_name: 'Anh Tôn Thất Dương',
  customer_phone: '0867533708',
  customer_id: 'KH009910',
}

describe('thayBien', () => {
  it('thay đúng biến có dữ liệu', () => {
    expect(thayBien('Em là {{account_name}} ạ', rc)).toBe('Em là Hoài Chang Trà Dược Việt Nam ạ')
  })

  it('chịu được khoảng trắng và chữ hoa trong tên biến', () => {
    expect(thayBien('{{ ACCOUNT_NAME }}', rc)).toBe('Hoài Chang Trà Dược Việt Nam')
  })

  it('biến không có dữ liệu thì thành chuỗi rỗng, không để lại dấu ngoặc', () => {
    const trong = { ...rc, customer_id: '' }
    expect(thayBien('Mã KH: {{customer_id}}.', trong)).toBe('Mã KH: .')
  })

  it('biến gõ sai tên thì GIỮ NGUYÊN để người soạn nhìn thấy', () => {
    // Xoá âm thầm thì người soạn tưởng đã chạy đúng, mãi không phát hiện gõ sai.
    expect(thayBien('{{ten_tai_khoan}}', rc)).toBe('{{ten_tai_khoan}}')
  })

  it('không có dấu ngoặc thì trả nguyên văn', () => {
    expect(thayBien('Không có biến nào', rc)).toBe('Không có biến nào')
  })

  it('nội dung rỗng thì không vỡ', () => {
    expect(thayBien(null, rc)).toBeNull()
    expect(thayBien('', rc)).toBe('')
  })
})

describe('khoiRuntimeContext', () => {
  it('luôn có thời gian, kể cả khi không biết tài khoản nào', () => {
    const k = khoiRuntimeContext({ ...rc, account_name: '', account_role: '', channel_name: '' })
    expect(k).toContain('Thời gian hiện tại')
    expect(k).not.toContain('Tên tài khoản đang trả lời')
  })

  it('có tên tài khoản thì nêu rõ và cấm lấy tên khác', () => {
    const k = khoiRuntimeContext(rc)
    expect(k).toContain('Hoài Chang Trà Dược Việt Nam')
    expect(k).toMatch(/KHÔNG lấy tên/)
  })
})
