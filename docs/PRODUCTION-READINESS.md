# Production Readiness

Ngày baseline: 04/09/2026  
Múi giờ: Asia/Bangkok  
Phạm vi hiện tại: P24 — tổng duyệt cuối trên fixture local, ngày 09/09/2026.  
Kết luận hiện tại: **NO-GO / P24 BLOCKED**. Full regression **240 PASS / 9 FAIL / 0 skip** (5 lỗi gốc + 4 parent). Rehearsal local 58 checks PASS; restore smoke 52 PASS; audit dependency 0 advisory. C-01 còn plaintext, H-05/P22 chưa xanh, privacy và các gate hạ tầng/release/backup vận hành còn mở. Xem [P24 checkpoint](P24-CHECKPOINT.md), [kết quả và digest bằng chứng](P24-RESULTS.json) và mục P24 cuối tài liệu. Không deploy production/domain thật; chờ lệnh rõ ràng của người dùng. Các phần P00–P23 bên dưới là lịch sử, kể cả mô tả code/trạng thái đã thay đổi; không thay thế kết luận P24.

## 1. Phạm vi và trạng thái repository

- Git: repository chưa có commit (`No commits yet on master`); toàn bộ source/tài liệu hiện là untracked. Vì chưa có commit gốc nên chưa thể so sánh regression bằng commit SHA.
- P01 đã thêm `.gitignore` cho dependency, local env, SQLite/WAL/SHM, log, backup, coverage, upload, season snapshot và file tạm; `.env.example` cùng các file `.gitkeep` vẫn được phép commit (`.gitignore:1-56`).
- Không thấy `AGENTS.md` ở root.
- Không thay đổi source/config/runtime trong P00. Hai file tài liệu được tạo/cập nhật là `docs/PRODUCTION-READINESS.md` và `docs/PRODUCTION-GO-LIVE-PROMPTS.md`.

### Cấu trúc code

| Khu vực | Vai trò | Bằng chứng |
|---|---|---|
| `server.js` | Tạo Express app, static files, mount Master/Gym Admin/Public routes, mở server khi chạy trực tiếp | `server.js:1-50` |
| `db/` | Mở SQLite, bật WAL và áp schema idempotent lúc khởi động | `db/index.js:1-13`; `db/schema.sql:1-108` |
| `engine/` | Luật round, vé, điểm tổng và create/edit/delete entry | `engine/index.js:7-285` |
| `routes/` | API Master Admin, Gym Admin, public dashboard và helper snapshot/slug | `routes/master.js:1-350`; `routes/gym-admin.js:1-216`; `routes/gym-public.js:1-244`; `routes/helpers.js:1-54` |
| `public/` | UI vanilla HTML/CSS/JS, không có build step | `public/dashboard.js:1-311`; `public/admin.js:1-399`; `public/master.js:1-469` |
| `test/` | Ba script test Node tự đếm pass/fail, không dùng test framework | `test/engine-test.js:1-222`; `test/master-routes-smoke-test.js:1-398`; `test/frontend-ux-test.js:1-177` |
| `season-configs/` | Snapshot JSON được ghi khi tạo/sửa Season Template | `routes/helpers.js:21-47` |

### Package scripts và runtime

| Script | Lệnh | Trạng thái baseline |
|---|---|---|
| `npm start` | `node server.js` | Chưa chạy trong P00 vì dependency native chưa cài được; mặc định port 3000 và DB `db/gvg.db` (`package.json:7`; `server.js:40-47`). |
| `npm test` | Chạy tuần tự engine → HTTP smoke → frontend UX bằng `&&` | Exit code 1 trước test đầu do thiếu `better-sqlite3` (`package.json:8`). |

Dependencies khai báo: `better-sqlite3 ^13.0.3`, `dotenv ^17.4.2`, `express ^5.2.1` (`package.json:13-16`). Không khai báo `engines`, lint, coverage, audit, build, migration, backup hay E2E script.

## 2. Database baseline

SQLite schema hiện có 10 bảng và 4 index:

| Nhóm | Bảng/index | Bằng chứng |
|---|---|---|
| Season template | `season_templates`, `season_template_maps`, `season_template_rounds` | `db/schema.sql:3-33` |
| Tenant và season | `gyms`, `gym_seasons` | `db/schema.sql:35-51` |
| Tiến độ | `gym_round_map_progress`, `gym_round_status` | `db/schema.sql:53-68` |
| Thành viên và log | `members`, `entries` | `db/schema.sql:70-91` |
| Yêu cầu tạo gym | `gym_requests` | `db/schema.sql:93-103` |
| Index | Theo `gym_season_id` trên entries/progress/status/members | `db/schema.sql:105-108` |

Đặc điểm cần giữ hoặc kiểm soát khi migration:

- Schema được `db.exec()` mỗi lần mở database và dùng `CREATE ... IF NOT EXISTS`; chưa có versioned migration (`db/index.js:5-10`).
- WAL được bật (`db/index.js:7`); chưa thấy `foreign_keys = ON` hoặc `busy_timeout`.
- `gyms.slug`, `gyms.admin_code` là unique; mã admin đang lưu plaintext (`db/schema.sql:35-43`).
- Member unique theo `(gym_season_id, name)`; progress/status unique theo season/round/map tương ứng (`db/schema.sql:53-79`).
- Các quan hệ có khai báo `REFERENCES`, nhưng hiệu lực enforcement cần kiểm chứng sau khi bật `foreign_keys`.

## 3. Kết quả test baseline

### Kết quả chính xác

| Lệnh/suite | Khai báo | Pass | Fail | Không chạy | Kết quả |
|---|---:|---:|---:|---:|---|
| `npm test` | 117 checks | 0 | 0 | 117 | **Infrastructure failure**, exit 1 trước check đầu: `MODULE_NOT_FOUND: better-sqlite3`. Do chuỗi dùng `&&`, hai suite sau không được gọi. |
| `node test/frontend-ux-test.js` | 39 checks | **39** | **0** | 0 | PASS, exit 0. |
| `node test/engine-test.js` | 32 checks | 0 | 0 | **32** | Không thực thi do `better-sqlite3` không khả dụng. |
| `node test/master-routes-smoke-test.js` | 46 checks | 0 | 0 | **46** | Không thực thi do `better-sqlite3` không khả dụng. |
| **Tổng assertions thực sự đã chạy trong P00** | **117 checks đã khai báo** | **39** | **0** | **78** | Toàn bộ suite **chưa đạt** vì 78 checks chưa chạy. |

Số check được xác định từ các lời gọi `check(...)` và bộ đếm/tổng kết của từng script: `test/engine-test.js:7-16,218-222`; `test/master-routes-smoke-test.js:14-23,377-392`; `test/frontend-ux-test.js:9-20,174-177`.

### Blocker môi trường

1. Runtime được dùng: Node `v24.19.0`, npm `11.17.0`.
2. Lần `npm ci` đầu thất bại vì `node-gyp` không tìm thấy Python.
3. Khi trỏ tới Python 3.12.14 đóng gói cùng Codex, `better-sqlite3@13.0.3` vẫn phải build native và thất bại vì không tìm thấy Visual Studio C++ Build Tools.
4. Thư mục `node_modules` dở dang không còn tồn tại sau cleanup của npm; source và lockfile không bị chỉnh sửa.

Tiêu chí gỡ blocker: dùng Node version được dự án chốt và có prebuilt binary tương thích, hoặc cài toolchain native Windows phù hợp; sau đó `npm ci` và `npm test` phải exit 0 với đủ **117/117 PASS, 0 FAIL, 0 không chạy** (hoặc cập nhật con số có giải thích nếu test suite được thay đổi có chủ đích).

## 4. Route/API baseline

### Trang và static route

| Method/path | Hành vi phải giữ |
|---|---|
| `GET /` và static assets | `express.static(public)` phục vụ `index.html`, JS, CSS, icon và upload (`server.js:17-18`). |
| `GET /master` | Trả `public/master.html` trước khi mount Master router; thứ tự này bắt buộc để middleware auth không chặn HTML (`server.js:20-28`). |
| `GET /g/:slug/admin` | Redirect 302 sang `/g/:slug#admin` (`server.js:30-32`). |
| `GET /g/:slug` | Trả `public/dashboard.html` nếu không bị public router xử lý trước (`server.js:34-35`). |

### Master Admin — base `/master`, header hiện tại `x-master-admin-code`

| Method/path | Hành vi/response quan trọng |
|---|---|
| `POST /map-images` | Raw PNG/JPEG tối đa 5 MB; kiểm tra magic bytes khớp Content-Type; tên file server-generated; trả `{ok,image_url}` (`routes/master.js:27-60`). |
| `GET /verify` | Đúng mã trả `{ok:true}`, sai mã trả 403 (`routes/master.js:20-24,70-72`). |
| `GET /season-templates` | Danh sách template kèm `gym_count` (`routes/master.js:76-85`). |
| `GET /season-templates/:id` | Trả `{season,maps,rounds}`; 404 nếu không tồn tại (`routes/master.js:88-95`). |
| `POST /season-templates` | Validate payload, tạo atomically, snapshot JSON, trả ID + tên snapshot (`routes/master.js:104-172`). |
| `PATCH /season-templates/:id` | Update template; update map theo ID/append map mới, không xóa map; thay rounds; recompute active gyms; xuất snapshot (`routes/master.js:175-240`). |
| `PATCH /season-templates/:id/activate` | Chỉ một template active; 404 nếu không tồn tại (`routes/master.js:243-250`). |
| `GET /gyms` | Mặc định bỏ soft-deleted; `include_deleted=1` trả cả gym đã xóa (`routes/master.js:255-261`). |
| `GET /gyms/check-slug?slug=` | Chuẩn hóa slug và giữ chỗ slug của gym soft-deleted (`routes/master.js:264-269`). |
| `POST /gyms` | Cần template active; tạo gym + gym season trong transaction, sinh mã nếu thiếu, khởi tạo Round 1; trả URL và `admin_code` (`routes/master.js:271-309`). |
| `PATCH /gyms/:id/slug` | Chuẩn hóa/đổi slug; 400 invalid, 404 missing, 409 conflict (`routes/master.js:312-323`). |
| `PATCH /gyms/:id/delete` | Soft-delete qua `deleted_at`, không xóa dữ liệu (`routes/master.js:326-331`). |
| `PATCH /gyms/:id/restore` | Bỏ `deleted_at` (`routes/master.js:334-339`). |
| `GET /gym-requests?status=` | Danh sách request theo status; hiện chỉ read-only stub (`routes/master.js:342-347`). |

