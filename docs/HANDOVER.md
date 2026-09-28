# GvG App — Bản đồ tiếp quản khi dự án tạm dừng

Cập nhật: **11/09/2026, Asia/Bangkok — P24.PAUSE**. Đọc tài liệu này trước khi tiếp tục dự án.

## 1. Dự án là gì?

GvG App (Gym vs Gym Tracker) là ứng dụng web quản lý mùa đấu, thành viên, vé, điểm và lịch sử lượt chơi cho nhiều Gym có tiến độ độc lập. Master Admin quản lý Gym và cấu hình mùa; Gym Admin quản lý roster, ghi/sửa/xóa lượt chơi và chuyển mùa; người xem dùng dashboard công khai theo slug. Backend dùng Node.js/CommonJS, Express 5 và SQLite qua better-sqlite3; frontend là HTML/CSS/JavaScript thuần, không có bước build frontend. Hệ thống đã có session cookie, Argon2id, CSRF, kiểm soát quyền theo Gym, xử lý ảnh bằng Sharp, migration/backup và kiểm thử Node/Playwright.

## 2. Trạng thái tổng thể và cách đọc bằng chứng

**NO-GO / TẠM DỪNG. Việc đầu tiên khi resume là chốt hạ tầng.** Theo cập nhật của chủ dự án trong P24.PAUSE, lý do tạm dừng là tính minh bạch và quyền kiểm soát server dùng chung; không phải phát hiện lỗi code mới. Phần code/test thuộc C-01 và H-05 đã hoàn thành trong phạm vi nghiệm thu local, nhưng các bước vận hành thật vẫn chưa được chứng minh và visual vẫn có known issue.

Tài liệu này tổng hợp toàn bộ **29 file `docs/*CHECKPOINT.md` hiện có**, đối chiếu readiness, kế hoạch go-live, các runbook, package scripts và Git tại workspace. Số test dưới đây là bằng chứng lịch sử đã ghi trong checkpoint, **không phải kết quả chạy lại trong P24.PAUSE**. Phiên này chỉ tạo tài liệu này; không cài dependency, chạy test, sửa code/test/cấu hình, tạo gói ZIP, triển khai hay commit.

Quy tắc đọc: dùng P24.1e cho C-01, P24.2h cho H-05; các đoạn OPEN/FAIL cũ trong readiness hoặc prompts là lịch sử. Những thông tin server, giá đã khảo sát và quyết định H-06 bên dưới do **chủ dự án cung cấp trong P24.PAUSE**, chưa có checkpoint tương ứng trong checkout này. Không diễn giải lịch dự kiến trong prompts thành ngày thực hiện.

## 3. Các hạng mục go-live

| Hạng mục | Trạng thái tiếp quản | Tóm tắt và giới hạn |
|---|---|---|
| C-01 — credential | **PASS local; live scrub OPEN** | Đã ngừng ghi credential plaintext mới và kiểm chứng scrub idempotent trên clone; chưa áp dụng hoặc phê duyệt scrub DB thật, phạm vi scan vẫn có giới hạn theo [P24.1e](P24-1E-CHECKPOINT.md). |
| H-05 — regression | **PASS-with-known-issue** | Các lỗi fixture Auth/Gym đã sửa; ba subtest so ảnh Gym/Dashboard/Master được chuyển sang monitoring không chặn CI, còn chức năng/bảo mật/dữ liệu vẫn blocking. Đã thử chờ network/font/ảnh/animation và chặn polling Dashboard nhưng vẫn tái hiện mismatch; phép đo DOM/computed-state chỉ thu được capture PASS, còn cô lập hai case lại lộ lỗi case khác nên chưa xác định root cause. Không coi polling là điều kiện cần của lỗi đã tái hiện, không nới tolerance hoặc thay baseline để báo xanh; xem [P24.2h](P24-2H-CHECKPOINT.md). |
| H-01 — TLS/HTTPS và hạ tầng truy cập | **OPEN; triển khai/xác minh thật chưa bắt đầu** | Readiness gọi là PARTIAL / staging BLOCKED: đã có mẫu proxy và test local, chưa xác minh TLS/renewal, access gate staging, proxy/IP, firewall và quyền file trên host đích. |
| H-04 — backup/restore thật | **OPEN; vận hành thật chưa bắt đầu** | Code migration/backup/restore và diễn tập fixture đã có; còn snapshot DB + uploads + season đồng bộ, backup mã hóa ngoài máy, lịch/retention/cảnh báo và restore dữ liệu đại diện với RPO/RTO thực tế. |
| H-06 — dữ liệu member công khai | **ĐÃ QUYẾT ĐỊNH theo chủ dự án tại P24.PAUSE** | Chấp nhận member data công khai; định hướng Điều khoản sử dụng là chuyển trách nhiệm/rủi ro pháp lý về dữ liệu do người dùng cung cấp cho người dùng. Tài liệu dự kiến: `docs/TERMS-OF-USE-NOTES.md` — **chưa có trong workspace**; readiness cũ vẫn OPEN, chưa có bằng chứng Điều khoản đã được soạn/áp dụng hoặc hiệu lực pháp lý đã được xác nhận. |

