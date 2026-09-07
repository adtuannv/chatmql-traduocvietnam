import { describe, expect, it } from 'vitest'
import { coNhacTen } from './mention-rule.js'

describe('coNhacTen', () => {
  const ten = ['Trợ lý', 'AI', 'Bot Trà']

  it('nhận tag kiểu Zalo', () => {
    expect(coNhacTen('@Trợ lý cho mình hỏi giá', ten)).toBe(true)
  })

  it('nhận gọi tên trần trong câu — cách người thật hay gõ', () => {
    expect(coNhacTen('trợ lý ơi cho hỏi cái này', ten)).toBe(true)
    expect(coNhacTen('cho hỏi Bot Trà còn hàng không', ten)).toBe(true)
  })

  it('bỏ dấu vẫn nhận ra', () => {
    expect(coNhacTen('tro ly oi giup em voi', ten)).toBe(true)
  })

  it('không nhận khi tên chỉ là chuỗi con của từ khác', () => {
    // "AI" nằm trong "email", "cái" — so chuỗi con thì mọi câu đều thành được nhắc.
    expect(coNhacTen('gửi email cho anh nhé', ten)).toBe(false)
    expect(coNhacTen('cái này bao nhiêu tiền', ten)).toBe(false)
  })

  it('không nhận khi không có tên nào', () => {
    expect(coNhacTen('shop còn hàng không ạ', ten)).toBe(false)
  })

  it('câu rỗng hoặc danh sách tên rỗng thì không tính là được nhắc', () => {
    expect(coNhacTen('', ten)).toBe(false)
    expect(coNhacTen('trợ lý ơi', [])).toBe(false)
    expect(coNhacTen('trợ lý ơi', ['', '  '])).toBe(false)
  })

  it('không vỡ khi tên chứa ký tự đặc biệt của biểu thức chính quy', () => {
    expect(coNhacTen('hỏi A+B nhé', ['A+B'])).toBe(true)
    expect(coNhacTen('hỏi AxB nhé', ['A+B'])).toBe(false)
  })
})
