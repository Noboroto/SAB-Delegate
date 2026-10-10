# SAB-Delegate — Project Instructions

Bot Discord (discord.js) phục vụ server của SAB: slash command quản trị (poll, mention theo
reaction, thread riêng, ghi chú, sinh nhật, trò chơi nối từ, hẹn giờ gửi tin…). Một tiến trình
chạy **nhiều bot cùng lúc** (mỗi token trong `TOKENS` là một `Client`). Dữ liệu lưu SQLite qua
`quick.db`. Deploy: Coolify, build từ source.

Code nằm trong `root/` (package `sab-delegate`); file deploy (`dockerfile`, `*.compose.yml`) ở gốc repo.

## 0. Luật cứng — quét nhanh trước khi làm

| Tuyệt đối KHÔNG                                                                                       | Vì sao / xem mục                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Tạo `CLAUDE.md` / `CLAUDE.local.md` trong repo hoặc thư mục cha                                       | Claude Code sẽ đọc nó và **bỏ qua** `AGENTS.md` này                                               |
| Tự suy luận lại một hành vi khi chưa đọc serena memory                                                | Sự thật đã đo nằm ở `mem:core` → `mem:lessons/index` (§1)                                         |
| `git push` lên `main` khi user chưa đồng ý                                                            | Webhook Coolify **tự deploy prod ngay** khi push `main` (§6)                                      |
| Gỡ lockfile khỏi git / cài không `--frozen-lockfile`                                                  | Clone mới kéo bản mới nhất → build prod vỡ (đã xảy ra, §2)                                        |
| Dùng `${VAR:?}`, named volume, `container_name` trong `coolify.compose.yml`                           | Coolify làm hỏng cả ba (§2)                                                                       |
| Đặt `cpus:` cấp service song song `deploy.resources.limits.cpus`                                      | Compose từ chối file → mọi deploy fail trước khi build (§2)                                       |
| Commit `.env`, token bot, file `*.sqlite`, `root/files/*`                                             | Token Discord lộ = mất quyền điều khiển bot; sqlite là dữ liệu thật                               |
| Dùng API discord.js đã deprecated (`ephemeral: true`, `fetchReply`)                                   | Dùng `flags: MessageFlags.Ephemeral`, `withResponse` (§3)                                         |
| Gửi một tin > 2000 ký tự                                                                              | Discord từ chối; chia khối, `reply` + `followUp` (§3)                                             |
| Tham chiếu path/URL git không track (`plans/`, report cục bộ, `/Users/...`) trong code/comment/docs   | Reader chỉ có repo phải theo được (§5)                                                            |
| `git commit --no-verify` / `git push --no-verify`                                                     | Bỏ qua hook = bỏ qua cổng chất lượng (§6)                                                         |
| Tạo `.github/workflows/*`                                                                             | Không dùng CI (§6)                                                                                |
| Commit code chưa qua ≥2 agent review                                                                  | Một góc nhìn bỏ sót cả lớp lỗi (§7)                                                               |
| Chạy nhiều việc nặng song song (install + docker build + test)                                        | Máy dùng chung với repo khác, đã bị watchdog reset (§5)                                           |
| Để lại nợ kỹ thuật                                                                                    | Concern agent báo phải xử lý xong trong cùng wave (§5)                                            |

## 1. Tool policy — serena memory trước, MCP trước built-in

**Serena memory là nơi tra đầu tiên — ưu tiên số một của repo này.**

1. Đầu mỗi phiên/task: `read_memory("core")` → index chủ đề trong `mem:lessons/index`. Sự thật
   đã ĐO ĐƯỢC (deploy Coolify, lockfile, cạm bẫy discord.js, quick.db…) nằm ở đó — đừng đoán lại.
2. Trước khi kết luận "cái này chắc là…" về hành vi bot/deploy → tra memory trước.
3. Có bài học mới **đã đo/kiểm chứng** → `write_memory` đúng chủ đề (`lessons/<topic>/<slug>`)
   rồi thêm một dòng vào `mem:lessons/index`. Sửa memory sai thay vì tạo bản trùng.
