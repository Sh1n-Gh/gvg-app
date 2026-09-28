# P24.2g — Cô lập hai visual known issue

10/09/2026. **PARTIAL: cô lập DONE, H-05 vẫn BLOCKED do FAIL ngoài ngoại lệ.** Không commit, không sửa code sản phẩm, baseline, tolerance hoặc logic khác.

## Cơ chế

`test/admin-xss-test.js` và `test/dashboard-xss-test.js`: dùng context của visual test để đăng ký đúng một subtest `skip-with-note` cho Gym `390/member-edit` và Dashboard `1440/dashboard`. Giữ nguyên assertion Buffer equality trong callback bị skip; các case khác vẫn assert trực tiếp và chặn CI. Screenshot và state transitions vẫn chạy để giữ lịch sử trang cho các case kế tiếp. Không retry, không skip cả suite. Comment và skip reason trỏ tới [P24.2c](P24-2C-CHECKPOINT.md) và [P24.2f](P24-2F-CHECKPOINT.md).

Hai ngoại lệ visual-only có root cause chưa xác định: Gym 5002 pixels/bbox [0,255,389,636], Dashboard 58404 pixels/bbox [0,255,1439,935]. Chúng không được báo là assertion PASS; rủi ro là mất kiểm tra pixel ở hai case trong thời gian cô lập.

## Full regression — đúng một lượt

`node scripts/test-ci.js > tmp/p24-2g/full-regression.log 2>&1`

Bắt đầu 13:52:27 +07:00, kết thúc 13:56:30 +07:00. Exit **1**; 21/21 file hoàn tất, 20 file xanh. **256 PASS / 2 FAIL chặn CI / 2 known-issue SKIP / 0 cancelled = 260 records/checks**. Hai subtest SKIP mới bổ sung vào 258 records/checks cũ, không tăng số PASS bằng cách tính ngoại lệ là PASS.

- Gym: 6 PASS / 2 FAIL / 1 known-issue SKIP. FAIL tại `768/wizard` (`Layout changed at 768/wizard`) và parent Gym. Workflow PASS. Vòng visual dừng tại mismatch nên các case phía sau chưa được thực thi.
- Dashboard: 5 PASS / 0 FAIL / 1 known-issue SKIP.
- Master: 9 PASS / 0 FAIL; các file còn lại PASS.
- So P24.2b 256/2: tổng PASS/FAIL giữ nguyên, nhưng lỗi visual chuyển từ `390/member-edit` sang `768/wizard`; không phải cùng tập FAIL. Không chứng minh thay đổi cô lập gây ra mismatch này, cũng không có bằng chứng mọi visual khác đã ổn định.

[Full log](../tmp/p24-2g/full-regression.log), [summary theo file](../tmp/p24-2g/summary.json), [exit](../tmp/p24-2g/full-exit.txt), [start](../tmp/p24-2g/full-start.txt), [end](../tmp/p24-2g/full-end.txt). Không rerun để tìm lượt xanh, không mở rộng ngoại lệ ngoài hai case được giao.

## Disposition

`PRODUCTION-READINESS.md` đã cập nhật ngoại lệ, lịch sử điều tra và kết quả hiện tại. **Không đổi H-05 sang PASS-with-known-issue** vì vẫn còn FAIL ngoài ngoại lệ. Cần xử lý hoặc quyết định riêng về Gym `768/wizard` trước khi có thể đóng H-05 trung thực. NO-GO và các gate khác không được nâng trạng thái.

Giữ nguyên các chỉnh sửa có sẵn đầu phiên trong auth, visual diagnostic/readiness, các checkpoint P24.2a–f và PRODUCTION-GO-LIVE-PROMPTS. Phiên này chỉ sửa hai test ở phần cô lập và tài liệu H-05; artifacts ở tmp/p24-2g.
