# P24.1c — Xác minh C-01 local/fixture, 09/09/2026

**P24.1c PARTIAL — điều tra/báo cáo hoàn tất, chưa DONE về điều kiện nghiệm thu; C-01 PARTIAL local. NO-GO / P24 BLOCKED giữ nguyên.** Đính chính sau điều tra: 8 FAIL mới do fixture chưa thích nghi với thay đổi P24.1b phải được xử lý và kiểm chứng trước nghiệm thu C-01; không đẩy chúng sang nhóm H-05 đã biết. Cụm “DONE phần kiểm tra và báo cáo” đã dùng trước đây không có nghĩa P24.1c đạt nghiệm thu. Đã kiểm tra P24.1a và P24.1b đều DONE trong prompts/readiness và checkpoint b trước lần chạy c; working tree lúc bắt đầu c sạch. Lượt điều tra bổ sung chỉ đọc log/source/Git và cập nhật báo cáo này, không sửa code/test/baseline, không chạy lại test, không scrub DB thật, không commit.


## P24.1d — sửa fixture và kiểm chứng giới hạn, 09/09/2026

**DONE trong phạm vi P24.1d: cả 8 records #7–14 đã FIX, assertions mục tiêu đều PASS.** Các phần P24.1c bên dưới giữ số liệu và phân tích lịch sử tại lần c; ghi chú FIX trong bảng là kết quả chạy mới của d. Không suy diễn thành PASS cho lượt 14 file hoặc đóng C-01/P24; P24.1e xác nhận cuối chưa chạy, NO-GO / P24 BLOCKED giữ nguyên.

Đã đọc phân tích #7–14 và đối chiếu flow hiện có: hai fixture DB memory trống thiếu Master khi gọi createApp(). Chỉ sửa test/error-handling-test.js và test/observability-test.js để await migrateCredentials(db, { env }) trước createApp(), qua flow migration/provisioning hiện có (hash, verify và transaction), áp dụng cho từng test case dùng fixture. Không insert principal thủ công, không thay assertions, không sửa auth/config.js hay code production, không khôi phục runtime bootstrap fallback.

Hai lệnh đã chạy, tuần tự theo file:

```text
node --test --test-concurrency=1 test/observability-test.js test/error-handling-test.js
node --test --test-concurrency=1 test/auth-test.js test/session-test.js test/request-security-test.js test/auth-scrub-test.js
```

| File | PASS | FAIL | Kết luận P24.1d |
|---|---:|---:|---|
| observability-test.js | 7 | 0 | Đạt baseline P24/P22; #10–14 đã FIX |
| error-handling-test.js | 4 | 0 | Đạt baseline P24/P22; #7–9 đã FIX |
| auth-test.js | 7 | 1 | Chỉ lỗi startup exited tại :137 → :157, record #4 H-05 cũ |
| session-test.js | 18 | 0 | Không regression phụ trong phạm vi chạy |
| request-security-test.js | 6 | 0 | Không regression phụ trong phạm vi chạy |
| auth-scrub-test.js | 7 | 0 | Không regression phụ trong phạm vi chạy |

Lệnh mục tiêu: **11 PASS / 0 FAIL**, exit 0. Lệnh liên quan: **38 PASS / 1 FAIL**, exit 1, khớp baseline a/b của bốn file; đã chạy cả bốn tên file được yêu cầu dù mô tả ghi “3 file”. Tổng phạm vi d: **49 PASS / 1 FAIL / 0 skip / 0 cancelled (50 tests)**. Log: [target-tests.txt](../tmp/p24-1d/target-tests.txt), [related-tests.txt](../tmp/p24-1d/related-tests.txt). Không ghi đè log/results của c.

**Sáu records #1–6 (H-05) giữ nguyên, không sửa và không đóng:** chỉ #4 được chạy lại và vẫn FAIL; #1–3/#5–6 không chạy lại trong d. Không chạy full suite 14 file, không chạy smoke/scan bổ sung, không commit.

## Tổng hợp a/b/c

