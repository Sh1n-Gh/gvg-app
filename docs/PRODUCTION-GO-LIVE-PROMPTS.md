# Kế hoạch prompt đưa GvG App lên production

Ngày lập: 04/09/2026  
Ngày bắt đầu dự kiến: 07/09/2026  
Múi giờ: Asia/Bangkok  
Mục tiêu: xử lý lần lượt các vấn đề bảo mật, lỗi, vận hành và QA mà không làm một phiên Codex quá lớn.

## Cách sử dụng

1. Mỗi ngày mở một task Codex mới và dán đúng prompt của ngày đó.
2. Không yêu cầu task làm luôn công việc của ngày tiếp theo.
3. Task phải đọc file này và cập nhật bảng trạng thái trước khi kết thúc.
4. Với task nặng, nếu gần hết giới hạn thì dừng tại checkpoint an toàn, ghi rõ phần đã xong và phần còn lại.
5. Không tự commit nếu người dùng chưa yêu cầu; cuối task chỉ đề xuất commit message.
6. Chỉ chạy toàn bộ test ở những ngày checkpoint. Các ngày khác chạy test liên quan để tiết kiệm thời gian và quota.
7. Nếu một ngày bị trễ, giữ nguyên thứ tự phụ thuộc và dời các ngày sau; không chạy song song các task cùng sửa authentication hoặc database.

## Quy tắc chung áp dụng cho mọi prompt

- Workspace là `D:\Documents\ChatGPT\GvG App`.
- Đọc `docs/PRODUCTION-GO-LIVE-PROMPTS.md` và các tài liệu được prompt chỉ định trước khi sửa.
- Bảo toàn dữ liệu hiện tại; không xóa database, `.env`, ảnh upload hoặc lịch sử Git.
- Kiểm tra working tree trước khi sửa và không ghi đè thay đổi không liên quan của người dùng.
- Chỉ thay đổi đúng phạm vi của ngày hiện tại; không tự thêm chức năng/UI mới.
- Dùng prepared statement cho SQL và validation phía server cho mọi input.
- Thêm hoặc cập nhật test phù hợp với thay đổi.
- Cuối task phải báo cáo: file đã sửa, test đã chạy, kết quả, rủi ro còn lại, bước tiếp theo và commit message đề xuất.
- Cập nhật trạng thái ngày tương ứng trong bảng dưới thành `DONE`, `PARTIAL` hoặc `BLOCKED`, kèm ghi chú ngắn.

## Lịch tổng thể

