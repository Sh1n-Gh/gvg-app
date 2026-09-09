# P11 — Security headers và CSP

DONE (local) — 07/09/2026, theo yêu cầu trực tiếp thực hiện P11. P10 vẫn BLOCKED / NO-GO; không đóng C-01/H-05, không triển khai production hoặc làm P12. Working tree ban đầu toàn bộ source untracked; không commit, không sửa database/.env/upload hiện có.

## Cấu hình

`security/headers.js` là middleware tương đương cho phạm vi headers yêu cầu, không thêm dependency. `server.js` đặt middleware sau cấu hình trust proxy, trước rate limit/parser/static/auth/routes để cả redirect, 404, 413, 429 và lỗi API có headers. Tắt `X-Powered-By`.

Policy áp dụng cả development và production để browser tests kiểm tra đúng CSP thực thi:

```text
default-src 'none'; base-uri 'none'; object-src 'none';
frame-ancestors 'none'; frame-src 'none'; form-action 'self';
script-src 'self'; script-src-attr 'none';
style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline';
font-src https://fonts.gstatic.com; img-src 'self' data: [exact configured HTTPS origins];
connect-src 'self'; worker-src 'none'; manifest-src 'none'
```

Không wildcard, scheme HTTP(S) tổng quát, script inline, eval hoặc blob. Script trang chủ được chuyển nguyên nội dung sang `public/index.js`; handler gán bằng JS vẫn hoạt động. Không sửa layout/CSS hoặc logic nghiệp vụ.

Headers khác: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. Permissions Policy tắt camera, microphone, geolocation, payment, USB, accelerometer, gyroscope, magnetometer và browsing-topics.

HSTS `max-age=31536000` chỉ khi `NODE_ENV=production` **và** `req.secure=true`. Production HTTP và development HTTPS không gửi HSTS. Không suy ra HTTPS từ PUBLIC_ORIGIN, không tự đọc/tin X-Forwarded-Proto. Express chỉ tin peer trong TRUST_PROXY đã cấu hình ở P09. Không bật includeSubDomains/preload khi chưa kiểm kê subdomain. Không thêm upgrade-insecure-requests làm thay đổi localhost/URL ảnh. HTTPS/proxy thật và firewall vẫn thuộc P12; proxy phải ghi đè forwarded headers.

## Kiểm kê tài nguyên và ngoại lệ

| Loại | Nguồn đang dùng | Quyết định CSP |
|---|---|---|
| Script | auth-client, pokemon-types, admin-utils, dashboard, admin, master và index JS trong public | Chỉ self; không CDN hoặc inline script |
| CSS | `/style.css`; Google Fonts CSS trên 4 HTML | self và chính xác fonts.googleapis.com |
| Font | Fredoka 500/600/700, Rubik 400/500/600; fallback sans-serif | Chính xác fonts.gstatic.com; không data font |
| Style attribute | HTML Master/Home/Admin, template button/form, heatmap Dashboard và DOM style động | Ngoại lệ `style-src-attr 'unsafe-inline'` để giữ UI. Không mở unsafe-inline cho script hoặc style element trên trang HTML |
| Pokemon Type | 18 SVG bundled `/assets/pokemon-types/*.svg`, có style element nội bộ | Chỉ response đường dẫn SVG bundled thêm `style-src-elem` với SHA-256 nội dung style chuẩn hóa CRLF theo XML. Không cấp hash cho HTML hoặc upload |
| Map/Avatar | URL từ API/DB; ảnh upload trong `/uploads/map-images/`; fallback DOM | self mặc định; nguồn ngoài qua CSP_IMAGE_ORIGINS |
| Preview | FileReader PNG/JPEG base64 trước khi upload | Ngoại lệ data: chỉ img-src. CSP không phân biệt MIME data ảnh; helper P08 chỉ nhận PNG/JPEG. Không cho data script/frame/object |
| API | fetch cùng origin, JSON và raw upload | connect-src self; không WebSocket, worker, iframe, media hoặc manifest |

