/**
 * eslint.config.js — Chỉ bắt những lỗi mà TypeScript KHÔNG thấy được.
 *
 * Cố ý hẹp. Trước đây `npm run lint` chỉ chạy `tsc`, mà tsc không hiểu luật của
 * React hook: một hook đặt sau `return` sớm vẫn hợp lệ về kiểu, nhưng khi chạy
 * thì React đếm số hook lệch giữa hai lượt render và ném lỗi #310 — trắng cả
 * màn hình. Lỗi đó đã lọt lên bản thật ở màn huấn luyện AI.
 *
 * Nên ở đây chỉ bật đúng nhóm luật hook. Thêm hàng trăm luật phong cách vào lúc
 * này chỉ tạo ra hàng nghìn cảnh báo cũ rồi không ai chạy nữa.
 */
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Hook gọi có điều kiện / sau return sớm → lỗi lúc chạy, chặn hẳn.
      'react-hooks/rules-of-hooks': 'error',
      // Thiếu dependency chỉ gây dữ liệu cũ chứ không vỡ màn — cảnh báo là đủ.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
