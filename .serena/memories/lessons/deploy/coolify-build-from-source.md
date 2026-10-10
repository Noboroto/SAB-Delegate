# Deploy Coolify — sự thật đã đo (2026-10-10)

- Prod = Coolify 4.3.23, file `coolify.compose.yml`, `build:` từ source. Push `main` → webhook tự deploy NGAY.
- Lockfile từng bị gitignore → clone mới resolve bản mới nhất, một gói transitive đòi node ≥ 20
  trong khi image node 18 → build vỡ. Sửa: commit lockfile, `dockerfile` cài frozen.
  **How to apply**: lockfile luôn tracked; đổi gói/đổi Node = đổi lockfile cùng commit + build docker thử local.
- Compose từ chối `cpus:` cấp service cùng `deploy.resources.limits.cpus` khác giá trị
  ("can't set distinct values on 'cpus' and 'deploy.resources.limits.cpus'") → mọi deploy fail
  trước build. Chỉ dùng `deploy.resources.limits.cpus` (hiện 0.5).
- Coolify làm hỏng `${VAR:?}`, named volume, `container_name` → không dùng trong `coolify.compose.yml`.
  Coolify tự đặt alias theo tên service, không cần block `networks:`.
- Dữ liệu prod: bind mount tuyệt đối `/srv/appdata/sab-delegate/files` (luật host: dữ liệu bền chỉ ở `/srv/appdata`).
  Đo 2026-10-10: từ lúc chuyển sang Coolify (21/9) tới 10/10 bot chạy trên mount tương đối `./root/files`
  = thư mục ứng dụng Coolify chứa DB RỖNG (birthday chỉ có `max`, config/note/word 0 dòng) — không chúc
  sinh nhật, mất cấu hình kênh. Dữ liệu thật vẫn nằm ở `/srv/appdata/sab-delegate/files`.
  **How to apply**: sau mọi lần đổi mount, đếm số dòng từng bảng `json` (python3 sqlite3, `mode=ro`) ở cả nguồn
  và đích; "file còn đủ" không có nghĩa là dữ liệu còn. Bản sao lưu: `/srv/appdata/_archive/sab-delegate-files-*-261010.tar.gz`.
- Verify sau deploy: container 0 restart, log có `Ready! Logged in as Sabi` và `... as Alohomora`.
- Node 18 EOL → chuyển Node 24 + pnpm (2026-10-10). Base image: `mem:lessons/deploy/base-image-reuse`.
- Đăng ký lại slash command trên prod (đo 2026-10-10): chạy trong container đang sống để dùng chung env,
  `docker exec -e CREATE_CMD=1 <container> node --import tsx ./src/index.ts` → mỗi bot log 17 dòng
  `Successfully registered application command`, tiến trình tự thoát 0; bot chính không restart.
- Mọi push lên `main` (kể cả chỉ sửa .md) đều kích hoạt deploy lại.