| Ngày | Mã | Công việc | Mức tải | Trạng thái |
|---|---|---|---|---|
| 07/09/2026 | P00 | Baseline và tài liệu kiểm soát | Nhẹ | PARTIAL — đã lập baseline; 39 PASS, 0 FAIL, 78 chưa chạy do thiếu native C++ toolchain cho better-sqlite3 |
| 08/09/2026 | P01 | Git hygiene và secret scan | Nhẹ | DONE — đã thêm ignore, chuẩn hóa env mẫu và quét working tree/toàn bộ Git refs; không thấy secret thật |
| 09/09/2026 | P02 | Thiết kế authentication | Trung bình | DONE — đã tạo AUTH-DESIGN; chờ người dùng phê duyệt trước P03 |
| 10/09/2026 | P03 | Authentication backend: schema và password | Nặng | DONE — additive schema/hash/migration, rollback và test pass; xem [P03 checkpoint](P03-CHECKPOINT.md); chưa làm P04 |
| 11/09/2026 | P04 | Authentication backend: session và phân quyền | Nặng | DONE — xem [P04 checkpoint](P04-CHECKPOINT.md); session/CSRF/tenant và bridge hash; không sửa frontend |
| 14/09/2026 | P05 | Chuyển frontend sang session | Trung bình | DONE — xem [P05 checkpoint](P05-CHECKPOINT.md); browser/session tests pass, bridge removed; staging/scrub chưa thực hiện |
| 15/09/2026 | P06 | Chống XSS cho Dashboard | Trung bình | DONE - [P06 checkpoint](P06-CHECKPOINT.md); XSS/UX/session PASS; 12 responsive screenshot pairs identical |
| 16/09/2026 | P07 | Chống XSS cho Gym Admin | Trung bình | DONE — [P07 checkpoint](P07-CHECKPOINT.md); XSS/workflow/session PASS, 15 responsive screenshot pairs identical |
| 17/09/2026 | P08 | Chống XSS cho Master Admin | Trung bình | DONE — [P08 checkpoint](P08-CHECKPOINT.md); XSS/upload/template/regression PASS; 15 responsive comparisons PASS |
| 18/09/2026 | P09 | Validation, body limit và rate limiting | Trung bình | DONE — [P09 checkpoint](P09-CHECKPOINT.md); body/validation/proxy/rate limits; 22 security/session + 50 smoke PASS |
| 21/09/2026 | P10 | Checkpoint Critical | Nhẹ | BLOCKED — audit 07/09: C-01 còn plaintext; full suite 175 PASS/5 FAIL (3 lỗi subtest + 2 parent), 0 skip; chưa chuyển High; xem PRODUCTION-READINESS mục P10 |
| 22/09/2026 | P11 | Security headers và CSP | Trung bình | DONE — [P11 checkpoint](P11-CHECKPOINT.md); CSP/headers/HSTS, 58 test PASS local; P10 vẫn BLOCKED |
| 23/09/2026 | P12 | HTTPS, reverse proxy và domain config | Trung bình | DONE — cấu hình mẫu Nginx/localhost/Host; 28 test PASS; chưa deploy/TLS thật, xem [P12 checkpoint](P12-CHECKPOINT.md) |
| 24/09/2026 | P13 | Gia cố upload ảnh | Trung bình | DONE — Sharp decode/encode, metadata/pixel/byte limits, quota và thiết kế orphan; 86 checks PASS; xem [P13 checkpoint](P13-CHECKPOINT.md) |
| 25/09/2026 | P14 | Error handling và privacy | Trung bình | DONE — error boundary/request ID, 404/500; 116 checks PASS; privacy chờ quyết định sản phẩm, xem [P14 checkpoint](P14-CHECKPOINT.md) |
| 28/09/2026 | P15 | Checkpoint High | Nhẹ | BLOCKED — audit 08/09: 187 PASS/8 FAIL/0 skip; CSP trang thực tế PASS; C-01/H-05 và staging gate còn chặn; NO-GO staging public có bảo vệ, xem PRODUCTION-READINESS mục P15 |
| 29/09/2026 | P16 | Migration framework | Nặng | DONE — version/checksum, baseline, atomic runner, preflight và backup hook; 11 migration tests PASS; tổng kiểm thử liên quan 116 PASS/1 lỗi fixture P15-Q1 đã biết; xem [P16 checkpoint](P16-CHECKPOINT.md) |
| 30/09/2026 | P17 | Backup và restore | Trung bình | DONE — SQLite Backup API/WAL, retention, restore vào đường dẫn mới và hook P16; 68 checks PASS/0 FAIL trên fixture, chưa động DB thật; xem [BACKUP-RESTORE.md](BACKUP-RESTORE.md) |
| 01/10/2026 | P18 | SQLite concurrency và index | Trung bình | DONE — atomic log transactions, 2 index có EXPLAIN/chi phí; 161 checks PASS, concurrency local; xem [P18 checkpoint](P18-CHECKPOINT.md), vẫn giới hạn 1 Node instance |
| 02/10/2026 | P19 | Dependency audit | Nhẹ | DONE — qs 6.16.0; audit production 0 advisory; 72 checks PASS; Node/npm và lịch cập nhật tại [P19 checkpoint](P19-CHECKPOINT.md); P15 vẫn BLOCKED |
| 05/10/2026 | P20 | Logging, monitoring và health check | Trung bình | DONE — structured allowlist logs, health/ready, drain HTTP/async DB; 80 checks PASS; xem [P20 checkpoint](P20-CHECKPOINT.md), monitoring thật chờ staging |
| 06/10/2026 | P21 | CI/CD và rollback | Nặng | DONE — pipeline/rollback trung lập, khóa migration và runbook; 30 tests PASS; build Linux/provider rehearsal chưa chạy, không deploy; xem [RELEASE-RUNBOOK](RELEASE-RUNBOOK.md) |
| 07/10/2026 | P22 | E2E authentication và security regression | Trung bình | DONE — xác nhận 09/09: P22 12 PASS/0 FAIL/0 skip; full regression đủ 20 suite, 243 PASS/8 FAIL/0 skip (5 lỗi gốc + 3 parent), H-05 còn mở; xem [P22 checkpoint](P22-CHECKPOINT.md) |
| 08/10/2026 | P23 | Load test, responsive và browser QA | Trung bình | DONE — local: 1.680 HTTP/560 writes, 0 lỗi/locked; burst đạt concurrency 32, đề xuất 16; Chrome/Edge/Firefox 84 views PASS; Safari/soak và 2 failure hồi quy ghi task riêng, xem [P23 checkpoint](P23-CHECKPOINT.md) |
| 09/10/2026 | P24 | Staging rehearsal và quyết định go-live | Nặng | BLOCKED — audit 09/09: NO-GO; 240 PASS/9 FAIL/0 skip; rehearsal local 58 checks và restore smoke 52 PASS; còn plaintext, regression/P22 và gate hạ tầng; không production, xem [P24 checkpoint](P24-CHECKPOINT.md) |

