# Triển khai và vận hành

Phạm vi: cách deploy, cấu hình Coolify, kiểm sau deploy, backup, đăng ký lại lệnh. Kiến trúc và lý do ở `docs/architecture.md`; thay bot cũ ở `docs/cutover-runbook.md`; luật cứng ở `AGENTS.md`.

## Nơi sở hữu từng thứ

| Việc                                             | Nguồn thật                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Service, mạng, healthcheck, giới hạn, bind mount | `coolify.compose.yml`                                               |
| Đường `/api/*` và `/mcp` từ web sang server      | `apps/web/next.config.ts` (`rewrites`), `apps/web/server-origin.ts` |
| Resource Postgres (image, lệnh, mount)           | `deploy/postgres.compose.yml`                                       |
| Stack chạy thử cục bộ                            | `compose.yml`, `deploy/local-smoke.compose.yml`                     |
| Release (kiểm rỗng, dump, migrate, cấp quyền)    | `apps/server/scripts/release.sh`                                    |
| Backup, restore drill                            | `apps/server/scripts/backup.sh`, `restore-drill.sh`                 |
| Hợp lệ của biến môi trường                       | `apps/server/src/config/env.ts`                                     |
| Luật compose (cấm `ports`, named volume...)      | `scripts/compose-rules.guard.test.ts`                               |

## Tài nguyên trên Coolify

- MỘT app Coolify duy nhất (repo, nhánh `main`, build pack Docker Compose, đường dẫn `/coolify.compose.yml`). Không tạo app thứ hai; không có staging. Push `main` là deploy prod; push `dev` KHÔNG deploy (kiểm khi cấu hình).
- Resource Postgres riêng, mạng ngoài `sab-db` tạo tay, alias `sab-postgres`, không `ports:`. Dữ liệu tại `/srv/appdata/sab-delegate/postgres` (PG18 mount `/var/lib/postgresql`, không phải `/data`). Mật khẩu superuser chỉ nằm trong resource này.
- Chỉ `sab-release`, `sab-server`, `sab-backup` vào `sab-db`. `sab-web` chỉ ở mạng `default`, không biến DB, không bí mật.
- Bind mount tuyệt đối dưới `/srv/appdata/sab-delegate/`, mount THƯ MỤC (không mount file đơn). Cấm bấm "Convert to directory".
- Không `${VAR:?}`, named volume, `container_name`, `ports:`, `cpus:` cấp service, `restart: always`. Giới hạn chỉ qua `deploy.resources.limits.*`. Biến bắt buộc fail-fast bằng Zod lúc boot.
- `stop_signal: SIGTERM`, `stop_grace_period: 45s` (lớn hơn 30 s drain của pg-boss), `pull_policy: never`, `depends_on` dạng map `service_completed_successfully` cho `sab-release`, `restart: "no"` cho release, `restart: unless-stopped` cho server, backup và web. `sab-web` đợi `sab-server` ở mức `service_started` (không `service_healthy`: probe của web không đụng server, bot đăng nhập Discord chậm không được giữ dashboard).
- Mọi biến bí mật đặt `is_buildtime=false`. Coolify bơm env thành `ARG` vào mọi stage, nên mọi `pnpm install` trong Dockerfile phải ghi `--prod` hoặc `--no-prod`.

## Biến môi trường theo service (chỉ TÊN)

Bảng này, `env.ts`, khối `environment:` của compose và `.env.example` phải khớp hai chiều. Bí mật in đậm. Không `env_file`; `sab-release` KHÔNG có biến `DISCORD_*`.