| Bước | Trạng thái | Bằng chứng và giới hạn |
|---|---|---|
| P24.1a | DONE | Create gym lưu tombstone độc lập, Argon2id principal; password tạm chỉ trả một lần/no-store. Hai test create/rollback được chạy lại trong session suite. |
| P24.1b | DONE script/test/rehearsal | 7 test scrub; rehearsal trước đó 3 → 0 plaintext, HTTP login 3/3, no-op/rollback PASS; live apply chưa thực hiện. |
| P24.1c | PARTIAL nghiệm thu; điều tra hoàn tất | 8 regression fixture mới trực tiếp từ P24.1b; 6 FAIL records thuộc H-05 có lịch sử. Scan clone sạch trong phạm vi đã biết nhưng source/log coverage còn giới hạn. Không ghi PASS local hoặc GO. |

## Test lần này

Chạy một lượt, tuần tự theo file để tránh tranh chấp browser; không dùng runner full regression:

```text
node --test --test-concurrency=1 test/auth-test.js test/auth-scrub-test.js test/session-test.js test/request-security-test.js test/deployment-test.js test/security-headers-test.js test/observability-test.js test/error-handling-test.js test/map-images-test.js test/frontend-session-test.js test/security-e2e-test.js test/master-xss-test.js test/admin-xss-test.js test/dashboard-xss-test.js
node test/master-routes-smoke-test.js
node scripts/scan-p24-1c.js
```

Các suite XSS dùng chung file với visual/workflow nên các subtest đó cũng chạy, nhưng failure visual/workflow thuộc H-05, không tự trở thành blocker plaintext C-01. Không chạy engine, migration, backup, release, concurrency hoặc full regression. Log: `tmp/p24-1c/tests.txt`, `tmp/p24-1c/master.txt`; SHA-256 trong [results](P24-1C-RESULTS.json).

**Kết quả: 86 PASS / 14 FAIL / 0 skip / 0 cancelled (100 tests), exit 1; Master smoke 50 PASS / 0 FAIL, exit 0.** Tổng hai lệnh 136 PASS / 14 FAIL. Toàn bộ 7 scrub tests PASS, 2 test P24.1a PASS, P22 security E2E PASS, Master XSS/workflow/visual PASS lần này. Đây không thay thế số liệu full regression H-05.

14 FAIL gồm 12 lỗi gốc + 2 parent:

- Auth startup: 1 lỗi `startup exited`, fixture vẫn PORT=0, thiếu TRUST_PROXY và chờ log cũ (P15-Q1).
- Error-handling: 3 lỗi; observability: 5 lỗi. Cả 8 đều `AUTH_CONFIG: active Master principal is required; provision offline`: fixture production còn dựa bootstrap env thay vì provision principal sau P24.1b. Test fail trước luồng mục tiêu, nên không có bằng chứng HTTP logging/error/lifecycle cho 8 luồng này. Test log schema/redaction riêng vẫn PASS.
- Gym: 2 lỗi gốc visual và workflow + 1 parent; Dashboard: 1 visual + 1 parent. Thuộc H-05, không dùng để đòi full suite cho C-01. Không thay baseline hoặc sửa ngoài phạm vi.

## Điều tra chênh lệch 1 → 14 FAIL (chỉ điều tra, 09/09/2026)

### Cách đếm và phạm vi

**86 là số PASS, không phải tổng số test.** P24.1a chạy 3 file bằng node:test: auth (8), session (18), request-security (6) = **32 records: 31 PASS + 1 FAIL**. P24.1b thêm auth-scrub (7) = **39: 38 PASS + 1 FAIL**; deployment chạy riêng 3 PASS. P24.1c chạy 14 file = **100: 86 PASS + 14 FAIL**. Node tính cả parent `test(...)` có subtest vào totals; không đổi cách đếm giữa các lượt, nhưng phạm vi c rộng hơn và có thêm parent records. Master smoke là runner riêng, 50 PASS ở a/c, không nằm trong 32/100; b không có số smoke riêng để cộng vào 39.

| File node:test trong P24.1c | PASS | FAIL | Tổng | So với lệnh P24.1a |
|---|---:|---:|---:|---|
| auth-test.js | 7 | 1 | 8 | Có sẵn |
| session-test.js | 18 | 0 | 18 | Có sẵn |
| request-security-test.js | 6 | 0 | 6 | Có sẵn |
| auth-scrub-test.js | 7 | 0 | 7 | Thêm từ b |
| deployment-test.js | 3 | 0 | 3 | Mở rộng; b từng chạy riêng |
| security-headers-test.js | 3 | 0 | 3 | Mở rộng |
| observability-test.js | 2 | 5 | 7 | Mở rộng |
| error-handling-test.js | 1 | 3 | 4 | Mở rộng |
| map-images-test.js | 5 | 0 | 5 | Mở rộng |
| frontend-session-test.js | 5 | 0 | 5 | Mở rộng, gồm parent |
| security-e2e-test.js | 12 | 0 | 12 | Mở rộng, gồm parent |
| master-xss-test.js | 9 | 0 | 9 | Mở rộng, gồm parent |
| admin-xss-test.js | 5 | 3 | 8 | Mở rộng, gồm parent |
| dashboard-xss-test.js | 3 | 2 | 5 | Mở rộng, gồm parent |
| **Tổng** | **86** | **14** | **100** | **Thêm 68 records so với a** |