4. Mọi prompt giao cho subagent phải nhắc: đọc `mem:core` trước, và không ghi memory (chỉ
   orchestrator ghi).

Cách bảo trì memory: `mem:memory_maintenance`.

Thứ tự công cụ: **serena memory → MCP → built-in (Read/Glob/Grep/Edit) → Bash**.

**Điều hướng & sửa code — `serena`**

| Việc                                  | ĐỪNG                        | DÙNG                                                                 |
| ------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| Tra bài học đã đo                     | suy luận lại từ đầu         | `read_memory("core")` → `mem:lessons/index`                          |
| Ghi nhớ kiến thức repo giữa các phiên | file rác trong repo         | `write_memory` / `read_memory` / `list_memories`                     |
| Tìm symbol (hàm/biến)                 | `Grep` theo tên             | `find_symbol`, `find_declaration`, `find_implementations`            |
| Tìm nơi gọi / tham chiếu              | `Grep`                      | `find_referencing_symbols`                                           |
| Xem API của file trước khi đọc        | `Read` cả file              | `get_symbols_overview`                                               |
| Sửa thân một symbol                   | `Edit` kèm khối context lớn | `replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol` |
| Đổi tên / thay chuỗi toàn repo        | `Grep` + N lần `Edit`       | `rename_symbol`, `replace_in_files`, `replace_content`               |
| Xoá symbol kèm dọn tham chiếu         | `Edit` tay từng chỗ         | `safe_delete_symbol`                                                 |
| Xem lỗi type/lint của 1 file          | chạy cả `tsc --noEmit`      | `get_diagnostics_for_file`                                           |

**Kiến trúc & review — `code-review-graph`**: `get_minimal_context_tool` (gọi trước tiên),
`get_impact_radius_tool`, `get_review_context_tool`, `detect_changes_tool`.

**Tài liệu ngoài**: docs thư viện (discord.js, quick.db, node-schedule, pnpm) → `context7`
(`resolve-library-id` → `query-docs`), không dựa trí nhớ — discord.js đổi API thường xuyên.
Repo GitHub ngoài → `deepwiki`. Web → `exa`/`tavily`/`firecrawl`; một trang → `WebFetch`.

**Vẫn dùng Bash cho**: git, package manager, build, docker, chạy bot — đừng né.

**Lưu ý vận hành**

- `serena` / `code-review-graph` **không phủ file untracked** — file mới chưa commit phải `Read` trực tiếp.
- Index rỗng/cũ không phải lý do quay về `Grep`: chạy `build_or_update_graph_tool` rồi query lại.
- Tool bị _deferred_ → nạp schema bằng `ToolSearch` **một lần cho cả cụm** (`select:` nhận danh sách phẩy).

## 2. Tech stack & deploy — luật, không phải bảng số

Phiên bản đọc ở `root/package.json`, `dockerfile`, `*.compose.yml` — không chép ra đây.

- **Runtime**: Node + TypeScript chạy thẳng bằng `tsx` (không có bước build) → lỗi type **không**
  chặn bot khởi động; phải tự chạy `pnpm typecheck`.
- **Package manager: pnpm** (bản ghim ở `packageManager` của `root/package.json`), chạy trong `root/`.
  Không dùng yarn/npm. `root/pnpm-lock.yaml` **luôn được commit**, `dockerfile` cài `--frozen-lockfile`.
  Thêm/nâng gói → cập nhật lockfile trong cùng commit. Gói cần install script (native addon,
  esbuild) phải khai trong `allowBuilds` của `root/pnpm-workspace.yaml`.
- **Dữ liệu**: `quick.db` (SQLite qua `better-sqlite3`, native addon — đổi bản Node phải rebuild).
  Đường dẫn DB lấy từ env `*_DB_PATH` (xem `compose.yml`), mặc định `./files/*.sqlite`. Không đổi
  key schema của DB mà không có bước chuyển đổi dữ liệu cũ.
- **Đăng ký slash command**: chỉ khi env `CREATE_CMD` ≠ `0` — bot xoá toàn bộ command cũ, đăng ký
  lại rồi `client.destroy()`. Prod chạy không có `CREATE_CMD`.
