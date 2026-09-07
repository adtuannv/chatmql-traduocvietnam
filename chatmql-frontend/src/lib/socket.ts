import { io, type Socket } from 'socket.io-client'
import { API_ORIGIN } from './config'
import { getToken } from './api-client'

let socket: Socket | null = null

// Các phòng hội thoại đang mở — server quên room khi đứt kết nối,
// nên phải join lại toàn bộ mỗi lần reconnect thành công.
const joinedConvs = new Set<string>()

// Lỗi từ middleware xác thực (token hết hạn/sai) là "fatal" với socket.io:
// client sẽ KHÔNG tự reconnect, phải chủ động connect() lại với token mới.
let authRetryTimer: ReturnType<typeof setTimeout> | null = null
let authRetryDelay = 2_000
const AUTH_RETRY_MAX = 30_000

/** Khởi tạo (hoặc lấy) socket dùng chung, xác thực bằng JWT. */
export function getSocket(): Socket {
  if (socket) return socket
  socket = io(API_ORIGIN, {
    path: '/socket.io',
    // Ưu tiên websocket; fallback polling khi WS bị proxy/firewall chặn
    // (backend đã reflect origin nên polling không còn vướng CORS).
    transports: ['websocket', 'polling'],
    // Dùng hàm để MỖI lần (re)connect đều đọc token mới nhất từ localStorage —
    // tránh kẹt token cũ sau khi axios auto-refresh lúc 401.
    auth: (cb) => cb({ token: getToken() }),
    autoConnect: true,
  })

  socket.on('connect', () => {
    authRetryDelay = 2_000
    if (authRetryTimer) {
      clearTimeout(authRetryTimer)
      authRetryTimer = null
    }
    // Join lại các phòng đã mở để tiếp tục nhận chat:message của hội thoại đó.
    for (const convId of joinedConvs) socket!.emit('join:conv', convId)
  })

  socket.on('connect_error', () => {
    // socket.active = socket.io sẽ tự thử lại (đứt mạng thường). Chỉ khi
    // KHÔNG active (bị middleware từ chối) mới cần tự lên lịch connect lại.
    if (socket?.active || authRetryTimer) return
    authRetryTimer = setTimeout(() => {
      authRetryTimer = null
      authRetryDelay = Math.min(authRetryDelay * 2, AUTH_RETRY_MAX)
      socket?.connect()
    }, authRetryDelay)
  })

  return socket
}

export function reconnectSocket() {
  if (socket) {
    socket.disconnect().connect()
  }
}

export function disconnectSocket() {
  joinedConvs.clear()
  if (authRetryTimer) {
    clearTimeout(authRetryTimer)
    authRetryTimer = null
  }
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

/** Tham gia / rời phòng hội thoại để nhận realtime của conversation đó. */
export function joinConversation(convId: string) {
  joinedConvs.add(convId)
  getSocket().emit('join:conv', convId)
}
export function leaveConversation(convId: string) {
  joinedConvs.delete(convId)
  getSocket().emit('leave:conv', convId)
}