## P24.1a — Dừng ghi credential plaintext mới

**DONE — 09/09/2026.** Đóng phần dừng ghi plaintext mới của C-01; không đóng toàn bộ C-01/P24. Phạm vi tương ứng P15-C1b trong bảng task tại [PRODUCTION-READINESS](PRODUCTION-READINESS.md), theo [AUTH-DESIGN](AUTH-DESIGN.md) phase C. P15-C1b trước đây không có mục riêng trong file prompts này.

- Create gym sinh temporary password CSPRNG 32 bytes, hash Argon2id bằng P03 và lưu `auth_principals.password_hash` với `must_rotate=1`. Cột `gyms.admin_code` nhận tombstone random độc lập, không dùng xác thực; bỏ qua `admin_code` client gửi.
- Giữ key response `gym.admin_code` để tương thích UI: đây là temporary password chỉ trả ở response tạo thành công với `Cache-Control: no-store`, không phải giá trị cột DB. Không lưu/log plaintext. Hash async trước transaction; gym/principal/season/round writes nằm trong cùng transaction đồng bộ.
- Test `node --test test/auth-test.js test/session-test.js test/request-security-test.js`: **31 PASS / 1 FAIL / 0 skip**. Hai test P24.1a PASS (create/login/reset/no plaintext/no disclosure và rollback principal/season/round). FAIL duy nhất là fixture startup P15-Q1 đã biết tại `test/auth-test.js:132`, ngoài phạm vi.
- Test `node test/master-routes-smoke-test.js`: **50 PASS / 0 FAIL**. Không chạy full suite. Log local: `tmp/p24-1a/auth-results.txt`, `tmp/p24-1a/master-results.txt`.
- **P24.1b: DONE script/test/rehearsal clone — 09/09/2026; live scrub vẫn OPEN.** Không migration/scrub DB thật, không commit. C-01 còn PARTIAL; kết luận NO-GO giữ nguyên. Xem mục P24.1b bên dưới.

## P15-C1c — Thiết kế scrub idempotent (tham chiếu)

Task này trước đây chỉ được liệt kê trong bảng P15 tại [PRODUCTION-READINESS](PRODUCTION-READINESS.md). Thiết kế có sẵn là [AUTH-DESIGN](AUTH-DESIGN.md), Phase C và rollback: backup/restore; xác minh principal/hash; tombstone unique thay plaintext; count/hash/login/reset/revoke; chạy lại không đổi; quét không plaintext; gỡ bootstrap runtime. Chỉ viết và rehearsal trên bản sao. Live apply là rollout riêng cần phê duyệt. Implementation tương ứng hiện là P24.1b bên dưới.

## P24.1b — Scrub admin_code plaintext cũ

**DONE trong phạm vi script + test + rehearsal clone — 09/09/2026. Live rollout OPEN, C-01 chưa đóng.** Đã kiểm tra P24.1a DONE trước khi bắt đầu.

- `auth/scrub.js`: password tạm random + Argon2id; hash/tombstone/revoke/version trong một transaction; scan mọi cột; rollback toàn bộ khi lỗi; chạy lại no-op. Handoff AES-256-GCM flush trước commit, không stdout password; bàn giao thủ công, không gửi email.
- `scripts/rehearse-auth-scrub.js`: CLI chỉ tạo clone mới; không có live apply/default DB path, không mở nguồn bằng SQLite, từ chối nguồn WAL chưa checkpoint.
- Bộ test liên quan **38 PASS / 1 FAIL / 0 skip**, gồm **7/7 test scrub PASS**. FAIL duy nhất P15-Q1 startup fixture đã biết. Clone của DB có sẵn `test/test.db`: **3 → 0 plaintext; HTTP login 3/3 PASS; lần 2 không đổi; rollback PASS; SHA-256 DB và WAL nguồn không đổi**.
- Bỏ runtime bootstrap fallback trong auth config; giữ additive migration offline và chặn hash tombstone. Xem [báo cáo P24.1b](P24-1B-CHECKPOINT.md) và [kết quả rehearsal](P24-1B-RESULTS.json) cho file, test, atomicity, bàn giao/recovery và rollout còn mở.
- **Không apply DB thật, không P24.1c, không commit.** Dừng sau báo cáo; người dùng phải duyệt tường minh một bước live rollout riêng.

---

## 07/09/2026 — P00: Baseline và tài liệu kiểm soát

