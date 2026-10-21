# Quy tắc giao diện dashboard (`apps/web`)

Phạm vi: AntD 6 + token CSS. Mỗi quy tắc nêu nguồn đo/đối chiếu. Token CSS ở
`apps/web/styles/tokens.css`, token AntD ở `apps/web/components/ui/theme-config.ts`
(`tokens.test.ts` buộc hai bên khớp nhau). Màu, cỡ chữ, bo góc chỉ đi qua token;
không mã hex, không `height` cứng trong component.

## 1. Thang khoảng cách

| Token       | Giá trị | Dùng cho                                                                          |
| ----------- | ------- | --------------------------------------------------------------------------------- |
| `--space-1` | 4px     | tiêu đề nhỏ với dòng phụ, icon với chữ                                            |
| `--space-2` | 8px     | khoảng cách giữa các control cùng hàng (nút, ô nhập, chữ ngắn)                    |
| `--space-3` | 12px    | giữa các khối trong một card (`Space size={12}`), giữa hai ô cạnh nhau trong form |
| `--space-4` | 16px    | giữa các card/khối cùng cấp (`Space size={16}`), thanh lọc với bảng               |
| `--space-6` | 24px    | lề dưới tiêu đề trang, giữa các nhóm lớn; `Form.Item` mặc định                    |
| `--page-px` | 16-40px | lề ngang trang (`.page-main`)                                                     |

- Chỉ dùng các bậc trên. Không `margin` lẻ (`marginTop: 7`, `marginLeft: 6`) để "căn cho khớp".
- Khoảng cách dọc giữa khối: `Space orientation="vertical"` với `size` thuộc thang; trong form: `Form.Item`.
- Khoảng cách ngang giữa control: `ActionRow` (mục 2), không tự viết `display: flex; gap`.

## 2. Căn lề và chiều cao control (quy tắc quan trọng nhất)

- Mọi hàng control (nút, ô nhập, select, chữ trạng thái) **bắt đầu cùng một mép trái** với
  nút/ô nhập ở hàng dưới trong cùng card. Nhìn thẳng dọc mép trái card phải thấy một đường.
- Mọi control cùng hàng **cùng chiều cao `--control-h`** (32px; 44px trên màn cảm ứng).
  AntD `controlHeight` ↔ `--control-h`, `controlHeightSM` ↔ `--control-h-sm`.
  Không trộn `size="small"` với cỡ mặc định trong một hàng; nút tự viết dùng `var(--control-h)`.
  Tag/chữ đứng cạnh nút trong hàng: dùng `align-items: center`, không ép chiều cao.
- Một khoảng cách duy nhất trong hàng: `--space-2`. Hàng bọc dòng (`flex-wrap`) khi hẹp.
- Hàng nút/control dùng `components/ui/action-row.tsx` (`ActionRow`), `align="end"` cho chân dialog.
  - **Không** dùng AntD `Space` cho hàng có `<input type="file">` ẩn hoặc `Upload`: `Space` bọc mỗi
    child trong một item, nên input `display: none` vẫn nhận một khoảng cách và đẩy cả hàng lệch phải.
    Guard `lib/code-quality/control-row-layout.guard.test.ts` chặn lỗi này.
  - `Space` vẫn đúng cho **xếp dọc** các khối (`orientation="vertical"`).
- Nút đứng riêng ở cuối form: rộng theo nội dung, canh trái, bọc `Form.Item style={{ marginBottom: 0 }}`.
  Không `block` trừ khi là nút duy nhất của card hẹp (thẻ máy chủ, đăng nhập).
- Nút hành động của form cùng mép trái với nhãn và ô nhập phía trên, không thụt vào.
- Một dòng "chữ + nút" (ví dụ số khoá đã dùng + nút Tạo): nút trước, chữ sau, cùng `ActionRow`.

## 3. Thứ bậc nút

- **Một nút `primary` mỗi vùng** (card, dialog, trang). Hành động tiếp theo của luồng nhiều bước
  là primary; bước trước đó đổi sang `default` khi bước sau xuất hiện (ví dụ "Kiểm tra tệp" →
  "Nhập N dòng").
- Hành động phá huỷ: `danger`, luôn qua `ConfirmAction` (xem trước kế hoạch rồi mới xác nhận);
  nút mở xác nhận là `default danger`, nút xác nhận trong modal mới là `danger` đặc.