Bằng chứng gần nhất cần giữ:

- **P24.2h, 10/09/2026:** regression đủ **21/21 file**, **255 PASS / 0 FAIL / 0 skip / 0 cancelled**, exit **0**. Tổng gồm checks legacy và parent của node:test, không phải 255 test độc lập; ba visual parent đã tách khỏi gate, không được cộng là PASS hay SKIP.
- Visual monitoring cùng checkpoint: **2 file PASS / 1 file FAIL** (Admin và Dashboard PASS, Master FAIL); raw TAP **4 PASS / 2 FAIL**, gồm parent, child exits **0/0/1**, wrapper exit **0**. Master lỗi tại `768/preview`, hai ảnh **793×1445**, **maxDelta 4 / 20 changedPixels**, tolerance vẫn **≤1**; các case sau điểm lỗi chưa được chạy.
- **C-01:** rehearsal clone có **3 → 0** Gym còn plaintext, login **3/3 PASS**, chạy lại no-op; **7/7** scrub tests PASS. Đây không chứng minh DB thật hoặc mọi bản backup/WAL cũ đã sạch.

Các mục Medium/Low trong [readiness](PRODUCTION-READINESS.md) vẫn phải được xử lý hoặc có quyết định chấp nhận trước GO: release artifact/provider/secret integration, soak trên tải đại diện, monitoring thật, clean install/native dependencies, QA Safari/iOS/accessibility và vòng đời upload. Không hiểu bảng ngắn trên là toàn bộ dự án đã được chứng nhận production.

## 4. Hạ tầng — nguyên nhân tạm dừng và quyết định còn thiếu

**Quyết định hạ tầng cuối cùng CHƯA CHỐT.** Không tiếp tục nhánh deploy dựa trên giả định server cũ sẽ được dùng.

Theo thông tin chủ dự án bàn giao trong P24.PAUSE:

- Server Vultr cũ dùng chung với **5 website WordPress của freelancer**. Phát hiện **3 domain lạ**, đã xác nhận thuộc freelancer và sẽ gỡ; chưa có bằng chứng trong repository rằng việc gỡ đã hoàn tất, cũng không suy ra 3 domain tương ứng 3 website bổ sung.
- Freelancer khuyến nghị không dùng chung server, đề xuất **Vercel + Turso/Postgres**. Đây là đề xuất **chưa quyết định**, cần viết lại/điều chỉnh tầng database và kiểm thử lại các luồng phụ thuộc SQLite đồng bộ, transaction, session, migration và backup; không phải chỉ đổi chuỗi kết nối.
- Đã khảo sát VPS riêng: **Vultr Shared CPU khoảng $10–12/tháng**, cùng các lựa chọn **Hetzner, Contabo, DigitalOcean**. Đây là mức giá khảo sát do chủ dự án cung cấp, không phải báo giá mới được kiểm tra trong phiên này; chưa có cấu hình/region/báo giá cuối cùng được lưu, cần kiểm tra lại khi chọn mua.
- Đang cân nhắc **máy nội bộ chạy 24/7 + Cloudflare Tunnel (phương án tunnel miễn phí theo thông tin bàn giao)**. Chưa chốt; cần xác nhận **OS và phiên bản của máy sẽ host** trước khi tiếp tục. Máy Windows dùng phát triển hiện tại không tự động là máy host được chọn.