```text
Hãy thực hiện P00 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md cho dự án D:\Documents\ChatGPT\GvG App.

Mục tiêu: tạo baseline trước khi sửa production. Chỉ kiểm tra và bổ sung tài liệu, không thay đổi hành vi ứng dụng.

Yêu cầu:
1. Kiểm tra git status, cấu trúc code, package scripts, schema database và các route chính.
2. Chạy toàn bộ bộ test hiện có và ghi chính xác số test pass/fail.
3. Tạo docs/PRODUCTION-READINESS.md gồm checklist Critical/High/Medium/Low, trạng thái hiện tại, bằng chứng file/dòng và tiêu chí go-live.
4. Ghi lại các API và hành vi quan trọng cần giữ nguyên để làm regression baseline.
5. Không sửa lỗi trong task này. Nếu thấy lỗi mới, chỉ thêm vào checklist.
6. Cập nhật P00 thành DONE/PARTIAL/BLOCKED. Dừng sau báo cáo; không làm P01.
```

## 08/09/2026 — P01: Git hygiene và secret scan

```text
Hãy thực hiện P01 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: ngăn secret và dữ liệu runtime bị commit. Không thay đổi chức năng ứng dụng.

Yêu cầu:
1. Đọc docs/PRODUCTION-READINESS.md và kiểm tra git status/lịch sử Git trước khi sửa.
2. Tạo .gitignore phù hợp cho Node.js + SQLite: .env, *.db, *.db-wal, *.db-shm, log, backup, coverage, file upload runtime và file tạm; không bỏ qua source/config mẫu cần commit.
3. Quét source và lịch sử Git để tìm password, token, API key, connection string và dữ liệu thật. Không in đầy đủ giá trị secret trong báo cáo.
4. Đảm bảo .env.example chỉ chứa placeholder và bổ sung danh sách biến production cần thiết nếu đã xác định được.
5. Không xóa file nhạy cảm và không rotate secret. Nếu secret từng được commit, báo rõ hành động người dùng cần làm.
6. Chạy test liên quan nếu có thay đổi config.
7. Cập nhật tài liệu và P01; dừng sau báo cáo.
```

## 09/09/2026 — P02: Thiết kế authentication

```text
Hãy thực hiện P02 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md. Đây là task thiết kế, chưa triển khai code authentication.

Mục tiêu: chốt kiến trúc xác thực an toàn cho Master Admin và Gym Admin mà không làm mất quyền truy cập hiện tại.

Yêu cầu:
1. Đọc route Master/Gym Admin, schema, frontend login và docs/PRODUCTION-READINESS.md.
2. Tạo docs/AUTH-DESIGN.md, mô tả: password hashing Argon2id hoặc bcrypt; server-side session; cookie HttpOnly/Secure/SameSite; CSRF; session expiry; logout; rotation/reset password; rate limiting; phân quyền Master/Gym và cách cô lập từng gym.
3. Thiết kế migration từ admin_code plaintext hiện tại. Không ghi password thật vào tài liệu.
4. Nêu rõ thay đổi API/frontend/schema, các test bắt buộc và kế hoạch rollback.
5. Chỉ chọn dependency có bảo trì tốt và tương thích Node hiện tại; nếu cần tra cứu phiên bản mới nhất, dùng nguồn chính thức.
6. Không sửa code ngoài tài liệu. Cập nhật P02 và dừng để người dùng duyệt thiết kế trước P03.
```

## 10/09/2026 — P03: Authentication backend — schema và password

```text
Hãy thực hiện P03 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md sau khi đọc và tuân thủ docs/AUTH-DESIGN.md đã được duyệt.

Phạm vi duy nhất: lớp dữ liệu và xử lý password; chưa chuyển frontend sang session.

Yêu cầu:
1. Thêm schema/migration cần thiết cho password hash và session theo thiết kế, bảo toàn dữ liệu cũ.
2. Loại bỏ fallback master-changeme; production thiếu cấu hình bắt buộc phải fail fast với thông báo không lộ secret.
3. Thêm hàm hash/verify password an toàn. Không log password/hash/admin code.
4. Tạo cơ chế chuyển đổi admin code cũ theo kế hoạch được duyệt, có rollback và không tự khóa toàn bộ admin.
5. Thêm unit/integration test cho hash, sai password, migration dữ liệu cũ và cấu hình production thiếu secret.
6. Không thay frontend, không làm P04. Cập nhật tài liệu/P03 và dừng tại checkpoint chạy được.
```

## 11/09/2026 — P04: Authentication backend — session và phân quyền