- **Deploy prod = Coolify**, file `coolify.compose.yml`, build từ source. Push `main` → webhook tự
  deploy. `prod.compose.yml`/`compose.yml` là thiết lập cũ (Portainer/NPM), giữ làm phương án lùi.
  - Không `${VAR:?}`, named volume, `container_name` trong `coolify.compose.yml`.
  - Giới hạn CPU chỉ qua `deploy.resources.limits.cpus`.
  - Chi tiết đã đo: `mem:lessons/deploy/coolify-build-from-source`.

## 3. Code — quy ước

- **DRY, YAGNI, KISS.** Logic dùng ≥2 command → đặt trong `root/src/ultils/` (tên thư mục lịch sử,
  giữ nguyên) và import lại.
- **Command**: mỗi file trong `src/commands/*.ts` export default `{ data: SlashCommandBuilder, execute }`
  và được nạp tự động. Subcommand nằm ở `src/commands/<tên>/` và export `{ name, addCommand, execute }`.
- **Luôn `await`** (hoặc `return`) promise của `execute` subcommand / `reply` / `send` — promise trôi
  nổi làm lỗi thoát khỏi `try/catch` trong `interactionCreate` và có thể crash tiến trình.
- **Bot cố ý vượt giới hạn của Discord — đó là mục đích của nó** (quyết định của chủ bot 2026-10-10).
  KHÔNG thêm: chặn command trong DM (`setContexts`/`setDMPermission(false)` mới), chặn link tin
  nhắn từ guild khác, kiểm thứ bậc role của người gọi, kiểm quyền người gọi trên kênh (invite…).
  Ai được dùng command chỉ do `setDefaultMemberPermissions` hiện có quyết định. Vẫn validate input
  để tránh crash (id, chuỗi thời gian, độ dài) — đó là độ bền, không phải bảo mật.
- **discord.js**: ephemeral → `flags: MessageFlags.Ephemeral`; lấy tin vừa gửi → `withResponse: true`;
  tin dài → chia khối ≤ 2000 ký tự. Tra `context7` trước khi dùng API lạ.
- **Lỗi**: lỗi command được báo vào kênh `bot-log` của guild quản trị và trả câu trả lời ephemeral cho
  người dùng — không nuốt lỗi im lặng, không hiện stack cho người dùng thường.
- **Timezone**: container mount `/etc/localtime` của host; cron sinh nhật chạy theo giờ host.
- **ESLint (flat config `root/eslint.config.mjs`) + Prettier** (`pnpm lint`, `pnpm pretty` trong `root/`). Mọi `eslint-disable` phải kèm lý do.
- Ưu tiên package có sẵn hơn tự viết; tự viết thì ghi lý do.

## 4. Bảo mật & dữ liệu

- `TOKENS` chỉ ở `.env` (gitignored) / biến môi trường Coolify. Không log token.
- Dữ liệu sqlite prod là dữ liệu thật của thành viên (sinh nhật, ghi chú…) — không copy ra ngoài,
  thao tác trên prod phải dừng bot trước, `cp -a` + so checksum, rồi mới đổi.

## 5. Chất lượng, việc nặng, comment

- Chưa có test tự động. Cổng tối thiểu trước commit: `pnpm typecheck` + `pnpm lint` + `pnpm pretty`
  sạch trong `root/`, và build docker (+ chạy thử khi có token test) khi đổi dependency/runtime.
- **Phát hiện lỗi là phải sửa**, kể cả ngoài phạm vi task; không chỉ ghi chú "để sau".
- **Không để nợ kỹ thuật**: không `TODO`/`FIXME` không chủ, không stub/placeholder.

### Việc nặng — khoá dùng chung toàn máy

Việc nặng (install, docker build, typecheck/test diện rộng, dựng stack, agent lái trình duyệt)
phải giữ khoá máy-chung `/tmp/cc-heavy.lock` theo đúng giao thức của Leaderboard/JudgeHub
(cờ chờ `/tmp/cc-heavy.sab-delegate-wants`, owner line chính xác, release owner-checked).
Chi tiết giao thức: `mem:lessons/process/heavy-work-and-worktrees`.