Khi resume, chủ dự án cần chốt VPS riêng hay self-host, OS/CPU, nơi lưu dữ liệu, domain, quyền quản trị và người chịu trách nhiệm vận hành. Nếu self-host, cần đưa điện/mạng/restart và backup ngoài máy vào kế hoạch vận hành. Cloudflare Tunnel làm thay đổi đường đi HTTPS/proxy; cấu hình production hiện giả định proxy loopback `127.0.0.1`, vì vậy phải đối chiếu Host, client IP, forwarded headers và Secure cookie với topology mới.

## 5. Nhánh B — deploy hiện có đến đâu?

Ở đây “nhánh B” là luồng công việc deploy, không phải tên Git branch; branch hiện tại là `master`. Chủ dự án cho biết đã làm một phần script deploy AlmaLinux 8, nhưng **không tìm thấy script đặc thù AlmaLinux 8 hoặc checkpoint P24.3 trong workspace hiện tại**. Không thể xác nhận phần đó đã được lưu ở nơi khác hay đã hoàn thành đến đâu.

| File hiện có | Vai trò / mức hoàn thành |
|---|---|
| `deploy/nginx.conf.example` | Mẫu Nginx TLS/redirect, kiểm soát Host và proxy tới Node loopback; cần điền và kiểm tra trên môi trường đích. |
| `deploy/gvg.service.example` | Mẫu service Linux/systemd và quyền ghi tối thiểu; không phải installer AlmaLinux. |
| `scripts/ci-release.sh` | Pipeline build/package Linux theo allowlist và các gate kiểm tra; không phải script cài server hay deploy hoàn chỉnh. |
| `scripts/release.js` | Protocol release/rollback nhận adapter; adapter provider thật chưa có trong bằng chứng bàn giao. |
| `scripts/rehearse-p24.js` | Rehearsal mô phỏng local với fixture và một số thao tác SQLite/HTTP thật; không chứng nhận hạ tầng đích. |

**Docker local: chưa có bằng chứng đã test deploy bằng Docker.** P24 ghi Docker/Nginx/OpenSSL không có trong PATH tại thời điểm audit và sử dụng mô phỏng local; không suy diễn trạng thái cài đặt máy hôm nay từ ghi chú cũ. Không tìm thấy báo cáo Docker/AlmaLinux mới hơn trong các tài liệu đã rà.

**Chưa từng chạy nhánh deploy này lên server thật**, theo thông tin P24.PAUSE và các checkpoint hiện có. P24 chỉ ghi **58 checks PASS** rehearsal local và **52 PASS / 0 FAIL** restore smoke bổ sung; không phải rehearsal staging thật. Hai nhãn release/rollback dùng cùng source nên chưa chứng minh rollback giữa hai artifact thật.

Tiếp tục từ [DEPLOYMENT](DEPLOYMENT.md), [RELEASE-RUNBOOK](RELEASE-RUNBOOK.md) và [BACKUP-RESTORE](BACKUP-RESTORE.md), sau khi chốt host. Runbook P21 thay yêu cầu EnvironmentFile bền vững trong mẫu P12 bằng secret-store integration/credential tạm; không dùng nguyên hai file `.example` để triển khai. Giữ một Node instance, SQLite trên disk local; chuyển database/đa host cần thiết kế riêng.

## 6. Chạy local để phát triển và test

Runtime đã pin: **Node 24.19.0**, baseline npm **11.17.0**; `package.json` yêu cầu **Node >=24.7.0 <25**. Kiểm tra `.node-version`, `package.json` và lockfile khi dựng lại sau thời gian dài, không tự nâng major.

Từ thư mục gốc repository:

```powershell
node --version
npm --version
npm install
npm run test:ci
```

`npm install` là lệnh cài cho phát triển; dùng `npm ci` khi cần tái lập chính xác theo lockfile trên checkout sạch. better-sqlite3 và Sharp có native binary: nếu không có binary tương thích, cần toolchain native phù hợp OS; không lấy workaround `--ignore-scripts` lịch sử làm bằng chứng clean install đã đạt.

Browser tests trên Windows mặc định dùng Edge đã cài (`msedge`). Trên Linux dùng Chromium của Playwright, chuẩn bị bằng `npx playwright install --with-deps chromium`; có thể chọn browser channel đã cài bằng `PLAYWRIGHT_CHANNEL` (`msedge` hoặc `chrome`). Không cần DB thật hay tài khoản production để chạy regression fixture.

Các lệnh test hiện tại:

- `npm run test:ci`: chạy regression rồi visual monitoring, kể cả regression lỗi; exit cuối theo regression.
- `npm run test:regression`: chỉ gate chức năng/bảo mật/dữ liệu, đủ các file `test/*-test.js`.
- `npm run visual-monitoring`: chạy ba nhóm so ảnh, lưu raw logs và `tmp/visual-monitoring/summary.json`; wrapper exit 0 **không có nghĩa visual PASS**.

Ba baseline lịch sử là `tmp/p06/dashboard-before.js`, `tmp/p07/admin-before.js`, `tmp/p08/master-before.js`, đều đang có trên máy này nhưng **Git ignored**. Checkout mới không tự có chúng; thiếu baseline làm monitoring ghi FAIL do skip, không chặn regression. Giữ bản sao baseline đáng tin cậy riêng nếu cần tiếp tục điều tra; không lấy source hiện tại giả làm baseline lịch sử. Các log/ảnh trong `tmp/` cũng không đi theo commit.

Để chạy dev với DB local đã chuẩn bị, đặt rõ `DB_PATH`, dùng `NODE_ENV=development`, rồi `npm start` (chạy `node server.js`; **không có script `npm run dev`**). Nếu cần tạo môi trường thử hoàn toàn mới, ví dụ PowerShell sau tạo DB riêng theo timestamp dưới `tmp/`, provision Master offline và không đụng DB cũ:

```powershell
$devDir = Join-Path (Get-Location) ('tmp/dev-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $devDir | Out-Null
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:DB_PATH = Join-Path $devDir 'gvg.db'
$env:AUTH_MIGRATION_BACKUP_PATH = Join-Path $devDir 'before-auth.sqlite3'
$devPassword = Read-Host 'Mat khau Master local moi (it nhat 12 ky tu)' -AsSecureString
$env:MASTER_ADMIN_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $devPassword).Password
npm run auth:migrate
# Chỉ tiếp tục nếu migration exit 0; nếu lỗi, dừng và kiểm tra cấu hình.
Remove-Item Env:MASTER_ADMIN_BOOTSTRAP_PASSWORD
npm start
```

Đây là hướng dẫn cho người tiếp quản, **chưa được chạy trong phiên P24.PAUSE**. Development tự áp schema khi mở DB; production không tự migrate. Mở `http://127.0.0.1:3000/master`, đăng nhập bằng password vừa provision, tạo/activate Season Template rồi tạo Gym; dashboard tại `/g/<slug>`, admin tại `/g/<slug>/admin` chuyển tới tab `#admin`. Dừng server bằng Ctrl+C; sửa backend thì khởi động lại, sửa frontend thì tải lại trang. Khi dùng DB hiện có, giữ cấu hình và credential hiện hành, không chạy mẫu tạo DB mới để thay thế dữ liệu đó.

## 7. Bản đồ tài liệu còn lại

Các đường dẫn trong bảng là tương đối từ root repository; mỗi file chỉ được mô tả vai trò để tra khi cần.