### Gym Admin — base `/g/:slug/admin`, header hiện tại `x-admin-code`

Mọi route resolve gym chưa soft-delete theo slug và so mã với đúng gym (`routes/gym-admin.js:12-31`).

| Method/path | Hành vi/response quan trọng |
|---|---|
| `GET /verify` | Đúng mã trả `{ok:true}`, sai mã trả 403 (`routes/gym-admin.js:25-33`). |
| `GET /members` | Member của active gym season, sort theo tên; không có season trả `[]` (`routes/gym-admin.js:37-42`). |
| `POST /members/bulk` | Trim tên, bỏ record rỗng, `INSERT OR IGNORE`; trả số created (`routes/gym-admin.js:44-62`). |
| `PATCH /members/:id` | Chỉ member trong active season của gym; đổi tên/avatar; 404 hoặc 400 duplicate (`routes/gym-admin.js:64-76`). |
| `PATCH /members/:id/ban` | Chỉ member tenant/season hiện tại; cập nhật `is_banned` và `banned_at` (`routes/gym-admin.js:78-86`). |
| `GET /entries` | Tối đa 300 entry active season, mới nhất trước, kèm member/map metadata (`routes/gym-admin.js:90-103`). |
| `POST /entries` | Server tự chọn active round; trả `{ok,entry_id,round_number,trace}`; invalid business rule trả 400 (`routes/gym-admin.js:105-138`). |
| `PATCH /entries/:id` | Chỉ entry active season của tenant; sửa vé/điểm rồi recompute chain (`routes/gym-admin.js:140-157`). |
| `DELETE /entries/:id` | Chỉ entry active season của tenant; xóa rồi recompute chain (`routes/gym-admin.js:159-170`). |
| `GET /season-switch/preview` | Báo có season global mới và roster không bị ban để copy (`routes/gym-admin.js:175-188`). |
| `POST /season-switch` | Đóng season cũ, tạo active season mới và copy roster được chọn trong transaction, khởi tạo Round 1 (`routes/gym-admin.js:190-213`). |

### Public — base `/g/:slug`, không auth

Gym không tồn tại hoặc đã soft-delete trả 404 trước mọi API public (`routes/gym-public.js:6-13`).

| Method/path | Hành vi/response quan trọng |
|---|---|
| `GET /state` | State active season; nếu chưa có season trả gym + các collection rỗng; có season trả round/map/member/ticket/summary (`routes/gym-public.js:84-97`). |
| `GET /seasons` | Archive các season của gym, mới nhất trước, kèm combined score (`routes/gym-public.js:99-115`). |
| `GET /seasons/:id/state` | Chỉ season thuộc đúng gym; sai tenant/missing trả 404 (`routes/gym-public.js:117-125`). |
| `GET /overview` | Ma trận Member × Map và tickets theo Round × Map; sort member theo điểm giảm dần rồi tên (`routes/gym-public.js:127-188`). |
| `GET /leaderboard` | Banned xuống cuối; sort điểm giảm dần rồi tên; trả vé cấp/dùng/còn/tương lai và trung bình điểm/vé (`routes/gym-public.js:190-221`). |
| `GET /log` | Tối đa 300 entry active season, mới nhất trước, có IDs phục vụ filter và metadata member/map (`routes/gym-public.js:223-242`). |

## 5. Regression behavior baseline

Những invariant sau phải có regression test trước/sau các thay đổi production:

- Round đầu tiên của gym/season mới trở thành `active`; chỉ một round chưa hoàn tất đầu tiên là active, round sau là pending; một round chỉ complete khi mọi map đạt trần (`engine/index.js:23-68`; `routes/master.js:289-298`; `routes/gym-admin.js:197-213`).
- Round vượt `last_defined_round_number` dùng `repeat_max_score` nếu có; nếu không thì hết nội dung (`engine/index.js:7-21`).
- Vé được cấp từ thời điểm battle start: day 1 + daily amount × số ngày elapsed, cap bởi `ticket_regen_days`; vé còn lại = cấp − đã dùng (`engine/index.js:71-90`).
- Entry mới chỉ được ghi vào active round; vé phải là integer 1–3, điểm là integer dương, member phải tồn tại/chưa bị ban, không vượt vé còn lại hoặc max score (`engine/index.js:115-197`).
- Sửa/xóa entry lịch sử được phép và phải cập nhật progress rồi recompute/cascade reopen round (`engine/index.js:199-270`).
- Combined score bằng tổng progress trừ toàn bộ điểm của member bị ban (`engine/index.js:92-107`).
- Public/Admin data phải tiếp tục được cô lập theo gym slug và active `gym_season_id`; season archive lookup phải kiểm tra `gym_id` (`routes/gym-admin.js:12-21,64-66,140-142,159-162`; `routes/gym-public.js:117-124`).
- Soft-delete gym làm public state trả 404; restore làm public state hoạt động lại. Đây là contract đã có smoke check (`test/master-routes-smoke-test.js:330-352`).
- Master `/master` vẫn tải HTML không auth ở request trang, còn mọi API `/master/*` vẫn qua auth; không đảo thứ tự mount (`server.js:20-28`).
- Dashboard tự refresh state mỗi 15 giây; tab admin dùng hash `#admin` (`public/dashboard.js:305-310`).
- UI contract hiện tại: đúng 18 Pokémon types; local SVG; map upload PNG/JPEG; dashboard có leaderboard, public log filters, score/ticket overview và mobile 4-map grid (`test/frontend-ux-test.js:34-172`).
- Authentication migration sau này phải bảo toàn khả năng login/logout tương đương nhưng không được bảo toàn cơ chế truyền mã plaintext qua header; đó là lỗ hổng cần thay thế, không phải contract tương thích lâu dài.

## 6. Checklist production readiness

Quy ước trạng thái: `PASS` đã có bằng chứng hiện tại; `PARTIAL` có một phần kiểm soát nhưng chưa đủ; `OPEN` chưa đạt; `BLOCKED` có điều kiện chặn chưa xử lý; `FAIL` kiểm soát/test chưa đạt trong audit hiện tại.

### Critical

| ID | Kiểm soát | Hiện tại | Bằng chứng | Tiêu chí go-live |
|---|---|---|---|---|
| C-01 | Authentication an toàn cho Master/Gym | **PARTIAL (P24.1a); scrub OPEN** | **Dừng ghi plaintext mới: DONE** — create gym lưu Argon2id vào `auth_principals.password_hash`, `gyms.admin_code` chỉ chứa tombstone random độc lập; toàn bộ writes và khởi tạo round atomic. **Scrub dữ liệu cũ: OPEN**, chưa thao tác DB cũ. | P24.1a DONE; P24.1b xử lý scrub riêng. Xem bằng chứng P24.1a cuối tài liệu; C-01 chưa đóng toàn bộ. |
| C-02 | Authorization và tenant isolation | **PASS local (P15)** | Role/tenant/session negative tests và browser cross-gym PASS; `auth/backend.js:92`. | Duy trì regression, xác minh staging sau khi được phép. |
| C-03 | XSS/output encoding và URL safety | **PASS security; P22 DONE (09/09)** | P22 riêng và trong regression đều 12 PASS/0 FAIL/0 skip; stored-XSS đi hết Gym/Dashboard/Master, không còn timeout hoặc parent P22 fail. | H-05 còn FAIL; không coi visual/workflow failure là XSS thực thi. Xem [P22 checkpoint](P22-CHECKPOINT.md). |
| C-04 | CSRF và brute-force/rate limiting | **PASS local có giới hạn (P15)** | Origin/token, SQLite credential limiter và HTTP quota tests PASS; `auth/backend.js:89`, `security/request-limits.js:25`. | Một process, xác minh proxy/NAT/load thật sau. |
| C-05 | SQL injection | **PASS source + local tests (P15)** | Placeholder/binding routes/auth/engine; validation tests PASS; `security/validation.js:10`. | Duy trì prepared statements; không coi là pentest độc lập. |
| C-06 | Secret/Git hygiene | **PASS scan P15 (P15)** | 96 working files + 157 blobs/10 refs; 62 match đều test fixture; không phát hiện secret thật trong phạm vi mẫu quét. | Không bao gồm DB/secret store; C-01 vẫn FAIL. |

### High

