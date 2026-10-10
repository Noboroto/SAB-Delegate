# Base image: tái dùng layer đã có trên host Coolify (đo 2026-10-10)

- Host Coolify không giữ tag `node:*` (multi-stage build xong là tag base không còn), nhưng LAYER của base
  vẫn nằm trong image app đã build. Image mới dùng đúng digest base → không tải/ghi lại layer đó.
- Đang có trên host (theo image app chạy thật):
  - `node:24.21.0-alpine3.23@sha256:9ec4a2e2…` (QR-Production-Manager qp-api/qp-web) — diffIDs amd64
    `e63b02c2b5…, 3e3cca1d6d…, ef9c3bd6ce…, 7c9a72471d…` khớp 100% với registry. **SAB-Delegate dùng bản này.**
  - node 24.16.0 alpine3.23 (spm-api, một api khác), node 22.23.3 alpine3.24 (SAB-Store backend).
- Cách kiểm: trên host `docker image inspect <app> --format '{{range .RootFS.Layers}}{{println .}}{{end}}'`,
  local `docker buildx imagetools inspect <ref@digest> --format '{{json (index .Image "linux/amd64").RootFS.DiffIDs}}'`.
- `RUN chmod -R` sau `COPY` nhân đôi toàn bộ file sang layer mới → không dùng.
- Đổi bản Node: ưu tiên digest mà repo khác trên host đang ghim (QR-Production-Manager `api/Dockerfile` `NODE_VERSION`).
