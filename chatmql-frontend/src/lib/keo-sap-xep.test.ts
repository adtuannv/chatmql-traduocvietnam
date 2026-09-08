/**
 * Đổi chỗ phần tử khi kéo thả.
 *
 * Thứ tự ảnh có ý nghĩa thật: tấm đầu là ảnh đại diện, cũng là tấm khách nhìn
 * thấy trước tiên khi sale gửi sản phẩm. Sai một bước là gửi nhầm ảnh.
 */
import { describe, it, expect } from 'vitest'
import { doiCho } from './keo-sap-xep'

const ds = ['a', 'b', 'c', 'd']

describe('doiCho', () => {
  it('kéo ra sau: phần tử chen vào đúng vị trí thả', () => {
    expect(doiCho(ds, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('kéo lên trước', () => {
    expect(doiCho(ds, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('kéo lên đầu là đổi ảnh đại diện', () => {
    expect(doiCho(ds, 2, 0)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('thả đúng chỗ cũ thì không đổi gì', () => {
    expect(doiCho(ds, 1, 1)).toEqual(ds)
  })

  it('vị trí ngoài mảng thì giữ nguyên, không vỡ', () => {
    for (const [tu, den] of [[-1, 0], [0, 9], [9, 0], [0, -1]] as const) {
      expect(doiCho(ds, tu, den)).toEqual(ds)
    }
  })

  it('không sửa mảng gốc', () => {
    const goc = [...ds]
    doiCho(ds, 0, 3)
    expect(ds).toEqual(goc)
  })
})
