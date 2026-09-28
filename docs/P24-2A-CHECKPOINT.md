# P24.2a — Điều tra và phân loại H-05

**DONE phần điều tra/bản đồ, 10/09/2026. H-05 vẫn BLOCKED; NO-GO / P24 BLOCKED giữ nguyên.** Không sửa production code, test hoặc baseline, không commit. DONE không có nghĩa đã chứng minh mọi cơ chế renderer: các giới hạn bằng chứng được ghi rõ bên dưới, không biến giả thuyết thành root cause đã xác nhận.

## Hiện trường và lần chạy duy nhất

- `git status --short` ban đầu rỗng. HEAD: `4bb04234b84f42a401d5f1cbfecfdca21d24aa59`.
- Windows, Node v24.19.0, browser theo suite là Edge mặc định trên Windows. Không đổi dependency/env/browser. `TRUST_PROXY` không có trong process environment. Không tìm thấy AGENTS.md trong workspace.
- Đọc runner `scripts/test-ci.js:1–10`: liệt kê mọi `test/*-test.js`, sort, spawn tuần tự, tiếp tục sau failure. Chạy **đúng một lần**, không rerun suite/subtest/probe HTTP:

```powershell
node scripts/test-ci.js > tmp/p24-2a/full-regression.log 2>&1
```

- Toàn bộ stdout/stderr được redirect trước khi đọc; chỉ đọc log sau process hoàn tất. Bắt đầu **08:25:11.720 +07:00**, kết thúc **08:29:28.115 +07:00**, exit **1** (exit của wrapper lưu metadata là 0, không phải exit suite).
- [Log đầy đủ](../tmp/p24-2a/full-regression.log), [exit](../tmp/p24-2a/exit-code.txt), [start](../tmp/p24-2a/start.txt), [end](../tmp/p24-2a/end.txt), [summary từng file](../tmp/p24-2a/summary.json).
- SHA-256 log: `E7EE5DC8BD4465B8D12AEB040FAB273398016451B6B29A0BBE5650ABA0FAFC6C`.
- **21/21 file hoàn tất, 18 file xanh; 253 PASS / 5 FAIL / 0 skip / 0 cancelled = 258 records/checks.** Có parent trong node:test và checks legacy; không phải 258 test độc lập. So P22 có thêm `auth-scrub-test.js` (7/0), không phải chạy sai suite 20 file cũ.
- Đã sao lưu thư mục ảnh/baseline cũ sang `tmp/p24-2a/p06`, `p07`, `p08` trước chạy. Test tự ghi ảnh kết quả mới ở `tmp/p06–p08`; đây là output runner, không cập nhật baseline JS. [Hash baseline trước/sau](../tmp/p24-2a/baseline-hashes.txt) trùng cả ba file. Ảnh cũ có timestamp lẫn nhiều lượt, không gán mọi ảnh trong một thư mục cho cùng checkpoint.

## Đầy đủ FAIL hiện tại

Tên subtest bên dưới thuộc parent ghi ngay trong cùng hàng/nhóm. Các dòng `✖` lặp ở phần “failing tests” là bản in lại, không cộng thêm failure. HTTP 400/401/500 trong log cũng không tự tính FAIL: nhiều negative tests chủ động phát sinh chúng.

| # | Tên đầy đủ / quan hệ | File/dòng khai báo → lỗi; log | Loại nguyên nhân | Có ổn định lặp lại không | Mức độ nghiêm trọng | Đề xuất phiên sửa |
|---|---|---|---|---|---|---|
| 1 | `P07 Gym Admin XSS and workflow regression` → `real session/API/database: create/edit member and create/edit log preserve data and IDs` | `test/admin-xss-test.js:194` → `:221`; log 29, 42–51 | **Fixture sai contract validation**: gửi avatar javascript nhưng đợi create thành công; không phải timing | Có: P10/P15/P22/P24/P24.1c và lần này | High về mất coverage workflow; chưa có lỗi production được chứng minh | Nhóm A: sửa fixture Gym và auth trong một phiên nhỏ, từng nguyên nhân con riêng |
| 2 | `P07 Gym Admin XSS and workflow regression` — **parent**, chỉ lan truyền #1; visual con PASS | `test/admin-xss-test.js:52`; log 30 | Parent #1, không độc lập | Có khi #1 fail | Theo #1 | Nhóm A, không task riêng |
| 3 | `CLI migration and production HTTP checkpoint work with explicit configuration` — **top-level độc lập** | `test/auth-test.js:137` → `:157`; log 77, 89–95 | **Fixture config/readiness lỗi thời**: thiếu proxy; port 0; stdout sentinel cũ | Có: P15/P16/P24/a/b/c/d và lần này | High về gate startup/HTTP chưa được kiểm chứng | Nhóm A, cùng phạm vi fixture/contract, không tuyên bố cùng một dòng root cause với Gym |
| 4 | `P08 Master Admin XSS, upload and template regression` → `before/after Master responsive screenshots` | `test/master-xss-test.js:186` → `:226`; log 626, 668–681 | **Visual rendering không ổn định**, pixel nền sai khác nhỏ; cơ chế raster cụ thể chưa xác nhận | Không cố định: edit/preview/PASS thay đổi | Medium về triệu chứng visual; vẫn chặn gate H-05 High | Nhóm B: điều tra renderer và làm visual harness/baseline tái lập chung cả ba UI |
| 5 | `P08 Master Admin XSS, upload and template regression` — **parent**, chỉ lan truyền #4 | `test/master-xss-test.js:54`; log 656 | Parent #4, không độc lập | Theo #4 | Theo #4 | Nhóm B, không task riêng |