| Đường dẫn | Dùng để làm gì |
|---|---|
| `PRD-FINAL.md` | Nguồn yêu cầu nghiệp vụ về mùa, round, vé, điểm và quyền tác nhân. |
| `HANDOFF-FOR-CODEX.md` | Bàn giao cũ về thiết kế và invariant; phần header-auth, default credential và startup schema đã lỗi thời, không dùng làm hướng dẫn vận hành hiện tại. |
| `PAIR-TEAM-LOG-SPEC.md` | Đặc tả mở rộng Team/Invest/Sync Pair, ghi chưa triển khai; không phải hạng mục tự động làm khi resume go-live. |
| `docs/PRODUCTION-READINESS.md` | Danh sách gate/rủi ro và lịch sử audit; đọc cùng trạng thái mới nhất trong tài liệu này. |
| `docs/PRODUCTION-GO-LIVE-PROMPTS.md` | Kế hoạch công việc và prompt từng bước, có lịch dự kiến và trạng thái lịch sử. |
| `docs/TERMS-OF-USE-NOTES.md` | Tài liệu Điều khoản được yêu cầu tham chiếu nhưng **chưa tìm thấy**, cần thu hồi/bổ sung sau khi resume. |
| `docs/AUTH-DESIGN.md` | Thiết kế credential/session, cutover và recovery; đối chiếu C-01 mới nhất khi áp dụng. |
| `docs/DEPLOYMENT.md` | Topology Linux/Nginx và các kiểm tra cấu hình host đích. |
| `docs/RELEASE-RUNBOOK.md` | Build artifact, adapter, secret store, release/rollback và recovery. |
| `docs/BACKUP-RESTORE.md` | SQLite backup/WAL, restore, snapshot file và mục tiêu RPO/RTO. |
| `docs/MIGRATIONS.md` | Ledger/checksum, preflight, backup gate và cách nâng schema. |
| `docs/OBSERVABILITY.md` | Logs, health/readiness, drain, collector và cảnh báo vận hành. |
| `docs/P24-1B-CHECKPOINT.md` | Hồ sơ scrub và rehearsal clone của P24.1b. |
| `docs/P24-1C-CHECKPOINT.md` | Hồ sơ xác minh P24.1c và phần bổ sung P24.1d trong cùng file. |
| `docs/P24-1E-CHECKPOINT.md` | Hồ sơ nghiệm thu C-01 local cuối cùng. |
| `docs/P24-2A-CHECKPOINT.md` | Hồ sơ phân loại lỗi regression H-05. |
| `docs/P24-2B-CHECKPOINT.md` | Hồ sơ sửa fixture Gym/Auth. |
| `docs/P24-2C-CHECKPOINT.md` | Hồ sơ thu thập visual lặp lại. |
| `docs/P24-2D-CHECKPOINT.md` | Hồ sơ thử screenshot readiness. |
| `docs/P24-2E-CHECKPOINT.md` | Hồ sơ cô lập polling Dashboard. |
| `docs/P24-2F-CHECKPOINT.md` | Hồ sơ đo DOM/computed-state. |
| `docs/P24-2G-CHECKPOINT.md` | Hồ sơ ngoại lệ hai case visual. |
| `docs/P24-2H-CHECKPOINT.md` | Hồ sơ quyết định toàn bộ visual non-blocking và nghiệm thu H-05. |
| `docs/P24-CHECKPOINT.md` | Audit và rehearsal local gốc trước các cập nhật P24.1/P24.2. |
| `docs/P24-1B-RESULTS.json`, `docs/P24-1C-RESULTS.json`, `docs/P24-1E-RESULTS.json`, `docs/P24-RESULTS.json` | Kết quả máy đọc/digest của các đợt tương ứng. |
| `docs/P03-CHECKPOINT.md` | Hồ sơ hashing và credential migration ban đầu. |
| `docs/P04-CHECKPOINT.md` | Hồ sơ backend session và phân quyền. |
| `docs/P05-CHECKPOINT.md` | Hồ sơ frontend session và gỡ legacy bridge. |
| `docs/P06-CHECKPOINT.md` | Hồ sơ Dashboard XSS. |
| `docs/P07-CHECKPOINT.md` | Hồ sơ Gym Admin XSS. |
| `docs/P08-CHECKPOINT.md` | Hồ sơ Master Admin XSS. |
| `docs/P09-CHECKPOINT.md` | Hồ sơ validation và rate limits. |
| `docs/P11-CHECKPOINT.md` | Hồ sơ CSP/security headers. |
| `docs/P12-CHECKPOINT.md` | Hồ sơ mẫu HTTPS/proxy/systemd. |
| `docs/P13-CHECKPOINT.md` | Hồ sơ gia cố upload ảnh. |
| `docs/P14-CHECKPOINT.md` | Hồ sơ error boundary và audit dữ liệu public. |
| `docs/P16-CHECKPOINT.md` | Hồ sơ migration framework. |
| `docs/P18-CHECKPOINT.md`, `docs/P18-BENCHMARK.json` | Hồ sơ concurrency/index và phép đo SQLite. |
| `docs/P19-CHECKPOINT.md` | Hồ sơ dependency và baseline runtime. |
| `docs/P20-CHECKPOINT.md` | Hồ sơ observability local. |
| `docs/P22-CHECKPOINT.md` | Hồ sơ E2E bảo mật. |
| `docs/P23-CHECKPOINT.md`, `docs/P23-RESULTS.json` | Hồ sơ load test và browser QA local. |

**Khoảng trống tên file:** không có checkpoint P24.1a hoặc P24.1d độc lập (a nằm trong prompts/readiness, d nằm trong P24.1c). Không có file checkpoint **P24.3** để liệt kê hoặc xác nhận nội dung; cần lấy lại nếu đã thực hiện ở phiên/checkout khác. P10/P15 được ghi trong readiness; P17/P21 nằm trong runbook tương ứng.