| ID | Kiểm soát | Hiện tại | Bằng chứng | Tiêu chí go-live |
|---|---|---|---|---|
| H-01 | HTTPS, proxy, security headers và CSP | **PARTIAL / staging BLOCKED (P15)** | Deployment/CSP tests PASS; thiếu staging access gate và bằng chứng hạ tầng thật; early Host 400 thiếu headers. | P15-S1/H1/R1; xem CSP và giới hạn P15. |
| H-02 | Upload ảnh Map | **PASS local cho upload mới (P15)** | Sharp/quota/byte/pixel/type tests và browser upload-template PASS; `security/map-images.js:14`. | Ảnh legacy/cleanup/resource monitoring còn giới hạn như P13. |
| H-03 | Error handling và disclosure | **PASS local (P15)** | 4 error tests PASS; SQL/stack/path được che, request ID; `security/errors.js:16`. | Lỗi edge/service chưa xác minh. |
| H-04 | Backup/restore và versioned migration | **OPEN / dữ liệu thật BLOCKED (P15)** | Auth có backup API; boot schema chưa versioned, chưa restore drill tổng thể; `db/index.js:5`, `auth/migrate.js:26`. | C1a rehearsal auth; P16/P17 cho tổng thể trước dữ liệu thật. |
| H-05 | Full regression suite | **FAIL / BLOCKED; P22 đã đóng (09/09)** | Đủ 20 file, 16 xanh; 243 PASS/8 FAIL/0 skip/0 cancelled, exit 1. 5 lỗi gốc + 3 parent; giảm 9 → 8 FAIL so với P24. | Auth startup, Gym workflow, visual Gym/Dashboard/Master còn mở; Gym visual ngoài 5 lỗi baseline P24, các vị trí mismatch mới ghi riêng tại [P22 checkpoint](P22-CHECKPOINT.md). Baseline tái lập và gate không skip vẫn cần xử lý. |
| H-06 | Public-data privacy | **OPEN / dữ liệu thật BLOCKED (P15)** | Public state/overview/log/archive theo slug, SELECT * member + spread; `routes/gym-public.js:54`. | P15-D1 quyết định audience/allowlist/retention; S1 gate mọi route. |

### Medium

| ID | Kiểm soát | Hiện tại | Bằng chứng | Tiêu chí go-live |
|---|---|---|---|---|
| M-01 | SQLite integrity/concurrency | **PARTIAL** | WAL bật; chưa thấy foreign keys/busy timeout; index chỉ theo `gym_season_id` (`db/index.js:5-10`; `db/schema.sql:105-108`). | `foreign_keys`, `busy_timeout`, transaction/concurrency tests; query plan chứng minh index cho read/write chính; nêu ngưỡng chuyển PostgreSQL. |
| M-02 | Validation và body limits | **PASS (P10 local)** | JSON 128 KiB/auth 8 KiB, reject compressed JSON/form (`server.js:22`, `server.js:34`); raw 5 MiB (`routes/master.js:26`); validation type/range/ID/URL (`security/validation.js:1`). `test/request-security-test.js:39`, `test/request-security-test.js:87` PASS. | Giữ limits ở app; proxy limits và kiểm thử staging thuộc P12. |
| M-03 | Logging, health/readiness, graceful shutdown | **PASS local (P20)** | `security/observability.js`, `security/lifecycle.js`, `server.js`; 80 checks PASS, xem [P20 checkpoint](P20-CHECKPOINT.md). | Collector/alert ownership/delivery, proxy effective config và SIGTERM Linux thật cần xác minh staging theo [OBSERVABILITY.md](OBSERVABILITY.md); không thay NO-GO P15. |
| M-04 | CI/CD, immutable release và rollback | **OPEN** | Chỉ có start/test scripts; không thấy pipeline/runbook (`package.json:6-9`). | Clean install/test/security/package/deploy/readiness pipeline; immutable artifact; migration lock; rollback rehearsal pass. |
| M-05 | Dependency/runtime policy | **PARTIAL (P19)** | [P19 checkpoint](P19-CHECKPOINT.md): qs 6.16.0, audit production 0 advisory; 72 checks PASS; Node 24.19.0/npm 11.17.0 và lịch update đã chốt; package engines có sẵn. | Gate advisory PASS local; còn clean install/native smoke trên CI/staging đích P21/P24. |

### Low

| ID | Kiểm soát | Hiện tại | Bằng chứng | Tiêu chí go-live |
|---|---|---|---|---|
| L-01 | Browser/responsive/accessibility QA | **PARTIAL** | 39 frontend source-contract checks pass, gồm mobile layout; chưa có browser E2E/manual matrix (`test/frontend-ux-test.js:26-177`). | Chrome/Edge/Firefox pass; Safari checklist; keyboard/focus/contrast/overflow/broken-link checks có bằng chứng. |
| L-02 | Project metadata và developer gates | **OPEN** | `description`, `author` rỗng; không lint/format/coverage scripts (`package.json:1-12`). | Metadata/runbook owner rõ; lint/format/coverage thresholds hoặc quyết định miễn trừ được ghi nhận. |
| L-03 | Static/runtime artifact lifecycle | **OPEN** | Snapshot và upload được ghi local; chưa có retention/quota/cleanup policy (`routes/helpers.js:21-47`; `routes/master.js:27-60`). | Storage ngoài web root khi phù hợp; backup/retention/quota/orphan cleanup an toàn, không xóa file đang dùng. |

## 7. Tiêu chí quyết định go-live

Chỉ kết luận `GO` khi đồng thời đáp ứng:

- Không còn mục Critical hoặc High ở trạng thái `OPEN`, `PARTIAL` hoặc `BLOCKED`.
- Clean install tái lập được trên runtime production đã chốt; toàn bộ unit/integration/frontend/security/E2E pass.
- Authentication/session/authorization và cross-gym isolation đã được kiểm tra cả positive và negative.
- HTTPS, proxy, security headers, CSP, cookie và request limits hoạt động trên staging.
- Secret scan sạch; runtime data/config không nằm trong Git/artifact.
- Migration, backup restore và rollback đều đã rehearsal thành công trên staging/test data.
- Health/readiness, redacted logging, monitoring và người nhận cảnh báo đã sẵn sàng.
- Load test chứng minh mức tải dự kiến nằm trong giới hạn an toàn; browser/responsive QA hoàn tất.
- Có phê duyệt rõ ràng của người dùng trước deploy production/domain thật.

Trạng thái sau P01: **NO-GO**. P01 hoàn tất Git hygiene/secret baseline nhưng không sửa các vấn đề ứng dụng thuộc những task sau.

## 8. P01 — Git hygiene và secret scan

Ngày thực hiện: 04/09/2026. Phạm vi chỉ gồm ignore/config mẫu/tài liệu; không thay đổi runtime behavior.

### Git và dữ liệu runtime

- `HEAD` vẫn chưa có commit (`No commits yet on master`), nên không có commit history/reflog của người dùng để chứa secret đã commit.
- Git có hai ref nội bộ Codex trỏ trực tiếp tới tree snapshot, không phải commit. Cả hai tree đã được liệt kê và quét cùng working tree.
- Trước khi sửa, chỉ có `public/uploads/map-images/.gitkeep` trong các nhóm DB/WAL/SHM/log/backup/coverage/temp/upload; không phát hiện database hay file dữ liệu runtime thực tế.
- Không có `.env` thật, private-key/certificate file hoặc file mang tên credentials/secret; chỉ có `.env.example`.
- Không xóa file, không rotate credential và không chạy thao tác rewrite Git history.

### Phạm vi quét và kết quả

Quét theo các nhóm: private-key marker; AWS/GitHub/Google/Slack/Stripe token; JWT-like token; credentialed PostgreSQL/MySQL/MongoDB/Redis URI; literal credential assignment; environment fallback; email-like PII. Output quét chỉ chứa scope, file, dòng và loại match, không in giá trị.

| Scope | Kết quả |
|---|---|
| Working tree | Không phát hiện secret hoặc dữ liệu thật có độ tin cậy cao. Có một insecure environment fallback đã biết tại `routes/master.js:9`. |
| Git commit history | Không có commit để quét. |
| Git internal tree refs | Không phát hiện secret thật. Cùng fallback tại `routes/master.js:9` xuất hiện trong cả hai snapshot. |
| `.env.example` | Chỉ chứa safe example/placeholder cho `PORT`, `DB_PATH`, `MASTER_ADMIN_CODE` (`.env.example:1-4`). |

Fallback Master Admin là chuỗi công khai trong source, do đó không được coi là bí mật cần che/rotate; nó vẫn là Critical C-01 và phải bị loại ở P03 theo kế hoạch. Nếu có deployment từng dùng chính fallback này, phải coi credential đó là compromised và thay ngay trong secret store/deployment config.

Literal credential scan còn thấy đúng một giá trị test-only trong `test/master-routes-smoke-test.js:15` và placeholder trong `.env.example:4`; cả hai được phân loại là fixture/placeholder, không phải credential thật. Không có match nào cần review hoặc rotate tại P01.

### Ignore contract

Các đường dẫn đại diện phải bị ignore: `.env`, `.env.production`, `node_modules/`, `db/gvg.db`, `db/gvg.db-wal`, `db/gvg.db-shm`, `logs/app.log`, `backup/gvg.db`, `coverage/`, runtime files trong `public/uploads/`, JSON sinh trong `season-configs/`, `tmp/` và `*.tmp`. Các file `.env.example`, `public/uploads/map-images/.gitkeep`, `season-configs/.gitkeep`, source, schema, docs, package manifest và lockfile phải tiếp tục track được.

### Tiêu chí duy trì