--- heavy-lock amendment 2026-09-30 ---
Context: the Mac was watchdog-reset at 22:59 with load around 55. A JudgeHub commit running the hook full suite, inside the lock, overlapped with 3 Leaderboard agents (2 git worktrees) and about 8 Playwright browsers running outside the lock, while about 19 containers were up.

1. Memory gate: before every heavy step, run `memory_pressure -Q`. If system-wide free memory is under 35%, WAIT (keep the wants-flag heartbeat). Never skip the gate. The lock only serializes jobs; it never checked headroom.
2. Heavy means: tests triggered by commit/push hooks, pnpm/yarn/bundle install, typecheck, full or wide test runs, docker build, bringing up an app stack, and any agent driving a browser (Playwright, chrome-devtools or claude-in-chrome MCP). All of these go through /tmp/cc-heavy.lock with an exact owner line.
3. Machine-wide, at most ONE agent at a time may edit and also test, install, build, or drive a browser. No parallel implementation agents doing those. No extra git worktrees (`git worktree add` or agent isolation "worktree") unless truly needed and the user agrees. Read-only reviewers without a browser may run in parallel in small numbers. Edit-only agents (lint allowed) may run in parallel.
4. Long-lived dev servers and compose stacks count against the budget: stop them when the work pauses; don't leave them idle for hours.
   --- end ---

### Soi comment TRƯỚC KHI commit (bắt buộc)

Xoá: work log / lịch sử ("bản trước dùng X"), diễn giải lại code, nhãn plan/phase/audit, comment
chết, TODO không chủ, tham chiếu path/URL git không track.
Giữ: **vì sao** chọn cách này, invariant và hậu quả nếu vi phạm, cạm bẫy đã đo (kèm bằng chứng).

## 6. Git, commit, deploy

- **KHÔNG dùng GitHub CI** — không tạo `.github/workflows/*`.
- **Cấm `--no-verify`.**
- **Conventional Commits** (`feat:`, `fix:`, `chore(deps):`, …). Không đưa plan ID/phase/nhãn audit
  vào commit message hay comment.
- **Push `main` = deploy prod** (webhook Coolify). Chỉ push khi user đồng ý; sau push phải kiểm
  container lên, 0 restart, log có `Ready! Logged in as …` cho mọi bot.
- Trước mỗi commit: `git diff --cached --name-only` để chắc chỉ stage đúng file định commit.

## 7. Chạy agent

- **Subagent tối đa `sonnet`** — truyền `model: "sonnet"` tường minh; `opus` chỉ cho `kongming`,
  tối đa 1 cùng lúc; không bao giờ `fable`. Chi tiết: `mem:lessons/process/subagent-model-cap`.
- Giao **danh sách file được sửa** tường minh; subagent gặp lỗi ngoài danh sách thì báo, không tự sửa.
- Chỉ orchestrator chạy git ghi và ghi serena memory.
- **≥2 agent review đọc-thuần, mỗi agent một góc nhìn** trước mỗi commit có code: (1) hồi quy hành
  vi command/dữ liệu sqlite cũ; (2) lỗi async/promise trôi nổi + giới hạn API Discord; (3) độ bền
  input người dùng + token/dữ liệu sqlite. Reviewer KHÔNG báo "thiếu kiểm quyền" kiểu DM/role
  hierarchy/cross-guild/invite — bot cố ý bỏ qua (§3). Orchestrator thẩm định lại phát hiện trước khi sửa.
- Reviewer neo mỗi phát hiện vào `file:line` + kịch bản hỏng có thật; xét theo toàn pipeline
  (Discord đã chặn gì phía trước — option bắt buộc, kiểu option, quyền mặc định) trước khi thêm kiểm tra.

## 8. Đặt tên file & tài liệu

- Plan: `plans/<YYMMDD-HHMM>-<slug>/` (gitignored); report: `plans/reports/<loại>-<YYMMDD-HHMM>-<slug>.md`.
- `docs/` đặt tên theo chủ đề. Quyết định kiến trúc/vận hành chốt → `docs/` hoặc serena memory.
