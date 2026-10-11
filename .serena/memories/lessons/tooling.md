# Tooling lessons

- Claude Code tự đọc `AGENTS.md` chỉ khi KHÔNG có `CLAUDE.md`/`CLAUDE.local.md` ở cwd hoặc thư mục cha.
- Serena `activate_project` với path repo; `search_for_pattern` trên thư mục gitignore cần `skip_ignored_files=false`.
- serena / code-review-graph không phủ file untracked — file mới phải `Read` trực tiếp.
- Repo đồng bộ Mac ↔ Windows bằng Syncthing (kể cả `.git`); `.git/config` theo từng máy, Windows phải tự `git remote add origin`.

## Bổ sung từ bài học các repo khác (11/10/2026)
- Serena `get_diagnostics_for_file` chỉ là tsc — không có luật typed-lint; chạy `npx eslint <file> --max-warnings 0` cho mọi file đã đụng. Syncthing: gitignore ≠ stignore, cấm `(?d)`, một máy ghi git, DB sống ngoài thư mục sync (`mem:lessons/tooling/dependencies-and-syncthing`).