- Chạy secret scan ở pre-commit/CI và trước khi tạo release artifact.
- Không commit `.env`, SQLite database/sidecar, upload runtime, log, backup, coverage hay temp file.
- Không đưa secret thật vào `.env.example`, source, test fixture, tài liệu, log hoặc snapshot.
- Nếu phát hiện secret từng nằm trong commit/ref/artifact: revoke/rotate ở nhà cung cấp trước, xóa khỏi current tree, đánh giá rewrite history có phối hợp, rồi yêu cầu mọi clone/fork đồng bộ lại.

### Kiểm tra sau thay đổi

| Kiểm tra | Kết quả |
|---|---|
| Ignore contract bằng `git check-ignore --no-index` | **20 PASS / 0 FAIL**: 13 path runtime phải ignore và 7 source/template/placeholder phải track. |
| `.env.example` key/duplicate validation | **3 PASS / 0 FAIL**: đủ `PORT`, `DB_PATH`, `MASTER_ADMIN_CODE`, không trùng key. |
| `node test/frontend-ux-test.js` | **39 PASS / 0 FAIL**, exit 0. |

Không chạy lại full `npm test` vì P00 đã xác định dependency native `better-sqlite3` chưa cài được trong môi trường này; thay đổi P01 không tác động code/schema/runtime và frontend contract suite liên quan vẫn pass.

## 9. P02 — Authentication design

Ngày thực hiện: 04/09/2026. Đã tạo `docs/AUTH-DESIGN.md` và chốt thiết kế Argon2id, server-side session, cookie, CSRF, expiry/logout, password rotation/reset, rate limiting, Master/Gym authorization, cross-gym isolation, staged plaintext migration, API/frontend/schema delta, test matrix và rollback.

- Node 24.19.0 tại workspace có `crypto.argon2`; API chính thức có từ Node 24.7.0. Thiết kế không thêm native hashing addon.
- Dependency dự kiến duy nhất là `express-session@1.19.0`, do Express duy trì; session store là custom adapter trên `better-sqlite3` hiện có, không dùng production MemoryStore.
- Migration giữ legacy plaintext trong P03/P04 bridge để tránh lockout; chỉ scrub sau P05 cutover, backup, count verification và user approval.
- C-01/C-02/C-04 vẫn chưa pass vì P02 chỉ là thiết kế. P03 không được bắt đầu cho tới khi người dùng phê duyệt `docs/AUTH-DESIGN.md`.
- Không chạy test vì P02 chỉ sửa Markdown và không thay code/schema/package/config/runtime behavior.




## P09 — Validation và request protection (07/09/2026)

P09 DONE: xem [P09 checkpoint](P09-CHECKPOINT.md). M-02 đã xử lý local: JSON 128 KiB/auth 8 KiB, raw upload 5 MiB, không nhận form, validation server dùng chung và error code 400/401/403/404/409/413/429. C-04 đã có CSRF/session từ P04–P05 và nay bổ sung quota HTTP cho login/verify/upload/mutation/public; credential limiter dùng req.ip với explicit TRUST_PROXY và khóa theo gym ID. H-01 vẫn PARTIAL/OPEN: đã có cấu hình trust proxy, HTTPS/header/CSP và staging còn chờ P11/P12. H-02 vẫn PARTIAL, decode/re-encode và pixel/quota thuộc P13.

Bằng chứng: server.js (middleware body/error/proxy), security/validation.js, security/request-limits.js, auth/backend.js (credential IP), routes/master.js và routes/gym-admin.js (validation/tenant/constraint), test/request-security-test.js. npm run test:p09: 22 security/session PASS + 50 smoke PASS, 0 FAIL. HTTP quota trong RAM chỉ phù hợp một Node instance; cấu hình proxy thật và NAT/load chưa được kiểm thử staging. Không coi đây là quyết định GO; P10 chưa thực hiện.

## P10 — Checkpoint Critical (07/09/2026)

**Kết luận: FAIL / BLOCKED. Chưa được chuyển sang nhóm High; production vẫn NO-GO.** Đã hoàn thành lượt audit, không sửa runtime/test, không mở rộng chức năng, không commit/deploy, không làm P11. Chỉ cập nhật hai tài liệu production; script/log audit ở `tmp/p10/` và log gốc `tmp-p10-*.log` đều ignored. Working tree đầu/cuối vẫn untracked; không có commit SHA để làm baseline. Fixture SQLite `:memory:` trên localhost, không dùng DB/credential người dùng.

### Toàn bộ test và kết quả

Runtime audit: Node v24.19.0, npm 11.17.0. Đã chạy đủ 10 file `test/*-test.js`; `npm test` chưa bao gồm bốn file browser/XSS nên chạy bổ sung bằng lệnh riêng. Số node:test dưới đây tính cả parent theo runner, không được diễn giải 5 FAIL thành 5 lỗi độc lập.

| Lệnh / suite | PASS | FAIL | Skip | Bằng chứng |
|---|---:|---:|---:|---|
| `npm test` — engine | 32 | 0 | 0 | `test/engine-test.js`; `tmp-p10-tests.log` |
| `npm test` — master smoke | 50 | 0 | 0 | `test/master-routes-smoke-test.js`; log trên |
| `npm test` — frontend UX | 41 | 0 | 0 | `test/frontend-ux-test.js`; log trên |
| `npm test` — auth/session/request security | 30 | 0 | 0 | `test/auth-test.js`, `test/session-test.js`, `test/request-security-test.js`; exit 0 |
| `node --test test/frontend-session-test.js test/dashboard-xss-test.js test/admin-xss-test.js test/master-xss-test.js` | 22 | 5 | 0 | `tmp-p10-browser.log`; exit 1; session 5/0, Master 9/0, Dashboard 3/2, Gym 5/3 |
| **Tổng lượt đầy đủ ban đầu** | **175** | **5** | **0** | 153 core + 27 browser test records |
| Rerun riêng `node --test test/admin-xss-test.js` | 5 | 3 | 0 | `tmp/p10/admin-rerun.log`; exit 1, tái hiện cả hai lỗi subtest |
| Rerun riêng `node --test test/dashboard-xss-test.js` | 5 | 0 | 0 | `tmp/p10/dashboard-rerun.log`; exit 0; không xóa lỗi lượt đầu khỏi audit |

Ba lỗi subtest (hai parent fail lan truyền):

1. Gym workflow timeout tại `test/admin-xss-test.js:221`: fixture gửi `avatar_url=javascript:…` ở dòng 220 và chờ tạo thành viên thành công. P09 đã cấm URL đó (`security/validation.js:18`, `security/validation.js:30`). HTTP probe xác nhận 400 `INVALID_REQUEST`, dữ liệu hợp lệ tạo/sửa thủ công vẫn chạy. Đây là regression fixture không theo contract mới; không có lý do nới validation. Các bước edit/log phía sau trong subtest không chạy vì dừng ở timeout.
2. Gym visual `390/members` fail tại `test/admin-xss-test.js:189`, cả full và rerun. Test so byte PNG bằng `Buffer.equals`, chưa chứng minh là lỗi layout runtime hay độ bất định render; ghi FAIL, không tự tăng tolerance hoặc thay baseline.
3. Dashboard visual `1440/log` fail tại `test/dashboard-xss-test.js:80`; rerun riêng PASS. Phép so cũng là byte PNG, nên chỉ kết luận có flake chưa được giải quyết, không kết luận pixel/layout sai từ thông báo assertion.

Không clean-install lại dependency hoặc kiểm thử staging trong P10. Native SQLite hiện chạy được; blocker toolchain cũ P00 không còn giải thích H-05 hiện tại. Visual baseline local P06/P07/P08 đều tồn tại, không skip, không thay/ghi lại baseline source.

### Audit bảo mật với bằng chứng hiện tại

| Hạng mục | Pass/Fail | Bằng chứng / giới hạn |
|---|---|---|
| Secret source/Git/config | PASS trong phạm vi scan | `tmp/p10/secret-scan.json`: 193 lượt file/blob = 80 working file + 113 blob duy nhất, 6 tree refs, không commit. Quét private key/provider token/JWT/credential URI/literal assignment; 40 match chỉ là fixture test (working + blobs), không in giá trị. `.env.example` không chứa secret thật. Không quét/xuất DB runtime hay khẳng định secret store production sạch. |
| Password/session | PASS cơ chế, **FAIL vòng đời plaintext (C-01)** | `auth/password.js:21`, `auth/password.js:34` Argon2id/salt ngẫu nhiên; `auth/backend.js:34` HttpOnly/Secure production/SameSite Lax; dòng 79 regenerate; `auth/session-store.js:12` expiry/version/revoke; `auth/config.js:5` fail-fast. `routes/master.js:298` vẫn ghi password ban đầu plaintext; chưa đóng phase scrub. |
| Authorization | PASS local | `auth/backend.js:92` deny by default, role/gym binding trước business API; `routes/gym-admin.js:67`, `routes/gym-admin.js:148`, `routes/gym-public.js:121` resource scope. Tests role/tenant/soft-delete/session renaming PASS; HTTP probe xác nhận 401/403/404. |
| XSS | PASS kiểm soát security | Rà sinks trong `public/dashboard.js`, `public/admin.js`, `public/master.js`: hằng/escape text và quoted attributes, DOM, URL HTTP(S); helper ở các dòng 8/9/6. `public/master.js:23` tách data PNG/JPEG preview. Payload/error/URL subtests PASS cả 3 UI; failure responsive/workflow theo H-05. |
| CSRF | PASS local | `auth/backend.js:20`, `auth/backend.js:89`, `auth/backend.js:97`: exact Origin/HTTPS Referer + constant-time token cho mutation, login/logout Origin guard. `test/session-test.js:75` bao gồm upload và không ghi DB khi bị chặn; manual Origin lạ 403. |
| Injection | PASS source/HTTP | Prepared statements với binding ở routes/auth/engine; không thấy eval/shell execution nhận request input. Schema exec đọc file local cố định. ID/input độc hại bị 400; scalar markup trong tên giữ nguyên dữ liệu, không chạy HTML. |
| CORS | PASS same-origin local | Không middleware/header ACAO wildcard hoặc reflection trong `server.js:11`/routes. HTTP GET có session và preflight OPTIONS từ `https://evil.invalid` không trả Access-Control-Allow-Origin; OPTIONS có thể 200 với `GET, HEAD`, không cấp quyền đọc cross-origin. Origin lạ mutation 403. Không coi CORS thay thế auth/CSRF. |
| Body limit/validation | PASS local | `server.js:22`–`server.js:45`, `routes/master.js:26`, `security/validation.js:1`; tests oversized/chunked/form/compressed JSON, invalid numeric/date/ID/URL và valid request PASS. |
| Rate limiting/proxy | PASS local, giới hạn vận hành | `security/request-limits.js:10`, `security/request-limits.js:31`, `auth/rate-limit.js:1`; brute-force theo IP/principal, IPv6 /64, Retry-After, mutation/read/upload quota PASS. HTTP quota RAM chỉ một instance, reset khi restart; credential quota SQLite bền vững. Proxy thật/HTTPS/edge flood protection chưa audit staging (P12/P23). |