- Nút phụ (Huỷ, Tải tệp mẫu, Sao chép): `default`. Nút ít quan trọng trong dòng chữ: `type="link"`.
- Nút chỉ có icon phải có `aria-label`. Nhãn nút nêu đúng phạm vi ("Xoá ghi chú Rules").
- Không hai nút primary trong một `Alert action` + footer modal; nút trong `Alert` là `default`.
- Trạng thái khi bấm: `loading` ngay lập tức, `disabled` khi đang gửi (chống bấm đúp), nhãn không đổi chỗ.

## 4. Form

- `layout="vertical"`; nhãn trên ô nhập; một cột (hai cột chỉ cho cặp ngắn như ngày/tháng, `gap: var(--space-3)`).
- Thứ tự: trường → lỗi tổng (`ErrorAlert` trong `Form.Item`) → hàng nút.
- Giá trị mặc định hợp lý, điền sẵn; điều hệ thống đã biết thì không hỏi lại.
- Validate bằng schema dùng chung trong `@sab/shared`; lỗi đặt đúng trường (`form.setFields`).
- Thông báo lỗi nói bước người dùng cần làm; không hiện `err.message` thô.
- Ô nhập số/select rộng `100%` của cột, không độ rộng cố định lệch nhau.

## 5. Tệp tải lên (nhập CSV, ảnh đại diện)

Mẫu một hàng, trong `ActionRow`, theo thứ tự cố định:

1. `<input type="file" hidden>` (cùng hàng, không chiếm chỗ) + nút **Chọn tệp** (`default`);
2. nút phụ nếu có (**Tải tệp mẫu**), cùng cỡ;
3. chữ trạng thái `type="secondary"`: tên tệp đã chọn hoặc "Chưa chọn tệp".

Dưới hàng đó: `Alert` lỗi tệp (quá lớn, không đọc được), rồi nút hành động tiếp theo. Giới hạn dung
lượng/định dạng nêu ngay trong dòng hướng dẫn phía trên. Hai bước: xem trước → xác nhận, báo cáo
liệt kê thêm/bỏ qua/từ chối.

## 6. Bảng

- Lọc/sắp/phân trang ở server; thanh lọc nằm **trên** bảng, cùng `ActionRow`, cách bảng `--space-4`.
- `scroll={{ x: 'max-content' }}` để bảng cuộn trong khung ở 390px; phân trang 10-12 dòng.
- Hàng thao tác ở cột cuối, nút cùng cỡ; trạng thái bằng `Tag` kèm chữ, không chỉ màu.
- Bảng nhỏ trong card: `size="small"` cho **cả bảng**, không trộn với control cỡ thường cùng hàng.
- Ô chứa nội dung người dùng: chữ thường (không HTML), `overflow-wrap: anywhere`.

## 7. Trạng thái rỗng, đang tải, lỗi

- Rỗng: `PageState` với một nút bước kế. Nút đó là primary **duy nhất**: ẩn nút cùng việc ở đầu trang
  khi đang rỗng.
- Đang tải: `loading.tsx` ở lá route (skeleton đúng hình), `PageLoading`; refetch giữ dữ liệu cũ.
- Lỗi đọc: `RouteErrorState`/`ErrorAlert` có nút thử lại. Lỗi ghi: `message.error` qua `App.useApp()`.
- Không im lặng quá 300 ms; thao tác dài có tiến trình hoặc "đã nhận, đang xử lý".

## 8. Chữ

- Font `Be Vietnam Pro` (`theme-config.ts` `fontFamily`), cỡ cơ sở 14px; trên màn cảm ứng ô nhập 16px.
- Thang tiêu đề khai MỘT chỗ (`headingScale` trong `theme-config.ts`): `h1` 24px (`Heading`, một mỗi trang), `h2` 18px (`SectionTitle`: tiêu đề card/khu vực), `h3` 16px (`SectionTitle level={3}`: khối bên trong card). Không nhảy cấp, không `fontSize` rời.
- Văn bản dài giới hạn `--measure` (65ch). Chữ phụ: `Typography.Text type="secondary"`.
- Chính tả tiếng Việt thống nhất: Xoá, khoá, Huỷ, hoà, thoả, tuỳ.

## 9. Màu và tương phản

- Chỉ token: `--text-primary/secondary/muted`, `--primary`, `--link`, `--danger`, cặp
  `--green|red|amber|blue|gray-bg/fg` cho trạng thái. AntD `colorPrimary` ↔ `--primary`.
