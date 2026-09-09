# P23 — Load test, responsive và browser QA

DONE trong phạm vi audit local ngày 09/09/2026; không phải chứng nhận staging/production. Không deploy, không chạm DB hiện tại, không commit. Working tree ban đầu toàn bộ source untracked; giữ nguyên các thay đổi ngoài phạm vi. P22 vẫn TODO trong lịch; P23 không thay thế P22, không gỡ blocker P10/P15 và không thực hiện P24.

## Chạy lại và hàng rào an toàn

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\tmp\p23-browsers"
npx playwright install firefox
npm run qa:p23
# Chỉ QA lại giao diện, giữ kết quả load và loadAt đã lưu:
node scripts/qa-p23.js --browser-only
```

Chrome/Edge dùng browser channel đã cài, Firefox dùng bản Playwright 153.0. Trong sandbox Windows hiện tại Firefox không tạo được page (subprocess bị chặn); thử `about:blank` ngoài sandbox PASS, rồi chạy QA ngoài sandbox trên fixture riêng. Không tắt browser sandbox trong harness. Không cần sửa dependency/lockfile. Browser download nằm trong `tmp/` ignored.

`test/p23-server.js` luôn tạo DB file mới trong thư mục `gvg-p23-*` do mkdtemp trả về, chỉ listen `127.0.0.1` với port ngẫu nhiên. Không nhận DB_PATH, URL, password hay secret từ caller. DB WAL/FULL, 100 members, 5 maps, 10.000 entries, một gym/season; vé 100.000/member để không hết vé khi benchmark và để stress số dài. Có tên tiếng Việt dài. Migration/auth dùng credential giả, backup giả trong cùng temp. Mỗi level/browser có fixture riêng, session/CSRF thật, rate limit thật. Kết thúc đóng server/auth/DB, kiểm tra integrity/FK/count, xác minh temp path không phải symlink rồi chỉ xoá thư mục tự tạo. Watchdog 180 giây/fixture; lỗi timeout bất thường có thể để lại temp để điều tra, không xoá đường dẫn cấu hình. Không dùng DB workspace hay ghi upload thật.

Load client và HTTP server ở **hai Node processes**, cùng máy i3-9100F / Windows 10.0.19045 / Node 24.19.0. Không chạy suite khác đồng thời trong lượt load được lưu cuối cùng. Report máy đọc được: [P23-RESULTS.json](P23-RESULTS.json). Ảnh tái tạo ở `tmp/p23/`, 320/768/1440 × 4 views × 3 browsers.

## Phép đo và giới hạn

Mỗi level warmup GET state/overview/leaderboard/log một lần; sau đó **240 requests**, worker pool closed-loop, concurrency 1/4/8/16/32/64/128. Mix cố định: 40 state, 40 overview, 40 leaderboard, 40 history `/log`, **80 authenticated POST entries**. Latency client đến khi đọc/parse JSON xong, gồm queue/network loopback; percentile nearest-rank, không lấy trung bình các percentile. Report phân riêng từng endpoint và status. Timeout request 15 giây; dừng level tiếp theo nếu error >5% hoặc p99 >5 giây; tối đa 1.680 measured requests, không phải test vô hạn.

| Concurrent requests | p50 ms | p95 ms | p99 ms | Write p95 / p99 ms | Error rate | DB locked | req/s |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 18,38 | 32,12 | 34,43 | 19,20 / 32,88 | 0% | 0 | 50,54 |
| 4 | 39,49 | 58,52 | 77,67 | 44,17 / 54,39 | 0% | 0 | 99,20 |
| 8 | 74,50 | 102,16 | 120,54 | 85,10 / 119,59 | 0% | 0 | 107,92 |
| 16 | 147,29 | 194,94 | 206,71 | 202,03 / 207,15 | 0% | 0 | 107,99 |
| 32 | 293,23 | 364,59 | 416,25 | 359,10 / 428,29 | 0% | 0 | 107,83 |
| 64 | 580,47 | 702,85 | 832,81 | 776,04 / 896,20 | 0% | 0 | 105,34 |
| 128 | 971,96 | 1.383,70 | 1.677,13 | 1.624,42 / 1.747,84 | 0% | 0 | 103,92 |

Tổng **1.680/1.680 HTTP 200**, **560 writes**; mỗi fixture cuối 10.080 entries, integrity `ok`, FK không lỗi. Không 429, timeout hay lock ngoài dự kiến. DB lock lấy từ exception driver/log trong fixture; suite concurrency độc lập xác minh thêm writer lock/timeout có chủ đích. Một Node dùng SQLite đồng bộ serialize công việc; không xuất hiện lock không có nghĩa SQLite có nhiều writer đồng thời.

**Ngưỡng burst local đạt tiêu chí: 32 concurrent** (write p95 <500 ms, p99 <1.000 ms theo mục tiêu P18). **Khuyến nghị khởi đầu rehearsal ở 16** để có headroom; concurrency 64 đã vượt write p95, 128 vượt cả p95/p99. Throughput gần plateau từ 8 trở lên, thêm concurrency chủ yếu tăng thời gian chờ. Đây là số request đang bay, không phải số user. Không thay query/index/timeout chỉ từ quan sát này.

Không được suy diễn ~108 req/s thành sustained capacity: limiter mặc định mỗi IP chỉ 240 reads/phút và 120 mutations/phút. Mỗi level nằm dưới quota rồi dùng fixture mới; không giả IP, không tắt limiter. Chưa đo burst >quota trong harness này (P09/P22 có test 429). Thời lượng vài giây/level và 40–80 samples/endpoint làm p99 không ổn định; chưa có peak dự kiến, production host/disk, network RTT, multi-gym, backup/checkpoint dài hay soak 30 phút ở 2× peak. Chỉ một Node instance được hỗ trợ; không kết luận sức tải production an toàn từ P23.

History filter thực sự chạy client trên **300 log mới nhất**. HTTP `/log` ở bảng là chi phí lấy dữ liệu, không giả vờ có SQL filter server. QA đo 20 lần chuyển member 1/all ở từng breakpoint/browser, xác nhận 3/300 public cards, 3/50 admin cards (admin giới hạn render 50); chờ hai animation frames sau change. p50/p95/p99 từng tổ hợp nằm trong JSON, gồm render/frame scheduling, không phải CPU time thuần. Test UX riêng kiểm tra kết hợp Member/Round/Map và filter rỗng. p99 của 20 samples gần như max, không dùng làm SLA.

## QA giao diện và các sửa nhỏ

Ma trận **320×740, 360×800, 390×844, 412×915, 768×1024, 1024×768, 1440×900**; dashboard/overview, leaderboard, public history và admin log. Viewport emulation trên desktop engine, chưa thay thiết bị touch thật. Browser/version, phát hiện overflow, tên controls, alt, meta, link status, keyboard và ảnh nằm trong report/harness.

Kết quả cuối sau sửa: **84/84 views PASS**, 0 document overflow, 0 clipped ticket groups, 0 thiếu nhãn/alt trong các views khảo sát, 0 pageerror; keyboard Tab/Enter PASS cả ba. **840 lần lọc/render** kiểm tra số cards đúng. Các internal links/resources đã probe không có lỗi ngoài 404/500 cố ý.

| Browser | Views PASS | Filter p95 lớn nhất ms | Filter p99 lớn nhất ms |
|---|---:|---:|---:|
| Chrome 152.0.7977.76 | 28 | 53,5 | 56,6 |
| Edge 152.0.4191.66 | 28 | 54,3 | 55,7 |
| Firefox 153.0 (Playwright build) | 28 | 72 | 91 |

Các giá trị trên là max của percentile từng tổ hợp 20 samples, không phải percentile pooled. p50 từng tổ hợp được lưu trong JSON.

Các sửa có bằng chứng:

- `public/index.html`, `dashboard.html`, `master.html`, `favicon.svg`: bổ sung favicon SVG cục bộ và description; giữ title/lang/viewport hiện có.
- `public/admin.js`: input điểm và select vé trong chế độ sửa log trước đây chỉ có chữ bên cạnh, thiếu accessible name; thêm aria-label, kiểm tra bằng role/name trong browser và mở/huỷ edit ở cả 7 widths.
- `public/style.css`: cụm vé leaderboard mobile bị cắt bên trong card với số dài dù document không overflow. Chỉ thêm `flex-wrap: wrap`; harness kiểm tra bounding boxes từng cụm vé để tránh false PASS từ document width. Không đổi grid hay viết lại UI.

Kiểm tra sơ bộ accessibility: lang/title, nhãn controls đang hiển thị ở các views, alt attributes, focus outline, Tab → Enter kích hoạt leaderboard, accessible name hai trường edit. Chưa audit WCAG đầy đủ, contrast tất cả màu, screen reader hay touch target toàn app. Tên dài ở leaderboard/overview vẫn ellipsis theo thiết kế; kiểm tra tiếp khả năng đọc đầy đủ bằng touch/screen reader trong task riêng.

Overview có bảng rộng cuộn trong container theo thiết kế, nav tab có cuộn ngang riêng; không coi container scroll hợp lệ là document overflow. Đã xem trực tiếp ảnh mobile/tablet/desktop để phát hiện clipping mà phép đo toàn trang bỏ sót.

Local link/resource của home, master login, gym, trang lỗi: kiểm tra GET link/script/style/icon/img nội bộ có trong DOM; 404/500 cố ý giữ đúng status và không lộ canary. 500 được tiêm qua map-image service trong fixture, không thêm route lỗi vào production. Favicon khai báo `/favicon.svg`; không cần request mặc định `/favicon.ico`. Đây không phải crawler toàn bộ URL động hay mọi trạng thái Master sau login.

Layout QA chủ động chặn network ngoài để dùng fallback fonts ổn định. Probe stylesheet Google Fonts riêng trả 200; lượt thử tải fonts trực tiếp trong browser bị timeout 12 giây. Vì vậy **chưa chứng minh layout với webfont tải xong**, cần kiểm tra thêm ở staging; không sửa CSP/mở origin tuỳ tiện. Các request font bị abort trong JSON là hành vi harness, không phải broken application link.

## Hồi quy và task còn mở

- `node --test test/error-handling-test.js test/sqlite-concurrency-test.js`: **9 PASS / 0 FAIL**, gồm kiểm tra lock cố ý (một SQLITE_BUSY đúng dự kiến), 300 writes/100 reads từ connections độc lập, HTTP mixed writes và error privacy.
- `node test/frontend-ux-test.js`: **41 PASS / 0 FAIL** sau sửa CSS/aria-label.
- `node --test test/admin-xss-test.js test/security-headers-test.js`: **8 PASS / 3 FAIL** tính cả parent fail. Hai subtest gốc thất bại: P07 screenshot `390/entries`, và real workflow timeout đợi `#member-list .list-row` (7 giây). CSP suite PASS, 5 subtests XSS/editor/error PASS. Không gọi toàn bộ regression suite ở P23.

