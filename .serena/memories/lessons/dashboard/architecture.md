# Kiến trúc mới (chủ repo chốt 2026-10-10)

## Một bot
- Gộp Alohomora vào Sabi. Danh tính theo server bằng `guild.members.editMe({ nick, avatar })` (Discord cho bot đặt avatar/banner/bio theo guild từ 10/9/2025; nick cần CHANGE_NICKNAME).
- Đo 10/10: Sabi 9 guild, Alohomora 3; trùng ở 713025650176294945 và 991859002881355828; riêng Alohomora: 892803326377336863 (21CNTN-APCS-CTT-CLC02) → phải mời Sabi vào đó trước khi gỡ Alohomora (chủ repo tự làm).
- Menu `/` và DM luôn hiện tên/icon TOÀN CỤC của ứng dụng; nickname/avatar riêng chỉ hiện trong server.
- Hệ quả: bỏ được `claimOnce` chống trùng giữa client khi chỉ còn 1 client.

## Stack
- NestJS + Fastify, **Necord** (1 bot/tiến trình theo FAQ Necord), Prisma + Postgres, **pg-boss** cho lịch hẹn/cron.
- KHÔNG: Redis, BullMQ, MinIO/SeaweedFS.
- Avatar: không cần object storage — ảnh gửi base64 lên Discord, Discord giữ trên CDN; đọc lại bằng `member.avatarURL()`. Chỉ cần lưu nếu muốn khôi phục/lịch sử → cột bytea Postgres. Thêm SeaweedFS khi có nhiều file người dùng tải lên (image đã có trên host).
- Song ngữ vi/en: next-intl (web) + `use-intl/core` `createTranslator` (bot) cùng `messages/{vi,en}.json`; mô tả lệnh qua `setDescriptionLocalizations`, tên lệnh giữ nguyên.
- Cấu trúc: `packages/shared` (Zod + messages), `apps/server` (module = service + HTTP controller + Necord commands), `apps/web`. Lệnh slash không kiểm quyền; HTTP có guard Manage Server.
- Postgres: image `postgres:17.10-alpine3.23` (có sẵn trên host), bind mount `/srv/appdata/sab-delegate/postgres`; từ điển trò nối từ để ở file JSON, không đưa vào DB.

## Lập lịch: pg-boss, không Redis/BullMQ/node-cron (chủ repo xác nhận 22:14 10/10)
- node-schedule/node-cron chỉ là bộ đếm giờ trong RAM → mất lịch mỗi lần restart (mỗi deploy web là restart).
- pg-boss: `send(queue, data, { startAfter })` cho hẹn một lần, `schedule(name, cron, data, { tz: 'Asia/Ho_Chi_Minh' })` cho cron, retry, huỷ theo job id cố định; worker poll mặc định 2s.
- Chưa kiểm chứng: cron lỡ giờ khi bot tắt có được bù không (sinh nhật đã tự chạy lại lúc ready + cờ theo ngày nên không phụ thuộc).
- Cần Redis khi: nhiều tiến trình bot (sharding ≥2.500 guild), pub/sub giữa tiến trình, cache đọc nhiều.
