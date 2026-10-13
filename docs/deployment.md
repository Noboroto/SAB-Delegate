# Triển khai và vận hành

Phạm vi: cách deploy, cấu hình Coolify, kiểm sau deploy, backup, đăng ký lại lệnh. Kiến trúc và lý do ở `docs/architecture.md`; thay bot cũ ở `docs/cutover-runbook.md`; luật cứng ở `AGENTS.md`. Chỗ ghi "(xác nhận sau khi compose xong)" mô tả theo hợp đồng thiết kế, phải đối chiếu lại với `coolify.compose.yml` và script thật khi các file đó hoàn tất. Con số đo được ghi ở `mem:lessons/deploy/*`, không chép lại đây.

## Nơi sở hữu từng thứ

| Việc | Nguồn thật |
| --- | --- |
| Service, mạng, healthcheck, giới hạn, bind mount | `coolify.compose.yml` |
| Resource Postgres (image, lệnh, mount) | `deploy/postgres.compose.yml` (xác nhận sau khi compose xong) |
| Stack chạy thử cục bộ | `compose.yml`, `deploy/local-smoke.compose.yml` (xác nhận sau khi compose xong) |
| Release (kiểm rỗng, dump, migrate, cấp quyền) | `apps/server/scripts/release.sh` |
| Backup, restore drill | `apps/server/scripts/backup.sh`, `restore-drill.sh` (xác nhận sau khi compose xong) |
| Hợp lệ của biến môi trường | `apps/server/src/config/env.ts` |
| Luật compose (cấm `ports`, named volume...) | `scripts/compose-rules.guard.test.ts` (xác nhận sau khi compose xong) |

## Tài nguyên trên Coolify

- MỘT app Coolify duy nhất (repo, nhánh `main`, build pack Docker Compose, đường dẫn `/coolify.compose.yml`). Không tạo app thứ hai; không có staging. Push `main` là deploy prod; push `dev` KHÔNG deploy (kiểm khi cấu hình).
- Resource Postgres riêng, mạng ngoài `sab-db` tạo tay, alias `sab-postgres`, không `ports:`. Dữ liệu tại `/srv/appdata/sab-delegate/postgres` (PG18 mount `/var/lib/postgresql`, không phải `/data`). Mật khẩu superuser chỉ nằm trong resource này.
- Chỉ `sab-release`, `sab-server`, `sab-backup` vào `sab-db`.
- Bind mount tuyệt đối dưới `/srv/appdata/sab-delegate/`, mount THƯ MỤC (không mount file đơn). Cấm bấm "Convert to directory".
- Không `${VAR:?}`, named volume, `container_name`, `ports:`, `cpus:` cấp service, `restart: always`. Giới hạn chỉ qua `deploy.resources.limits.*`. Biến bắt buộc fail-fast bằng Zod lúc boot.
- `stop_signal: SIGTERM`, `stop_grace_period: 45s` (lớn hơn 30 s drain của pg-boss), `pull_policy: never`, `depends_on` dạng map `service_completed_successfully` cho `sab-release`, `restart: "no"` cho release, `restart: unless-stopped` cho server và backup.
- Mọi biến bí mật đặt `is_buildtime=false`. Coolify bơm env thành `ARG` vào mọi stage, nên mọi `pnpm install` trong Dockerfile phải ghi `--prod` hoặc `--no-prod`.

## Biến môi trường theo service (chỉ TÊN)

Bảng này, `env.ts`, khối `environment:` của compose và `.env.example` phải khớp hai chiều. Bí mật in đậm. Không `env_file`; `sab-release` KHÔNG có biến `DISCORD_*`.

| Service | Biến |
| --- | --- |
| `sab-server` | `APP_ENV`, **`DISCORD_TOKEN`**, `DISCORD_CLIENT_ID`, `DISCORD_ALLOWED_APP_IDS`, `ADMIN_GUILD_ID`, `MIGRATION_PENDING`, `COMMANDS_FORCE_RESET`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, **`POSTGRES_PASSWORD`** (role runtime), `DB_POOL_MAX`, `PGBOSS_POOL_MAX`, `PGBOSS_WORKERS_ENABLED`, `LOG_LEVEL`. `DISCORD_DEV_GUILD_ID` chỉ ở dev cục bộ, CẤM ở production |
| `sab-release` | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` (role runtime, để cấp quyền), `POSTGRES_MIGRATE_USER`, **`POSTGRES_MIGRATE_PASSWORD`**, `BACKUP_ENABLED`, `BACKUP_KEEP_PRE_MIGRATE`, cùng các biến backup nếu release gọi `backup.sh` |
| `sab-backup` | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_BACKUP_USER`, **`POSTGRES_BACKUP_PASSWORD`**, `BACKUP_ENABLED`, `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_PRE_MIGRATE` |
| Không service mới nào | `TOKENS` (cũ). Giữ trên Coolify tới hết cửa sổ rollback nhưng NGOÀI mọi allowlist |
| Máy owner, tạm | `LEGACY_BOT_TOKEN`, `LEGACY_CLIENT_ID` (script dọn lệnh Alohomora); không bao giờ vào compose |