### Kiểm tra thủ công

Thực hiện qua Codex in-app browser tại `http://127.0.0.1:3210`, fixture Master + gym A/B và một season/map. Edge connector không khả dụng nên chuyển sang in-app browser; các automated browser suite dùng Edge headless như harness có sẵn. Không gọi lượt chạy automated là manual.

| Luồng thao tác trực tiếp | Kết quả quan sát | Trạng thái |
|---|---|---|
| Master đăng nhập, Dashboard, Gyms, Season Templates, đăng xuất | Đăng nhập mở 4 tab, summary 2 gym/1 season; thấy A/B và template P10; đăng xuất trước chuyển Gym. Upload/create/edit template được xác minh bằng suite Master API/SQLite, không tuyên bố manual upload. | PASS |
| Gym A đăng nhập, tạo member tên `P10 <b>literal</b>` với avatar rỗng | Hiện tên nguyên văn, thông báo thêm 1 thành viên; không có member B trong danh sách. | PASS |
| Gym A ghi log 20 điểm/1 vé rồi sửa thành 30 | Thông báo ghi thành công, mở Sửa/Lưu, Dashboard cập nhật 30 điểm/1 vé đã dùng. | PASS |
| Dashboard, Xếp hạng, Lịch sử | Tên markup hiển thị literal ở bảng/member/filter; score 30, vé còn 10; lịch sử 1/1 lượt. | PASS |
| Giữ session A và mở `/g/b#admin` | Form khóa, thông báo không có quyền; không hiện panel quản trị B. | PASS |

HTTP probes thủ công bổ sung (`tmp/p10/http-probes.json`, fixture cùng server): đọc A 200; A đọc/sửa B 403; Gym gọi Master 401; sửa member B bằng URL A 404; archive B qua A 404; Origin lạ mutation 403; avatar javascript 400; CORS không ACAO. Điều hướng browser trực tiếp tới API 403 bị browser báo `ERR_BLOCKED_BY_CLIENT`; mã HTTP được xác nhận bằng probe độc lập, không suy đoán từ lỗi browser. Refresh/logout/expiry/password rotation đầy đủ PASS ở `test/frontend-session-test.js:12`, không đổi credential người dùng thủ công.

### Blocker và task riêng đề xuất

- **P10-C01 — Critical / BLOCKED: hoàn tất cutover credential không plaintext.** Phải dừng ghi credential plaintext khi tạo gym (`routes/master.js:286`, `routes/master.js:294`, `routes/master.js:298`), xử lý ràng buộc cột legacy/migration và dữ liệu hiện hữu; rehearsal backup/restore/scrub/login/reset/revoke/rollback rồi xác minh không còn plaintext và gỡ bootstrap khỏi runtime config. `docs/AUTH-DESIGN.md:266` yêu cầu phase C, dòng 272 không giữ plaintext chờ P16; `docs/P05-CHECKPOINT.md` xác nhận chưa scrub. Đây là công việc migration/cutover, không phải sửa nhỏ thuộc P09; P10 không tự scrub DB hoặc mở rộng authentication. `must_rotate` hiện là grace-period theo thiết kế, không bị diễn giải thành bằng chứng đã rotate hết.
- **P10-QA — H-05 / BLOCKED: khôi phục full regression đáng tin cậy.** Cập nhật fixture P07 để assert URL nguy hiểm bị 400/không ghi DB, dùng avatar hợp lệ cho create/edit/log; vẫn giữ XSS payload DB cũ ở test rendering. Điều tra visual Gym và Dashboard bằng decoded pixel/geometry và thời gian render, không tạo baseline từ code mới để tự pass. Bổ sung bốn browser/XSS suite vào checkpoint runner nếu được giao task; chạy lại đủ 10 file, không skip/flake còn mở.

Không sửa lỗi nhỏ trong P10 vì không tìm thấy Critical nhỏ có nguyên nhân thuộc phạm vi P09; C-01 cần task riêng như yêu cầu. Chỉ khi C-01 đóng với bằng chứng và H-05 xanh mới audit lại P10 để quyết định chuyển High. Các việc CSP/HTTPS/upload/error/privacy/backup vẫn giữ nguyên trong kế hoạch, không được coi đã hoàn tất qua checkpoint này.

Commit message đề xuất: `docs: record P10 critical audit blockers and regression evidence`.

## P11 — Security headers / CSP (07/09/2026)

P11 DONE local theo yêu cầu trực tiếp: xem [P11 checkpoint](P11-CHECKPOINT.md) về inventory, ngoại lệ style attribute/data preview/SVG hashes, test và giới hạn. 58 test liên quan PASS ở các lượt cuối; P08 visual đã gặp flake ở lượt đồng thời và PASS khi chạy riêng, không đóng H-05. P10 vẫn BLOCKED, không thay kết luận NO-GO. Trước rollout phải kiểm kê nguồn ảnh DB thật và cấu hình CSP_IMAGE_ORIGINS; HTTPS/proxy/staging thuộc P12. Không deploy, không tiếp tục P12.

## P12 — cấu hình triển khai mẫu (08/09/2026)

P12 DONE trong phạm vi mẫu: [DEPLOYMENT](DEPLOYMENT.md), [checkpoint](P12-CHECKPOINT.md), `deploy/nginx.conf.example`, `deploy/gvg.service.example`, `security/deployment.js`, `server.js`. Production bắt buộc localhost/proxy 127.0.0.1, allowlist Host theo PUBLIC_ORIGIN; 28 test liên quan PASS, 0 FAIL/skip. H-01 vẫn PARTIAL vì chưa nginx -t/TLS/DNS/firewall/permissions trên staging. P10 vẫn BLOCKED/NO-GO. Không deploy hoặc thực hiện P13.


## P13 — Upload hardening (08/09/2026)

P13 DONE: [checkpoint và thiết kế quota/orphan](P13-CHECKPOINT.md). Không sửa frontend, database thật hoặc ảnh cũ. 86 checks liên quan PASS, gồm real browser upload PNG/JPEG và sửa template. H-02 đóng cho upload mới; L-03 vẫn OPEN cho vòng đời snapshot/backup và cleanup executable. Quota hiện thực thi cho một process; cần resource limits/service và monitoring khi deploy. `npm audit --omit=dev` còn 1 moderate ở qs, chuyển đánh giá P19; không audit-fix trong P13. P10 vẫn BLOCKED, không thay NO-GO; không làm P14.


## P14 — Error handling và privacy

P14 DONE theo phạm vi được giao: [checkpoint](P14-CHECKPOINT.md). H-03 PASS local; 116 checks PASS, 0 FAIL/skip. Public API đã audit; H-06 vẫn cần quyết định sản phẩm, chưa đổi quyền hiển thị. Không deploy, không làm P15; P10 BLOCKED/NO-GO giữ nguyên.


## P15 — Checkpoint Critical + High (08/09/2026)

**Kết luận: NO-GO cho staging public có bảo vệ; P15 BLOCKED.** Audit đã hoàn tất, nhưng C-01 còn ghi credential plaintext, H-05 full suite chưa xanh, H-04 chưa có quy trình restore/migration tổng thể, H-06 chưa chốt audience dữ liệu. Mẫu Nginx hiện chưa có access gate dành cho staging. Không triển khai server, mở port, thay DNS/TLS, commit, scrub dữ liệu thật hoặc làm P16.

Đây là kết luận hiện tại thay cho nhận định P10; các ghi chép checkpoint trước được giữ làm lịch sử. Chỉ sửa hai tài liệu production. Node v24.19.0/npm 11.17.0; working tree vẫn untracked, chưa có commit SHA. Test dùng DB fixture của suite (`:memory:`, temp directory và `test/test.db` do engine suite tự tạo lại), server loopback và Edge headless. Không chạy app trên DB người dùng. Không clean-install dependency, không khẳng định đã pentest độc lập hoặc kiểm thử hạ tầng thật.

### Toàn bộ test: 187 PASS / 8 FAIL / 0 skip / 0 cancelled

