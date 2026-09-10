# P24.1e — Xác nhận cuối C-01 local (10/09/2026)

**DONE — C-01 PASS local trong phạm vi bằng chứng a→d; live scrub OPEN. NO-GO / P24 BLOCKED giữ nguyên; H-01/H-04/H-05/H-06 vẫn mở.**

## Điều kiện bắt đầu và phạm vi nghiệm thu

Đã đọc lại toàn bộ báo cáo a trong prompts/readiness, [b](P24-1B-CHECKPOINT.md), [c và d](P24-1C-CHECKPOINT.md) cùng results b/c. Git status trước khi bắt đầu sạch; HEAD là 77e528b (P24.1d). Không có thay đổi source sau bản sửa d trong working tree, không có căn cứ cần chạy lại suite đã kiểm chứng. Không chạy lại test, smoke, rehearsal hay full regression.

P24.1a/b/d DONE trong phạm vi tương ứng. Người dùng xác nhận phần ĐIỀU TRA/PHÂN LOẠI của c là DONE cho điều kiện bắt đầu e; giữ nguyên nhãn PARTIAL trong checkpoint c vì phản ánh nghiệm thu tại thời điểm trước d. Người dùng chấp nhận giới hạn scan dưới đây cho PASS local; đây không phải phê duyệt live rollout. Chỉ dòng C-01 trong readiness được cập nhật; phần đầu NO-GO và các nhận định P24.1c cũ giữ nguyên theo yêu cầu, đọc trạng thái C-01 mới tại bảng Critical và báo cáo e này.

## Tổng hợp bằng chứng a→e

