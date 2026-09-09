# P22 — checkpoint tiếp nối 09/09/2026

**DONE — P22 riêng 12 PASS/0 FAIL/0 skip; full regression đã chạy đủ một lần ở lượt xác nhận cuối: 243 PASS/8 FAIL/0 skip. H-05 vẫn BLOCKED.** Không thay kết luận GO/NO-GO của P24.

## Hiện trường trước khi sửa

- Git branch `master` chưa có commit, toàn bộ source untracked. Không có diff baseline để quy file cho phiên trước; không reset/ghi đè source và không commit.
- `test/security-e2e-test.js` đầy đủ cú pháp và đã có tất cả nhóm P22. Không viết lại từ đầu.
- Không có thư mục `%TEMP%/gvg-p22-*` bỏ sót trước lần chạy. `tmp/p22` chỉ chứa log. Các thư mục fixture/bằng chứng P24 riêng được giữ nguyên, không chạy lại P23/P24.
- Chạy lại `npm run test:p22`: **10 PASS / 2 FAIL / 0 skip** (11 subtests: 10 xanh, 1 XSS timeout; FAIL còn lại là parent). Log: `tmp/p22/resume-initial.log`.
- Đã xác nhận xanh trước sửa: Master/Gym UI login sai/đúng, refresh, idle/absolute expiry độc lập, re-login, logout, cookie replay; cross-gym/foreign IDs; public endpoint denial; CSRF; brute-force; upload giả; error disclosure.

## Nhóm hoàn tất, đã xanh

- XSS: sửa điều hướng và locator theo DOM thực tế; mở tab Gyms ở Master, scope member ở Gym và heading ở Dashboard. Giữ kiểm tra payload literal hiển thị, sentinel không chạy và không có handler/tag nguy hiểm. Bổ sung xác nhận tên đã lưu DB và URL `javascript:` bị 400/không đổi dữ liệu. Gym name legacy chỉ seed trong DB fixture vì không có API đổi tên.
- Public: toàn bộ business admin route hiện có của Master/Gym và session/change-password bị 401 kể cả forged CSRF/legacy credential headers; public state vẫn 200; DB/upload không đổi.
- Upload giả: SVG, text và chữ ký PNG giả bị 400/không tạo file; PNG hợp lệ được lưu/serve đúng MIME; hết budget trả 429/Retry-After.
- Disclosure: 404, malformed JSON có secret canary, lỗi DB thật trả envelope chung/request ID; không lộ SQL, stack, canary hoặc đường dẫn Windows.
- `npm run test:p22`: **12 PASS / 0 FAIL / 0 skip** (11 subtests + parent), log `tmp/p22/resume-p22.log`.
- Fixture dùng SQLite `:memory:`, loopback port ngẫu nhiên, credentials test cố định, upload `mkdtemp`; không nhận DB/server/upload/secret production từ env. Browser chặn request ngoài origin local. Teardown đóng contexts/server/auth/DB, kiểm tra đường dẫn và symlink trước xóa đúng thư mục upload, assert không còn tồn tại.

## Lượt xác nhận cuối theo yêu cầu tiếp nối

- Git vẫn chưa có commit, source untracked; không thể khẳng định working tree sạch bằng diff. File P22 hoàn chỉnh, không có sửa code trong lượt này; SHA-256 `5d595e9be5a6d8e960d5695bc1cd112fbc1dc4e9b88cd342d6adbf1af7df2455`.
- Chạy riêng `node --test test/security-e2e-test.js`: **12 PASS/0 FAIL/0 skip**, exit 0; log `tmp/p22/verify-p22-final.log`.
- Đọc toàn bộ log cũ `tmp/p22/resume-regression.log`: **20/20 file đã hoàn tất**, kết thúc ở `sqlite-concurrency-test.js`, có summary của mọi file, process exit 1. **245 PASS/6 FAIL/0 skip**; log không bị cắt. Gym visual `390/member-edit` fail; Master visual PASS ở lượt cũ này. Không dùng kết quả cũ thay cho lượt chạy cuối được yêu cầu.
- Chạy **đúng một lần** `node scripts/test-ci.js > tmp/p22/regression-final.log 2>&1` ở lượt xác nhận cuối, chỉ đọc sau process kết thúc. Exit **1**, lưu riêng tại `tmp/p22/regression-final.exit.txt`.
- **20/20 file hoàn tất, 16/20 file xanh; 243 PASS/8 FAIL/0 skip/0 cancelled**. Tổng là checks legacy cộng node:test có tính parent, không phải 251 test độc lập. Summary máy đọc: `tmp/p22/regression-final-summary.json`.
- SHA-256 log cuối: `72be8ee1dee5524472ebcca7db71dd4feb4feaf155ae53cefd0c8ab6fc31260c`.

