# Danh sách lệnh của bot

Một chỗ duy nhất để nhớ mỗi lệnh làm gì và được phép làm gì. Đây là bản tra cứu cho chủ bot, không phải tài liệu thiết kế; hành vi thật nằm ở code.

## Luật của chủ bot

> Chỗ nào bot cũ không chặn là chủ bot cho phép (không phải vượt quyền). Đường slash không thêm hạn chế mới; REST/MCP (Release 2) mặc định bảo thủ: không ping, chỉ trong guild của mình.

Hệ quả cụ thể cho đường slash:

- Bot không kiểm quyền của người gọi. "Ai dùng" chỉ là quyền mặc định Discord dùng để hiện lệnh; admin máy chủ chỉnh lại được trong Cài đặt máy chủ.
- Bot ping đúng như bản cũ: `@user`, `@role`, `@everyone`/`@here` trong nội dung hoặc danh sách đều ping, kể cả khi người gọi không có quyền "Mention Everyone". Mặc định toàn bot không ping gì, chỉ lệnh nào bản cũ có ping mới bật lại.
- Link tin nhắn của guild khác vẫn được theo (bot làm việc xuyên mọi máy chủ nó có mặt).
- Lệnh không có `setContexts` guild-only thì vẫn hiện trong DM; dùng trong DM sẽ báo lỗi không có máy chủ. Chỉ `/add-poll`, `/attendance-by-role`, `/create-activity` là guild-only.
- Khoảng "Trả lời": "công khai" = cả kênh thấy; "riêng" = chỉ người gọi thấy (ephemeral). Lỗi/từ chối luôn trả riêng; lỗi bất ngờ còn được báo vào `bot-log` (xem mục tự động).

## Cách đọc

| Cột         | Ý nghĩa                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| Ai dùng     | Quyền mặc định của Discord cho cả nhóm lệnh ("mọi người" = không đặt quyền) |
| Trả lời     | Công khai hay riêng                                                         |
| Ping        | Ai bị thông báo                                                             |
| Được phép   | Điểm bản cũ không chặn, bot giữ nguyên                                      |
| Khác bản cũ | Chỉ ghi chỗ khác; trống = giữ nguyên bản cũ                                 |

Chung cho mọi lệnh:

- Bot trả lời theo ngôn ngữ của guild: tiếng Việt mặc định; guild chọn English thì giữ câu chữ của bản cũ.
- Ô nhập `emoji` và `time`/`date` có gợi ý khi gõ.
- Dấu "⚠ cần kiểm" đánh dấu chỗ code mới khác bản cũ mà chưa nằm trong danh sách khác biệt đã duyệt.

Nguồn đối chiếu: quyền và guild-only ở `apps/server/src/discord/command-groups.ts`; mô tả ở `packages/shared/src/messages/{vi,en}/*.json`; option ở `apps/server/src/modules/*/*.commands.ts`; bản cũ ở `root/src/commands/`.

---

## 1. `/bot-message` — nói và sửa bằng tiếng của bot

Ai dùng: Quản trị viên. Mọi subcommand trả riêng.

