/**
 * miniapp-link.ts — Dựng link Zalo Mini App cho một sản phẩm.
 *
 * Gom về một chỗ vì trước đây tab Sản phẩm và ô ghép mã ở trang Sản phẩm mỗi
 * nơi tự dựng một kiểu, và chúng đã lệch nhau: chỗ xem thử ra link này, chỗ gửi
 * khách ra link khác.
 */

/** Mã sản phẩm bên hệ quản trị Mini App, hoặc mã/định danh của hệ thống nguồn. */
export type NguonMa = {
  miniAppId?: string | null
  code?: string | null
  id?: number | string | null
}

/**
 * Mã hoá mã sản phẩm đúng một lần, dù đưa vào ở dạng nào.
 *
 * Mã Mini App có dấu gạch chéo (`FX/TP-CC03-100/KR-ZL`) nên bắt buộc phải mã
 * hoá. Nhưng người dùng hay sao mã thẳng từ thanh địa chỉ trình duyệt, tức là
 * đã mã hoá sẵn (`CCTT%2FACBT-ZL`) — mã hoá thêm lần nữa sẽ ra `%252F` và link
 * chết mà không ai biết, vì nhìn bằng mắt vẫn thấy "có link".
 *
 * Giải trước rồi mã lại nên vào kiểu nào cũng ra đúng một kết quả.
 */
export function maHoaMaMiniApp(ma: string): string {
  let v = ma
  try {
    const giai = decodeURIComponent(ma)
    if (giai !== ma) v = giai
  } catch {
    // Chuỗi có '%' nhưng không phải mã hoá hợp lệ — giữ nguyên rồi mã hoá.
  }
  return encodeURIComponent(v)
}

/**
 * Thay các ô `{miniapp}` / `{code}` / `{id}` trong mẫu bằng giá trị của sản phẩm.
 *
 * `{miniapp}` là mã bên hệ quản trị Zalo Mini App và là thứ Mini App thật sự
 * hiểu; `{code}` và `{id}` giữ lại cho hệ thống nguồn nào đánh địa chỉ kiểu khác.
 *
 * Trả `null` khi thiếu mẫu, hoặc khi mẫu cần một ô mà sản phẩm chưa có giá trị —
 * thà khoá nút gửi còn hơn gửi khách một link hỏng.
 */
export function miniAppLink(template: string, p: NguonMa): string | null {
  if (!template) return null
  const phan: Record<string, string> = {
    '{miniapp}': p.miniAppId?.trim() ?? '',
    '{code}': p.code?.trim() ?? '',
    '{id}': p.id != null ? String(p.id) : '',
  }
  let out = template
  for (const [khoa, giaTri] of Object.entries(phan)) {
    if (!template.includes(khoa)) continue
    if (!giaTri) return null
    out = out.replaceAll(khoa, maHoaMaMiniApp(giaTri))
  }
  return out
}
