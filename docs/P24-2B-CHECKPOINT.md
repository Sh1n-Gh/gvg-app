# P24.2b — Fixture Gym workflow và Auth CLI startup

Ngày 10/09/2026. Không commit. Chỉ sửa hai test bên dưới và tạo checkpoint này. Không sửa production, validation, auth, visual harness hoặc baseline.

## Phạm vi và tái hiện

P24.2a có 253 PASS / 5 FAIL: **2 lỗi gốc thuộc phạm vi này + 1 parent Gym = 3 FAIL records**, không có parent Auth riêng. Hai records còn lại là Master visual và parent. Các flake Gym/Dashboard lịch sử vẫn chưa được đóng.

Working tree đầu phiên đã có `docs/PRODUCTION-GO-LIVE-PROMPTS.md` modified và `docs/P24-2A-CHECKPOINT.md` untracked; giữ nguyên các thay đổi đó. Không có AGENTS.md trong workspace theo danh sách file đã kiểm tra.

Toàn bộ stdout/stderr của mỗi lượt test được redirect ra file. Lượt tái hiện đúng phạm vi hoàn tất rồi mới đọc: [exact-before.log](../tmp/p24-2b/exact-before.log), exit 1, **0 PASS / 3 FAIL**. Gym POST trả 400, sau đó timeout 7000ms tại `#member-list .list-row` (dòng cũ 221). Auth báo `startup exited` tại dòng cũ 157; fixture cũ không thu stderr, nên không khẳng định log có exception proxy cụ thể. Đối chiếu source xác nhận thiếu TRUST_PROXY trước listen, PORT=0 không hợp lệ và sentinel stdout cũ.

Lệnh lọc đúng (dùng lại sau sửa, thay tên log):

```powershell
node --test --test-name-pattern='^P07 Gym Admin XSS and workflow regression$|CLI migration and production HTTP checkpoint work with explicit configuration' --test-skip-pattern='escape roundtrips|API names, IDs|wizard input values|avatar and Map URL|API failures stay|responsive before/after' test/admin-xss-test.js test/auth-test.js > tmp/p24-2b/exact-before.log 2>&1
```

**Sai lệch thực thi cần ghi rõ:** lượt đầu `target-before.log` chỉ chạy Auth; dòng PASS tên file Gym không phải workflow PASS. Lượt tiếp `gym-before.log` khớp parent nên Node chạy cả 7 test con Gym (gồm visual ngoài dự kiến), 6 PASS / 2 FAIL. Sau khi phát hiện đã thêm skip-pattern như trên để chạy đúng hai case. Không chạy full suite trước sửa, không sửa visual; đây vẫn là chạy thừa ngoài yêu cầu “đúng 2 case”, không che giấu bằng cách bỏ log. Có đọc log Gym đang ghi ở lượt ngoài dự kiến; lượt exact và lượt full được phân tích sau hoàn tất.

## Thay đổi cụ thể

### Gym avatar — DONE

- `test/admin-xss-test.js:221–229`, hunk `@@ -218,8 +218,15 @@`: giữ lần gửi `javascript:alert(1)` làm negative case, đợi đúng response `/members/bulk`, assert 400 và bảng members vẫn rỗng; sau đó dùng `/assets/pokemon-types/fire.svg` cho positive workflow và assert URL lưu trong DB.
- Reset danh sách request sau negative case để assertion cũ **4 mutations nghiệp vụ có CSRF** tiếp tục đếm trọn create/edit member và create/edit log. Không bỏ/nới assertion cũ, không tăng timeout.
- Contract `security/validation.js:20–31,76–78`: avatar_url tùy chọn; nếu có phải là chuỗi well-formed tối đa 2048 ký tự, cho phép rỗng; URL tương đối hoặc HTTP(S), không credentials, whitespace, control characters, dấu ngoặc nhọn, quote, backtick, backslash hay `//` đầu chuỗi. Không validate MIME/dung lượng file ảnh ở field URL này. Member cần name không rỗng tối đa 120 ký tự; bulk tối đa 500 phần tử; JSON ứng dụng giới hạn 128 KiB. Fixture hợp lệ khớp contract hiện tại.
- Giữ nguyên fixture DB map độc hại và các kiểm tra XSS hiện hữu. Không có lỗi workflow khác xuất hiện sau khi avatar hợp lệ.

### Auth CLI startup (P15-Q1) — DONE