Không phát hiện FAIL mới ngoài tập lỗi lịch sử. **3 nguyên nhân độc lập đang FAIL**, không phải 5 hay 6. Master #4/#5 không nằm trong sáu records P24.1c nhưng có trong P24 gốc; cần giữ trong bản đồ.

## Đối chiếu toàn bộ danh sách cũ

| Lỗi lịch sử | P24.2a | Khớp/khác |
|---|---|---|
| P24.1c #1 Gym `responsive before/after screenshots`, `:169 → :189`, 390/members | PASS, log 8 | Cả 15 cặp hoàn tất; không còn FAIL tại 390/members lần này. Không đóng flake |
| P24.1c #2 Gym workflow | FAIL #1 | Đúng selector, 7000ms và điểm lỗi P24 gốc |
| P24.1c #3 Gym parent | FAIL #2 | Lần c do hai con; lần này chỉ workflow |
| P24.1c #4 auth CLI | FAIL #3 | Cùng lỗi; dòng đã dịch +5 từ baseline P24 |
| P24.1c #5 Dashboard `before/after pixel equality across four public tabs at 390/768/1440`, `:70 → :80` | PASS, log 115 | 12 cặp hoàn tất; khác lần c/P22 fail 1440 dashboard, P24 fail 390 dashboard |
| P24.1c #6 Dashboard parent `P06 Dashboard XSS and responsive regression`, `:30` | PASS, log 116 | Không còn con fail |
| P24 gốc Master visual + parent | FAIL #4/#5 | **Đúng 390/edit, 390×1664, maxDelta=2, changedPixels=21855 như P24**; P22 cuối/P15 là 390/preview 21851; c PASS |
| P24 gốc stored-XSS + parent P22 | PASS | `security-e2e-test.js` 12/0, log 1268–1288; không tái phát timeout |
| P24.1c #7–14 đã sửa d | PASS | error-handling 4/0, observability 7/0; không có regression thiếu Master principal |

## Gym timeout: nguyên nhân đã xác định

`test/admin-xss-test.js:210` đặt default timeout **7000ms**. `:218–219` đã login và chờ panel visible; `:220` nhập payload tên cùng avatar `javascript:alert(1)`; `:221` click save rồi **chờ locator `#member-list .list-row` visible**. Không phải đợi network, animation hoặc login. Toàn subtest 15095.7419ms gồm setup/login/cleanup, không phải timeout 15 giây.

Đường đi: `public/admin.js:216–228` gửi `/members/bulk`; `routes/gym-admin.js:4` áp body validation trước handler `:45`; `security/validation.js:76–78 → :28–31 → :20–25` từ chối protocol ngoài HTTP(S). Request lỗi trước INSERT `routes/gym-admin.js:56`. Frontend catch ở `public/admin.js:227` hiển thị lỗi, không chạy `loadAll()` thành công để có member mới.

Log 20: POST login 200 lúc **01:26:04.120Z**; log 27–28: application error và POST **400 lúc 01:26:04.515Z, 19.31ms**; log 44–50 ghi đúng wait selector. Logger không ghi URL/body, nên ánh xạ POST 400 với bulk là đối chiếu thứ tự source + log, không phải network trace có URL. Kết hợp validation tĩnh và lịch sử P24 đủ xác nhận fixture sai contract. Tăng timeout chỉ kéo dài chờ một record không được phép tạo, không giải quyết vấn đề. Phiên sửa phải giữ negative URL rejection/DB unchanged và dùng avatar hợp lệ cho luồng create/edit/log đầy đủ.