Đối chiếu số học: **1 FAIL cũ trong 3 file a + 5 FAIL có lịch sử ở các file mở rộng (3 subtest + 2 parent) + 8 FAIL mới do b = 14**. Phần thêm 68 records có 55 PASS và 13 FAIL. Không phải 13 lỗi mới do C-01, cũng không phải cả 14 đều lỗi H-05 cũ.

### Đủ 14 FAIL records và phân loại

Dòng dưới là dòng hiện tại tại lần c: “khai báo → điểm lỗi”. Parent không phải nguyên nhân độc lập. Tám hàng mang mã **B** cùng một nguyên nhân ở cấu hình production, nhưng là tám test bị mất coverage khác nhau.

| # | Tên đầy đủ trong log / lỗi thực tế | File/dòng | So với P24 và lịch sử | Liên hệ P24.1a/b; quyết định |
|---|---|---|---|---|
| 1 | `responsive before/after screenshots` — `Layout changed at 390/members` | `test/admin-xss-test.js:169` → `:189` | **Không thuộc 9 FAIL P24** (lượt P24 PASS visual Gym). Đã FAIL từ P10 đúng `390/members`, readiness dòng 307; P15/P22 còn các biến thể khác. | **H-05 đã có lịch sử**, không có bằng chứng regression C-01. So byte PNG qua mocked routes, không đi create gym/bootstrap/scrub. Chưa kết luận nguyên nhân render/PNG giống nhau chỉ vì cùng assertion. |
| 2 | `real session/API/database: create/edit member and create/edit log preserve data and IDs` — timeout 7000ms chờ `#member-list .list-row` | `test/admin-xss-test.js:194` → `:221` (input `:220`) | **Có trong 5 lỗi gốc P24**, P10/P15/P22 cũng ghi nhận. | **H-05/P15-Q2/P23-Q1**. Fixture gửi avatar `javascript:` bị validation từ P09 chặn, nhưng chờ tạo thành viên thành công. Gym seed legacy được migrate trước login (`:197–206`); login đã qua, không phải giả định plaintext sau create gym a. |
| 3 | `P07 Gym Admin XSS and workflow regression` — parent FAIL của #1/#2 | `test/admin-xss-test.js:52`; log c dòng 29 | **Parent Gym có trong 9 FAIL P24**, khi đó do workflow; c có thêm visual con so với P24. | **H-05, lỗi lan truyền**, không cộng thành nguyên nhân mới. |
| 4 | `CLI migration and production HTTP checkpoint work with explicit configuration` — `startup exited` | `test/auth-test.js:137` → `:157`; trước b là `:132` → `:152` | **Có trong 5 lỗi gốc P24**, cũng là **1 FAIL duy nhất a/b**. | **H-05/P15-Q1**. PORT=0, thiếu TRUST_PROXY, chờ chuỗi log cũ; test đã migrate Master trước spawn. B thêm 5 dòng ở test trước đó nên số dòng dịch, không tạo lỗi mới này. |
| 5 | `before/after pixel equality across four public tabs at 390/768/1440` — `pixels changed: 1440 dashboard` | `test/dashboard-xss-test.js:70` → `:80` | **Có cùng subtest trong 5 lỗi gốc P24** (P24: `390 dashboard`); P22 đã ghi đúng `1440 dashboard`. | **H-05 có lịch sử**. Mock HTTP/static frontend, không chạy backend a/b. Assertion so bytes PNG; chưa chứng minh cùng root cause với biến thể P24. |
| 6 | `P06 Dashboard XSS and responsive regression` — parent FAIL của #5 | `test/dashboard-xss-test.js:30`; log c dòng 50 | **Parent Dashboard có trong 9 FAIL P24**. | **H-05, lỗi lan truyền**, không phải regression độc lập. |
| 7 | `404 route, missing gym, API HTML negotiation, IDs and early Host rejection` — thiếu active Master principal | `test/error-handling-test.js:38` → `:39` → fixture `:9` → `auth/config.js:16` | **MỚI sau b**; không trong 9 FAIL/5 lỗi gốc P24. Suite error-handling P24/P22 đều 4/0. | **B — regression fixture trực tiếp từ P24.1b**, cần sửa/kiểm chứng trước nghiệm thu C-01. **P24.1d: FIX — PASS** (xem kết quả mới phía trên). |
| 8 | `validation, malformed JSON, body limit and unknown status400 do not disclose input` — thiếu active Master principal | `test/error-handling-test.js:48` → `:49` → fixture `:9` → `auth/config.js:16` | **MỚI sau b**; P24/P22 suite 4/0. | **B**, cùng nguyên nhân #7, chưa chạy assertions validation/disclosure. **P24.1d: FIX — PASS** (xem kết quả mới phía trên). |
| 9 | `real SQLite constraint and query failures plus unexpected async rejection are sanitized` — thiếu active Master principal | `test/error-handling-test.js:58` → `:59` → fixture `:9` → `auth/config.js:16` | **MỚI sau b**; P24/P22 suite 4/0. | **B**, cùng nguyên nhân #7, chưa kiểm chứng sanitize SQL/async errors. **P24.1d: FIX — PASS** (xem kết quả mới phía trên). |
| 10 | `health/readiness minimal, uncached, Host protected; readiness fails on real DB access failure and draining` — thiếu active Master principal | `test/observability-test.js:47` → `:48` → fixture `:12` → `auth/config.js:16` | **MỚI sau b**; P24/P22 observability đều 7/0. | **B**, chưa chạy health/readiness assertions. **P24.1d: FIX — PASS** (xem kết quả mới phía trên). |
| 11 | `HTTP logs correlate errors without headers, URLs, query, PII or exception text` — thiếu active Master principal | `test/observability-test.js:65` → `:66` → fixture `:12` → `auth/config.js:16` | **MỚI sau b**; P24/P22 suite 7/0. | **B**, thiếu evidence HTTP log/redaction; không được gọi logging đã PASS toàn bộ. **P24.1d: FIX — PASS** (xem kết quả mới phía trên). |
| 12 | `SIGTERM drains async database write, client aborted=false, repeated signals safe` — thiếu active Master principal | `test/observability-test.js:75` → `:79` → fixture `:12` → `auth/config.js:16` | **MỚI sau b**; P24/P22 suite 7/0. | **B**, một test sinh từ vòng lặp, chưa vào shutdown/drain scenario. **P24.1d: FIX — PASS** (xem kết quả mới phía trên). |
| 13 | `SIGTERM drains async database write, client aborted=true, repeated signals safe` — thiếu active Master principal | `test/observability-test.js:75` → `:79` → fixture `:12` → `auth/config.js:16` | **MỚI sau b**; P24/P22 suite 7/0. | **B**, record riêng với #12 dù cùng dòng; chưa vào aborted-client scenario. **P24.1d: FIX — PASS** (xem kết quả mới phía trên). |
| 14 | `shutdown deadline reports failure without closing DB under a pending operation` — thiếu active Master principal | `test/observability-test.js:93` → `:94` → fixture `:12` → `auth/config.js:16` | **MỚI sau b**; P24/P22 suite 7/0. | **B**, chưa kiểm chứng deadline/pending DB operation. **P24.1d: FIX — PASS** (xem kết quả mới phía trên). |