| Subcommand                                                     | Làm gì                                                                                                  | Ping / Được phép                                                                                    | Khác bản cũ                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send` `content` `[destination]` `[reply-message]`             | Bot gửi tin vào kênh/thread (mặc định kênh hiện tại), hoặc trả lời một tin                              | Ping theo nội dung (user, role, everyone). Gửi được vào kênh của guild khác, trả lời tin guild khác | —                                                                                                                                                                                                                                                                                                                            |
| `copy-paste` `message-link` `[destination]`                    | Sao chép tin (chữ, file) sang kênh khác                                                                 | Ping theo nội dung tin gốc. Nguồn từ guild khác được                                                | —                                                                                                                                                                                                                                                                                                                            |
| `edit-copy` `new-message-link` `old-bot-message-link`          | Sửa tin cũ của bot bằng nội dung của một tin khác                                                       | Ping theo nội dung mới                                                                              | —                                                                                                                                                                                                                                                                                                                            |
| `edit-send` `old-bot-message-link` `[new-content]`             | Sửa tin cũ của bot bằng chữ gõ tay                                                                      | Ping theo nội dung mới                                                                              | Khác đã duyệt (hộp thoại cho nội dung dài): `new-content` đổi thành tuỳ chọn, thiếu thì mở hộp thoại (bản cũ bắt buộc)                                                                                                                                                                                                       |
| `react` `message-link` `emoji` `[poll-choice-count 0-10]`      | Bot thả emoji vào một tin, tuỳ chọn thêm các số làm lựa chọn bình chọn                                  | Không ping                                                                                          | —                                                                                                                                                                                                                                                                                                                            |
| `schedule-send` `time` `[message]` `[date]` `[destination]`    | Hẹn giờ gửi một tin                                                                                     | Ping theo nội dung khi đến giờ                                                                      | Khác đã duyệt: `time` + `date` là chuỗi có gợi ý (giờ Việt Nam; `date` dạng ngày/tháng, không năm = lần gần nhất sắp tới) thay 6 option số. Khác đã duyệt: `message` tuỳ chọn (mở hộp thoại); lịch lưu trong DB nên không mất khi khởi động lại (bản cũ chỉ trong RAM); giới hạn 366 ngày / 500 lịch chờ chỉ áp cho REST/MCP |
| `schedule-copy` `message-link` `time` `[date]` `[destination]` | Hẹn giờ sao chép một tin; chữ và file được đọc lúc đến giờ, nên sửa tin trước đó thì bản gửi là bản sửa | Ping theo nội dung khi đến giờ                                                                      | Như `schedule-send` (`time`/`date`, bền, giới hạn mới)                                                                                                                                                                                                                                                                       |

## 2. `/scheduler` — xem và huỷ tin hẹn giờ

Ai dùng: Quản lý tin nhắn.

| Subcommand    | Làm gì                        | Trả lời   | Khác bản cũ                                                                                                              |
| ------------- | ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `get`         | Liệt kê tin hẹn giờ của guild | Công khai | Khác đã duyệt: chỉ liệt kê lịch đang chờ (bản cũ chỉ biết lịch còn sống nên tương đương); id là id mới, lấy từ danh sách |
| `cancel` `id` | Huỷ một lịch                  | Riêng     | `id` có gợi ý từ danh sách lịch chờ                                                                                      |

## 3. `/birthday` — danh sách sinh nhật

Ai dùng: Quản trị viên.

| Subcommand                       | Làm gì                                                                       | Trả lời   |
| -------------------------------- | ---------------------------------------------------------------------------- | --------- |
| `append-list` `file`             | Nhập file CSV (tối đa 1 MB), báo từng dòng bị bỏ qua                         | Riêng     |
| `get-list` `[month 1-12]`        | Xem danh sách theo tháng (mặc định cả năm)                                   | Công khai |
| `remove` `[student-id]` `[user]` | Xoá một người khỏi danh sách theo mã sinh viên hoặc user (cần một trong hai) | Riêng     |
| `birthday-channel` `channel`     | Chọn kênh chúc mừng; cùng cài đặt với `/set birthday-channel`                | Công khai |

Không ping. Lời chúc tự động nằm ở mục "Hành vi tự động".

## 4. `/set` — cài đặt máy chủ

Ai dùng: Quản trị viên. Bot từ chối (riêng) nếu nó không đủ quyền trong kênh được chọn; đó là kiểm quyền của bot, không phải của người gọi. Trả lời công khai, không ping.

| Subcommand                   | Làm gì                                  |
| ---------------------------- | --------------------------------------- |
| `intro-channel` `channel`    | Kênh giới thiệu, nguồn cho `/get intro` |
| `log-channel` `channel`      | Kênh log của guild                      |
| `birthday-channel` `channel` | Kênh chúc sinh nhật                     |

## 5. `/game` — trò chơi trong kênh

Ai dùng: Quản lý tin nhắn. Trả lời riêng; vòng chơi mở đầu được đăng vào kênh chơi, đó là thứ cả phòng thấy. Không ping. Trò: nối từ, đếm số, xếp chữ, Wordle.

| Subcommand                           | Làm gì                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `set` `game` `channel` `[max-words]` | Chọn kênh chơi của một trò và bắt đầu ván mới; `max-words` chỉ dùng cho nối từ (tối thiểu 200, mặc định 3000), trò khác bỏ qua |
| `reset` `game`                       | Chơi lại ở kênh đã chọn (nối từ: đăng lại "Trò chơi bắt đầu"); chưa chọn kênh thì báo                                          |
| `skip` `game`                        | Chỉ xếp chữ và Wordle: lộ đáp án và ra câu mới                                                                                 |

`/leaderboard game` (công khai) và `/help game` (riêng) dành cho mọi người.

## 6. `/note` — ghi chú theo vai trò

Ai dùng: mọi người. Trả lời công khai: ghi chú là của cả phòng. Không ping (tên vai trò hiện dạng chữ).

| Subcommand                       | Làm gì                                               | Khác bản cũ                                                                                        |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `add` `role` `topic` `[content]` | Lưu (hoặc ghi đè) ghi chú theo chủ đề                | Khác đã duyệt: thiếu `content` thì mở hộp thoại; option `note` đổi tên `content`. `topic` có gợi ý |
| `get` `role`                     | Xem mọi ghi chú của vai trò                          | —                                                                                                  |
| `remove` `role` `topic`          | Xoá ghi chú; báo xong dù chủ đề có tồn tại hay không | `topic` có gợi ý                                                                                   |

Ai cũng thêm/xoá được ghi chú của mọi vai trò: bản cũ không chặn.

## 7. `/get` — tra thông tin

Ai dùng: mọi người.

| Subcommand                                                                        | Làm gì                                                                                          | Trả lời                                                             | Ping                                       | Khác bản cũ                                                                                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `intro` `user`                                                                    | Tìm bài giới thiệu mới nhất của user trong kênh giới thiệu (quét tối đa 10000 tin gần nhất)     | Công khai; chưa đặt kênh thì báo riêng                              | Không                                      | —                                                                                                                         |
| `id-by-reaction` `message-link` `emoji` `[mention]` `[reply-message]` `[content]` | Liệt kê id người đã thả emoji                                                                   | Công khai; riêng nếu có `reply-message` (danh sách gửi vào tin kia) | Chỉ khi `mention` bật: ping những người đó | —                                                                                                                         |
| `id-by-role` `role` `[in-this-channel]`                                           | Liệt kê id thành viên của vai trò                                                               | Công khai                                                           | Không                                      | Bản cũ tự chặn người không có quyền Quản lý vai trò; bản mới bỏ chặn, ai thấy lệnh là dùng được (chủ bot chốt 2026-10-14) |
| `invite-link` `[channel]`                                                         | Tạo lời mời không hết hạn, gửi DM cho người gọi (DM đóng thì hiện link trong câu trả lời riêng) | Riêng                                                               | Không                                      | —                                                                                                                         |

Link tin nhắn của guild khác được theo ở `id-by-reaction`.

## 8. `/mention` — nhắc nhiều người

Ai dùng: người có quyền Dùng lệnh ứng dụng (gần như mọi người). Ping được chủ động: `@user` trong danh sách và `@role`/`@everyone` trong `content` đều ping.

| Subcommand                                                                                        | Làm gì                                                                                                                                                 | Trả lời                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `by-a-reaction` `message-link` `emoji` `[reply-message]` `[content]`                              | Ping những người đã thả emoji                                                                                                                          | Công khai; riêng ("Sent!") nếu có `reply-message`                    |
| `not-react` `message-link` `[content]` `[role]` `[is-reply]` `[include-bots]` `[only-in-channel]` | Ping những người nhìn thấy kênh nhưng chưa thả cảm xúc nào; lọc theo vai trò, có thể gồm bot; `only-in-channel` tắt thì xét mọi thành viên của vai trò | Công khai; riêng nếu `is-reply` (danh sách trả lời vào chính tin đó) |
| `everyone` `[content]` `[reply-message]`                                                          | Chỉ trong thread: bot ping cả thread với lời "đã nhắc @everyone", dù người gọi không có quyền Mention Everyone                                         | Riêng ("Sent!"); tin ở thread                                        |

`/thread everyone` là cùng lệnh này đặt trong `/thread`. Danh sách dài được chia khối ≤ 2000 ký tự. Kênh thoại không được hỗ trợ.

## 9. `/bulk-assign` — gán hoặc gỡ vai trò hàng loạt

Ai dùng: Quản lý vai trò. Trả lời riêng, không ping. `is-remove` bật thì gỡ thay vì gán. Báo số người xong và từng người lỗi.

| Subcommand                                                | Làm gì                                                                                            | Khác bản cũ                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `list` `role` `[ids]` `[members-of-role]` `[is-remove]`   | Gán/gỡ cho danh sách id (mention, dấu phẩy đều nhận)                                              | Khác đã duyệt (nhập id dễ hơn): `ids` đổi thành tuỳ chọn và thêm `members-of-role` (lấy thành viên của một vai trò khác); bản cũ `ids` bắt buộc |
| `by-reaction` `message-link` `emoji` `role` `[is-remove]` | Gán/gỡ cho người đã thả emoji vào tin (kể cả tin guild khác; vai trò là của guild đang chạy lệnh) | —                                                                                                                                               |

## 10. `/thread` — luồng theo tiền tố

Ai dùng: Quản lý vai trò.

| Subcommand                                               | Làm gì                                                                                                | Trả lời   | Ping                               | Khác bản cũ                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- | ---------------------------------- | ---------------------------------------------------------------- |
| `create` `name` `message` `[is-private]` `[destination]` | Tạo thread (kênh chữ hoặc forum; thread riêng chỉ ở kênh chữ) và đăng tin đầu, ghi "người gọi đã tạo" | Công khai | Theo nội dung tin đầu (user, role) | —                                                                |
| `edit-prefix` `old-prefix` `new-prefix` `[destination]`  | Đổi tiền tố tên mọi thread đang mở khớp tiền tố cũ                                                    | Riêng     | Không                              | —                                                                |
| `remove-by-prefix` `prefix` `[destination]`              | Xoá mọi thread khớp tiền tố                                                                           | Riêng     | Không                              | Khác đã duyệt: xem danh sách và hỏi xác nhận (nút) trước khi xoá |
| `everyone`                                               | Xem `/mention everyone`                                                                               |           |                                    |                                                                  |

## 11. `/private-thread` — một thread riêng cho mỗi người

Ai dùng: Quản lý vai trò. Chỉ trong kênh chữ. Trả lời riêng. Bot thêm từng người (và người gọi) vào thread riêng của họ rồi đăng `message`; ping theo nội dung `message` (user, role).

| Subcommand                                                                | Làm gì                                                        | Khác bản cũ                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `list` `prefix` `[ids]` `[role]` `[message]` `[destination]`              | Tạo thread `<prefix>-<tên>` cho từng người trong danh sách id | Khác đã duyệt: thêm `role`; `ids` đổi thành tuỳ chọn (cần `ids` hoặc `role`) |
| `by-reaction` `prefix` `message-link` `emoji` `[message]` `[destination]` | Tạo cho người đã thả emoji vào tin (kể cả tin guild khác)     | —                                                                            |

## 12. `/purge` — xoá hàng loạt tin trong kênh

Ai dùng: Quản trị viên. Mọi câu trả lời là riêng. Chỉ chạm kênh đang chạy lệnh (link phải cùng kênh). Tin hệ thống bị bỏ qua.

| Subcommand                                          | Làm gì                                                                                                                                                                                                                    | Khác bản cũ                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `any` `[until-link]` `[from-link]` `[count 1-1000]` | Xoá các tin mới hơn `until-link` (tin này được giữ) đến `from-link` (tin này bị xoá; mặc định tin mới nhất); hoặc xoá `count` tin mới nhất. Dùng `until-link` hoặc `count`, không cả hai; `from-link` đi với `until-link` | Khác đã duyệt: hiện số tin sẽ xoá và hỏi xác nhận bằng nút trước khi xoá; thêm `count`. Tin đăng thêm khi đang chờ xác nhận không bị xoá lẫn |

## 13. `/ping`

Ai dùng: mọi người, cả trong DM. Trả lời công khai: thời gian bot chạy, nhịp websocket, độ trễ khứ hồi. Không ping.

## 14. `/add-poll` (chỉ trong máy chủ)

Ai dùng: mọi người. Trả lời riêng. `poll-choice-count` (1-10) `[message-link]`: thả các emoji số 1-10 vào tin có sẵn, hoặc vào một tin "New Poll!" bot đăng mới. Link guild khác được. Không ping.

## 15. `/attendance-by-role` (chỉ trong máy chủ)

Ai dùng: mọi người. Trả lời công khai: `role` `[voice-channel]` so thành viên của vai trò với người đang ở kênh thoại/stage; liệt kê người có mặt (chữ, không ping) và người vắng (mention).

- Ping: chỉ những người vắng, đúng như bản cũ.
- Khác đã duyệt: `voice-channel` tuỳ chọn, mặc định kênh thoại của người gọi (không ở kênh nào thì báo riêng).

## 16. `/create-activity` (chỉ trong máy chủ)

Ai dùng: Quản lý kênh. Trả lời công khai, không ping. `1-emoji` `2-name` `3-short-name (đúng 3 ký tự)` `[category]`: tạo 3 vai trò (`-Event`, `-Multi`, `-MC`) và 3 kênh (general, thread-only, thoại) với quyền theo vai trò Technician/Muted có sẵn (kiểm tên vai trò ở `activity.overwrites.ts`).

- Khác đã duyệt: `category` tuỳ chọn; bỏ trống thì dùng category trong cấu hình guild, không có thì dùng category cố định của bản cũ.

## 17. `/chatbot` — quản lý chatbot của máy chủ

Ai dùng: Quản lý máy chủ (`ManageGuild`, cùng quy tắc với dashboard). Mọi subcommand trả riêng, không ping gì (`allowedMentions` rỗng), không kiểm quyền người gọi; lệnh phá huỷ áp dụng ngay, không hỏi xác nhận. Trong DM báo lỗi không có máy chủ. Khoá và địa chỉ mô hình ngôn ngữ của máy chủ CHỈ đặt trên dashboard: option slash để lại khoá trong log kênh.

| Subcommand                                  | Làm gì                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                    | Bật hay tắt, các kênh, hạn mức mặc định, mô hình đang dùng (của máy chủ hay dùng chung, tên model, 4 ký tự cuối khoá); đang tạm dừng vì hết credit thì ghi đến lúc nào |
| `enable` / `disable`                        | Bật / tắt chatbot (mặc định tắt)                                                                                                                                       |
| `channel-add` `channel`                     | Cho chatbot trả lời khi được nhắc ở kênh này (kênh chữ, announcement, thread). Từ chối nếu kênh thuộc trò chơi / nối từ hoặc đã đủ số kênh tối đa                      |
| `channel-remove` `channel`                  | Thôi trả lời ở kênh; đồng thời xoá bộ nhớ của kênh                                                                                                                     |
| `limit` `amount`                            | Hạn mức token hằng tháng mặc định cho mỗi thành viên (0 đến 1 tỷ)                                                                                                      |
| `quota-set` `user` `[limit]` `[clear]`      | Hạn mức riêng của một thành viên; đúng MỘT trong `limit` hoặc `clear` (bỏ hạn mức riêng, về mặc định), cả hai hay không có đều bị từ chối                              |
| `quota-grant` `user` `tokens`               | Cộng token thưởng cho tháng này; số âm thu hồi lần thưởng trước, thưởng không xuống dưới 0                                                                             |
| `quota-reset` `user`                        | Đặt lại phần đã dùng của tháng này về 0, giữ thưởng; không hoàn tác                                                                                                    |
| `usage` `[user]`                            | Một thành viên: đã dùng, còn lại, tổng. Bỏ trống: 10 người dùng nhiều nhất tháng này                                                                                   |
| `memory-clear` `scope` `[user]` `[channel]` | Xoá bộ nhớ chatbot trong máy chủ này; `scope` = `user` (cần `user`) / `channel` (cần `channel`) / `all`. Id không thuộc `scope` bị service từ chối                     |

Số lượng kênh tối đa, hạn mức mặc định và các trần nằm ở `packages/shared/src/constants/chatbot.ts`. Cách bot trả lời, hạn mức và bộ nhớ: `docs/architecture.md` mục chatbot.

## 18. `/chat` — phần của riêng thành viên

Ai dùng: mọi người (không đặt quyền mặc định). Trả riêng. Mọi lệnh khoá theo id người gọi VÀ máy chủ hiện tại: chỉ thấy dòng của chính mình, không bao giờ thấy chữ của người khác hay ngữ cảnh đã gửi cho mô hình.

| Subcommand      | Làm gì                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| `memory`        | Xem bản tóm tắt chatbot nhớ về mình trong máy chủ này                    |
| `memory-clear`  | Xoá bản tóm tắt đó                                                       |
| `usage`         | Đã dùng, còn lại, tổng của tháng này (cùng số với dòng cuối câu trả lời) |
| `history`       | 5 lượt hỏi đáp gần nhất của mình (câu hỏi và trả lời được rút gọn)       |
| `history-clear` | Xoá lịch sử hỏi đáp của mình trong máy chủ này, báo số lượt đã xoá       |

## 19. `/verify` — xác thực email của chính mình

Ai dùng: mọi người (không đặt quyền mặc định), chỉ trong máy chủ. Mọi câu trả lời là riêng và không hiện địa chỉ đầy đủ.

| Subcommand    | Làm gì                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`       | Mở form nhập email (dòng mô tả dưới ô lấy từ `verify-message` của máy chủ, cắt còn 100 ký tự). Gửi mã qua thư, rồi trả lời riêng kèm nút `Nhập mã` / `Gửi mã mới` |
| `delete-data` | Xoá email đã xác thực và bản chờ mã của chính mình trong máy chủ này. Role đã nhận được giữ nguyên                                                                |

