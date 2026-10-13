# Kiến trúc chạy thật (Release 1)

Phạm vi: bố cục tiến trình, ranh giới và LÝ DO. Hành vi chi tiết nằm ở code; cách vận hành ở `docs/deployment.md`; cutover ở `docs/cutover-runbook.md`; lý do chọn gói và số đo ở `docs/stack-decisions.md`; lệnh ở `docs/commands.md`. Release 2 (web, REST, auth, MCP) chưa nằm trong tài liệu này vì chưa chạy trên prod.

## Bố cục

```
 Coolify host (Traefik)                              mạng ngoài `sab-db` (tạo tay)
 ┌─ Resource A: Postgres (riêng) ───────┐   ┌─ Resource B: app compose (repo, nhánh main) ───────────────┐
 │ alias `sab-postgres`, không `ports:`  │<─>│ sab-release  (one-shot) ──service_completed_successfully──┐ │
 │ role: migrate · runtime · backup      │   │ sab-server   (Necord bot + Prisma + pg-boss + /health) <───┘ │
 │ dữ liệu: /srv/appdata/sab-delegate/   │   │ sab-backup   (vòng sleep tới 03:00, role backup)             │
 └───────────────────────────────────────┘   └──────────────────────────────────────────────────────────────┘
```

Nơi sở hữu: `coolify.compose.yml` (stack prod), `deploy/postgres.compose.yml` (nội dung resource Postgres), `apps/server/Dockerfile` (target `runner`, `release`), `apps/server/scripts/` (release, backup, restore drill).

## Quyết định và lý do

| Quyết định | Lý do (không suy lại khi chưa có bằng chứng mới) |
| --- | --- |
| MỘT tiến trình NestJS (Fastify) chứa bot Necord, Prisma và pg-boss | Một bot Sabi thay cho hai token cũ; không Redis/BullMQ; lịch hẹn và cron nằm trong Postgres nên sống qua restart |
| Postgres là resource Coolify RIÊNG, không nằm trong compose app | Coolify xoá và dựng lại CẢ stack compose mỗi deploy; DB không được restart theo mỗi lần đẩy code |
| Image DB `postgres:18` Debian, ghim theo digest; session `-c timezone=UTC` | `uuidv7()` cần PG18; glibc cho `lower()` tiếng Việt; hai bài học ở `mem:lessons/deploy/coolify-host-images-and-build-cache` và `mem:lessons/postgres-prisma/ids-time-image` |
| `sab-release` one-shot chạy TRƯỚC server, server `depends_on` dạng map `service_completed_successfully` | Migrate lỗi thì server không khởi động; dạng list không chờ |
| Backup là service riêng, KHÔNG có BackupModule trong server | Server không giữ quyền ghi/xoá dump; một `backup.sh` dùng chung cho release và job hằng ngày |
| Ba role Postgres: `migrate` (DDL, chỉ release), `runtime` (DML, server), `backup` (đọc) | Server bị chiếm cũng không đổi được schema; runtime không có `CREATE` |
| Chỉ ba service tham gia `sab-db`; mỗi service có khối `environment:` tường minh | Coolify bơm env rộng; token và mật khẩu chỉ tới service cần nó. `TOKENS` cũ không nằm trong bất kỳ allowlist nào |
| Slash command KHÔNG kiểm quyền người gọi | Luật chủ bot; xem `docs/commands.md` |

## Trong `sab-server`

Điểm vào `apps/server/src/main.ts`; cổng cố định 3100. Module gốc `apps/server/src/app.module.ts`.

| Thành phần | Vai trò | Ghi chú đáng nhớ |
| --- | --- | --- |
| `config/env.ts` | Zod validate env lúc boot (fail-fast, chỉ in TÊN biến) | Thay cho `${VAR:?}` |
| `prisma/` | Prisma 7 + `adapter-pg`, pool luôn UTC | Không gọi Discord API trong `$transaction` |
| `jobs/` | Facade pg-boss, một cửa duy nhất | Runtime không `CREATE`: không tự cài schema `pgboss`, release làm việc đó |
| `app-state/` | Cặp khoá-giá trị (băm bộ lệnh đã đăng ký) | Xem phần đăng ký lệnh |
| `discord/` | `BootGuard`, `CommandRegistrar`, `DiscordReadyService` | Xem bên dưới |
| `modules/*` | Một module cho mỗi nhóm lệnh: guild-config, system, birthday, note, reactions, word-game, schedule, messaging, mention, role-assign, thread, purge, activity, attendance, info | Danh sách thật ở `modules/feature-modules.ts` |
| `health/` | `/health` readiness, `/health/live` liveness | Xem bên dưới |
| `tools/migrate-quickdb/` | Công cụ nạp quick.db và `export-claims` | TẠM THỜI, xoá cùng bot cũ |