```text
Hãy thực hiện P04 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md, dựa trên docs/AUTH-DESIGN.md và kết quả P03.

Mục tiêu: hoàn thiện backend login/session/logout và phân quyền.

Yêu cầu:
1. Implement login, kiểm tra session và logout cho Master Admin và Gym Admin.
2. Cookie production phải HttpOnly, Secure, SameSite theo thiết kế; local development vẫn test được.
3. Session có expiry, rotation phù hợp và có thể revoke.
4. Middleware phải ngăn Gym Admin truy cập Master API và ngăn Admin gym A truy cập dữ liệu gym B.
5. Xử lý CSRF phù hợp với cookie auth cho toàn bộ mutation endpoint.
6. Thêm test positive/negative cho login, expiry, logout, CSRF và cross-gym authorization.
7. Giữ tương thích tạm thời với frontend hiện tại nếu thiết kế yêu cầu, nhưng đánh dấu rõ phần legacy cần xóa ở P05.
8. Cập nhật tài liệu/P04; không làm frontend.
```

## 14/09/2026 — P05: Chuyển frontend sang session

```text
Hãy thực hiện P05 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: chuyển Master Admin và Gym Admin frontend sang cơ chế session của P04.

Yêu cầu:
1. Loại bỏ việc giữ/gửi master code hoặc admin code trong mỗi API request.
2. Không lưu password, token hoặc session identifier vào localStorage/sessionStorage.
3. Tích hợp login, logout, trạng thái session hết hạn và thông báo lỗi thân thiện.
4. Giữ nguyên layout và các chức năng quản lý hiện tại ngoài phần xác thực.
5. Xóa đường tương thích legacy chỉ khi backend/frontend mới đã có test đầy đủ.
6. Test login, refresh, logout, hết hạn session, sai password và phân quyền trên cả Master/Gym Admin.
7. Cập nhật tài liệu/P05; không sửa XSS ngoài phần bắt buộc cho login.
```

## 15/09/2026 — P06: Chống XSS cho Dashboard

```text
Hãy thực hiện P06 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md, chỉ tập trung public/dashboard.js và helper dùng trực tiếp bởi Dashboard.

Mục tiêu: loại bỏ stored/reflected XSS nhưng không đổi layout Dashboard.

Yêu cầu:
1. Lập danh sách tất cả innerHTML/insertAdjacentHTML và xác định dữ liệu nào đến từ database/user/API.
2. Dùng textContent và DOM API khi có thể; nếu buộc phải sinh HTML, dùng helper escape được test kỹ.
3. Validate/sanitize URL avatar và ảnh Map; không cho javascript:, data HTML/SVG nguy hiểm hoặc event handler.
4. Thêm regression test với tên thành viên, Map, lỗi API và URL chứa payload XSS.
5. So sánh giao diện trước/sau để bảo đảm không thay layout responsive.
6. Chạy test frontend liên quan, cập nhật P06 và dừng.
```

## 16/09/2026 — P07: Chống XSS cho Gym Admin

```text
Hãy thực hiện P07 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md, chỉ tập trung public/admin.js và phần Gym Admin liên quan.

Áp dụng cùng tiêu chuẩn của P06: thay cách render dữ liệu không tin cậy bằng textContent/DOM API hoặc escape an toàn; validate URL ảnh; không đổi UX ngoài sửa lỗi bảo mật.

Thêm test cho tên thành viên, Map, filter, log card, avatar và error message chứa payload XSS. Kiểm tra thao tác tạo/sửa thành viên và ghi/sửa log vẫn hoạt động. Cập nhật tài liệu/P07 rồi dừng; không làm P08.
```

## 17/09/2026 — P08: Chống XSS cho Master Admin

```text
Hãy thực hiện P08 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md, chỉ tập trung public/master.js và phần Master Admin liên quan.

Áp dụng cùng tiêu chuẩn của P06/P07. Đặc biệt kiểm tra tên gym, season template, Map, preview ảnh, error message và dữ liệu được insert bằng template string. Không làm hỏng tính năng upload/preview ảnh hoặc chỉnh sửa template.

Thêm test XSS phù hợp, chạy regression Master Admin, cập nhật tài liệu/P08 và dừng.
```

## 18/09/2026 — P09: Validation, body limit và rate limiting

```text
Hãy thực hiện P09 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: chống brute-force, request quá lớn và input không hợp lệ.

Yêu cầu:
1. Thêm limit rõ ràng cho JSON body và form/upload.
2. Thêm rate limit chặt cho login/verify theo IP và định danh gym; rate limit hợp lý cho mutation, public API và upload.
3. Chuẩn hóa server-side validation cho ID, tên, slug, URL, điểm, vé, round và các trường cấu hình season.
4. Chuẩn hóa mã lỗi 400/401/403/404/409/413/429.
5. Không để reverse proxy khiến mọi người dùng bị nhận cùng một IP; ghi rõ cấu hình trust proxy cần thiết.
6. Test brute-force, body quá lớn, số âm, NaN, chuỗi quá dài, ID sai và request hợp lệ.
7. Cập nhật tài liệu/P09 và dừng.
```