### Nguyên nhân tám regression B và mức chắc chắn

Đối chiếu Git `c50e2fb` (baseline **đã có P24.1a**) → `4f455d5` cho thấy `auth/config.js:15` đổi từ `!master && !env.MASTER_ADMIN_BOOTSTRAP_PASSWORD && !env.MASTER_ADMIN_CODE` sang chỉ `!master`. Đây là bỏ ngoại lệ bootstrap trong **validation runtime production**, không phải scrub chạy khi startup. `server.js:12` gọi validation ngay trong `createApp()`.

Hai fixture không đổi trong diff đó: `test/error-handling-test.js:6–9` và `test/observability-test.js:8–12` tạo DB memory trống, truyền `MASTER_ADMIN_BOOTSTRAP_PASSWORD`, rồi gọi `createApp()` mà không provision Master principal. Trước b, env làm chúng vượt validation dù DB chưa có Master; sau b, fail-fast đúng contract mới. Tám stack trong log c đều chứng minh đúng đường gọi này. Các lượt P24/P22 trước b đều xanh ở hai suite, trong khi a/b không chạy hai suite nên không phát hiện regression. Đây là **regression tương thích fixture/coverage do b gây ra**, không có bằng chứng tám lỗi implementation độc lập ở health/error/logging/shutdown; đồng thời không thể coi các luồng đó vẫn hoạt động khi test chưa đi tới assertions.