### Khởi động

1. `loadEnv()` kiểm toàn bộ env trước khi mở socket.
2. `BootGuard` gọi `GET /users/@me` và từ chối nếu token thuộc application không khớp `DISCORD_CLIENT_ID` hoặc không nằm trong `DISCORD_ALLOWED_APP_IDS`. Lý do: token prod dán nhầm vào bản dev sẽ đăng nhập rồi GHI ĐÈ lệnh của application đó.
3. Necord đăng nhập. Khi `clientReady`, registrar đăng ký lệnh, rồi `DiscordReadyService` mở cổng: worker pg-boss và cron chỉ đăng ký SAU bước này (worker nhận job khi bot chưa gửi được tin thì job hỏng vô ích).
4. `MIGRATION_PENDING=true`: không nạp Necord và các module cần Discord; bot không đăng nhập, không đăng ký lệnh, không cron. Dùng đúng một lần, ở cutover, để nạp dữ liệu cũ trước khi bot phục vụ.

### Đăng ký lệnh

Prod đăng ký toàn cục, dev chỉ trong `DISCORD_DEV_GUILD_ID` (bắt buộc ở dev, cấm ở prod: tránh kéo lệnh khỏi guild thật). Băm payload lưu trong `AppState` theo application và phạm vi; băm khớp vẫn phải đối chiếu `GET` với Discord vì lệnh có thể bị xoá tay hoặc bị `CREATE_CMD` của bản cũ thay. Bulk `PUT` thay CẢ bộ lệnh, nên bộ lệnh khai báo phải đủ trước khi deploy prod. `COMMANDS_FORCE_RESET` là cờ một lần: xoá rồi đăng ký lại; chỉ trong phạm vi của chính môi trường đó. Cách dùng: `docs/deployment.md`.

### Health

- `GET /health`: readiness. 200 khi Postgres trả lời VÀ Discord đã `ready`; 503 nếu không; `migration-pending` là trạng thái khoẻ hợp lệ riêng. HEALTHCHECK của image và compose bám cái này, để Coolify không coi bản mới là lên trước khi gateway lên.
- `GET /health/live`: chỉ báo tiến trình sống, không phụ thuộc gì. Phải xanh khi Postgres đang restart hoặc gateway đang nối lại, nếu không bộ giám sát sẽ giết đúng tiến trình đang tự hồi phục.

### Tắt máy (SIGTERM)

Thứ tự quan trọng vì job đang chạy vẫn dùng client và pool:

1. `onModuleDestroy`: pg-boss `stop({ graceful: true })` chờ job đang chạy (tối đa 30 s); cờ "đang dừng" bật để vòng lặp qua nhiều guild dừng giữa chừng.
2. `beforeApplicationShutdown`: `client.destroy()` (cổng gateway).
3. `onApplicationShutdown`: Prisma `$disconnect` và đóng pool.

`stop_grace_period` của compose phải lớn hơn 30 s (45 s). Nếu Prisma đóng sớm hơn pg-boss, job dang dở sẽ thấy pool đã chết; bài học ở `docs/stack-decisions.md` mục 2.2.

## Dòng dữ liệu

**Sinh nhật.** pg-boss lịch `0 0 * * *` múi giờ `Asia/Ho_Chi_Minh` (queue `birthday-daily`), cộng bù khi lỡ. Handler còn chạy ngay khi bot `ready`, vì lịch có thể trễ và tiến trình có thể vừa khởi động lại. Mọi lần chạy đều an toàn khi lặp: lease theo ngày trong `BirthdayService` quyết định ai chúc, tính "hôm nay" theo giờ Việt Nam từ đồng hồ. Hệ quả: deploy hay restart quanh 00:00 không chúc đôi và không bỏ sót.

**Hẹn giờ gửi tin.** Lệnh ghi một dòng trong DB rồi, SAU commit, đẩy job (queue `scheduled-message-send`, id job = id dòng, nên retry không tạo job trùng). Worker nhận job, giữ lease trên dòng bằng cập nhật có điều kiện rồi mới gửi; ghi kết quả cũng có điều kiện theo lease. Tiến trình chết giữa lúc gửi thì lease hết hạn và lần chạy sau gửi nốt (at-least-once, cửa sổ trùng hẹp). Lịch KHÔNG còn mất khi deploy, khác bản cũ giữ trong RAM. Nội dung/tệp đọc lúc đến giờ (`schedule-copy`).

## Sổ tay đọc tiếp

- Số đo thật và gói đã loại: `docs/stack-decisions.md`.
- Vận hành, backup, đăng ký lại lệnh: `docs/deployment.md`.
- Thay bot cũ: `docs/cutover-runbook.md`.
- Luật cứng và bài học đã đo: `AGENTS.md` và serena `mem:lessons/index`.