## Auth P15-Q1: nguyên nhân cũ vẫn tồn tại

P15 ghi ở `PRODUCTION-READINESS.md:399`, P16 checkpoint đoạn test startup, P24 bảng năm lỗi gốc. Hiện `test/auth-test.js:141–143` vẫn spread process.env, đặt PORT='0', không đặt TRUST_PROXY. Environment hiện không có TRUST_PROXY. Schema và credential CLI assertions đã qua trước spawn `:154`, do đó không giống fixture chưa provision Master của P24.1d.

Thứ tự source: createApp → `security/deployment.js:5–6` từ chối proxy trước listen. Nếu sửa proxy, `security/deployment.js:30–31` còn từ chối port 0; nếu sửa cả hai, `test/auth-test.js:158` vẫn đợi `http://localhost` trong khi `server.js:113` phát structured event `server_started`. Timeout sentinel **5000ms**, nhưng lần này child exit sớm: subtest tổng 1351.0428ms, `startup exited` ở log 91.

Không có stderr child trong log vì test pipe mà không thu thập; server catch `:118` cũng chỉ log `startup_failed`. Vì vậy không giả vờ đã nhìn thấy thông báo exception proxy trong lần chạy này: nguyên nhân tức thời suy ra từ source, config thực tế và thứ tự fail-fast, phù hợp probe P15 đã ghi.

`git diff c50e2fb HEAD -- test/auth-test.js security/deployment.js server.js` chỉ có thay đổi test validateConfig trước đó (+5 dòng), **không đổi CLI subtest, deployment hoặc server**. Git bắt đầu ở baseline sau P15/P16/P24 nên không thể chứng nhận lịch sử trước baseline bằng commit; checkpoint là bằng chứng giai đoạn đó. Không có thay đổi mới liên quan startup trong lịch sử Git hiện có. Phiên sửa cần config hợp lệ, thu lỗi child an toàn, readiness/HTTP thật; giữ negative tests proxy/port.

## Visual: pixel thật, không phải bằng chứng CSS baseline sai

Đã xem trực tiếp ba cặp ảnh và decode RGBA bằng Sharp, không chỉ so PNG bytes. Script phân tích chỉ đọc ảnh và ghi báo cáo ở tmp, không mở browser/rerun test. [Số liệu và timestamp từng cặp](../tmp/p24-2a/pixel-analysis.json), [script](../tmp/p24-2a/compare.cjs).

| Cặp ảnh | Kích thước | Pixel đổi / max channel delta | Bounding box pixel đổi (inclusive) |
|---|---|---|---|
| [Gym before cũ](../tmp/p24-2a/p07/before-390-members.png) / [after](../tmp/p24-2a/p07/after-390-members.png), mtime before 09/09 07:29:38.755Z | 390×1151 | 4779 / 2 | x0–389, y255–635 |
| [Dashboard before cũ](../tmp/p24-2a/p06/before-1440-dashboard.png) / [after](../tmp/p24-2a/p06/after-1440-dashboard.png), 09/09 07:30:19.895Z | 1440×1180 | 58404 / 1 | x0–1439, y255–935 |
| [Master before mới](../tmp/p08/before-390-edit.png) / [after](../tmp/p08/after-390-edit.png), 10/09 01:27:48.897Z | 390×1664 | 21855 / 2 | x0–389, y255–933 |

Gym/Dashboard mới: **15/15 và 12/12 cặp byte-identical**, mọi pixel delta 0. Master mới chỉ dashboard/edit được chụp trước assertion dừng vòng visual; các ảnh view sau còn timestamp cũ, **không tính chúng là PASS mới**. Master geometry assertion `:207` đã qua trước pixel assertion `:226`, vì vậy không có thay đổi geometry trong cặp fail hiện tại.

Hai UI Gym/Dashboard cùng dùng `public/dashboard.html` và `public/style.css` hiện tại cho cả before/after; chỉ inject JS baseline cũ (`test/admin-xss-test.js:24–39,169–189`; Dashboard `:14–26,70–80`). Không so CSS hiện tại với CSS cũ. `git diff c50e2fb HEAD` ở CSS, hai JS và hai test này rỗng. Font external bị route abort; ảnh được decode, Date.now cố định, screenshot đặt animations disabled. Không có bằng chứng CDN font tải chậm hoặc thời gian chờ DOM thiếu là nguyên nhân hiện tại.