- WCAG AA: chữ thường 4.5:1, chữ lớn/icon 3:1, đo theo nền trực tiếp, cả sáng và tối.
- Trạng thái không chỉ bằng màu (kèm chữ/icon). Focus ring `--focus` 3px, không xoá outline.
- Theme sáng/tối/hệ thống; `[data-theme='dark']` là tín hiệu duy nhất.

## 10. Đáp ứng (responsive)

- Thiết kế cho 1440×900; kiểm 390, 768, 1440 × sáng/tối × vi/en.
- Không cuộn ngang trang (`scrollWidth <= innerWidth`); bảng cuộn trong khung.
- Hàng control bọc dòng khi hẹp (`flex-wrap`), mép trái vẫn thẳng; form một cột.
- Cảm ứng (`pointer: coarse`): `--control-h` = 44px, ô nhập 16px; mọi hàng lớn cùng lúc nhờ dùng token.
- Dùng breakpoint của `Grid` AntD, không `px` rải rác.

## 10b. Độ rộng và chữ ẩn

- Độ rộng bộ lọc, cột bảng, `flex-basis` lấy từ token `--w-2xs/--w-xs/--w-sm/--w-md/--w-lg`
  (80/160/240/360/480px), không `calc(var(--space-6) * N)` hay số px rời. Cỡ avatar/icon và viền 1-3px giữ nguyên.
- Nút có nhãn dài (nêu phạm vi) bọc dòng bằng class `btn-wrap` (`ConfirmAction` đã gắn); không ép một dòng ở 390px.
- Chữ chỉ dành cho trình đọc màn hình: class `.sr-only`.
- Nút mở xác nhận có `aria-label` phải chứa nguyên nhãn đang hiện (WCAG 2.5.3): "Mở bảng điều khiển — {tên}".

## 11. Danh sách soát trước khi xong một màn hình

1. Kéo thẳng một đường dọc mép trái card: mọi hàng nút/ô nhập có thẳng không?
2. Mọi control cùng hàng có cùng chiều cao không (không `size="small"` lẫn)?
3. Mỗi card/dialog có đúng một nút primary không?
4. Khoảng cách chỉ lấy từ thang `--space-*` không?
5. Có `Upload`/input tệp nằm trong `Space` không? (guard sẽ báo)
6. Trạng thái rỗng, đang tải, lỗi, đang gửi đều thấy được không?
7. Ảnh chụp 390/768/1440 sáng và tối đã xem chưa?

## 12. Thành phần dùng chung

Dùng các thành phần này thay vì tự viết lại; route mới không gõ `maxWidth: 720`, `fontSize: 18`
hay `minHeight` rời.

| Thành phần                                                              | Import                              | Khi nào dùng                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FormColumn`                                                            | `@/components/ui/form-column`       | Cột một form/card của trang cài đặt: rộng tối đa `--form-w` (720px), đầy chiều rộng trên điện thoại, các con cách nhau `--space-4`.                                                 |
| `UnsavedGuardProvider`, `useUnsavedChanges(dirty)`, `useConfirmLeave()` | `@/components/forms/unsaved-guard`  | Provider đã nằm trong `AppFrame`, route chỉ gọi hook. Mỗi form gọi `useUnsavedChanges(dirty)`; trang "bẩn" khi bất kỳ form nào còn bẩn. Chuyển tab dùng `useConfirmLeave()`.        |
| `PublicChrome`                                                          | `@/components/layout/public-chrome` | Chọn ngôn ngữ và giao diện sáng/tối góc phải trên cho trang chưa đăng nhập; `app/(public)/layout.tsx` đã gắn sẵn, trang public không tự thêm.                                       |
| `PageLoading`                                                           | `@/components/ui/page-loading`      | `loading.tsx` ở lá route: `variant="form"`, `"table"` hoặc `"cards"` vẽ skeleton đúng hình trang; không truyền `variant` thì là vòng xoay giữa trang (trang không có hình cố định). |
| `SectionTitle`                                                          | `@/components/ui/section-title`     | `h2` (hoặc `level={3}`) trong trang, dưới `Heading`; cỡ lấy từ thang tiêu đề của theme. `id` để `aria-labelledby`; `flush` khi là `title` của `Card`.                               |
| `ResultBlock`                                                           | `@/components/ui/result-block`      | Bọc khối kết quả/lỗi hiện dưới form, cách phần trên `--space-4`; không `marginTop` rời.                                                                                             |
