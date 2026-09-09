# P07 — Chống XSS cho Gym Admin

Hoàn thành: 07/09/2026. Phạm vi runtime: chỉ `public/admin.js`. Thêm `test/admin-xss-test.js`, tài liệu này và cập nhật bảng P07. Không sửa Dashboard, Master Admin, CSS/HTML, backend hay dữ liệu thật. Working tree ban đầu toàn bộ source chưa được Git track; không tự commit.

## Kiểm kê toàn bộ HTML sink trước sửa

Có **8 phép gán innerHTML, 4 insertAdjacentHTML**. Dữ liệu DB/user đi vào frontend qua API; kể cả ID/trường số cũng không được coi là HTML an toàn.

| # | Sink trước sửa | Nguồn / cách xử lý |
|---|---|---|
| 1 | loadDashboardState / entry-map.innerHTML | `/state`: Map id/name/status/points; chuyển option DOM, value property và textContent; giữ thứ tự ưu tiên Map chưa clear |
| 2 | renderWizardRows / container.innerHTML | `/season-switch/preview`: roster name/avatar_url; chuyển input DOM và value property |
| 3 | renderWizardRows / insertAdjacentHTML khi roster rỗng | Template nội bộ; thay append/replaceChildren với DOM |
| 4 | wizard-add-row / insertAdjacentHTML | Template nội bộ; thay append DOM, gắn remove handler khi tạo mỗi dòng |
| 5 | loadMembers / member-list.innerHTML | `/members`: id, name, avatar_url, is_banned; escape text và attribute có dấu nháy, ảnh tạo qua DOM + URL policy; class/badge là hằng chọn bằng boolean |
| 6 | loadMembers / entry-member.innerHTML | `/members`: id/name; chuyển option DOM và value/textContent |
| 7 | renderNewMemberRows / c.innerHTML rỗng | Chỉ clear bằng chuỗi rỗng, không chứa dữ liệu ngoài; giữ nguyên |
| 8 | renderNewMemberRows / insertAdjacentHTML | newMemberRowHtml là template hằng, không có input/API; giữ nguyên |
| 9 | add-member-row / insertAdjacentHTML | Cùng template hằng như trên; giữ nguyên |
| 10 | setLogFilterOptions / select.innerHTML | `/entries`: member/map id/name, round; thay option DOM, giữ lựa chọn trước đó nếu còn tồn tại |
| 11 | renderAdminLog / list.innerHTML khi rỗng | Thông báo hằng; giữ nguyên |
| 12 | renderAdminLog / list.innerHTML từ logCardHtml | `/entries`: id, Map/member name, round, tickets, points; escape cả text lẫn quoted attribute, ảnh Map qua DOM/URL policy; thời gian chuyển qua Date và phép toán số |

Sau sửa còn **4 innerHTML + 2 insertAdjacentHTML**: chỉ 2 template động (member list và log card), còn lại là clear/HTML hằng. Giữ các template nhiều phần tử để bảo toàn cấu trúc view/edit, class và khoảng trắng hiện có. Mọi scalar API trong template động được escape ở text/attribute; không đưa dữ liệu ngoài vào HTML fragment, event handler hoặc CSS.

`escapeHtml` chỉ dùng cho text và attribute có dấu nháy, escape `& < > " '`. Không dùng làm sanitizer cho URL, script hay CSS. `avatarHtml` tạo img/div bằng DOM, fallback bằng textContent rồi serialize cho template. `pokemonTypeIconHtml` dùng allowlist type/icon nội bộ từ P06, class mặc định hằng; không sửa helper này. `prioritizeEntryMaps` và `filterAdminLogRows` không có HTML sink.

Tên Gym, season banner, round hint, filter summary, thông báo tạo thành viên/ghi log/chuyển mùa và lỗi API vốn dùng textContent; giữ nguyên. Lỗi sửa thành viên dùng alert, xác nhận dùng confirm: các surface này hiển thị text, không parse HTML. `auth-client.js` cũng hiển thị lỗi bằng textContent; không cần sửa.

## URL ảnh và bảo toàn dữ liệu

Áp dụng cùng policy P06: HTTP(S) hoặc đường dẫn tương đối resolve theo URL trang; từ chối URL sai, control/whitespace, dấu nháy, angle brackets, backtick, backslash và credentials. Không cho javascript:, toàn bộ data: (HTML/SVG/PNG), blob:, file:. URL bị từ chối hiển thị fallback hiện có. Icon SVG nội bộ vẫn là img hợp lệ.