| Task riêng | Phạm vi / điều kiện đóng |
|---|---|
| P23-Q1 (liên quan P15-Q2/Q3) | Điều tra 2 failure Gym Admin cũ: decoded pixels/font/animation/geometry; fixture auth/roster visibility. Chạy riêng, phân biệt timing harness với bug sản phẩm; không bỏ assertion hay cập nhật baseline mù. |
| P23-Q2 | Đo soak 30 phút ở 2× peak đã thống nhất, traffic nhiều IP hợp lệ qua proxy staging, dữ liệu đại diện/backup/WAL/disk. Xác nhận concurrency và error budget trước GO. Không mở thêm Node instances. |
| P23-Q3 | QA webfonts online và Safari/iOS thật; kiểm tra text zoom, touch, screen reader/contrast và cách đọc tên ellipsis. Không xem desktop emulation là mobile device coverage. |

Checklist Safari (môi trường Windows không có Safari; Firefox không thay thế WebKit/Safari):

- [ ] Ghi phiên bản Safari/macOS và iOS/iPadOS thực tế, chạy với fixture riêng.
- [ ] 320/360/390/412 portrait, landscape, iPad 768/1024, desktop; overview cuộn ngang chạm, nav tabs, leaderboard số dài, admin log edit/cancel.
- [ ] Login/refresh/logout, cookie SameSite/CSRF, back/forward cache, session expiry.
- [ ] Member/Round/Map filter + reset đúng tập 300 mới nhất; native select, numeric keyboard, focus không nhảy.
- [ ] Favicon SVG, title/description/lang/viewport, fonts tải xong và khi offline; không text clipping ở zoom 200%.
- [ ] 404/500, internal links, console/CSP errors, VoiceOver labels/focus/table headers, contrast và touch targets.

File trong phạm vi: `scripts/qa-p23.js`, `test/p23-server.js`, `package.json`, 3 HTML, `public/favicon.svg`, `public/admin.js`, `public/style.css`, report/checkpoint và bảng P23/PRODUCTION-READINESS. Bước tiếp theo là các task QA còn mở và P22/P24 theo quyết định riêng; dừng tại P23.

Commit đề xuất: `test: add isolated P23 load and browser QA with small UI fixes`.