## 21/09/2026 — P10: Checkpoint Critical

```text
Hãy thực hiện P10 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md. Đây là checkpoint audit, không tự mở rộng hoặc thêm chức năng.

Yêu cầu:
1. Chạy toàn bộ test.
2. Rà lại secret, authentication, authorization, XSS, CSRF, injection, CORS, body limit và rate limiting.
3. Kiểm tra thủ công các luồng Master Admin, Gym Admin, Dashboard và cross-gym access.
4. Cập nhật docs/PRODUCTION-READINESS.md với bằng chứng file/dòng và trạng thái Pass/Fail.
5. Nếu còn Critical, chỉ sửa lỗi nhỏ có nguyên nhân rõ và trong phạm vi thay đổi vừa thực hiện; lỗi lớn phải ghi BLOCKED và đề xuất task riêng.
6. Đưa ra kết luận có được chuyển sang nhóm High hay chưa. Cập nhật P10 và dừng.
```

## 22/09/2026 — P11: Security headers và CSP

```text
Hãy thực hiện P11 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: thêm security headers production mà không làm hỏng giao diện.

Yêu cầu:
1. Cấu hình Helmet hoặc middleware tương đương.
2. Thiết lập CSP tối thiểu quyền, frame-ancestors, nosniff, referrer policy và permissions policy.
3. HSTS chỉ bật đúng trong HTTPS production.
4. Kiểm kê font, ảnh, script, style đang dùng để tránh mở CSP wildcard không cần thiết.
5. Test toàn bộ trang và upload/preview ảnh; ghi lại ngoại lệ CSP nếu bắt buộc.
6. Cập nhật tài liệu/P11 và dừng.
```

## 23/09/2026 — P12: HTTPS, reverse proxy và domain config

```text
Hãy thực hiện P12 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md. Nếu chưa có thông tin server/domain thật, tạo cấu hình mẫu an toàn và danh sách giá trị người dùng phải điền; không tự deploy.

Yêu cầu:
1. Chọn Nginx hoặc Caddy và giải thích ngắn lý do.
2. Tạo cấu hình HTTP redirect sang HTTPS, proxy tới Node chỉ trên localhost, giới hạn request/upload và truyền proxy headers đúng.
3. Cấu hình Express trust proxy và allowlist domain/Host production mà không phá local development.
4. Đảm bảo .env, database, backup, source và Node port không được public.
5. Viết docs/DEPLOYMENT.md gồm TLS, firewall, user chạy service, filesystem permissions và checklist DNS.
6. Không mở port, đổi DNS hay thao tác server thật. Cập nhật P12 và dừng.
```

## 24/09/2026 — P13: Gia cố upload ảnh

```text
Hãy thực hiện P13 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: làm upload Map PNG/JPEG an toàn hơn trong khi giữ UX hiện tại.

Yêu cầu:
1. Giữ giới hạn 5 MB hoặc đề xuất mức mới có lý do.
2. Decode và encode lại ảnh bằng thư viện phù hợp; xóa metadata.
3. Giới hạn width, height và tổng pixel để chống decompression/image bomb.
4. Tên file server-generated; không tin filename/MIME từ client; chỉ phục vụ content type cố định.
5. Thiết kế quota và dọn ảnh orphan an toàn, không xóa nhầm ảnh đang được dùng.
6. Test file giả đuôi, magic bytes sai, ảnh quá lớn, ảnh hợp lệ và sửa template.
7. Cập nhật tài liệu/P13 và dừng.
```

## 25/09/2026 — P14: Error handling và privacy

```text
Hãy thực hiện P14 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: không lộ thông tin hệ thống và kiểm soát dữ liệu public.

Yêu cầu:
1. Thêm 404 và centralized error middleware.
2. Production không trả stack trace, SQL error, filesystem path hoặc secret; development vẫn đủ thông tin debug.
3. Chuẩn hóa error response và request/correlation ID.
4. Audit public API xem tên thành viên, avatar, lịch sử, điểm và thông tin gym nào thực sự cần public; chỉ báo cáo nếu thay đổi quyền hiển thị cần quyết định sản phẩm.
5. Tạo trang 404/500 thân thiện nếu phù hợp kiến trúc hiện tại.
6. Test lỗi route, validation, database và lỗi bất ngờ. Cập nhật P14 và dừng.
```

## 28/09/2026 — P15: Checkpoint High

