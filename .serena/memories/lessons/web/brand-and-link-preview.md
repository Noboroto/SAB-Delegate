# Brand SAB + link preview (đo 2026-10-15)

## Logo / màu
- Logo gốc: repo `sabinhcmus/logo.png` (= SAB-Store `frontend/public/logo.png`, 2242×934; mark ở x 0–640). Màu đo từ pixel: navy #4b5fab, teal #55c6d0, vàng #fecd68. Asset web sinh bằng PIL một lần (icon/apple-icon/favicon/opengraph-image ở `apps/web/app/`, logo ở `apps/web/public/brand/`).
- Chủ repo chọn navy làm primary (chữ trắng 5.96:1); teal/vàng ~2:1 trên trắng → chỉ trang trí.

## AntD darkAlgorithm (antd 6.6) — bẫy đã đo
- Seed `colorPrimary`/`colorLink` bị algorithm đổi sắc dù đặt trong `theme.token`: navy #4b5fab → #435494, teal #55c6d0 → #4babb4. KHÔNG pin được → CSS phải chép giá trị đã tính.
- Map token (colorBgContainer, colorBorder, colorPrimaryHover, colorPrimaryText…) override được. Nền navy làm algorithm sinh viền/card xanh rực (#334993, #1b274f) → pin neutrals.
- Tabs/Menu tô chữ selected bằng `colorPrimary` trực tiếp → pin qua `components.Tabs/Menu`.
- Test phải so `theme.getDesignToken(config)` chứ không so seed (test so seed đã che lỗi link dark từ trước).
- Trình duyệt Playwright có thể giữ chunk cũ sau rebuild → thêm `?v=` khi đo lại.

## Link preview (Messenger/Facebook/Zalo)
- `metadataBase` từ env `APP_URL` lúc request (sab-web nhận `APP_URL` trong compose). `next dev` luôn dùng localhost cho og:image dạng file (cố ý của Next); `next start` mới dùng metadataBase — đo bằng `next start`.
- robots.ts: khối riêng cho facebookexternalhit/Facebot (bài học JudgeHub); `*` không được chặn /servers vì `/` → /servers → /login.
- Guard i18n (`message-keys.guard.test.ts`) chỉ nhận `const t = await getTranslations('ns')` — destructure `Promise.all` làm guard báo key "không dùng".