(xác nhận sau khi compose xong: danh sách thật của từng khối `environment:`; `COMMANDS_FORCE_RESET` chỉ đặt tạm, xem mục đăng ký lại lệnh.)

Kiểm: `docker exec <container> env | cut -d= -f1` cho từng container, so với bảng; không `TOKENS`. Không in giá trị, không `docker compose config` đã nội suy.

## Giảm downtime khi deploy

Coolify xoá rồi dựng lại cả stack mỗi deploy, và một token chỉ đăng nhập gateway ở một nơi, nên KHÔNG có zero-downtime. Mục tiêu là khoảng dừng ngắn, đoán trước được. Đo và lý do: `mem:lessons/deploy/low-downtime-deploy`.

- Build trước, dừng sau: không `docker stop` tay trước khi push.
- Build tuần tự, mỗi lần một image. `df -h /` trước build; trên 85% chỉ `docker image prune -f` và `docker builder prune -f --filter until=24h`, không `-a`, `system`, `volume`.
- KHÔNG deploy trong 23:30–00:30 (giờ Việt Nam): Coolify prune ép buộc lúc 00:00, mất cache image; và đó cũng là giờ cron sinh nhật.
- Thứ tự migration theo loại: thêm (additive) thì migrate rồi swap; xoá hoặc thu hẹp thì swap trước, migrate ở deploy sau (expand rồi contract). Release chạy TRƯỚC khi app mới thay app cũ nên mọi migration phải tương thích bản app cũ. Checklist review: không NOT NULL không default, không đổi tên hoặc xoá cột trong cùng release.
- Commit chỉ đổi tài liệu hoặc memory dùng `[skip cd]`; mọi push `main` khác đều làm bot rớt mạng.
- Trước push `main`: `docker compose -f coolify.compose.yml config -q` với giá trị giả (lỗi validate làm deploy fail im lặng trong khi container cũ vẫn chạy). Đổi dependency, đường import hoặc tên file: build image Linux (`--target runner`) và `require` thử TRONG image (macOS không phân biệt hoa/thường).
- Migration đã commit và push TRƯỚC deploy; Prisma in "No pending migrations" kể cả khi quên commit.

## Kiểm sau deploy

1. Trong 10 giây phải có deployment mới: `docker exec coolify-db psql -U coolify -d coolify -At -c "select status from application_deployment_queues order by id desc limit 1"`. Không có thì kích tay (webhook có thể không bắn).
2. `docker ps`: ba service đúng trạng thái (`sab-release` Exited 0, `sab-server` và `sab-backup` Up), 0 restart.
3. Log `sab-server` có `Ready! Logged in as …`; `#bot-log` yên.
4. `GET /health` trả `ok` (cả `database` và `discord` là `up`).
5. `_prisma_migrations` khớp thư mục `apps/server/prisma/migrations` (số dòng, không dòng nào chưa `finished_at`), và đếm dữ liệu thật so với mốc trước deploy.
6. `docker history --no-trunc <image> | grep -c '<TÊN_SECRET>='` bằng 0 cho cả ba image.
7. Giữ id deployment và tag/SHA cũ để rollback nhanh.

## Backup và restore

- Một script `backup.sh` dùng cho release (tag `pre-migrate`, chạy mỗi lần Postgres đã có bảng, TRƯỚC `prisma migrate deploy`) và job hằng ngày `sab-backup` (`0 3 * * *`, `Asia/Ho_Chi_Minh`, tag `daily`). Dump hỏng thì release dừng, server không khởi động.
- Dump `pg_dump -Fc`, kiểm bằng `pg_restore --list`, đổi tên nguyên tử; file 0600, thư mục `/srv/appdata/sab-delegate/backups` 0700. Tên `<db>-<tag>-<UTC>.dump`; xoay vòng chỉ trong cùng tiền tố `<db>-<tag>-` (`daily` giữ 14, `pre-migrate` giữ 5). Tag khác (`baseline`, `pre-cutover`, `pre-rollback`) KHÔNG xoay. (xác nhận sau khi compose xong: số giữ, đường dẫn)
- Dump trước thay đổi rủi ro (cutover, rollback, migration lớn) copy thêm sang `/srv/appdata/_archive/sab-delegate/`, ngoài vòng xoay.
- Ngoại lệ có ghi nhận: chủ host không đề xuất backup định kỳ, nhưng owner repo QUYẾT ĐỊNH có backup hằng ngày. Điều kiện giữ ngoại lệ: restore drill đạt. Không có bản sao ngoài máy chủ ở Release 1; owner tải tay dump `baseline` về máy riêng sau cutover.
- Restore drill (`restore-drill.sh`): khôi phục dump mới nhất vào database tạm, đếm row so với nguồn, rồi xoá database tạm. Chạy sau khi dựng và sau mỗi thay đổi lớn của schema hoặc script backup. Khôi phục thật: dừng app, `pg_restore --clean --if-exists`, đọc lại số dòng bằng kết nối MỚI.
- Cấm `docker compose down -v`; cấm `prisma migrate dev|reset` và `db push` trên DB không phải máy dev.