- `test/auth-test.js:139–150`, hunk `@@ -136,10 +136,16 @@`: chọn port trống trên loopback rồi đóng socket chọn port; truyền port thực (1–65535), `TRUST_PROXY=127.0.0.1`, `LOG_LEVEL=info`. Giữ production HTTPS origin, migration schema/credentials và secrets fixture.
- `test/auth-test.js:161–192`, hunk `@@ -152,11 +158,38 @@`: parse JSON theo dòng (kể cả chunk bị tách), chờ event `server_started` thay `http://localhost`; thu tên event được allowlist, exit code và số byte stderr cho chẩn đoán an toàn, không dump secrets/env hay nội dung stderr tùy ý.
- Gửi HTTP thực tới loopback `/ready` với Host khớp origin và forwarded proto HTTPS, assert status 200, JSON `{status:'ok'}` và stderr rỗng. Timeout startup giữ 5000ms. Không sửa logic auth hoặc các negative tests cấu hình khác.
- Contract nguồn: `security/deployment.js:5–6,30–33`, `server.js:25–34,113`, `security/observability.js` (JSON event và LOG_LEVEL).
- Giới hạn fixture: có khoảng thời gian giữa đóng socket chọn port và child bind; tranh chấp port sẽ làm test FAIL rõ, không retry che lỗi. Lượt xác nhận không gặp tranh chấp.

## Kết quả xác nhận

[exact-after.log](../tmp/p24-2b/exact-after.log), exit 0: **3 PASS / 0 FAIL**, gồm workflow Gym, parent Gym và Auth CLI. Không thêm test record mới; các assertion mới nằm trong case cũ.

Full regression chạy **đúng một lần sau sửa**: `node scripts/test-ci.js > tmp/p24-2b/full-regression.log 2>&1`. Bắt đầu 08:39:29.596 +07:00, kết thúc 08:43:24.841 +07:00, exit **1**. **21/21 file hoàn tất, 20 file xanh; 256 PASS / 2 FAIL / 0 skip / 0 cancelled = 258 records/checks**, cùng cách đếm parent và legacy checks như P24.2a.

| Phần | P24.2a PASS/FAIL | P24.2b PASS/FAIL | Đối chiếu |
|---|---:|---:|---|
| Gym (admin-xss) | 6/2 | 6/2 | Workflow đã PASS; visual FAIL 390/member-edit khiến parent vẫn FAIL |
| Auth | 7/1 | 8/0 | CLI startup/readiness PASS |
| Master visual suite | 7/2 | 9/0 | PASS lần này, không đóng flake |
| Các file còn lại | 233/0 | 233/0 | Không thêm FAIL; Dashboard PASS |
| **Tổng** | **253/5** | **256/2** | **+3 PASS, −3 FAIL**; không phải cùng một tập FAIL |

**Bất ngờ ngoài phạm vi:** Gym visual trước đó PASS nhưng lượt full này FAIL tại `390/member-edit`, `test/admin-xss-test.js:189` với `Layout changed at 390/member-edit`. Parent Gym FAIL do visual, không còn do workflow. Đây là vị trí từng được ghi trong lịch sử P22 ở checkpoint P24.2a; không khẳng định cơ chế renderer chỉ từ lần chạy này. Master 390/edit không FAIL lần này. Không rerun full/visual, không sửa baseline, tolerance hoặc sản phẩm để làm xanh. Runner tự ghi ảnh tmp như thường lệ.

**H-05 sau P24.2b: còn 2 FAIL records hiện hành = 1 visual case Gym + 1 parent. Hai lỗi gốc fixture đã DONE.** Về tồn đọng cho P24.2c, cả ba vấn đề visual lịch sử (Master, Gym, Dashboard) vẫn chưa được giải quyết/chứng minh ổn định; PASS một lượt không đóng chúng. H-05 vẫn BLOCKED, không tuyên bố regression xanh hay GO.

Artifacts: [full log](../tmp/p24-2b/full-regression.log), [summary theo file](../tmp/p24-2b/summary.json), [exit](../tmp/p24-2b/full-exit.txt), [start](../tmp/p24-2b/full-start.txt), [end](../tmp/p24-2b/full-end.txt), [diff đầy đủ của hai test](../tmp/p24-2b/fixture.diff). SHA-256 full log: `9535D24427A14B6CB53E9ECCC4A7832F2CFFCF0FDE1EAAFDF38B2C1182A7BD0E`.

`git diff --check` không báo lỗi whitespace. File thay đổi bởi phiên này: **test/admin-xss-test.js, test/auth-test.js, docs/P24-2B-CHECKPOINT.md**; artifacts log/diff nằm trong tmp. Không sửa các file đã có thay đổi đầu phiên, không sửa code sản phẩm, không commit. Không phát hiện vấn đề cần đổi code/API sản phẩm để fixture pass nên không có yêu cầu xin ý kiến sửa sản phẩm.