| Service               | Biến                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sab-server`          | `APP_ENV`, **`DISCORD_TOKEN`**, `DISCORD_CLIENT_ID`, `DISCORD_ALLOWED_APP_IDS`, `ADMIN_GUILD_ID`, `MIGRATION_PENDING` (mặc định compose `true`: thiếu hay trống thì bot không đăng nhập; chạy thật phải đặt `false` rõ ràng), `COMMANDS_FORCE_RESET`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, **`POSTGRES_PASSWORD`** (role runtime), `DB_POOL_MAX`, `PGBOSS_POOL_MAX`, `PGBOSS_WORKERS_ENABLED`, **`DISCORD_CLIENT_SECRET`**, **`BETTER_AUTH_SECRET`** (≥ 32 ký tự), **`LLM_KEY_SECRET`** (≥ 32 ký tự, tuỳ chọn; mã hoá khoá API của mô hình ngôn ngữ, xem mục Chatbot; cũng mã hoá mật khẩu SMTP và địa chỉ email đã xác minh, xem mục Email verification trong `docs/architecture.md`; tài khoản SMTP chỉ lưu trong DB, cấu hình ở dashboard guild quản trị), `APP_URL` (origin https không path, ví dụ `https://bot.sabies.vn`), `TRUSTED_PROXY_IPS` (danh sách IP/CIDR phân cách phẩy; xem mục Release 2), `MCP_ENABLED` (mặc định `true`; `false` gỡ route `/mcp`; route chỉ có khi REST bật, tức là có `APP_URL`, và production còn cần `TRUSTED_PROXY_IPS`), `LOG_LEVEL`. Bốn biến REST/đăng nhập đi cùng nhau: có `APP_URL` mà thiếu ba biến kia (production) thì server từ chối khởi động; bỏ trống cả bốn = chỉ chạy bot `DISCORD_DEV_GUILD_ID` chỉ ở dev cục bộ, CẤM ở production |
| `sab-release`         | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` (role runtime, để cấp quyền), `POSTGRES_MIGRATE_USER`, **`POSTGRES_MIGRATE_PASSWORD`**, `BACKUP_DIR`, `BACKUP_KEEP_PRE_MIGRATE`. Không có `BACKUP_ENABLED`: release luôn dump DB không rỗng (xem mục Backup)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `sab-web`             | `NODE_ENV`, `PORT`, `HOSTNAME` (hằng số của image, không đặt trên Coolify). KHÔNG `DISCORD_*`, `POSTGRES_*`, `BETTER_AUTH_*`, `TOKENS`, không bí mật nào. `SERVER_INTERNAL_URL` cố ý vắng: đích rewrite được nướng vào image lúc build (mặc định `http://sab-server:3100`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sab-backup`          | `TZ`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_BACKUP_USER`, **`POSTGRES_BACKUP_PASSWORD`**, `BACKUP_DIR`, `BACKUP_ENABLED`, `BACKUP_KEEP_DAILY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Không service mới nào | `TOKENS` (cũ). Giữ trên Coolify tới hết cửa sổ rollback nhưng NGOÀI mọi allowlist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Máy owner, tạm        | `LEGACY_BOT_TOKEN`, `LEGACY_CLIENT_ID` (script dọn lệnh Alohomora); không bao giờ vào compose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Bảng đã đối chiếu với `coolify.compose.yml` (2026-10-15). `COMMANDS_FORCE_RESET` chỉ đặt tạm, xem mục đăng ký lại lệnh.

Kiểm: `docker exec <container> env | cut -d= -f1` cho từng container, so với bảng; không `TOKENS`. Không in giá trị, không `docker compose config` đã nội suy.

## Chatbot

Không có biến môi trường hay bước vận hành mới; chỉ cần `LLM_KEY_SECRET` đã có sẵn. Thiết kế: `docs/architecture.md` mục Chatbot.

- `LLM_KEY_SECRET` (đã có trong `coolify.compose.yml`) mã hoá khoá API của mô hình dùng chung và của từng guild. Thiếu thì không lưu được cấu hình mô hình nên chatbot không có gì để hỏi. ĐỔI giá trị làm mọi khoá đã lưu không giải mã được: guild có mô hình riêng sẽ bị coi là chưa cài (không lặng lẽ dùng khoá dùng chung) và phải nhập lại khoá.
- `LLM_KEY_SECRET` cũng là gốc của xác thực email: băm địa chỉ, địa chỉ đã mã hoá và mật khẩu SMTP đều suy từ nó. KHÔNG BAO GIỜ đổi hay xoay giá trị này sau khi có người dùng xác thực email: danh sách email hết khớp, địa chỉ đã lưu không đọc được, file xuất thiếu cột email. Lộ khoá thì lên kế hoạch chuyển đổi dữ liệu, đừng chỉ đặt giá trị mới.
- Chatbot mặc định tắt ở mọi guild; bật từng guild bằng `/chatbot enable` hoặc dashboard, nên deploy không đổi hành vi của guild nào.
- Các migration `*_chatbot*` chỉ thêm bảng, cột và giá trị enum, đi theo luồng `sab-release` thường lệ (dump `pre-migrate` rồi `migrate deploy`); không cần bước tay.
- Khởi động lại là an toàn: lời nhắc dở dang được hoàn token và trả lời lại nếu không quá 10 phút tuổi. Không có bước dọn tay.
- Nhà cung cấp hết credit thì admin guild quản trị thấy cảnh báo ở `#bot-log`; chatbot của mô hình đó tự thử lại sau 15 phút.

## Trước lần deploy đầu

Làm đúng thứ tự, trên host; thiếu một bước thì `sab-release` hoặc Postgres hỏng ngay lần push đầu.

1. Mạng: `docker network create sab-db`.
2. Thư mục dưới `/srv/appdata/sab-delegate/` (và `/srv/appdata/_archive/sab-delegate/`), với chủ và quyền:

| Thư mục       | Chủ / quyền           | Ghi chú                                                                                                                                     |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres`    | root, 0755 lúc tạo    | entrypoint của image Postgres chown phần dữ liệu về uid 999 khi khởi tạo; sau lần chạy đầu kiểm `ls -ln` thấy cụm PG18 thuộc 999, mode 0700 |
| `backups`     | root, 0700            | `sab-release` và `sab-backup` chạy root; `backup.sh` cũng tự `chmod 700`                                                                    |
| `files-final` | root, 0755; file 0644 | mount chỉ-đọc cho server (uid `node`); tạo bằng các bước T0 của `docs/cutover-runbook.md`, không `mkdir` rỗng                               |
| `files`       | giữ nguyên            | dữ liệu sống của bot cũ, không đụng                                                                                                         |

3. Triển khai resource Postgres (`deploy/postgres.compose.yml`) và chờ healthy.
4. Chạy `deploy/initdb/01-roles.sh` MỘT lần theo hướng dẫn ở đầu file (tạo ba role, khoá `CONNECT`). Script tắt ghi log câu lệnh cho phiên của nó nên mật khẩu không vào log Postgres. File phải `+x` trong git (`git ls-files -s deploy/initdb/01-roles.sh` bắt đầu bằng `100755`). Xong bước này mới được push.
5. Nhập biến trên Coolify (`is_buildtime=false` cho mọi bí mật). `MIGRATION_PENDING` để mặc định (`true`).
6. Push `main`. Sau lần build đầu: `docker history --no-trunc` trên CẢ ba image, `grep -c '<TÊN_SECRET>='` phải 0 cho từng tên bí mật; đo thời gian từ `StartedAt` của `sab-server` tới lần healthcheck đầu tiên thành công và so với `start_period: 60s` (chừa dư; lệnh ở runbook T1).

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
2. `docker ps`: bốn service đúng trạng thái (`sab-release` Exited 0, `sab-server`, `sab-backup` và `sab-web` Up/healthy), 0 restart.
3. Log `sab-server` có `Ready! Logged in as …`; `#bot-log` yên.
4. `GET /health` trả `ok` (cả `database` và `discord` là `up`).
5. `_prisma_migrations` khớp thư mục `apps/server/prisma/migrations` (số dòng, không dòng nào chưa `finished_at`), và đếm dữ liệu thật so với mốc trước deploy.
6. `docker history --no-trunc <image> | grep -c '<TÊN_SECRET>='` bằng 0 cho cả bốn image (web thêm: các tên `NEXT_PUBLIC_*` nếu có).
7. Giữ id deployment và tag/SHA cũ để rollback nhanh.

## Release 2 (dashboard, REST, MCP)

Một app Coolify, thêm service `sab-web`; thay đổi so với Release 1 chỉ là service mới và bốn biến của `sab-server`.