## Log và giám sát

- `docker logs` theo service; tìm container bằng nhãn `com.docker.compose.project` và `com.docker.compose.service`. Log pino đã che bí mật.
- Lỗi lệnh bất ngờ gửi vào kênh `bot-log` của guild quản trị. Probe giám sát dùng `/health/live` cho "sống" (không bao giờ kéo DB vào), `/health` cho "sẵn sàng".

## Đăng ký lại lệnh

Mặc định bot tự đăng ký khi băm payload đổi hoặc khi Discord giữ bộ khác (đối chiếu `GET`). Chỉ cần thủ công khi muốn dọn lệnh thừa.

`COMMANDS_FORCE_RESET=true` là cờ MỘT LẦN: ở lần boot tiếp theo, ngay sau `Ready`, bot xoá toàn bộ lệnh trong phạm vi của môi trường (prod: toàn cục; dev: chỉ guild dev) rồi đăng ký lại đủ bộ. Owner cho phép xoá và đăng ký lại. Quy trình:

1. Đặt `COMMANDS_FORCE_RESET=true` trên Coolify, redeploy.
2. Chờ `Ready` và dòng log "Registered … after the wipe"; đọc lại `GET /applications/{id}/commands` (hoặc xem trong Discord) để chắc bộ lệnh đủ.
3. Bỏ biến (hoặc đặt `false`) và redeploy NGAY. Còn cờ thì MỌI lần boot sau đều xoá lệnh; log cảnh báo `COMMANDS_FORCE_RESET is still set`.

Ghi chú: giữa hai bước xoá và đăng ký, lệnh biến mất ngắn; đăng ký lại có thử lại nhiều lần, thất bại hẳn thì lần boot sau tự đăng ký bù. Từ chối xoá lệnh toàn cục nếu bộ khai báo rỗng. Lệnh của Alohomora (app cũ) không thuộc phạm vi này: dọn bằng script riêng ở runbook cutover.

## Bot dev

- Chỉ test tương tác bằng app Discord riêng ("SAB Dev") và guild thử; `APP_ENV=development`, `DISCORD_DEV_GUILD_ID` đặt, `DISCORD_ALLOWED_APP_IDS` chỉ gồm SAB Dev, `BACKUP_ENABLED=false`.
- KHÔNG dùng chung token prod cho dev. Đã đo: hai tiến trình cùng một token cùng nhận mọi interaction (một bên thắng, bên kia nhận lỗi 10062), lệnh guild và toàn cục cùng tên hiện đôi, và bản bot cũ ghi vào dữ liệu prod. Chi tiết: `mem:lessons/discord/shared-token-dev-bot`. Token prod chỉ chấp nhận cho kiểm boot/đăng nhập/đăng ký, không tương tác, và phải dừng ngay sau đó.
- `BootGuard` + `DISCORD_ALLOWED_APP_IDS` là lớp chặn dán nhầm token; đừng nới danh sách để "cho chạy được".
- Chỉ MỘT worker dev dùng chung một Postgres (nhiều worker cùng consume job); đặt `PGBOSS_WORKERS_ENABLED=false` ở tiến trình phụ.

## Số đo cần ghi lại sau khi có

Phần này để TRỐNG có chủ đích tới khi đo thật; không điền số ước lượng.

- SIGTERM tới `Ready` của một lần redeploy trên Coolify, đo bằng probe 1 req/s vào `/health` kèm trạng thái online của bot.
- Thời gian build lạnh ba image trên host; `max_connections` thật so với tổng pool (Prisma + pg-boss + job migrate/backup).
- Mạng ngoài và alias, `service_completed_successfully`, Coolify có bơm env ngoài `environment:` hay không, cách chạy job backup ngoài server (Scheduled Task hay cron host).