Đã chạy đủ **14 file `test/*-test.js`**. `npm test` chỉ chứa 6 file, nên gọi thêm 8 file với concurrency=1. Không sửa test/baseline, không rerun để thay thế failure của lượt đầu. Các suite core và nhóm bổ sung được khởi chạy riêng; browser suites chạy tuần tự trong nhóm bổ sung.

| Lệnh / nhóm | PASS | FAIL | Skip | Bằng chứng |
|---|---:|---:|---:|---|
| `npm test`: engine | 32 | 0 | 0 | `test/engine-test.js`, `tmp/p15/core.log:65` |
| `npm test`: Master HTTP smoke | 50 | 0 | 0 | `test/master-routes-smoke-test.js`, `tmp/p15/core.log:132` |
| `npm test`: frontend UX | 41 | 0 | 0 | `test/frontend-ux-test.js`, `tmp/p15/core.log:179` |
| `npm test`: auth/session/request security | 29 | 1 | 0 | `test/auth-test.js`, `test/session-test.js`, `test/request-security-test.js`; core log:213 |
| Bổ sung: deployment/error/upload/headers-CSP | 15 | 0 | 0 | `test/deployment-test.js`, `test/error-handling-test.js`, `test/map-images-test.js`, `test/security-headers-test.js` |
| Bổ sung: frontend session | 5 | 0 | 0 | `test/frontend-session-test.js` |
| Bổ sung: Dashboard XSS | 3 | 2 | 0 | `test/dashboard-xss-test.js` |
| Bổ sung: Gym XSS/workflow | 5 | 3 | 0 | `test/admin-xss-test.js` |
| Bổ sung: Master XSS/upload/template | 7 | 2 | 0 | `test/master-xss-test.js` |
| **Tổng** | **187** | **8** | **0** | **195 records/checks**; cả hai lệnh exit 1 |

Lệnh bổ sung chính xác:

```powershell
node --test --test-concurrency=1 test/deployment-test.js test/error-handling-test.js test/map-images-test.js test/security-headers-test.js test/frontend-session-test.js test/dashboard-xss-test.js test/admin-xss-test.js test/master-xss-test.js
```

8 FAIL là **5 lỗi độc lập + 3 parent fail lan truyền**, không phải 8 lỗ hổng:

1. **Auth CLI fixture:** `test/auth-test.js:130`, config dòng 135 dùng `PORT=0` và không khai báo `TRUST_PROXY`. P12 yêu cầu proxy chính xác và port 1–65535 (`security/deployment.js:5`, `security/deployment.js:32`). Test dừng với `startup exited` ở dòng 144. Probe riêng xác nhận cả hai config bị từ chối. Không suy luận startup production hợp lệ bị lỗi; fixture cần cập nhật và thực sự gửi HTTP, vì hiện chỉ chờ dòng stdout.
2. **Gym workflow:** `test/admin-xss-test.js:220` gửi avatar `javascript:alert(1)` rồi chờ member được tạo ở dòng 221. Server chặn theo `security/validation.js:18`; fixture trái contract P09, timeout 7000 ms. Các bước edit member/create-edit log phía sau chưa chạy trong subtest này; không được ghi chúng PASS.
3. **Gym visual:** `test/admin-xss-test.js:189`, `1440/entry-edit`, so byte PNG thất bại. Không đủ bằng chứng để kết luận lỗi layout hay flake.
4. **Dashboard visual:** `test/dashboard-xss-test.js:80`, `1440/dashboard`, so byte PNG thất bại. Flake từng thấy ở P10 chưa được giải quyết.
5. **Master visual:** `test/master-xss-test.js:226`, `390/preview`: hai ảnh đều 390×1664, `maxDelta=2`, `changedPixels=21851`. Có khác pixel thực, chưa xác định nguyên nhân; không tự tăng tolerance hoặc tạo lại baseline để pass.

### Audit toàn bộ Critical + High

| ID / nhóm | Kết quả P15 | Bằng chứng và giới hạn |
|---|---|---|
| C-01 Authentication | **FAIL / BLOCKED** | Argon2id salt ngẫu nhiên/constant-time verify (`auth/password.js:21`, `:34`); session regenerate, cookie `__Host-`, Secure/HttpOnly/SameSite=Lax (`auth/backend.js:33`, `:79`); expiry/version/revoke (`auth/session-store.js:12`) được test. Nhưng `routes/master.js:269`, `:280` vẫn ghi mật khẩu đầu vào vào `gyms.admin_code`; schema `db/schema.sql:39` NOT NULL UNIQUE; `auth/migrate.js:16` vẫn đọc legacy. Không có bằng chứng phase C scrub theo `docs/AUTH-DESIGN.md:266`. Must-rotate là grace period, không phải đã đổi mật khẩu. |
| C-02 Authorization/tenant | **PASS local** | Guard role/gym trước business API (`auth/backend.js:92`, `:97`), scope members/entries và archive (`routes/gym-admin.js:67`, `:148`; `routes/gym-public.js:121`). Session tests và browser đồng thời hai role/cross-gym PASS. Không thấy legacy header bypass; unauthenticated Master probe 401. |
| C-03 XSS | **PASS kiểm soát security; H-05 FAIL** | Rà HTML sinks trong cả Dashboard/Gym/Master: text/quoted attributes escape, DOM, HTTP(S) URL policy (`public/dashboard.js:9`, `public/admin.js:9`, `public/master.js:6`, `:23`); session errors dùng textContent (`public/auth-client.js:44`). Payload tên/ID/URL/error và upload response độc hại PASS. CSP enforced trong browser PASS. Không coi visual/workflow failure là XSS, cũng không bỏ qua chúng. |
| C-04 CSRF/rate limit | **PASS local có giới hạn** | Origin/HTTPS Referer exact + timing-safe token cho mutation, login/logout Origin guard (`auth/backend.js:20`, `:89`, `:97`); upload đi cùng guard. SQLite reservation trước hash theo IP/principal, escalation và Retry-After (`auth/rate-limit.js:7`); HTTP quota, IPv6 /64, cap 20k buckets, explicit proxy (`security/request-limits.js:2`, `:14`, `:25`). Auth/session/request tests PASS ngoại trừ CLI fixture nói trên. HTTP quota RAM và upload quota chỉ phù hợp một process; chưa đo NAT, flood hoặc multi-instance. |
| C-05 Injection | **PASS source + tests local** | Rà routes/auth/engine: SQL dùng placeholder/binding; SQL exec chỉ schema local cố định (`db/index.js:8`, `auth/migrate.js:7`). Không thấy eval/new Function/shell execution nhận input request trong runtime. ID/slug/body/query validation tại `security/validation.js:10`, `:14`, `:77`; request security test PASS. Không thấy server fetch URL ảnh từ input, không có đường SSRF qua upload normalize. |
| C-06 Secret/Git | **PASS trong phạm vi scan** | Quét 96 working files + 157 Git blobs duy nhất, 10 refs = 253 lượt file/blob; 62 match literal đều thuộc test fixtures (24 working, 38 blob). Không match private-key/provider-token/JWT/credential URI; không in giá trị. `tmp/p15/secret-scan.json`. Không có commit; không quét DB/secret store người dùng, không coi plaintext C-01 đã sạch. |
| H-01 HTTPS/proxy/headers/CSP | **PARTIAL; staging BLOCKED** | `security/deployment.js:3` strict Host/proxy, localhost production; `deploy/nginx.conf.example:1` TLS1.2/1.3, redirect fixed host, overwrite forwarding headers, limit body/connection, cấm đường dẫn nhạy cảm. Deployment 3/3 và CSP/headers 3/3 PASS. Không chạy nginx -t, TLS/renewal, DNS/firewall/permissions thực. **Chưa có gate staging** trong mẫu: dashboard/API public theo slug vẫn public nếu dùng nguyên mẫu. Một gap nhỏ: Host 400 trả trước headers middleware (`server.js:18`, `:20`), probe xác nhận thiếu CSP/nosniff; không có HTML/secret phản chiếu và không phân loại thành Critical/High mới. Lỗi do Nginx tạo cũng chưa được kiểm tra headers. |
| H-02 Upload | **PASS local cho upload mới** | `security/map-images.js:7`, `:14`, `:41`, `:67`: 5 MiB, 8192 px/16M pixels, reject multi-frame/truncated/fake, Sharp decode/re-encode/strip metadata, 2 processing slots, UUID/exclusive write, fixed content type/nosniff, reject traversal/symlink; quota 512 MiB/2000 file. 5 upload tests và browser PNG/JPEG/create-edit template PASS. Ảnh legacy chưa normalize; cleanup mới là thiết kế; resource limits/monitoring khi vận hành chưa xác minh. |
| H-03 Error disclosure | **PASS local** | `security/errors.js:16`, `:42`: UUID do server sinh, no-store, schema JSON/HTML404/500, unexpected SQL/filesystem/stack bị che; debug chỉ khi development explicit. 4 tests PASS với SQLite error thật, async rejection, malformed body, 400/404/409/413/500; browser API errors render text. Không khẳng định lỗi từ Nginx/service ngoài app có cùng schema. |
| H-04 Backup/restore/migration | **OPEN / BLOCKED cho dữ liệu thật** | Boot vẫn áp schema trực tiếp (`db/index.js:5`); auth migration đã có backup SQLite (`auth/migrate.js:26`) nhưng chưa thay thế versioned migration/restore drill tổng thể. Không đồng nhất “có backup API” với “đã restore được”. P16/P17 chưa làm. |
| H-05 Full regression | **FAIL / BLOCKED** | 187/8/0 như bảng; 5 lỗi độc lập. `package.json:8` không bao gồm 8 suite bổ sung; baseline visual phụ thuộc file ignored tại tmp/p06–p08 nên clean checkout có thể skip. Cần runner đủ suite và baseline tái lập. |
| H-06 Public privacy | **OPEN / BLOCKED cho dữ liệu thật** | `routes/gym-public.js:54` SELECT * members + spread, public state/overview/leaderboard/log/archive lộ tên/avatar/ban/vé/điểm/timestamps theo thiết kế hiện tại. Đã audit P14, chưa có quyết định audience/retention/allowlist. App admin login không bảo vệ toàn bộ public dashboard/API. |

