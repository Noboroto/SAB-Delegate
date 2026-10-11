# Quyền vào dashboard = Manage Server của Discord

Chủ bot quyết (2026-10-10): "Dashboard == check permission manage bot của discord".
- Discord không có quyền "manage bot"; quyền quản lý bot/integration trong server là **Manage Server** (`PermissionFlagsBits.ManageGuild`). Administrator bao hàm nó; chủ guild luôn qua.
- Người đăng nhập (Discord OAuth, scope `identify`) chỉ thấy và sửa những guild mà: bot có mặt VÀ họ có ManageGuild (hoặc Administrator/owner) trong guild đó.
- Kiểm ở phía bot (API nội bộ) cho MỌI request, lấy từ dữ liệu Discord thật (fetch member), không tin client/cookie.

**Why**: dashboard là đường ghi dữ liệu mới từ Internet; khác với lệnh slash (bot cố ý vượt giới hạn, `mem:lessons/discord/bypass-by-design`), dashboard bắt buộc có cổng quyền này.
**How to apply**: không thêm cổng khác (danh sách ID riêng, RBAC) trừ khi chủ bot yêu cầu; không bỏ cổng này.

## Domain (chủ bot chốt 2026-10-10)
- Dashboard ở `https://bot.sabies.vn`. Discord OAuth redirect: `https://bot.sabies.vn/api/auth/callback/discord`.
- DNS đã có (đo 2026-10-11): `bot.sabies.vn` là CNAME → `sabies.vn` → 103.82.192.210 (host Coolify), kiểm qua resolver mặc định và 1.1.1.1. Có thể gắn domain trong Coolify (Let's Encrypt cần DNS trỏ đúng — đã đúng).

## Bổ sung từ bài học các repo khác (11/10/2026)
- Cổng quyền là MỘT hàm `canManageGuild` trong `packages/shared` dùng cho UI/API/job; chỉ guard Nest enforce quyền, `proxy.ts` Next chỉ redirect lạc quan theo cookie; client mutation qua một wrapper fetch xử lý 401/403. Chi tiết: `mem:lessons/nestjs/di-and-build`.