## 8. Tiếp tục theo đúng thứ tự

1. **Chốt hạ tầng: VPS riêng hay self-host.** Xác nhận OS máy host, quyền quản trị, chi phí và người vận hành; thu hồi phần script/checkpoint deploy cùng ghi chú Điều khoản còn thiếu nếu nằm ngoài checkout này.
2. **Đối chiếu và điều chỉnh nhánh B theo host đã chọn.** Nếu khác AlmaLinux/Linux thì viết lại hoặc điều chỉnh service/install/deploy; nếu vẫn Linux cũng phải rà distro/CPU/native binary/secret store. Với Vercel + Turso/Postgres, lập công việc chuyển database riêng; với Tunnel, kiểm chứng topology proxy mới.
3. **Triển khai H-01 và H-04 trên môi trường đích.** TLS/HTTPS, staging access gate và kiểm tra mạng/quyền file; backup DB + files, mã hóa/off-server, lịch/cảnh báo, download/decrypt/restore thật và đo RPO/RTO — phần vận hành này chưa bắt đầu.
4. **Rehearsal staging trước GO thật.** Dùng artifact đã cố định và dữ liệu được phép; regression, HTTPS/login/CSRF/upload, deploy/rollback/restore và failure handling. Nếu mang theo DB legacy, giữ live scrub C-01 là rollout riêng cần phê duyệt theo P24.1e; lưu quyết định H-06/Điều khoản và disposition các gate còn lại, rồi mới xin quyết định GO của chủ dự án.

Không tự mở tiếp tính năng, deploy server/domain thật hoặc coi tài liệu bàn giao là phê duyệt GO.

## 9. Git và cách đóng gói an toàn

Snapshot tại P24.PAUSE: branch **`master`**, HEAD **`4bb04234b84f42a401d5f1cbfecfdca21d24aa59`** (`docs(security): close C-01 PASS local (P24.1a-e) — no new plaintext, idempotent scrub verified, fixture regressions fixed`). Các ghi chú “chưa có commit/toàn source untracked” trong tài liệu cũ không còn phản ánh Git hiện tại.

`git status --short` sau khi thêm tài liệu này; 8 modified đã có trước phiên, chỉ HANDOVER mới tạo ở P24.PAUSE:

```text
 M docs/PRODUCTION-GO-LIVE-PROMPTS.md
 M docs/PRODUCTION-READINESS.md
 M package.json
 M scripts/test-ci.js
 M test/admin-xss-test.js
 M test/auth-test.js
 M test/dashboard-xss-test.js
 M test/master-xss-test.js
?? docs/HANDOVER.md
?? docs/P24-2A-CHECKPOINT.md
?? docs/P24-2B-CHECKPOINT.md
?? docs/P24-2C-CHECKPOINT.md
?? docs/P24-2D-CHECKPOINT.md
?? docs/P24-2E-CHECKPOINT.md
?? docs/P24-2F-CHECKPOINT.md
?? docs/P24-2G-CHECKPOINT.md
?? docs/P24-2H-CHECKPOINT.md
?? scripts/test-ci-with-monitoring.js
?? scripts/visual-monitoring.js
?? test/bbox-diagnostic.js
?? test/screenshot-stability.js
?? test/visual-suite-mode.js
```

**Đề xuất commit: CÓ**, sau khi chủ dự án review và cho phép, để giữ đồng bộ toàn bộ thay đổi H-05/test runner/helper/checkpoint với HANDOVER. Chỉ commit HANDOVER sẽ không lưu được các helper đang untracked mà `package.json` hiện phụ thuộc; checkout từ HEAD cũ chưa tái tạo trạng thái P24.2h. Có thể dùng message `chore: preserve P24 H-05 results and pause handover` sau khi rà diff và danh sách file cụ thể. **Phiên này không stage, không commit; mọi commit cần yêu cầu/phê duyệt tiếp theo của người dùng.**

Commit không mang theo `tmp/`, baseline visual, DB, uploads, season snapshots, `.env` hay backup bị ignore. Trước khi di chuyển/xóa máy làm việc, cần kế hoạch sao lưu riêng có kiểm soát cho dữ liệu và bằng chứng cần giữ; không đưa secret/DB vào Git, không dùng `git add .` để đóng gói mù. P24.PAUSE chưa tạo archive hoặc bản backup dữ liệu; phạm vi được giao chỉ là tài liệu tiếp quản này.