CORS/body bổ sung: probe GET và OPTIONS Origin lạ không có ACAO, Master OPTIONS 401; không có CORS wildcard/reflection. Body JSON 128 KiB, auth 8 KiB, upload 5 MiB, từ chối form/compression theo `server.js:27`–`:50`; regression negative/positive PASS. `/.env`, `/db/gvg.db` trả 404. Probe production dùng HTTP loopback với trusted X-Forwarded-Proto=https để kiểm tra middleware; **không phải TLS handshake thật**.

### CSP trên trang thực tế

`test/security-headers-test.js:48` chạy Edge headless với Express thật/SQLite fixture, không chỉ so chuỗi header. PASS:

- `/`, `/index.html`, `/master`, `/master.html`, `/g/csp`, `/dashboard.html`, `/admin.html`, `/g/csp/admin` tại **390, 768, 1440 px**: 24 tổ hợp, mỗi tổ hợp so CSP bật/tắt = 48 lượt trang; geometry/style được đo không đổi, không có `securitypolicyviolation` trong luồng hợp lệ.
- Login Master và Gym, click các tab visible sau đăng nhập và Gym admin tabs; không vi phạm CSP. Form landing và redirect slug hoạt động. Browser Master suite riêng xác minh upload/preview PNG/JPEG và tạo/sửa template thật.
- Chèn inline script không thực thi (`window.injected` undefined), ảnh `https://unapproved.invalid` bị chặn; ghi nhận `script-src-elem` và `img-src` violation chủ đích. SVG icons bundled có style hash hoạt động.
- Policy không wildcard/unsafe-eval; `script-src 'self'`, script attributes none, object/base/frame none. Ngoại lệ có chủ đích: `style-src-attr 'unsafe-inline'`, ảnh `data:` cho preview, Google font origins và SVG style hashes (`security/headers.js:26`). Không coi style ngoại lệ là quyền chạy inline script.

Giới hạn: stylesheet Google được fulfill rỗng để độc lập mạng, vì vậy không chứng minh font CDN tải thật. DB và ảnh là fixture, chưa kiểm kê nguồn ảnh/HTTP mixed content của dữ liệu thật hoặc cấu hình `CSP_IMAGE_ORIGINS` của staging. CSP PASS local không xóa H-01 PARTIAL hoặc visual failures H-05. Không thực hiện manual browser audit trong P15; các bằng chứng trang thực tế ở trên là automated browser.

### Task sửa nhỏ theo phụ thuộc — chỉ lập danh sách, chưa thực hiện

| Task | Phụ thuộc | Phạm vi và bằng chứng đóng task |
|---|---|---|
| P15-Q1 | Không | Sửa fixture production `test/auth-test.js:135`: proxy hợp lệ, port khả dụng 1–65535, bắt stderr an toàn, gửi HTTP có Host đúng; vẫn test missing proxy/PORT=0 fail-fast. Auth suite xanh. |
| P15-Q2 | Không | Sửa Gym workflow: assert avatar nguy hiểm 400/DB không đổi; dùng avatar hợp lệ cho create/edit/log. Giữ payload XSS legacy qua fixture DB để kiểm tra rendering. Subtest đi hết các bước và xanh. |
| P15-Q3 | Không | Điều tra riêng ba visual failure bằng decoded pixels/geometry/font/time; cố định nguồn bất định đã chứng minh. Baseline có nguồn gốc lưu được trong clean checkout; không tăng tolerance để che lỗi. |
| P15-Q4 | Q1, Q2, Q3 | Checkpoint runner đủ 14 file, không bỏ suite khi suite trước fail; clean install trên Node chốt, full suite 0 fail/skip, lưu log. |
| P15-C1a | Không | Trên fixture/clone cô lập, rehearsal SQLite WAL-safe backup và restore/integrity/count/login trước cutover; chốt rollback chỉ về bản session-compatible theo AUTH-DESIGN. Không thao tác DB thật. |
| P15-C1b | C1a | Dừng ghi password plaintext mới tại create gym; dùng tombstone unique không xác thực theo phase C, vẫn tạo principal atomically và chỉ hiển thị temporary password một lần. Test create/rollback/login/reset; DB không chứa password mới. |
| P15-C1c | C1b, Q1, Q2 | Viết/rehearse scrub idempotent trên bản sao: count/hash/login/reset/revoke/restore và quét không plaintext, bỏ bootstrap runtime sau migration. Việc áp dữ liệu thật là rollout riêng theo quy trình được duyệt, không nằm trong P15. |
| P15-S1 | Không | Chốt và chuẩn bị access gate staging cho **mọi** trang/API/upload: VPN/IP allowlist hoặc identity proxy; dữ liệu tổng hợp riêng, secret riêng. Kiểm thử người ngoài bị chặn cả đường upload/API, không chỉ `/master`; chưa bật server public. |
| P15-H1 | Không | Bổ sung headers cho early Host 400 và quyết định headers cho lỗi edge; test createApp thực, không chỉ middleware riêng. Gap nhỏ, không tự nâng thành lỗ hổng lớn. |
| P15-D1 | Quyết định sản phẩm | Chốt audience/field allowlist/retention của H-06; thực thi và test negative tương ứng trước dùng dữ liệu thật. Staging chỉ fixture không được diễn giải là phê duyệt public data. |
| P15-R1 | Q4, C1c, S1, H1 | Audit lại P15 và review cấu hình cụ thể trước xin phép triển khai. Nếu có dữ liệu thật, thêm D1 và P16/P17 (migration/restore) làm điều kiện bắt buộc. Chỉ sau cho phép riêng mới rehearsal TLS/gate/proxy/firewall/CSP thật theo DEPLOYMENT; P15 hiện không cấp phép đó. |

Ưu tiên đóng C-01 và H-05 trước. Các task độc lập trong bảng có thể lên lịch riêng, không có agent/task mới được tạo. Giới hạn một instance, ảnh legacy, dependency audit P19 và logging/monitoring/load P20/P23 vẫn giữ trong kế hoạch; P15 không tự xử lý các ngày sau.

### Bằng chứng lưu local

Log/probe/script ở `tmp/p15/` ignored; ảnh do harness ghi ở `tmp/p06/`, `tmp/p07/`, `tmp/p08/`. Các log không được commit tự động; nội dung kết quả và failure quan trọng đã ghi đầy đủ ở trên để tài liệu không phụ thuộc vào tmp. SHA-256 tại thời điểm audit:

| Artifact | SHA-256 |
|---|---|
| `tmp/p15/core.log` | `45AAD3189D5E7A2B4524D218D8D8B0A8BF416EF424EBDE409586E16F24D167E0` |
| `tmp/p15/additional.log` | `407F8337B987C83697B7E22D3C7CEEAA43FD6B0B80BC103F630DF9CDC1AE7794` |
| `tmp/p15/secret-scan.json` | `E1111208D69CAC1241CDF12112553B55113D1E8FEFE5DBB48CFFD552E794EA14` |
| `tmp/p15/probes.json` | `70F3EC1BCE26A9A1D07724FDFE20ADDC3BE0A9BD44EE89674117E3740E112C6D` |

Commit message đề xuất: `docs: record P15 security audit and protected staging blockers`.

## P16 — Migration framework (08/09/2026)

Framework có version/checksum, baseline không replay DDL legacy, transaction toàn batch, preflight WAL và backup hook bắt buộc cho production. Runtime không dùng schema.sql làm migration. Xem [P16 checkpoint](P16-CHECKPOINT.md) và [migration runbook](MIGRATIONS.md). Kiểm thử liên quan: 116 PASS / 1 FAIL đã biết (P15-Q1 fixture startup), 0 skip. Chưa áp dụng trên DB thật; backup/restore provider chờ P17. Các blocker P10/P15 không thay đổi; không kết luận GO.

## P18 — SQLite concurrency và index (08/09/2026)

DONE trong phạm vi local: timeout/FULL rõ ràng, WAL fail-fast; create/edit/delete log có immediate transaction bao trùm validation và round-chain; migration 004 thêm đúng hai index có EXPLAIN, benchmark 100.000 entries và chi phí write/storage. 161 checks duy nhất PASS / 0 FAIL; 300 writes từ 3 connections + 100 snapshot reads và 80 HTTP log writes + 40 reads ở concurrency 10 không lỗi ngoài case timeout cố ý. Xem [P18 checkpoint](P18-CHECKPOINT.md) và [query evidence](P18-BENCHMARK.json). Chưa thay DB thật, chưa chứng minh nhiều Node instances hay tải production; P10/P15 vẫn BLOCKED, không đổi quyết định GO. Ngưỡng PostgreSQL và migration/rollback nằm trong checkpoint.

## P23 — Load và browser QA (09/09/2026)