1. Domain: gắn `https://bot.sabies.vn` vào service `sab-web` (cổng container `3101`), KHÔNG vào `sab-server`. Trỏ DNS đúng TRƯỚC khi bật domain (Let's Encrypt giới hạn 5 cert trùng hostname mỗi tuần; không thêm/xoá domain lặp lại).
2. Discord Developer Portal, app Sabi, OAuth2 Redirects: `https://bot.sabies.vn/api/auth/callback/discord`. `APP_URL` phải là đúng origin này.
3. Biến mới trên Coolify, đều `is_buildtime=false`: `APP_URL`, `DISCORD_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `TRUSTED_PROXY_IPS`. Không biến nào cho `sab-web`.
4. `/mcp`: Next `rewrites()` đẩy `/mcp` sang `sab-server` giống `/api/*`, KHÔNG dùng label Traefik. Next chuyển tiếp header nguyên vẹn (`Authorization` giữ nguyên, không tự thêm `Origin`), nên bearer auth và việc từ chối request có `Origin` của server vẫn đúng. `proxy.ts` loại `/mcp` khỏi matcher (không cookie ngôn ngữ trên trả lời JSON-RPC, không đệm body). Đích rewrite nướng lúc build, nên đổi `SERVER_INTERNAL_URL` phải build lại. Cần live-verify sau deploy (xem dưới), không suy từ test.
5. `TRUSTED_PROXY_IPS`: server thấy request đến từ container `sab-web` (Next thêm IP đó vào cuối `X-Forwarded-For`), và Traefik đứng trước web, nên danh sách phải phủ CẢ HAI. Subnet chỉ biết sau lần deploy đầu:
   - Mạng của app: `docker network ls --format '{{.Name}}' | grep <uuid-app-coolify>`; subnet: `docker network inspect <mạng> --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'`.
   - Mạng mà Traefik (`coolify-proxy`) dùng để tới app: `docker inspect <container-sab-web> --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{$v.IPAddress}}{{"\n"}}{{end}}'` và subnet của từng mạng như trên.
   - Đặt các subnet (CIDR) đó, phẩy phân cách. Lần deploy đầu có thể đặt tạm bằng CIDR rộng của mạng Docker rồi thu hẹp sau khi đo.
   - Đo bằng log: `/api/me` hai lần từ hai IP khác nhau phải thấy IP khác nhau trong bộ đếm rate limit; nếu mọi request cùng một IP là danh sách còn thiếu một hop.
6. Kiểm sau deploy, ngoài mục Kiểm sau deploy: mở `https://bot.sabies.vn/healthz` (200), đăng nhập Discord trọn vòng; `POST /mcp` không khoá trả `401` + `WWW-Authenticate: Bearer`; có `Origin` trả `403`; có khoá hợp lệ trả kết quả `tools/list`. Đọc lại bằng request thật, không chỉ log.
7. Rollback, từ nhẹ tới nặng: (a) chỉ `/mcp`: `MCP_ENABLED=false` rồi redeploy; (b) gỡ dashboard khỏi mạng: bỏ domain khỏi `sab-web` (bot không đổi); (c) về bot-only: để trống `APP_URL`, `DISCORD_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `TRUSTED_PROXY_IPS` rồi redeploy (server bỏ REST, web vẫn lên nhưng không có API); (d) revert commit thêm `sab-web` và push `main`. Mọi bước là một lần redeploy toàn stack (~60 s bot rớt mạng), nên theo luật giờ ở mục Giảm downtime.

## Backup và restore

- Một script `backup.sh` dùng cho release (tag `pre-migrate`, chạy mỗi lần Postgres đã có bảng, TRƯỚC `prisma migrate deploy`) và job hằng ngày `sab-backup` (vòng sleep tới 03:00 `Asia/Ho_Chi_Minh`, tag `daily`). Dump hỏng thì release dừng, server không khởi động. Release LUÔN dump DB không rỗng: nó ép `BACKUP_ENABLED=true` cho lần gọi đó và không đọc biến này, nên một giá trị `false` lạc vào không thể để migration chạy trên dữ liệu không có bản sao. `BACKUP_ENABLED` chỉ tắt job hằng ngày và dump thủ công (dev).
- Lệnh backup thủ công chạy trong container `sab-backup`: `b=$(docker ps --filter label=com.docker.compose.service=sab-backup --format '{{.Names}}'); docker exec "$b" /bin/sh /app/apps/server/scripts/backup.sh <tag>`.
- Healthcheck của `sab-backup`: khoẻ khi có dump `*-daily-*.dump` mới hơn 26 giờ (cron 03:00 cộng 2 giờ dự phòng). Container mới chưa có dump nào nên trong 26 giờ đầu một file đánh dấu lúc khởi động (`/tmp/backup-started`) thay chỗ; dump `pre-migrate` hay `baseline` KHÔNG được tính, để không che việc dump hằng ngày hỏng. Hệ quả: job hằng ngày hỏng ngay ngày đầu chỉ lộ ra sau 26 giờ.
- Dump `pg_dump -Fc`, kiểm bằng `pg_restore --list`, đổi tên nguyên tử rồi `sync` (rename nguyên tử nhưng chưa bền); file 0600, thư mục `/srv/appdata/sab-delegate/backups` 0700. Tên `<db>-<tag>-<UTC>.dump`; xoay vòng chỉ trong cùng tiền tố `<db>-<tag>-` (`daily` giữ 14, `pre-migrate` giữ 5). Tag khác (`baseline`, `pre-cutover`, `pre-rollback`) KHÔNG xoay.
- Dump trước thay đổi rủi ro (cutover, rollback, migration lớn) copy thêm sang `/srv/appdata/_archive/sab-delegate/`, ngoài vòng xoay.
- Ngoại lệ có ghi nhận: chủ host không đề xuất backup định kỳ, nhưng owner repo QUYẾT ĐỊNH có backup hằng ngày. Điều kiện giữ ngoại lệ: restore drill đạt. Không có bản sao ngoài máy chủ ở Release 1; owner tải tay dump `baseline` về máy riêng sau cutover.
- Restore drill (`restore-drill.sh`): khôi phục dump mới nhất vào database tạm, đếm row so với nguồn, rồi xoá database tạm. Chỉ so schema `public` (dữ liệu ứng dụng và `_prisma_migrations`): các bảng của pg-boss (schema `pgboss`) đổi từng giây nên so sẽ báo lệch trên một dump hoàn toàn lành; dump vẫn được khôi phục đủ schema đó (`--exit-on-error`). Chạy sau khi dựng và sau mỗi thay đổi lớn của schema hoặc script backup. Khôi phục thật: dừng app, `pg_restore --clean --if-exists`, đọc lại số dòng bằng kết nối MỚI.
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