Không có FAIL nào trong 14 được chứng minh do thao tác scrub hay route create gym lưu tombstone của a. Bảy scrub tests, hai test a và Master smoke vẫn PASS ở log c. Diff hai commit không thay routes/master.js (a đã ở baseline), không thay hai visual suites/frontend; visual setup mock request và không gọi backend a/b. Lượt điều tra không checkout/revert, không chạy A/B hoặc test mới: kết luận dựa log trước/sau, source và diff; không tuyên bố đã xác định root cause mọi biến thể visual. Không thể dùng diff này một mình chứng minh mọi hành vi trước a vì repo chỉ có hai commit và commit gốc đã chứa a.

### Đối chiếu trực tiếp với 9 FAIL P24 và quyết định

- **5 records giữ lại từ P24:** auth startup, Gym workflow + parent Gym, Dashboard visual + parent Dashboard.
- **1 record có lịch sử ngoài 9 P24:** Gym visual (#1; từng FAIL P10, P24 PASS, P22/c FAIL). Không gán là regression C-01 chỉ vì absent ở một lượt P24.
- **4 records P24 không còn FAIL trong c:** Master visual + parent Master, P22 stored-XSS + parent P22. Chỉ ghi PASS lần c cho Master visual, không tự đóng flake H-05; P22 đã có checkpoint xử lý riêng.
- **8 records mới từ b:** #7–14. Tổng **9 − 4 + 1 + 8 = 14**. So P22: **8 − 2 Master + 8 mới = 14**.

**Quyết định phân loại để người dùng xem xét:** #1–6 thuộc H-05 đã có lịch sử, không bắt chạy full regression để đóng C-01. #7–14 phải được xử lý như regression do thay đổi C-01/P24.1b và chạy lại các luồng mục tiêu trước khi P24.1c được coi DONE về nghiệm thu; không khôi phục bootstrap fallback chỉ để làm xanh test. Chưa sửa gì trong lượt này. Các thiếu hụt source/log scan ghi dưới vẫn còn riêng, không tự biến mất khi sửa tám fixture failures.

Nguồn đối chiếu: `tmp/p24-1c/tests.txt:1–50` (parent records) và `:1355–1527` (totals/12 lỗi gốc); `tmp/p24-1a/auth-results.txt`, `tmp/p24-1b/tests.txt`; [P24 checkpoint](P24-CHECKPOINT.md), `tmp/p24/test-summary.json`; [P22 checkpoint](P22-CHECKPOINT.md), `tmp/p22/regression-final-summary.json`; [readiness lịch sử P10/P15](PRODUCTION-READINESS.md); diff Git nêu trên. Giữ nguyên log/results của lần chạy c, không tạo số liệu test mới.

## Scan tự động và điều kiện còn thiếu

- `scripts/scan-p24-1c.js` mở **read-only** hai clone P24.1b có sẵn; không mở `test/test.db` hay DB thật. Sáu credential cũ/mới lấy trong bộ nhớ từ prepared clone và handoff mã hóa; không in giá trị/key. Scan mọi cột bằng `scanPlaintext`, scan bytes scrubbed DB và kiểm tra tất cả admin_code là tombstone; integrity OK; digest hai clone trước/sau không đổi.
- Scan working source gồm test fixture, không gồm dependency, Git history, artifact tmp, backup ngoài repo hoặc secret đã encode. Vị trí match được lưu dưới dạng file/dòng, không giá trị. Ba dòng trong `test/engine-test.js` chứa credential fixture trùng clone; tập mẫu bổ sung cũng có match trong test. Không được tuyên bố “không còn plaintext admin_code ở bất kỳ đâu trong source”. Mẫu cố định của chính scanner là probe test, được loại khỏi thống kê mẫu bổ sung để tránh tự-match.
- Scan stdout/stderr của cả hai lệnh bằng các credential clone và mẫu fixture đã biết. Một số suite dùng logger no-op hoặc capture riêng; password sinh ngẫu nhiên trong mọi HTTP response không được tập hợp bởi scanner này. Vì vậy 0 match chỉ là bằng chứng giới hạn, **không phải** chứng minh mọi plaintext đều không log. Scrub tests và observability tests cung cấp assertions bổ sung theo từng luồng; các test thất bại không được tính là đã xác minh luồng đó.
- Scan cuối: 87 file theo glob trong script; 3 dòng match credential clone trong fixture engine và 13 dòng match mẫu fixture bổ sung; 0 match ở log đã hoàn tất. Clone: 0 non-tombstone, 0 match mọi cột, 0 match bytes. Báo cáo chứa digest clone/log, không credential.
- Để đóng local: xử lý/kiểm chứng các failure auth/security liên quan; thống nhất hoặc thực thi tiêu chí fixture không hardcode nếu yêu cầu “bất kỳ đâu” được giữ nguyên; instrument logger/các tiến trình con cho password sinh động create/reset/scrub và kiểm tra output cả success/error. Không cần full regression để đóng C-01; H-05 là gate riêng. Không tự mở task sửa tiếp.

## Điều kiện áp scrub lên DB thật — chưa được phê duyệt

1. **Ai duyệt:** người dùng/chủ sở hữu hệ thống phải phê duyệt tường minh một rollout riêng, DB đích, phạm vi gym, script/version, lịch, người thao tác, người kiểm chứng và quyền resume/rollback. Hiện chưa có tên người chịu trách nhiệm vận hành được chỉ định; không coi Codex, DONE a/b/c hoặc báo cáo này là phê duyệt. Người phụ trách DB/backup phải xác nhận khả năng khôi phục; người phụ trách gym xác nhận danh sách người nhận và kênh bàn giao.
2. **Backup trước chạy:** chốt snapshot nhất quán DB + uploads/season, bao gồm committed WAL; dừng writers/checkpoint theo runbook. Backup mã hóa ngoài web root/repo, ACL thực tế (đặc biệt Windows), checksum/integrity và restore drill vào đường dẫn mới; kiểm chứng khóa khôi phục, RPO/RTO, dung lượng và rollback. Không xóa backup để đạt scan sạch. H-04 vận hành vẫn OPEN.
3. **Thời điểm bảo trì:** lịch cụ thể và múi giờ phải được duyệt, thông báo trước; dừng app và mọi job/writer, khóa thao tác migration. Kiểm tra đúng DB/version/principal/count; chuẩn bị Master recovery. CLI hiện tại chỉ tạo clone mới, **không có lệnh live apply**; kế hoạch cutover/apply thật cần được xây dựng, review và duyệt riêng.
4. **Thông báo gym admin:** thông báo trước thời gian gián đoạn, session bị revoke, credential cũ ngừng dùng, cách nhận password mới và đầu mối hỗ trợ. Xác minh danh tính từng admin; sau commit, operator đối chiếu handoff hash với DB, bàn giao thủ công qua kênh riêng được duyệt, không gửi password qua log/group chat. Giữ key tách khỏi handoff, ACL riêng; xác nhận đã nhận và đăng nhập/đổi password. `must_rotate` hiện là grace period, không cưỡng chế mọi thao tác. Chưa gửi email/tin nhắn nào.
5. **Sau chạy và resume:** count/scan cột + bytes/WAL/journal, login/change/reset/revoke, deleted gym, idempotence và recovery; người kiểm chứng ký nhận trước người có thẩm quyền cho resume. Lập retention/purge được duyệt cho backup/WAL/snapshot chứa plaintext cũ. Cleanup sau commit lỗi thì giữ offline, không giả định transaction rollback. Restore DB chỉ sang đường dẫn mới và cutover khi được duyệt, cân nhắc business writes; không quay lại plaintext/header auth.

H-01, H-04, H-05, H-06 giữ nguyên trạng thái mở. Dừng tại báo cáo a/b/c để người dùng xem xét trước quyết định sửa H-05, bổ sung evidence C-01 hoặc lập rollout scrub thật.

Commit message đề xuất: `docs(security): record P24.1c local verification and remaining C-01 evidence gaps`.
