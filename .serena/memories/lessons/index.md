# Lessons index (sự thật đã đo/đã kiểm chứng)

- `mem:lessons/deploy/coolify-build-from-source` — prod Coolify: push main = deploy; lockfile bắt buộc tracked + frozen; `cpus` vs `deploy.resources.limits.cpus`; Coolify hỏng `${VAR:?}`/named volume/container_name; dữ liệu sqlite ở mount tương đối (việc tồn: chuyển `/srv/appdata`); cách verify sau deploy; Node 18 EOL.
- `mem:lessons/discord/api-pitfalls` — ephemeral/fetchReply deprecated, giới hạn 2000 ký tự, Unknown Guild 10004 trong cron, subcommand không await.
- `mem:lessons/process/subagent-model-cap` — mọi Agent call `model: "sonnet"` tường minh; opus chỉ kongming/vòng nâng cấp, tối đa 1; không fable.
- `mem:lessons/process/heavy-work-and-worktrees` — máy dùng chung bị watchdog reset; memory gate 35%; 1 agent nặng toàn máy; giao thức khoá `/tmp/cc-heavy.lock`.
- `mem:lessons/tooling` — AGENTS.md auto-load, serena activate/search, file untracked, Syncthing `.git`.
- `mem:lessons/tooling/pnpm-and-runtime` — pnpm 12 `allowBuilds` (onlyBuiltDependencies bị bỏ qua), better-sqlite3 13 cần Node ≥22, TS ghim 6.0 vì typescript-eslint, tsconfig cho TS 6, tsx thay ts-node, dotenv quiet, ESLint flat config.
- `mem:lessons/discord/multi-client-dedupe` — mọi event chạy một lần cho mỗi bot: `claimOnce` trước khi ghi DB/gửi tin; cờ sinh nhật phải có năm; unhandledRejection không làm chết tiến trình.
- `mem:lessons/deploy/base-image-reuse` — base `node:24.21.0-alpine3.23@sha256:9ec4…` đã có layer trên host (QR-Production-Manager) → tái dùng; cách so diffIDs; tránh `chmod -R` nhân đôi layer.
- `mem:lessons/discord/bypass-by-design` — bot CỐ Ý vượt giới hạn Discord: không thêm chặn DM, chặn link guild khác, kiểm thứ bậc role, kiểm quyền invite của người gọi.