```text
Hãy thực hiện P15 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Chạy toàn bộ test và audit lại toàn bộ Critical + High: authentication, XSS, CSRF, injection, rate limit, HTTPS config, headers, upload và error disclosure. Kiểm tra CSP trên các trang thực tế. Cập nhật docs/PRODUCTION-READINESS.md với bằng chứng và kết luận có đủ điều kiện đưa lên staging public có bảo vệ hay chưa.

Không tự triển khai server. Nếu còn lỗi lớn, tạo danh sách task sửa nhỏ theo đúng phụ thuộc. Cập nhật P15 và dừng.
```

## 29/09/2026 — P16: Migration framework

```text
Hãy thực hiện P16 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md. Đây là task nặng; không kết hợp tối ưu query hoặc backup ngoài phần interface bắt buộc.

Mục tiêu: thay việc coi db/schema.sql là migration production bằng migration có version.

Yêu cầu:
1. Thiết kế bảng/version migration và runner idempotent.
2. Chuyển schema hiện tại sang baseline mà không chạy lại phá dữ liệu đã tồn tại.
3. Migration dùng transaction khi SQLite cho phép, fail rõ ràng và không đánh dấu thành công khi chạy dở.
4. Có dry-run/preflight phù hợp và hook yêu cầu backup trước migration production.
5. Test database trắng, database hiện tại, chạy lặp và migration lỗi giữa chừng.
6. Viết hướng dẫn tạo migration mới và rollback/forward-fix.
7. Cập nhật P16 và dừng.
```

## 30/09/2026 — P17: Backup và restore

```text
Hãy thực hiện P17 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: có quy trình backup SQLite có thể phục hồi thật.

Yêu cầu:
1. Tạo script backup dùng API/cơ chế an toàn với WAL, không copy file database đang ghi một cách thiếu nhất quán.
2. Backup ra thư mục cấu hình ngoài web root, tên có timestamp, retention rõ ràng và không commit.
3. Tạo quy trình restore vào đường dẫn mới; không ghi đè database hiện tại mặc định.
4. Thực hiện restore thử bằng dữ liệu test, chạy integrity check và bộ smoke test trên bản restore.
5. Viết docs/BACKUP-RESTORE.md gồm lịch chạy, lưu off-server, mã hóa, RPO/RTO và kiểm tra định kỳ.
6. Không động vào database thật. Cập nhật P17 và dừng.
```

## 01/10/2026 — P18: SQLite concurrency và index

```text
Hãy thực hiện P18 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: giảm lỗi database locked và tối ưu các query chính dựa trên bằng chứng.

Yêu cầu:
1. Kiểm tra WAL, foreign_keys, busy_timeout và transaction hiện tại; bổ sung cấu hình an toàn còn thiếu.
2. Dùng EXPLAIN QUERY PLAN cho Dashboard overview, leaderboard, history filter và admin log management.
3. Chỉ thêm composite index chứng minh được lợi ích; ghi chi phí write/storage.
4. Test concurrent reads/writes và nhiều request ghi log; không hứa hỗ trợ nhiều Node instance nếu chưa chứng minh.
5. Ghi rõ ngưỡng khi nên chuyển sang PostgreSQL.
6. Chạy performance/regression test, cập nhật P18 và dừng.
```

## 02/10/2026 — P19: Dependency audit

```text
Hãy thực hiện P19 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: xác nhận dependency production không có lỗ hổng đã biết ở mức chặn deploy.

Yêu cầu:
1. Chạy npm audit --omit=dev và kiểm tra package outdated bằng registry chính thức.
2. Phân loại từng advisory theo khả năng ảnh hưởng thực tế; không chỉ sao chép output.
3. Không chạy npm audit fix --force.
4. Nếu cần nâng cấp, chia theo nhóm nhỏ, giữ package-lock và chạy test sau từng nhóm.
5. Ghi phiên bản Node/npm production được hỗ trợ và đề xuất lịch cập nhật định kỳ.
6. Cập nhật tài liệu/P19 và dừng.
```

## 05/10/2026 — P20: Logging, monitoring và health check

```text
Hãy thực hiện P20 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: production có thể phát hiện và điều tra lỗi mà không lộ dữ liệu nhạy cảm.

Yêu cầu:
1. Thêm structured logging theo environment và request ID.
2. Redact password, cookie, authorization header, admin code, token và dữ liệu nhạy cảm.
3. Thêm /health cho process và /ready kiểm tra khả năng truy cập database, không trả thông tin nội bộ.
4. Hỗ trợ graceful shutdown để hoàn tất request/database operation đang chạy.
5. Viết hướng dẫn tích hợp Sentry hoặc hệ thống tương đương và cảnh báo disk/backup/error rate.
6. Test log redaction, health/readiness và shutdown. Cập nhật P20 và dừng.
```