Input URL chỉ hiển thị/sửa text nguyên văn, không tự xóa hoặc rewrite dữ liệu DB. Policy được áp dụng tại điểm render ảnh. Tên chứa dấu nháy/HTML vẫn được lưu và gửi nguyên văn, không lưu chuỗi đã escape. Helper nằm trong closure Admin để không phụ thuộc Dashboard và không ảnh hưởng Master.

Form chuyển mùa tạo input bằng DOM; remove handler gắn khi tạo dòng, gồm cả roster copy và dòng rỗng. Trước đây roster mới render chưa được bind nút remove cho đến khi thêm dòng; cách tạo DOM mới làm nút Xoá hoạt động ngay, không thêm control/flow mới.

## Test và giao diện

- `node --test test/admin-xss-test.js`: **8 PASS / 0 FAIL**, gồm 7 subtest + parent.
- `node test/frontend-ux-test.js`: **41 PASS / 0 FAIL**.
- `node --test test/frontend-session-test.js`: **5 PASS / 0 FAIL**, gồm 4 subtest + parent.

Regression P07 kiểm tra:

- Escape roundtrip: text, quoted attribute, dấu nháy đơn/đôi, ampersand, entity đã encode và payload phá attribute.
- Tên thành viên/Map, ID, round/tickets/points, member edit value, bộ lọc kết hợp/reset, log card, preview season và wizard roster có payload img/svg/event handler. Assert không tạo node/handler lạ, không thực thi payload và không có pageerror.
- URL javascript/data HTML/data SVG/phá attribute bị fallback; URL ảnh nội bộ vẫn decode thành công; unit test thêm blob/file/control/credentials/malformed URL.
- Lỗi API khi tạo/sửa thành viên, ghi/sửa log, chuyển mùa giữ nguyên text trong message/alert.
- Luồng trình duyệt dùng session/CSRF, Express và SQLite `:memory:` thật: tạo thành viên có payload, sửa cùng ID, Huỷ khôi phục giá trị; ghi 20 điểm rồi sửa thành 30 điểm/2 vé trên cùng entry ID. Kiểm tra dữ liệu DB, số bản ghi, request body nguyên văn, 4 mutation có CSRF và lọc đúng log.

**15 cặp screenshot trước/sau giống nhau từng byte PNG**: 390/768/1440 px × danh sách thành viên, sửa thành viên, wizard, lượt chơi và sửa lượt chơi. Đã xem ảnh mobile sửa thành viên và desktop sửa lượt chơi. Không sửa CSS/HTML. Fixture cố định, Edge headless, ảnh nội bộ, font ngoài bị chặn và animation tắt khi chụp; không thay thế QA đa browser/dữ liệu production.

Baseline `tmp/p07/admin-before.js` và 30 ảnh nằm trong thư mục ignored `tmp/p07/`. Khi clone không có baseline, subtest visual báo SKIP rõ ràng; các test XSS và workflow vẫn chạy. Muốn so sánh thay đổi mới, lưu source trước sửa vào baseline này rồi chạy suite.

### Regression Dashboard P06 chạy bổ sung

`node --test test/dashboard-xss-test.js`: mỗi lần **3 PASS / 2 FAIL** (3 subtest XSS pass; subtest visual và parent fail). Chạy hai lần: visual lệch tại 768/dashboard rồi 1440/dashboard. Đã xem cặp ảnh 768 px và xác nhận có pixel khác nhau; chưa xác định nguyên nhân chính xác. Test này chủ động loại script Admin/auth-client khỏi HTML, vì vậy không chạy phần runtime P07; Dashboard, CSS và test P06 không bị sửa trong P07. Đây là giới hạn của regression visual P06 cần điều tra riêng, không báo toàn bộ frontend suite xanh. Các test bắt buộc Gym Admin P07 và so sánh 15 cặp ảnh của P07 đều pass.

## Giới hạn và bước tiếp theo

Dừng tại P07; không thực hiện P08. Master XSS thuộc P08; CSP và kiểm tra nội dung upload/MIME thuộc P11/P13. URL validation frontend không xác minh nội dung file từ server. Không chạy toàn bộ backend suite trong ngày không phải checkpoint. Không commit/deploy.

Commit đề xuất: `fix(admin): prevent XSS in Gym Admin rendering and image URLs`.
