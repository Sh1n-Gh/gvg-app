# P05 — Frontend session checkpoint

Trạng thái: **DONE — code/local checkpoint**, 05/09/2026. Không triển khai production, không sửa XSS ngoài giao diện auth, không scrub dữ liệu thật.

## Kết quả

- `public/auth-client.js`: helper dùng chung cho Master/Gym. Login POST password đúng một lần, xóa ô password trước khi chờ request; cookie HttpOnly do browser quản lý. CSRF chỉ trong closure JS, thêm X-CSRF-Token cho mutation (kể cả raw upload); credentials=same-origin, no-store. Không dùng localStorage/sessionStorage hay đọc SID.
- `public/master.js`, `public/admin.js`: bỏ biến masterCode/adminCode và custom credential header; khởi tạo phiên bằng GET `/auth/session`. Refresh có session hợp lệ mở lại panel; 401 khóa panel và bỏ CSRF. Giữ form/bản nháp chưa gửi, không tự retry mutation. 403 báo không có quyền/phiên đã thay đổi; 429 và lỗi mạng có thông báo riêng.
- `public/master.html`, `public/dashboard.html`, `public/admin.html`: giữ layout/tab/business form hiện có; load helper trước JS trang, label đăng nhập/password và autocomplete phù hợp. Helper thêm vùng auth gồm logout, đổi password và cảnh báo must_rotate bằng DOM/textContent; không chặn nghiệp vụ vì must_rotate.
- Logout chỉ báo thành công sau response server; nếu mạng lỗi thì báo lỗi và không giả vờ đã đăng xuất. 204 không bị parse JSON lỗi. pageshow từ bfcache kiểm tra lại session. Không polling keepalive; expiry được xử lý khi request tiếp theo nhận 401, hoặc khi tải lại trang.
- Response của request thuộc phiên cũ không được dùng để mở lại/ghi kết quả vào phiên mới. Password/token không nằm trong URL/storage. Password đổi và credential tạo gym được xóa khỏi input khi gửi; mã gym được hiển thị một lần sau tạo vẫn được giữ theo business contract, và bị xóa khỏi màn hình khi logout/expiry.

## Gỡ legacy sau kiểm thử

Đã chạy backend + frontend E2E với `LEGACY_AUTH_ENABLED=0` trước khi gỡ bridge. Sau đó:

- `auth/backend.js`: bỏ đọc header credential và mọi nhánh LEGACY_AUTH_ENABLED; `/verify` luôn 404 (tombstone route), không authenticate. Flag cũ set 1 cũng không bật lại được.
- `routes/master.js`, `routes/gym-admin.js`: bỏ handlers `/verify`.
- `.env.example`: bỏ setting bridge. `MASTER_ADMIN_CODE` chỉ còn là alias input migration offline từ P03, không dùng request auth.
- `test/master-routes-smoke-test.js`: 50 checks chuyển sang cookie + CSRF thật, gồm upload/create/edit/delete/restore và Gym business mutations. Header cũ không cấp quyền.
- `test/session-test.js`: thay test bridge thành test từ chối header/verify ngay cả khi flag cũ bật; các test password đổi đăng nhập bằng auth/login.

Frontend cũ đã mở từ trước sẽ cần reload sau rollout. Không rollback riêng JS/frontend về P03; app/backend/frontend phải cùng release. Rollback cần artifact P04 hiểu hash + bridge nếu còn muốn phục vụ frontend cũ, hoặc forward-fix P05. Không khôi phục plaintext làm credential có hiệu lực.

## Kiểm thử thực tế

| Lệnh | Kết quả |
|---|---|
| `node test/master-routes-smoke-test.js` | **50 PASS / 0 FAIL**, cookie + CSRF, không dùng legacy để authenticate |
| `node test/frontend-ux-test.js` | **41 PASS / 0 FAIL** (39 baseline + 2 contract P05) |
| `npm run test:auth` | **24 nhóm PASS / 0 FAIL** |
| `npm run test:browser` | **4 kịch bản con PASS**; Node TAP tính thêm parent thành 5/5 |

Browser test `test/frontend-session-test.js` chạy **Microsoft Edge headless thật**, server HTTP local, SQLite in-memory đã seed/migrate; không dùng DB production hay browser profile cá nhân. Kiểm tra:

1. Master: sai/đúng password, xóa input, refresh, idle expiry, bản nháp còn sau relogin, đổi password, logout rồi refresh vẫn khóa.
2. Gym: các luồng tương tự, tạo member bằng session + CSRF sau relogin.
3. Không retry mutation 403; logout bị lỗi mạng không báo thành công; password input rỗng khi login request còn đang chờ.
4. Master và Gym cùng browser độc lập; Gym A vào Gym B bị khóa/403, không mutation tenant B; cookie Gym không truy cập API Master.

Browser kiểm tra requests không gửi custom header hoặc `/verify`, localStorage/sessionStorage rỗng, JS không thấy cookie HttpOnly; không có pageerror. Đã xem screenshot desktop/mobile 390px cho cả hai panel, không tràn ngang document, giữ tab/form quản lý. Ảnh test: `tmp/p05-browser/{master,gym}-{desktop,mobile}.png` (ignored, dữ liệu giả).

## Chạy lại

- Cài dependency theo lockfile. Playwright **1.62.1** là devDependency, không thêm runtime production dependency.
- `npm run test:p05` chạy các suite liên quan P05 và browser; `npm test` giữ suite không cần browser; `npm run test:browser` chạy riêng E2E.
- Windows mặc định dùng Edge có sẵn. Trên CI/Linux cài browser bằng `npx playwright install chromium` trước; có thể chọn browser có sẵn qua PLAYWRIGHT_CHANNEL (`msedge`, `chrome`). Không tự cài/ghi đè browser hệ thống.
- Test tắt request font ngoài để chạy ổn định offline; backend/browser traffic thật vẫn dùng localhost. TLS/proxy/domain production chưa được kiểm tra trong P05, thuộc P12/P22.

## Gate vận hành còn lại

- Chỉ code/local cutover được hoàn tất. Trước rollout thật: bảo đảm DB đã migrate P03, cấu hình signing/rate-limit secrets và PUBLIC_ORIGIN của P04; chạy staging session UI và xác minh Master/Gym/reset với artifact sẽ deploy.
- **Chưa scrub gyms.admin_code**, không thay/xóa database, .env hoặc backup thật. AUTH-DESIGN §11/§14 yêu cầu staging cutover, backup, xác minh principal/login/reset và phê duyệt vận hành trước scrub. Task frontend này không thực hiện các bước đó; không coi plaintext đã được loại khỏi DB. Cột cũ không còn dùng để authenticate.
- XSS của business render giữ nguyên phạm vi, tiếp tục P06–P08. Không có kết luận go-live; vẫn NO-GO cho production.

Tham chiếu kiểm thử: [Playwright browser channels](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge).

Commit đề xuất: `feat(auth): switch admin frontends to sessions and remove legacy bridge`