| Bước | Trạng thái trong phạm vi | Bằng chứng đã có, không cộng thành một lượt test mới |
|---|---|---|
| a | DONE — dừng ghi plaintext mới | Password tạm CSPRNG 32 bytes, Argon2id principal, tombstone độc lập; response một lần/no-store; create/login/reset/no-disclosure và transaction rollback PASS. Auth/session/request-security 31 PASS/1 FAIL/0 skip (P15-Q1 cũ); Master smoke 50 PASS/0 FAIL. |
| b | DONE — script/test/rehearsal clone | 7/7 scrub tests PASS; bộ liên quan 38 PASS/1 FAIL/0 skip (P15-Q1), deployment 3 PASS. Clone 3 → 0 plaintext, HTTP login 3/3, lần hai no-op, rollback/crash/recovery PASS; SHA-256 DB/WAL nguồn không đổi. Runtime bootstrap fallback đã bỏ; live apply chưa thực hiện. |
| c | DONE phần điều tra/phân loại; giữ PARTIAL nghiệm thu lịch sử | 14 file: 86 PASS/14 FAIL/0 skip; Master smoke 50 PASS. Phân loại đúng 8 regression fixture do b (#7–14) và 6 records H-05 cũ (#1–6). Scan clone sạch trong phạm vi giá trị đã biết, ghi rõ fixture và giới hạn log/instrumentation. |
| d | DONE — sửa đủ 8 regression fixture | Provision Master bằng flow hiện có trong hai fixture; không sửa production hoặc khôi phục fallback. Error-handling 4 PASS + observability 7 PASS = 11 PASS/0 FAIL. Bốn file auth/session/request-security/scrub: 38 PASS/1 FAIL. Tổng d 49 PASS/1 FAIL/0 skip/0 cancelled; lỗi duy nhất P15-Q1 cũ. Các records H-05 còn lại không chạy lại, không đóng. |
| e | DONE — xác nhận bằng chứng và scan cuối | Chạy đúng một lần scanner hiện có trên source HEAD 77e528b; không chạy lại suite. 87 file, 3 match credential clone và 13 match mẫu fixture bổ sung, giống c; clone integrity OK, 0 non-tombstone, 0 match mọi cột/bytes, digest không đổi; log c 0 match đã biết. |

## Phạm vi PASS local và hai loại giới hạn

- **ĐÃ ĐÓNG:** 8 regression fixture #7–14 do P24.1b, đã FIX và assertions mục tiêu PASS ở d. Không còn regression fixture liên quan C-01 trong phạm vi bằng chứng đã kiểm chứng. Bằng chứng a/b/d xác nhận không ghi credential plaintext mới và scrub idempotent trên clone.
- **CÒN CHẤP NHẬN, không chặn PASS local:** scanner chỉ tìm giá trị đã biết; không tập hợp password sinh động trong mọi response/log tiến trình con, một số logger no-op/capture riêng; chưa có instrumentation toàn diện cho success/error create/reset/scrub. Không quét dependency, Git history, backup ngoài repo, artifact tmp trong source scan hoặc secret chưa biết/đã encode. Các mẫu plaintext fixture còn trong source không phải regression mới; không tuyên bố source sạch mọi plaintext hay mọi log đều sạch.

**Ngoài phạm vi local:** chưa áp dụng hoặc phê duyệt scrub DB thật; CLI hiện tại clone-only. Các failure H-05 lịch sử vẫn mở, không dùng PASS local này để đóng full regression hay đổi NO-GO. Điều kiện live rollout bên dưới giữ nguyên từ c.

## Scan cuối và bảo toàn bằng chứng

Chạy duy nhất một lần `node scripts/scan-p24-1c.js` (exit 0), qua wrapper lưu kết quả mới vào [P24-1E-RESULTS.json](P24-1E-RESULTS.json) và khôi phục nguyên bytes results c sau khi scanner ghi output mặc định. Bỏ trường relatedTests hardcode lịch sử c khỏi results e để không hiểu nhầm đã chạy lại test. Scan chỉ mở read-only hai clone b và đọc log c có sẵn; không mở DB nguồn/DB thật. Kết quả không chứa password/key. Không có regression plaintext mới được phát hiện trong phạm vi scan so với c; scan không thay thế các giới hạn nêu trên.

## Điều kiện rollout DB thật — nguyên văn từ P24.1c

Nguồn: mục “Điều kiện áp scrub lên DB thật — chưa được phê duyệt” trong [P24.1c](P24-1C-CHECKPOINT.md). Sao nguyên văn đầy đủ để tham chiếu, không thêm điều kiện mới:

1. **Ai duyệt:** người dùng/chủ sở hữu hệ thống phải phê duyệt tường minh một rollout riêng, DB đích, phạm vi gym, script/version, lịch, người thao tác, người kiểm chứng và quyền resume/rollback. Hiện chưa có tên người chịu trách nhiệm vận hành được chỉ định; không coi Codex, DONE a/b/c hoặc báo cáo này là phê duyệt. Người phụ trách DB/backup phải xác nhận khả năng khôi phục; người phụ trách gym xác nhận danh sách người nhận và kênh bàn giao.
2. **Backup trước chạy:** chốt snapshot nhất quán DB + uploads/season, bao gồm committed WAL; dừng writers/checkpoint theo runbook. Backup mã hóa ngoài web root/repo, ACL thực tế (đặc biệt Windows), checksum/integrity và restore drill vào đường dẫn mới; kiểm chứng khóa khôi phục, RPO/RTO, dung lượng và rollback. Không xóa backup để đạt scan sạch. H-04 vận hành vẫn OPEN.
3. **Thời điểm bảo trì:** lịch cụ thể và múi giờ phải được duyệt, thông báo trước; dừng app và mọi job/writer, khóa thao tác migration. Kiểm tra đúng DB/version/principal/count; chuẩn bị Master recovery. CLI hiện tại chỉ tạo clone mới, **không có lệnh live apply**; kế hoạch cutover/apply thật cần được xây dựng, review và duyệt riêng.
4. **Thông báo gym admin:** thông báo trước thời gian gián đoạn, session bị revoke, credential cũ ngừng dùng, cách nhận password mới và đầu mối hỗ trợ. Xác minh danh tính từng admin; sau commit, operator đối chiếu handoff hash với DB, bàn giao thủ công qua kênh riêng được duyệt, không gửi password qua log/group chat. Giữ key tách khỏi handoff, ACL riêng; xác nhận đã nhận và đăng nhập/đổi password. `must_rotate` hiện là grace period, không cưỡng chế mọi thao tác. Chưa gửi email/tin nhắn nào.
5. **Sau chạy và resume:** count/scan cột + bytes/WAL/journal, login/change/reset/revoke, deleted gym, idempotence và recovery; người kiểm chứng ký nhận trước người có thẩm quyền cho resume. Lập retention/purge được duyệt cho backup/WAL/snapshot chứa plaintext cũ. Cleanup sau commit lỗi thì giữ offline, không giả định transaction rollback. Restore DB chỉ sang đường dẫn mới và cutover khi được duyệt, cân nhắc business writes; không quay lại plaintext/header auth.

## Kết thúc

Chỉ cập nhật tài liệu và lưu scan cuối; giữ nguyên checkpoint/results c, không sửa source/test, không apply DB thật, không commit. Dừng tại P24.1e. Live rollout cần phê duyệt riêng theo mục trên.