Mỗi thành viên thử tối đa 10 địa chỉ mỗi 10 phút, 60 giây giữa hai thư và 10 thư mỗi ngày; nhập sai mã 5 lần thì phải đợi bản chờ hết hạn (15 phút). Bấm nút khi đã xác thực rồi thì role bị mất được cấp lại.

Cùng luồng với nút do `/email-verify button` đăng (`ev/start/<guildId>`): nút, form và nút gửi lại dùng được cả trong DM (nút chào thành viên mới), máy chủ lấy từ custom id.

## 20. `/email-verify` — cài đặt xác thực email

Ai dùng: Quản lý máy chủ (`ManageGuild`). Trả riêng, không ping. Không kiểm quyền người gọi.

| Subcommand                                                                                                      | Làm gì                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                                                                        | Bật/tắt, gửi thư sẵn sàng chưa, số đã xác thực / đang chờ mã / luật / danh sách, thư đã gửi hôm nay, role mặc định                                                     |
| `button` `channel` `[title]` `[message]` `[button-text]`                                                        | Đăng tin có nút xác thực vào kênh chữ hoặc announcement                                                                                                                |
| `manual` `user` `email`                                                                                         | Xác thực thủ công, không gửi mã; không áp blocklist và luật; một địa chỉ vẫn chỉ thuộc một thành viên                                                                  |
| `unverify` `user` `[remove-roles]`                                                                              | Gỡ xác thực; có `remove-roles` thì thu hồi role đã cấp và cấp lại role chưa xác thực. Hỏi xác nhận bằng hai nút trước khi làm                                          |
| `test-mail` `email`                                                                                             | Gửi thư thử (tính vào hạn mức thư hằng ngày, tối đa 5 mỗi 10 phút mỗi người, có audit; gửi lỗi thì hoàn hạn mức); câu trả lời chỉ hiện địa chỉ đã che                  |
| `config` `[enabled]` `[unverified-role]` `[log-channel]` `[auto-verify]` `[auto-unverified]` `[verify-message]` | Đổi đúng các tuỳ chọn đã nhập; không có tuỳ chọn nào thì báo "không có gì để đổi". Bật cần có tài khoản SMTP; `auto-verify` DM nút cho thành viên mới                  |
| `role-add` / `role-remove` `role`                                                                               | Role mọi thành viên đã xác thực đều nhận (tối đa 25)                                                                                                                   |
| `export`                                                                                                        | File Excel các thành viên đã xác thực (email, tên, role…) gửi riêng, tối đa 20.000 dòng; kèm dòng nhắc nếu có thành viên không tra được tên/role; chứa dữ liệu cá nhân |

