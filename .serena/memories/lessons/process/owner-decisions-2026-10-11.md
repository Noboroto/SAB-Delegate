# Quyết định của chủ repo ngày 11/10/2026 ("làm toàn bộ theo recommend")

Áp cho đợt tái kiến trúc monorepo; chi tiết kiến trúc: `mem:lessons/dashboard/architecture`.

- **C1 Postgres là resource Coolify RIÊNG**, không nằm trong compose server/web (Coolify recreate cả stack mỗi deploy ~60 s). App nối qua mạng ngoài tạo tay `external: true` ở cả hai compose, gọi bằng tên service (mẫu mạng `observability` trên host).
- **C2 Hook commit-msg** chặn mention AI (claude/anthropic/codex/chatgpt, trừ token `CLAUDE.md`) → commit message không có dòng attribution AI.
- **C3 Dev server/compose stack** chỉ orchestrator bật/tắt, dưới khoá heavy, dừng khi nghỉ; subagent cấm.
- **C4 Nhánh `dev`** cho tái kiến trúc; `main` giữ bot hiện tại chạy prod tới cutover.
- **C5 Ràng buộc dữ liệu**: Zod là chính + SQL CHECK cho bất biến quan trọng (lớp fail-closed được phép trùng).
- **C6 Hook** chép Leaderboard: trần 29 file staged, trần 1000 dòng/file không được tăng, markdown-only bỏ qua, khoá heavy, gate-stamp; pre-push chạy lại gate (trừ khi stamp khớp) + kiểm compose.
- **C7 Zod sinh từ Prisma** (`prisma-zod-generator`); validate Nest 12 bằng Standard Schema gốc — tra context7 theo bản thật trước khi code.
- **C8 Múi giờ nghiệp vụ cố định `Asia/Ho_Chi_Minh`**, DB `timestamptz` UTC, một formatter.
- **C9 Backup**: ngoại lệ so với quyết định host — `pg_dump -Fc` hằng ngày cho DB SAB-Delegate + thử restore định kỳ.
- **C10 Test DB**: Docker Postgres 18 local, cổng cố định (ghi `/tmp/cc-ports.registry`), mỗi lần chạy một schema riêng; data dir ngoài thư mục Syncthing.
- **C11 Better Auth không lưu ảnh/tên Discord** (stateless, scope identify).
- **C12 Service `release`** (pg_dump → `prisma migrate deploy`, `depends_on: service_completed_successfully`) — đo thử trên Coolify của host trước khi ghi thành luật cứng.
- **C13**: checklist responsive 390/768/1440 × sáng/tối × vi/en áp toàn bộ web; chính tả "Xoá/khoá/Huỷ" cho cả chuỗi bot và web; tên plan theo UTC (như `ak plan create`); hook chép từ Leaderboard (đã cài, lib dùng chung giữ nguyên văn).
