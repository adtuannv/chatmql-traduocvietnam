/**
 * doc-assets-store.ts — Nơi lưu tệp của thư viện tài liệu.
 *
 * Tách riêng khỏi doc-library-routes.ts để send-image-core dùng được mà không
 * tạo vòng import (routes → send-image-core → routes).
 */
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cho đặt bằng biến môi trường: khi chạy trong container thì thư mục thật là
// một volume gắn ngoài, còn script bảo trì lại chạy ở host — hai nơi phải ghi
// vào cùng một chỗ, nếu không ảnh lưu xong mà máy chủ không phục vụ được.
export const DOC_ASSETS_DIR =
  process.env.DOC_ASSETS_DIR?.trim() || path.resolve(__dirname, '../../../uploads/doc-assets')
mkdir(DOC_ASSETS_DIR, { recursive: true }).catch(() => {})
