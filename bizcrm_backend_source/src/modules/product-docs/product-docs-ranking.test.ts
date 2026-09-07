/**
 * Xếp hạng tài liệu sản phẩm.
 *
 * Trước đây hàm tìm sắp theo `updatedAt`, nên hỏi "trà đinh ngọc" lại trả về
 * "bộ ấm chén" — sản phẩm sửa gần nhất chứ không phải sản phẩm khách hỏi. AI
 * tư vấn nhầm hàng còn tệ hơn không trả lời, nên khoá lại bằng test.
 */
import { describe, it, expect } from 'vitest'
import { diemKhop, TU_BO_QUA } from './product-docs-service.js'

const sp = (name: string, opts: Partial<{ keywords: string; productCode: string; description: string }> = {}) => ({
  name,
  keywords: opts.keywords ?? null,
  productCode: opts.productCode ?? 'X',
  description: opts.description ?? null,
})

describe('diemKhop', () => {
  it('tên trúng phải hơn hẳn mô tả trúng', () => {
    const dungTen = diemKhop(sp('Trà Đinh Ngọc - Hộp mica'), ['tra', 'dinh', 'ngoc'])
    const dungMoTa = diemKhop(sp('Bộ ấm chén', { description: 'dùng pha trà đinh ngọc rất hợp' }), ['tra', 'dinh', 'ngoc'])
    expect(dungTen).toBeGreaterThan(dungMoTa)
  })

  it('bỏ dấu vẫn khớp — khách gõ không dấu là chuyện thường', () => {
    expect(diemKhop(sp('Trà Đinh Ngọc'), ['tra', 'dinh'])).toBeGreaterThan(0)
    expect(diemKhop(sp('Tra Dinh Ngoc'), ['trà', 'đinh'])).toBeGreaterThan(0)
  })

  it('cùng một câu hỏi, khớp đúng mã thắng khớp lơ mơ ở tên', () => {
    const hoi = ['bk/tp-kv01-200']
    const dungMa = diemKhop(sp('Kẹo Vừng Ta', { productCode: 'BK/TP-KV01-200' }), hoi)
    const chiGanGiong = diemKhop(sp('Kẹo Dồi', { productCode: 'BK/TP-KD01-200' }), hoi)
    expect(dungMa).toBeGreaterThan(chiGanGiong)
  })

  it('cụm từ liền nhau trong tên được cộng thêm', () => {
    const lienNhau = diemKhop(sp('Bộ ấm chén Cúc cổ trường thọ'), ['bo', 'am', 'chen'])
    const roiRac = diemKhop(sp('Ấm đun nước, có chén kèm bộ lọc'), ['bo', 'am', 'chen'])
    expect(lienNhau).toBeGreaterThan(roiRac)
  })

  it('từ để hỏi bị loại, nếu không câu nào cũng khớp mọi thứ', () => {
    for (const t of ['bao', 'nhieu', 'tien', 'gia', 'shop']) expect(TU_BO_QUA.has(t)).toBe(true)
  })

  it('không liên quan thì không có điểm', () => {
    expect(diemKhop(sp('Trà Đinh Ngọc'), ['xe', 'may'])).toBe(0)
  })
})
