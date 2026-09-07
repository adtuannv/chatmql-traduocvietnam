/**
 * rbac-seed.ts — Đồng bộ danh mục quyền và vai trò gốc vào DB lúc khởi động.
 *
 * `permission-registry.ts` là nguồn sự thật; bảng DB chỉ là bản sao để join.
 * Chạy mỗi lần boot nên thêm quyền mới chỉ cần sửa registry rồi khởi động lại.
 *
 * Nguyên tắc khi seed vai trò gốc:
 *  - Tạo nếu chưa có, KHÔNG ghi đè `name`/`description` nếu tổ chức đã sửa
 *  - Quyền của vai trò gốc thì LUÔN đồng bộ lại theo registry — đây là hợp đồng
 *    của hệ thống, không phải thứ tổ chức tự chỉnh
 *  - `owner`/`admin` không cho sửa quyền ở tầng API (xem role-routes.ts)
 */
import { prisma } from '../../shared/prisma-client.js'
import { PERMISSIONS, SYSTEM_ROLES, permissionsOf } from '../../shared/permission-registry.js'
import { logger } from '../../shared/logger.js'

/** Ghi danh mục quyền. Quyền bị gỡ khỏi registry sẽ bị xoá khỏi DB luôn. */
async function syncPermissionCatalog(): Promise<void> {
  await prisma.$transaction([
    ...PERMISSIONS.map((p) =>
      prisma.permission.upsert({
        where: { key: p.key },
        update: { module: p.module, action: p.action, label: p.label, group: p.group, sortOrder: p.sortOrder },
        create: p,
      }),
    ),
    prisma.permission.deleteMany({ where: { key: { notIn: PERMISSIONS.map((p) => p.key) } } }),
  ])
}

/** Dựng 4 vai trò gốc cho một tổ chức. */
async function seedRolesForOrg(orgId: string): Promise<void> {
  for (const def of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({
      where: { orgId, systemKey: def.systemKey },
      select: { id: true },
    })

    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          // Chỉ giữ cờ hệ thống. Tên, mô tả và PHẠM VI để tổ chức tự chỉnh —
          // ép lại mỗi lần khởi động sẽ xoá sạch cấu hình họ vừa lưu.
          data: { isSystem: true },
        })
      : await prisma.role.create({
          data: {
            orgId,
            name: def.name,
            description: def.description,
            isSystem: true,
            systemKey: def.systemKey,
            dataScope: def.dataScope,
          },
        })

    // Quyền chỉ nạp khi vai trò MỚI được tạo. Ghi đè mỗi lần boot khiến admin
    // sửa quyền của Quản lý/Nhân viên xong khởi động lại là mất trắng.
    //
    // Ngoại lệ: `owner` LUÔN bị ép về toàn quyền. Đây là chốt chống tự khoá cửa —
    // gỡ nhầm quyền của chủ sở hữu là không còn ai vào sửa lại được.
    const isNew = !existing
    const forceFullSync = def.systemKey === 'owner'
    if (isNew || forceFullSync) {
      const keys = permissionsOf(def)
      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
        prisma.rolePermission.createMany({
          data: keys.map((permissionKey) => ({ roleId: role.id, permissionKey })),
          skipDuplicates: true,
        }),
      ])
    } else {
      // Quyền mới thêm vào registry vẫn phải xuất hiện, nhưng chỉ BỔ SUNG cho
      // owner/admin — vai trò khác để admin tự quyết có bật hay không.
      if (def.systemKey === 'admin') {
        await prisma.rolePermission.createMany({
          data: permissionsOf(def).map((permissionKey) => ({ roleId: role.id, permissionKey })),
          skipDuplicates: true,
        })
      }
    }
  }
}

/**
 * Nối `User.roleId` cho những người chưa gán, dựa theo cột `role` cũ.
 * Không đổi hành vi — giai đoạn 1 vẫn đọc `User.role` để quyết định.
 */
async function backfillUserRoles(orgId: string): Promise<number> {
  const roles = await prisma.role.findMany({
    where: { orgId, systemKey: { not: null } },
    select: { id: true, systemKey: true },
  })
  const byKey = new Map(roles.map((r) => [r.systemKey as string, r.id]))

  let updated = 0
  for (const [systemKey, roleId] of byKey) {
    const res = await prisma.user.updateMany({
      where: { orgId, role: systemKey, roleId: null },
      data: { roleId },
    })
    updated += res.count
  }
  return updated
}

/** Gọi một lần lúc khởi động app. */
export async function syncRbac(): Promise<void> {
  try {
    await syncPermissionCatalog()
    const orgs = await prisma.organization.findMany({ select: { id: true } })
    let linked = 0
    for (const org of orgs) {
      await seedRolesForOrg(org.id)
      linked += await backfillUserRoles(org.id)
    }
    logger.info(
      { permissions: PERMISSIONS.length, orgs: orgs.length, usersLinked: linked },
      '[rbac] danh mục quyền và vai trò gốc đã đồng bộ',
    )
  } catch (err) {
    // Không chặn khởi động: giai đoạn 1 chưa có hiệu lực, thiếu bảng cũng vẫn chạy được.
    logger.error({ err }, '[rbac] đồng bộ thất bại — hệ thống vẫn chạy bằng cột User.role cũ')
  }
}
