/**
 * mention-rule.ts — Luật "chỉ trả lời khi được nhắc tên" cho hội thoại nhóm.
 *
 * Trong nhóm, AI trả lời mọi câu là phá hội thoại của người thật: khách đang
 * nói với nhau thì bot chen vào. Bật luật này thì bot ngồi im cho tới khi có
 * người gọi đích danh.
 *
 * Chỉ áp dụng cho NHÓM. Hội thoại một-một thì mọi câu đều là nói với mình, bắt
 * khách phải gõ tên bot mới được trả lời là vô lý.
 */
import { prisma } from '../../shared/prisma-client.js'

/** Bỏ dấu tiếng Việt để so tên — khách gõ "tro ly" cũng phải nhận ra. */
export function boDau(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
}

function chuanHoa(s: string): string {
  return boDau(s).toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Tin này có nhắc tới một trong các tên gọi không?
 *
 * Nhận cả hai kiểu: `@Tên` do Zalo chèn khi tag, và gọi tên trần trong câu
 * ("trợ lý ơi cho hỏi") — nhân viên và khách hay gõ kiểu sau.
 *
 * So theo RANH GIỚI TỪ chứ không phải chuỗi con: tên "AI" mà so chuỗi con thì
 * "cái" hay "email" cũng thành được nhắc.
 */
export function coNhacTen(noiDung: string, tenGoi: string[]): boolean {
  const text = chuanHoa(noiDung)
  if (!text) return false
  for (const ten of tenGoi) {
    const t = chuanHoa(ten)
    if (!t) continue
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // (^|ký tự không phải chữ số) tên (ký tự không phải chữ số|hết câu)
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(text)) return true
  }
  return false
}

/**
 * Danh sách tên gọi của tổ chức.
 *
 * Ưu tiên tên do người dùng tự đặt; bỏ trống thì lấy tên các bot đang bật, để
 * bật luật lên là chạy được ngay mà không phải khai báo gì thêm.
 */
export async function layTenGoi(orgId: string, tenTuDat: string | null): Promise<string[]> {
  const tuDat = (tenTuDat ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tuDat.length) return tuDat

  const bots = await prisma.aiBot.findMany({
    where: { orgId, enabled: true },
    select: { name: true },
  })
  return bots.map((b) => b.name).filter(Boolean)
}

/**
 * Có được phép để AI trả lời tin này không?
 *
 * Trả về `true` khi không vướng luật. Hội thoại một-một luôn đi qua; nhóm thì
 * phải có tên được nhắc.
 */
export async function duocPhepTraLoi(input: {
  orgId: string
  laNhom: boolean
  noiDung: string
  batLuat: boolean
  tenTuDat: string | null
}): Promise<{ duoc: boolean; lyDo?: string }> {
  if (!input.laNhom || !input.batLuat) return { duoc: true }

  const ten = await layTenGoi(input.orgId, input.tenTuDat)
  // Không có tên nào để nhận biết thì luật vô nghĩa — thà trả lời còn hơn câm
  // lặng mà người dùng không hiểu vì sao.
  if (!ten.length) return { duoc: true }

  return coNhacTen(input.noiDung, ten)
    ? { duoc: true }
    : { duoc: false, lyDo: `nhóm chưa nhắc tên (${ten.join(', ')})` }
}