## 21. `/email-rule` — luật truy cập

Ai dùng: Quản lý máy chủ. Trả riêng, role chỉ hiển thị, không ping. Luật đánh số như `list` hiển thị (từ 1, tối đa 25 luật, 25 role mỗi luật).

| Subcommand                                    | Làm gì                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add` `expression` `role` `[role2]` `[role3]` | Thêm luật: điều kiện dạng chữ, ví dụ `domain:*.edu AND (list:k21 OR invite:abc12)` (trường `domain`, `email`, `list`, `invite`; AND chặt hơn OR; có ngoặc) |
| `edit` `index` `expression`                   | Đổi điều kiện của luật, giữ role                                                                                                                           |
| `remove` `index`                              | Xoá luật                                                                                                                                                   |
| `role-add` / `role-remove` `index` `role`     | Thêm / bỏ role của luật                                                                                                                                    |
| `list`                                        | Từng luật dạng chữ kèm role; cảnh báo danh sách mà luật nhắc tới nhưng không tồn tại; chia khối ≤ 2000 ký tự                                               |
| `clear`                                       | Xoá mọi luật, hỏi xác nhận bằng hai nút trước                                                                                                              |

Điều kiện sai thì trả lý do và vị trí (tính từ 1) và không đổi gì. Không luật nào có điều kiện địa chỉ thì mọi địa chỉ hợp lệ được nhận.

## 22. `/email-block` — chặn mẫu địa chỉ

Ai dùng: Quản lý máy chủ. Trả riêng.

| Subcommand          | Làm gì                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `add` `patterns`    | Thêm các mẫu cách nhau bằng dấu phẩy hoặc dấu cách, ví dụ `*@mailinator.com`; `*` thay cho văn bản bất kỳ (tối đa 100 mẫu) |
| `remove` `patterns` | Bỏ mẫu khỏi danh sách chặn                                                                                                 |
| `list`              | Xem các mẫu                                                                                                                |
| `clear`             | Bỏ hết, hỏi xác nhận bằng hai nút trước                                                                                    |

## 23. `/email-list` — danh sách email cho luật

Ai dùng: Quản lý máy chủ. Trả riêng. Địa chỉ chỉ lưu dạng băm nên không lệnh nào hiện lại được địa chỉ. Tối đa 25 danh sách, 20.000 địa chỉ mỗi danh sách.

| Subcommand                       | Làm gì                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create` `name`                  | Tạo danh sách trống (`a-z0-9_-`, tối đa 32 ký tự)                                                                                                                               |
| `delete` `name`                  | Xoá danh sách; cho biết số địa chỉ sẽ mất và hỏi xác nhận. Luật nhắc tới nó còn đó nhưng không khớp nữa                                                                         |
| `add` / `remove` `name` `emails` | Thêm / bỏ địa chỉ cách nhau bằng dấu cách, dấu phẩy hoặc xuống dòng; báo số thêm, số đã có, số không hợp lệ                                                                     |
| `upload` `name` `file` `[mode]`  | Thêm (mặc định) hoặc bỏ các địa chỉ trong file CSV/TXT ≤ 1 MB. File chỉ tải từ `cdn.discordapp.com` / `media.discordapp.net`, có giới hạn thời gian; xử lý từng lô 5000 địa chỉ |
| `clear` `name`                   | Bỏ hết địa chỉ, giữ danh sách; hỏi xác nhận                                                                                                                                     |
| `show`                           | Các danh sách và số địa chỉ của từng danh sách                                                                                                                                  |