| Suite file | PASS | FAIL | skip |
|---|---:|---:|---:|
| admin-xss-test.js | 5 | 3 | 0 |
| auth-test.js | 7 | 1 | 0 |
| backup-restore-test.js | 5 | 0 | 0 |
| dashboard-xss-test.js | 3 | 2 | 0 |
| deployment-test.js | 3 | 0 | 0 |
| engine-test.js | 32 | 0 | 0 |
| error-handling-test.js | 4 | 0 | 0 |
| frontend-session-test.js | 5 | 0 | 0 |
| frontend-ux-test.js | 41 | 0 | 0 |
| map-images-test.js | 5 | 0 | 0 |
| master-routes-smoke-test.js | 50 | 0 | 0 |
| master-xss-test.js | 7 | 2 | 0 |
| migrations-test.js | 12 | 0 | 0 |
| observability-test.js | 7 | 0 | 0 |
| release-test.js | 13 | 0 | 0 |
| request-security-test.js | 6 | 0 | 0 |
| security-e2e-test.js | 12 | 0 | 0 |
| security-headers-test.js | 3 | 0 | 0 |
| session-test.js | 18 | 0 | 0 |
| sqlite-concurrency-test.js | 5 | 0 | 0 |
| **Tổng** | **243** | **8** | **0** |

## Đối chiếu 5 lỗi gốc P24

| Baseline P24 | Lượt cuối P22 | Kết luận trong phạm vi này |
|---|---|---|
| Auth CLI startup fixture | `auth-test.js:152`: `startup exited` | Còn tái hiện; không sửa P15-Q1 |
| Gym workflow timeout | `admin-xss-test.js:221`: timeout 7000ms chờ `#member-list .list-row` | Còn tái hiện; không sửa P15-Q2/P23-Q1 |
| Dashboard visual `390 dashboard` | Cùng subtest/assertion `dashboard-xss-test.js:80`, nhưng mismatch **1440 dashboard** | Vị trí mới, chưa xác minh cùng nguyên nhân; không báo 390 fail ở lượt cuối |
| Master visual `390/edit` | Cùng subtest/assertion `master-xss-test.js:226`, nhưng mismatch **390/preview**, dimensions 390×1664, maxDelta=2, changedPixels=21851 | Vị trí mới, chưa xác minh cùng nguyên nhân; không báo edit fail ở lượt cuối |
| P22 stored-XSS timeout | Subtest stored-XSS và parent P22 đều PASS; suite **12/0/0** | Đã đóng, cả lỗi gốc và parent biến mất |

**Lỗi ngoài danh sách 5 lỗi gốc P24 — ghi riêng:** Gym visual `admin-xss-test.js:189`: `Layout changed at 1440/wizard`. P24 ghi Gym visual PASS ở lượt audit của nó (có lịch sử failure); log resume cũ fail ở `390/member-edit`. Đây là failure bổ sung so với danh sách baseline P24, không kết luận do sửa P22 gây ra và không tự sửa/nới assertion/baseline. Hai biến thể vị trí Dashboard/Master ở bảng trên cũng cần điều tra riêng, chưa chứng minh cùng root cause.

8 FAIL hiện gồm **5 subtest gốc + 3 parent** (Gym, Dashboard, Master). So với P24 **240/9/0**, P22 loại 2 FAIL (stored-XSS + parent), Gym visual bổ sung 1 FAIL → còn 8; số PASS tăng 3 gồm 2 PASS P22, trừ 1 Gym visual, cộng 2 test P24.1a đã có sẵn trong session suite (18 thay vì 16). Không triển khai lại P24.1a trong task này.

## Checkpoint kết thúc

Tất cả nhóm P22 hoàn tất; không còn nhóm chưa bắt đầu hay file code đang sửa dở. Không cần chạy lại regression chỉ để lấy số liệu: log đầy đủ, exit code, digest và bảng trên đã lưu. Fixture P22 tự dọn; không còn `%TEMP%/gvg-p22-*` sau chạy. Log/ảnh QA được giữ làm bằng chứng; fixture P24 do script chủ động giữ receipt được giữ nguyên.

H-05 vẫn mở vì auth/workflow và visual failures, visual baseline phụ thuộc `tmp/p06–p08`, runner chưa chặn skip ở clean checkout. Không sửa runtime/test/baseline trong lượt xác nhận cuối, không sửa P23/P24, không đổi kết luận đầu PRODUCTION-READINESS, không commit hay chạm dữ liệu production.