Vùng sai khác nhỏ lan đến mép nền và cùng bắt đầu y255; `public/style.css:20–23` vẽ radial gradients trên body. Điều này **ủng hộ cùng họ bất định raster/compositing gradient** cho Gym/Dashboard và Master, không ủng hộ hai lỗi breakpoint/layout hợp lệ chưa update snapshot. Đây là **giả thuyết cơ chế**, chưa phải chứng minh nhân quả: không có compositor trace, computed geometry lịch sử Gym/Dashboard hoặc A/B loại gradient. Không gán chắc chắn GPU, browser version hay race cụ thể. Cùng CSS không tự chứng minh cùng root cause; chưa có bằng chứng hai vấn đề production độc lập, nên gộp phiên điều tra harness, chỉ tách nếu instrumentation chỉ ra khác biệt.

Nguồn async còn đáng kiểm tra có tên cụ thể: `public/dashboard.js:344` refresh `loadState` mỗi 15000ms, hai page được tạo tuần tự; clock Date.now mock không dừng interval. `public/style.css:59–60` fadeIn và `:119` width transition, nhưng screenshot đã disable animation, Master còn finish animation trước chụp. Chưa có timestamp DOM/compositor để quy lỗi cho interval hay animation. Không phân loại chúng thành “flaky do timeout” đã chứng minh.

## Lịch sử độ ổn định

| Lượt | Gym visual | Dashboard visual | Master visual |
|---|---|---|---|
| P10 (readiness 307–308) | 390/members fail cả full/rerun | 1440/log fail; rerun PASS | Không dùng làm kết luận ở đây |
| P15 (readiness 401–403) | 1440/entry-edit | 1440/dashboard | 390/preview, max 2 |
| P22 resume / cuối | 390/member-edit / 1440/wizard | Cuối 1440/dashboard | Resume PASS / cuối 390/preview |
| P24 audit | PASS | 390/dashboard | 390/edit, 21855/max2 |
| P24.1c | 390/members | 1440/dashboard | PASS |
| P24.2a | PASS | PASS | 390/edit, 21855/max2 |

Nguồn: [P22 checkpoint](P22-CHECKPOINT.md), [P24 checkpoint](P24-CHECKPOINT.md), [P24.1c](P24-1C-CHECKPOINT.md), các mục P10/P15 trong readiness. Tên checkpoint không phải thứ tự thời gian tuyệt đối: P22 có lượt tiếp nối sau audit P24. Assertion dừng ở mismatch đầu nên đổi vị trí fail không chứng minh các vị trí sau đã xanh. Tuy nhiên các lượt hoàn toàn PASS xen kẽ chứng minh triệu chứng không ổn định. Không được đóng flake vì một lượt xanh.

## Nhóm sửa đề xuất để người dùng xem xét

1. **Nhóm A — fixture contract Gym + auth**: hai nguyên nhân cụ thể khác nhau nhưng cùng phạm vi sửa fixture; gộp một phiên nhỏ, khôi phục assertions nghiệp vụ và HTTP startup. Không sửa validation production để chiều fixture, không tăng timeout để che lỗi.
2. **Nhóm B — visual cả ba UI + baseline/gate tái lập**: trước hết thu geometry/background/compositor evidence và kiểm soát nguồn bất định đã chứng minh; sau đó mới quyết định giải pháp. Không update baseline mù, không nới tolerance. Baseline JS hiện ở tmp ignored, `skip` nếu thiếu; runner chỉ xét exit status nên gate clean checkout vẫn có lỗ hổng coverage, độc lập việc lần này skip=0.

Chưa phát hiện lỗi logic production nào được chứng minh từ FAIL hiện tại; nếu nhóm B tìm ra lỗi production, ưu tiên cao nhất và tách rõ file/dòng lúc có bằng chứng. Không có fixture regression C-01 mới. Hai visual lịch sử chưa đủ evidence để đóng root cause renderer; phần chưa biết được giữ rõ để tránh giao phiên sửa trên giả định sai.

Chỉ cập nhật checkpoint này và P24.2a trong prompts; giữ nguyên readiness theo phạm vi yêu cầu (các số liệu H-05 ở đó vẫn là lịch sử P22). Không tạo task sửa, không thực hiện P24.2b/c. Dừng chờ xem xét; không commit.