## 06/10/2026 — P21: CI/CD và rollback

```text
Hãy thực hiện P21 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md. Nếu chưa biết nhà cung cấp server, tạo pipeline và runbook trung lập hoặc phù hợp repository hiện tại; không tự deploy.

Mục tiêu: release lặp lại được và rollback được.

Yêu cầu:
1. Pipeline tối thiểu: clean install, test, dependency/security checks, package/build, backup gate, migration, deploy, readiness check.
2. Secret chỉ lấy từ secret store; không ghi vào YAML/log/artifact.
3. Release có version và artifact bất biến.
4. Viết rollback code và xử lý migration không backward-compatible.
5. Ngăn hai tiến trình migration chạy đồng thời.
6. Tạo docs/RELEASE-RUNBOOK.md và hướng dẫn rollback khẩn cấp.
7. Không kết nối/deploy production. Cập nhật P21 và dừng.
```

## 07/10/2026 — P22: E2E authentication và security regression

```text
Hãy thực hiện P22 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: tự động hóa các luồng bảo mật quan trọng nhất.

Yêu cầu:
1. Viết E2E cho Master login/logout/session expiry.
2. Viết E2E cho Gym Admin và cross-gym isolation.
3. Test CSRF, XSS payload, brute-force/rate limit, upload giả và error disclosure.
4. Test user public không truy cập được mutation/admin endpoint.
5. Test không được phụ thuộc dữ liệu production và phải dọn dữ liệu test an toàn.
6. Chạy suite mới cùng toàn bộ regression test, cập nhật P22 và dừng.
```

## 08/10/2026 — P23: Load test, responsive và browser QA

```text
Hãy thực hiện P23 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md.

Mục tiêu: tìm giới hạn vận hành và lỗi giao diện trước staging rehearsal.

Yêu cầu:
1. Tạo load test có kiểm soát cho Dashboard read, history filter và concurrent log writes; chỉ chạy trên local/test database.
2. Báo latency p50/p95/p99, error rate, database locked và mức concurrent an toàn; không tối ưu mù nếu chưa có số liệu.
3. QA responsive các breakpoint mobile phổ biến, tablet và desktop, đặc biệt leaderboard/overview/admin log.
4. Kiểm tra Chrome, Edge, Firefox và ghi checklist Safari nếu môi trường không có Safari.
5. Kiểm tra broken link, favicon, meta cơ bản, 404/500, overflow và accessibility cơ bản.
6. Chỉ sửa bug nhỏ rõ ràng; bug lớn đưa thành task riêng. Cập nhật P23 và dừng.
```

## 09/10/2026 — P24: Staging rehearsal và quyết định go-live

```text
Hãy thực hiện P24 trong docs/PRODUCTION-GO-LIVE-PROMPTS.md. Đây là lần tổng duyệt cuối; không deploy production nếu chưa có lệnh rõ ràng của người dùng.

Yêu cầu:
1. Triển khai hoặc mô phỏng đầy đủ quy trình trên staging/test environment theo docs/DEPLOYMENT.md và RELEASE-RUNBOOK.md.
2. Backup trước migration, chạy migration, khởi động release, health/readiness check và smoke/E2E test.
3. Thực hiện một lần rollback diễn tập và một lần restore backup vào database riêng.
4. Kiểm tra HTTPS redirect, TLS, headers, CSP, cookie, firewall/port, file permissions và secret injection.
5. Chạy toàn bộ test và tổng hợp mọi vấn đề còn mở theo Critical/High/Medium/Low.
6. Cập nhật docs/PRODUCTION-READINESS.md và đưa ra đúng một kết luận: GO, CONDITIONAL GO hoặc NO-GO, kèm lý do và điều kiện còn lại.
7. Cập nhật P24. Dừng và chờ người dùng phê duyệt trước mọi thao tác production/domain thật.
```

## Tiêu chí GO cuối cùng

- Không còn Critical hoặc High chưa xử lý.
- Toàn bộ test và security regression Pass.
- Authentication/session/authorization đã được kiểm tra cross-gym.
- HTTPS, security headers và CSP hoạt động trên staging.
- Backup đã restore thử thành công.
- Migration và rollback đã diễn tập.
- Không có secret trong source, Git history hoặc artifact.
- Có monitoring, health check và người chịu trách nhiệm nhận cảnh báo.
- Load test chứng minh tải dự kiến nằm trong giới hạn an toàn.
- Người dùng phê duyệt rõ ràng trước khi deploy production và gắn domain thật.




