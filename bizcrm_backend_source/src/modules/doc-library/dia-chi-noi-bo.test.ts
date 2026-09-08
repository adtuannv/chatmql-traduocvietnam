/**
 * Chặn địa chỉ nội bộ khi tải ảnh từ đường dẫn.
 *
 * Đây là chỗ máy chủ tự gọi ra một địa chỉ do người dùng nhập. Không chặn thì
 * bất kỳ ai có tài khoản cũng dò được dịch vụ trong mạng riêng qua chính máy
 * chủ này — cơ sở dữ liệu, Redis, hay thông tin định danh máy chủ đám mây.
 */
import { describe, it, expect } from 'vitest'
import { laDiaChiNoiBo } from './doc-library-routes.js'

describe('laDiaChiNoiBo', () => {
  it('chặn localhost và vòng lặp nội bộ', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '0.0.0.0', '::1'])
      expect(laDiaChiNoiBo(h)).toBe(true)
  })

  it('chặn dải mạng riêng', () => {
    for (const h of ['10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255', '100.64.0.1'])
      expect(laDiaChiNoiBo(h)).toBe(true)
  })

  it('chặn link-local — nơi để thông tin định danh máy chủ đám mây', () => {
    expect(laDiaChiNoiBo('169.254.169.254')).toBe(true)
  })

  it('chặn tên dịch vụ trong Docker (không có dấu chấm)', () => {
    for (const h of ['redis', 'postgres', 'bizcrm2_api']) expect(laDiaChiNoiBo(h)).toBe(true)
  })

  it('chặn hậu tố nội bộ', () => {
    for (const h of ['db.internal', 'api.local', 'app.localhost']) expect(laDiaChiNoiBo(h)).toBe(true)
  })

  it('CHO PHÉP địa chỉ công cộng bình thường', () => {
    for (const h of ['cdn.traduoc.vn', 'i.imgur.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1'])
      expect(laDiaChiNoiBo(h)).toBe(false)
  })
})