DONE audit local, xem [P23 checkpoint](P23-CHECKPOINT.md) và [kết quả máy đọc được](P23-RESULTS.json). 1.680 requests/560 log writes trên fixture file WAL: 0 HTTP errors/DB locked, integrity/FK PASS. Burst concurrency 32 đạt write p95 359,10 ms/p99 428,29 ms; đề xuất khởi đầu 16 để có headroom. Concurrency 64 đã vượt write p95 500 ms. Không coi burst vài giây hay req/s vượt quota mỗi IP là sustained capacity; chưa chứng minh peak production/soak/multi-instance.

Chrome/Edge/Firefox: 84 views và 840 filter changes PASS ở 7 widths. Sửa nhỏ favicon/description, accessible names của log editor và clipping cụm vé leaderboard mobile. Kiểm tra local links, 404/500, focus, overflow; Safari chỉ checklist, webfonts online còn cần QA. Hồi quy liên quan: 9 + 41 checks PASS; suite admin-XSS/CSP 8 PASS/3 FAIL (2 subtest gốc + parent). Task P23-Q1 theo dõi hai failure Gym Admin, Q2 soak/peak và Q3 Safari/webfont/accessibility mở trong checkpoint. Không gỡ blocker P10/P15, không làm P22/P24 và không đưa ra GO.

## P24 — Tổng duyệt cuối (09/09/2026)

**NO-GO**, P24 **BLOCKED** ở gate go-live. Báo cáo đầy đủ, bằng chứng file/dòng,
lệnh tái lập và điều kiện đóng tại [P24-CHECKPOINT.md](P24-CHECKPOINT.md);
từng suite, sự kiện protocol và SHA-256 log tại [P24-RESULTS.json](P24-RESULTS.json).

Đã thực hiện trên fixture local: backup SQLite trước migration 004 bằng CLI
production và hook thật; schema/integrity/FK; start child chỉ loopback;
health/readiness/login/cookie/headers/private-path probes; rollback protocol;
restore backup sang DB riêng rồi khởi động/smoke. 58 checks PASS, gồm 4 kiểm tra
template tĩnh. Deploy 1.096 ms, rollback 859 ms, restore/start/smoke 812 ms trên
fixture nhỏ. Rollback dùng cùng source/schema dưới hai label mô phỏng; chưa có
artifact cũ. Maintenance/code switch/runtime file snapshot/off-server là mô phỏng,
không coi đây là staging provider đã được kiểm chứng hoặc RPO/RTO production.
Smoke P17 trên DB restore riêng đạt 52/52 PASS.

Full regression `node scripts/test-ci.js`: đủ 20 suites, **240 PASS / 9 FAIL /
0 skip / 0 cancelled**, exit 1. Năm lỗi gốc: auth CLI startup fixture, Gym workflow
timeout, Dashboard visual 390/dashboard, Master visual 390/edit, P22 stored-XSS
timeout chờ text visible. Bốn parent fail được tính trong tổng 9; không có bằng
chứng payload XSS thực thi từ timeout. P22 10 PASS/2 FAIL, chưa đủ để đóng P22.
Không sửa/nới assertion hoặc baseline để lấy kết quả xanh. Audit tất cả dependency
exit 0 với 0 advisory; chưa clean install/build Linux.

| Severity | Vấn đề còn mở tại P24 | Điều kiện còn lại |
|---|---|---|
| Critical | C-01: dừng ghi plaintext mới DONE tại P24.1a; phase C scrub dữ liệu cũ vẫn OPEN | P24.1b riêng: scrub/revoke/reset/login/idempotence trên clone, kế hoạch rollout riêng được duyệt |
| High | H-05/P22: 5 regression failures; visual baseline ignored, runner không fail khi suite skip | Sửa nguyên nhân, baseline tái lập, clean full suite 0 fail/skip; hoàn tất E2E stored-XSS |
| High | H-01: HTTPS redirect/TLS chỉ review template; chưa staging gate/proxy/firewall/permissions thật | Gate mọi trang/API/upload; nginx -t, TLS chain/SNI/renewal, IP/proxy spoof, kiểm port IPv4/IPv6 từ ngoài, ACL/mode service/DB/backup |
| High | H-04: backup/restore local xanh, vận hành chưa chứng minh | Snapshot DB+uploads+season đồng bộ, off-server mã hóa/khóa khôi phục/scheduler/retention/alert, restore đại diện và RPO/RTO end-to-end |
| High | H-06: public SELECT * members và audience/retention chưa chốt | Quyết định sản phẩm, field allowlist/negative tests trước dữ liệu thật |
| Medium | M-04: chưa immutable artifact/registry/provenance, provider adapter và secret store | Source review/commit theo lệnh người dùng, CI Linux sạch/Gitleaks, thay EnvironmentFile bền vững bằng integration P21, diễn tập rollback hai artifact và restore schema khác |
| Medium | M-01/P23-Q2: local concurrency xanh, chưa peak/soak/proxy/NAT/disk | Soak 30 phút tại 2× peak thống nhất, một Node instance; FK/WAL/timeout/index đã có, không còn thiếu như baseline |
| Medium | M-03: chưa monitoring owner/alert delivery/retention/watchdog và Linux drain | Kiểm collector, nhận alert và graceful SIGTERM trên staging đích |
| Medium | M-05: audit xanh nhưng chưa native clean install máy đích | Xác minh CPU/libc/Node/build và lịch cập nhật |
| Low | P15-H1: early Host 400 thiếu headers, edge errors chưa xác minh | Test createApp và headers proxy errors |
| Low | L-01/P23-Q3: Safari/iOS/webfonts/zoom/screen reader/contrast/touch | Hoàn tất QA hoặc quyết định chấp nhận giới hạn rõ ràng |
| Low | L-02: metadata/owner/lint/format/coverage policy | Hoàn thiện hoặc ghi miễn trừ có người chịu trách nhiệm |
| Low | L-03/H-02 residual: ảnh legacy, orphan/season lifecycle, storage monitoring | Kiểm kê/normalize phù hợp, cleanup an toàn/retention và giám sát |

Cookie production (__Host-/Secure/HttpOnly/SameSite=Lax, không Set-Cookie qua HTTP),
CSRF/session và CSP/browser suite có bằng chứng local. X-Forwarded-Proto là mô phỏng
TLS termination, không chứng minh TLS handshake. Child secret được sinh và inject
trong memory, không xuất hiện trong log; chưa secret manager. ACL fixture cho nhóm
sandbox quyền Modify nên không chứng nhận permissions production. Không chạy lại
scan Git history P15 trong P24; Gitleaks CI vẫn là gate mở.

Đóng Critical, regression và các gate High, hoàn tất hoặc chấp nhận có căn cứ các
residual Medium/Low rồi tổng duyệt lại. Đã dừng process diễn tập; không đổi DB thật,
.env, DNS/domain, firewall, production hay commit. **Chờ lệnh phê duyệt rõ ràng của
người dùng trước mọi thao tác production/domain thật.**

## P24.1a — Dừng ghi plaintext mới (09/09/2026)

**DONE trong phạm vi P24.1a; C-01 PARTIAL. Scrub dữ liệu cũ vẫn OPEN (P24.1b).** Các nhận định create gym ghi plaintext ở checkpoint P10/P15/P24 phía trên là bằng chứng lịch sử trước bản sửa này; NO-GO không thay đổi.

- `routes/master.js`: bỏ dùng credential client gửi; sinh temporary password 32 random bytes, hash Argon2id theo P03 vào `auth_principals.password_hash`, `must_rotate=1`. Tombstone `disabled:` + 32 random bytes độc lập đáp ứng `gyms.admin_code NOT NULL UNIQUE` và không dùng cho auth. Không thêm schema, không update bất kỳ gym cũ nào.
- Hash async thực hiện trước transaction (không ghi DB); insert gym/principal/season và khởi tạo round đều nằm trong transaction đồng bộ. Lỗi ghi giữa chừng trả lỗi chung 409 và rollback toàn bộ, không trả credential.
- Response thành công `no-store` giữ key `gym.admin_code` cho UI hiện tại, nhưng chứa temporary password một lần, không phải tombstone DB; không có endpoint đọc lại. Client `admin_code` bị bỏ qua. Master mất response phải dùng reset hiện có. Không rollback về binary chỉ hiểu plaintext/header cho gym mới.
- `test/session-test.js`: test create/login/reset, `must_rotate`, legacy `/verify` 404 và header 401, password client/tombstone không login được, list/retry không lộ credential; quét SQLite serialized pages và log không chứa mật khẩu tạo/reset; fixture plaintext cũ giữ nguyên. Fault injection sau insert principal/season/round xác nhận rollback mọi bảng liên quan.
- `node --test test/auth-test.js test/session-test.js test/request-security-test.js`: **31 PASS / 1 FAIL / 0 skip**; FAIL duy nhất `test/auth-test.js:132` là P15-Q1 đã biết (PORT=0, thiếu TRUST_PROXY, chờ log cũ), không sửa ngoài phạm vi. Hai test P24.1a PASS.
- `node test/master-routes-smoke-test.js`: **50 PASS / 0 FAIL**. Log local ở `tmp/p24-1a/auth-results.txt` và `tmp/p24-1a/master-results.txt`. Không chạy full suite, không thao tác dữ liệu thật, không commit.

Rủi ro còn lại: plaintext cũ vẫn tồn tại, P24.1b chưa thực hiện; regression P15-Q1 và các gate P24 khác vẫn mở. Không coi P24.1a là bằng chứng hoàn tất phase C hoặc phê duyệt go-live.
