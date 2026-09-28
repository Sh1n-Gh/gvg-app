# P24.2h — Toàn bộ visual suite non-blocking

10/09/2026. Phạm vi: đóng H-05 cho gate go-live bằng ngoại lệ toàn bộ visual suite; không commit.

## Cơ chế

- `npm run test:regression`: đủ 21 file, chỉ các subtest chức năng/bảo mật/dữ liệu chặn exit code. `scripts/test-ci.js` ép mode blocking để không bị biến môi trường monitoring bên ngoài vô tình loại kiểm tra chức năng.
- `npm run visual-monitoring`: chạy riêng ba parent visual trong admin-xss-test.js, dashboard-xss-test.js và master-xss-test.js, tuần tự và tiếp tục sang file sau khi file trước fail. Raw TAP, exit code, PASS/FAIL/skip/cancelled từng file ở `tmp/visual-monitoring/`; wrapper trả 0. Skip do thiếu baseline được summary đánh dấu FAIL, không báo xanh giả.
- `npm run test:ci`: regression trước, monitoring sau kể cả regression lỗi; exit cuối giữ đúng exit regression (spawn lỗi/signal → 1). Repo chưa có workflow CI provider; đây là entrypoint CI mới.
- `test/visual-suite-mode.js` phân luồng lúc đăng ký subtest, không tạo skip giả trong regression. Chạy trực tiếp ba file mặc định là functional; muốn visual dùng lệnh monitoring. Toàn bộ 3 subtest so ảnh chuyển sang monitoring, không chỉ hai case P24.2g.
- Bỏ hai skip-with-note P24.2g; Buffer equality Gym/Dashboard chạy trực tiếp trở lại. Giữ toàn bộ test bodies, assertions, baseline, tolerance, capture/readiness và state transitions. Master vẫn exact geometry và maxDelta ≤ 1. Monitoring bỏ biến chọn case/chặn polling của các probe để chạy cấu hình bình thường.
- Giữ nguyên hành vi dừng vòng visual tại assertion lỗi đầu tiên trong từng file; kết quả file FAIL không chứng minh các case sau đó đã chạy. Không retry tìm lượt xanh.

## Bằng chứng và kết quả

**DONE; H-05 PASS-with-known-issue.** Lượt chạy: `node scripts/test-ci.js`, sau đó `node scripts/visual-monitoring.js`, mỗi lệnh đúng một lần. Logs/exit ở `tmp/p24-2h/`.

- Regression: 14:01:55–14:05:16 +07:00, **255 PASS / 0 FAIL / 0 skip / 0 cancelled**, exit **0**, đủ 21/21 file. Gym functional 7 PASS, Dashboard functional 4 PASS, Master functional 8 PASS; P22 12 PASS. Tổng giảm từ 258 records gốc xuống 255 vì ba visual parent subtest chuyển ra ngoài gate; hai skip records bổ sung P24.2g đã bỏ. Không tăng PASS bằng cách tính visual được miễn trừ là xanh.
- Monitoring: 14:05:16–14:06:11 +07:00, **2 file PASS / 1 file FAIL**. Admin 2 PASS/0 FAIL, Dashboard 2 PASS/0 FAIL, Master 0 PASS/2 FAIL; raw tổng **4 PASS / 2 FAIL / 0 skip / 0 cancelled** gồm visual subtest và parent mỗi file, không phải số phép so ảnh. Child exits **0/0/1**, wrapper exit **0**.
- Master fail tại `768/preview`: dimensions 793×1445 hai phía, maxDelta **4**, changedPixels **20**; tolerance vẫn ≤ 1. Vòng dừng tại đó, các case sau chưa được kiểm chứng. Admin và Dashboard PASS một lượt không chứng minh hết flake.
- [Regression log](../tmp/p24-2h/full-regression.log), [summary](../tmp/p24-2h/summary.json), [visual log](../tmp/p24-2h/visual-monitoring.log), [visual summary](../tmp/p24-2h/visual-summary.json). Raw exit files: [regression](../tmp/p24-2h/full-exit.txt), [monitoring](../tmp/p24-2h/visual-exit.txt). Logs dưới tmp ignored; kết quả quan trọng lưu ngay trong checkpoint này.

Kiểm tra harness bằng mock: phân luồng functional/visual đúng; CI giữ exit 0/1/signal của regression dù monitoring fail; cả ba visual child giả lập FAIL đều được log và wrapper vẫn exit 0. Syntax checks PASS. Không tính các probe này vào tổng regression.

## Lý do và tech debt

Điều tra [P24.2c](P24-2C-CHECKPOINT.md), [P24.2d](P24-2D-CHECKPOINT.md), [P24.2e](P24-2E-CHECKPOINT.md), [P24.2f](P24-2F-CHECKPOINT.md), [P24.2g](P24-2G-CHECKPOINT.md) liên tục lộ mismatch khác khi case trước được cô lập. Đây là dấu hiệu bất ổn harness/hạ tầng rộng; root cause chưa chứng minh. Quyết định P24.2h của người dùng chấp nhận toàn bộ so ảnh non-blocking cho go-live, không tuyên bố đã sửa flake.

Tech debt sau go-live: điều tra browser/render/compositing/timing và tương tác trạng thái; làm baseline local ignored tái lập trên checkout sạch; ghi nhận các case bị che bởi early-stop; có bằng chứng suite ổn định trước đề xuất đưa visual về blocking. Rủi ro chấp nhận: thay đổi hình ảnh có thể lọt gate dù monitoring FAIL. Các assertion bảo mật/chức năng/dữ liệu vẫn blocking. Không tự nâng các gate khác hoặc phê duyệt production.
