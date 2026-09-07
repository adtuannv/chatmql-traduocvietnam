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

export const DOC_ASSETS_DIR = path.resolve(__dirname, '../../../uploads/doc-assets')
mkdir(DOC_ASSETS_DIR, { recursive: true }).catch(() => {})