---

## Menu chuột phải trên tin nhắn (4)

Bản cũ không có. Không đặt guild-only. Mọi menu mở hộp thoại hoặc trả riêng.

| Menu                                               | Ai dùng            | Làm gì                                                                                                                              |
| -------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Edit bot message (Sửa tin nhắn của bot)            | Quản trị viên      | Mở hộp thoại sửa tin; chỉ tin do chính bot đăng, tin khác bị từ chối (riêng). Tương đương `/bot-message edit-send`                  |
| Reply as bot (Trả lời bằng bot)                    | Quản trị viên      | Mở hộp thoại, bot trả lời tin đã chọn; ping theo nội dung. Tương đương `/bot-message send` với `reply-message`                      |
| Mention non-reactors (Nhắc người chưa thả cảm xúc) | Dùng lệnh ứng dụng | `/mention not-react` với mặc định: không trả lời vào tin, không lọc vai trò, thành viên nhìn thấy kênh, bỏ bot; ping người chưa thả |
| Purge up to here (Xoá đến đây)                     | Quản trị viên      | Xoá mọi tin mới hơn tin đã chọn (tin này được giữ), sau xem trước và xác nhận như `/purge any`                                      |

---

## Hành vi tự động (không phải lệnh)

| Việc           | Hành vi                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chúc sinh nhật | 00:00 giờ Việt Nam mỗi ngày, vào kênh sinh nhật của guild; một tin cho mỗi người, ping người đó. Bot tắt lúc 00:00 thì chúc bù khi khởi động. Sinh nhật 29/2 được chúc vào 28/2 ở năm không nhuận                                                                                                                                                                                                          |
| Nối từ         | Trong kênh đặt bởi `/game set game:Nối từ`: bot thả phản ứng và trả lời theo luật nối từ; tin chat thường trong kênh được bỏ qua, trò đã đạt `max-words` thì im lặng đến khi `/game reset game:Nối từ`                                                                                                                                                                                                     |
| Nghĩa của từ   | Từ được chấp nhận: sau ✅ bot trả lời (không ping, không xem trước link) từ loại, nghĩa Anh-Anh + ví dụ (en.wiktionary, dự phòng Datamuse), nghĩa tiếng Việt (vi.wiktionary, dự phòng dịch máy MyMemory, có ghi "dịch máy") và link Anh-Anh / Anh-Việt / Oxford. Tra trực tiếp, chỉ nhớ tạm trong RAM (5000 từ, 24 giờ); mọi nguồn lỗi thì chỉ có ✅. Việc chấm từ không phụ thuộc vào phần này            |
| Auto-react     | Tin chứa cụm trong từ điển phản ứng, hoặc có `react <emoji>`, được bot thả emoji tương ứng; áp dụng cả khi sửa tin. Emoji lỗi (thiếu quyền, server không có) bị bỏ qua, không báo người dùng                                                                                                                                                                                                               |
| Chatbot        | Máy chủ phải bật (`/chatbot enable`) và có kênh (`/chatbot channel-add`). Trong kênh đó, nhắc thẳng bot hoặc trả lời một tin của bot thì bot trả lời bằng tin trả lời (ping người hỏi, không ping ai khác), kèm dòng cuối `-# còn lại x / tổng`. `@everyone`/`@role` không phải câu hỏi. Người đang chờ câu trả lời mà gửi thêm thì tin mới được thả ⏳ và bỏ qua. Thiết kế đầy đủ: `docs/architecture.md` |
| Xác thực email | Thành viên mới vào máy chủ đang bật xác thực: bot đối chiếu invite đã dùng (cần quyền Manage Server và intent Guild Invites), cấp role của các luật có `invite:<mã>`, role chưa xác thực nếu `auto-unverified`, và DM nút xác thực nếu `auto-verify` (đóng DM thì bỏ qua). Mỗi ngày 03:30 giờ nghiệp vụ xoá bản chờ mã hết hạn và bộ đếm thư cũ                                                            |
| Báo lỗi        | Lỗi bất ngờ khi chạy lệnh được gửi vào kênh `bot-log` của guild quản trị (không ping); người gọi chỉ thấy câu thông báo chung, không thấy chi tiết                                                                                                                                                                                                                                                         |

## Lệnh đã bỏ

- `/shutdown`: không còn. Tắt bot là việc của hạ tầng (Coolify), không qua Discord.

## Điểm cần kiểm (tổng hợp)

Khác biệt đã duyệt trong kế hoạch (nội dung tuỳ chọn mở hộp thoại, `members-of-role`, `ids` tuỳ chọn khi có `role`, lịch hẹn lưu DB và `/scheduler get` chỉ liệt kê lịch chờ) đã ghi ở từng lệnh. Còn lại cần chủ bot xác nhận:

1. Giới hạn 500 lịch chờ mỗi guild và tối đa 366 ngày chỉ áp cho REST/MCP (Release 2); lệnh slash không bị giới hạn, như bản cũ.