Không có `.env`/database runtime tại đường dẫn cấu hình/default trong workspace tại thời điểm kiểm kê; không có URL ảnh nguồn ngoài trong source/config season hiện có. Không suy đoán domain production hay đọc dữ liệu test như inventory production. **Trước rollout cần kiểm kê avatar_url và image_url của database thật**, thêm đúng HTTPS origin vào `CSP_IMAGE_ORIGINS` (phân cách dấu phẩy). Config từ chối wildcard, credentials, path/query, HTTP và CSP injection ngay khi tạo app. Không tự nới CSP từ dữ liệu DB/user. Ảnh ngoài allowlist hoặc HTTP khác nguồn sẽ bị chặn; cần thay URL/host hợp lệ trước rollout. API validation HTTP(S) cũ vẫn giữ; CSP là lớp kiểm soát trình duyệt riêng.

Nguồn đối chiếu: [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy), [style-src-attr](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr).

## Kiểm thử

Các lượt cuối của test liên quan: **58 PASS / 0 FAIL / 0 skip**:

- `node --test test/security-headers-test.js`: 3 PASS. Ma trận production/development × trusted/untrusted proxy × HTTP/HTTPS forwarded × trang/static/redirect/error/404; strict allowlist; browser chặn script inline và ảnh ngoài policy.
- Browser P11: 24 cặp so sánh CSP bật/tắt (8 URL × 390/768/1440): `/`, `/index.html`, `/master`, `/master.html`, `/g/csp`, `/dashboard.html`, `/admin.html`, redirect `/g/csp/admin`. Hình học, font-family, màu và background phần tử không đổi. Fixture có season/Map/member/ảnh cùng origin. Kiểm tra các tab public, Master/Gym sau đăng nhập, trang chủ click/Enter, 18 SVG standalone có fill đúng và không có CSP violation trong luồng hợp lệ. Các HTML standalone thiếu slug giữ hành vi cũ; URL vận hành là `/g/:slug`.
- `node --test test/frontend-session-test.js`: 5 PASS. Master/Gym login sai/đúng, refresh, expiry, draft, password change, logout, cross-tenant với headers thực tế.
- `node --test test/master-xss-test.js`: 9 PASS. Thêm listener CSP cho luồng session/API/SQLite thật: chọn preview PNG/JPEG, upload, tạo/sửa/mở lại template, decode ảnh đã lưu, clear và cancel; không CSP violation. 15 cặp responsive P08 PASS ở lượt riêng cuối.
- `node test/frontend-ux-test.js`: 41 PASS.

`npm run test:p11` tập hợp các suite trên. Không chạy toàn bộ suite ngoài phạm vi P11. DB fixture `:memory:`; fixture upload chỉ dọn đúng file do nó tạo.

Ghi nhận lượt phát triển: phép strip CSP bằng Playwright route.fetch ban đầu tự follow redirect làm mất fragment #admin ở baseline; đã dùng maxRedirects=0, giữ redirect thật. Sửa fixture member dùng gym_season_id và đặt listener/assertion CSP đúng luồng thật. P08 visual lần chạy đồng thời có sai khác 20 pixel/maxDelta 4 tại 768/preview; chạy riêng cuối 15 cặp PASS, không thay baseline hoặc nới tolerance. Flake lịch sử H-05 vẫn chưa được coi đóng.

So sánh layout tự động dùng Google CSS fixture rỗng để không phụ thuộc mạng, cùng fallback font ở cả hai phía. Probe Google CSS thực trả @font-face và toàn bộ URL font thuộc fonts.gstatic.com. Probe trình duyệt riêng phục vụ trang chủ qua middleware CSP thật với mạng Google Fonts: document.fonts.ready hoàn tất, Fredoka 600 và Rubik 400 đều loaded, không CSP violation. Không coi browser QA local là kiểm thử HTTPS production hoặc mọi browser. Staging cần kiểm tra nguồn ảnh thật, font mạng thật, proxy/TLS/HSTS và phản hồi từ reverse proxy.

## File và điểm dừng

Runtime: `security/headers.js`, `server.js`, `public/index.html`, `public/index.js`. Config/test: `.env.example`, `package.json`, `test/security-headers-test.js`, `test/master-xss-test.js`. Docs: checkpoint này, bảng P11 và PRODUCTION-READINESS.

Dừng tại P11. Bước tiếp theo cần yêu cầu riêng; P10 blockers vẫn phải được xử lý trước go-live. Commit đề xuất: `fix(security): enforce CSP and production security headers`.
