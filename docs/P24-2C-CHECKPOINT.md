# P24.2c — Thu thập flaky toàn bộ visual suite (H-05)

Ngày 10/09/2026. **DONE thu thập 10/10 lượt; H-05 vẫn BLOCKED. Không commit, không sửa test/code/baseline/tolerance/assertion.** Gym visual FAIL 10/10, Dashboard 5/10, Master 4/10. Không có lượt suite xanh. Có pattern vùng pixel lặp lại ở một số case, nhưng **chưa xác định root cause hoặc cơ chế chung**. Không mô tả kết quả là “ngẫu nhiên hoàn toàn”.

## Phạm vi và lệnh chính xác

Không có npm script visual riêng. Ba subtest có assertion so ảnh nằm trong ba file sau; mọi viewport là **390, 768, 1440**, đặt height=900 và chụp fullPage nên kích thước PNG thực có thể khác viewport.

| Thứ tự file CI | File và subtest visual | Thứ tự views trong từng viewport | Số cặp tối đa |
|---:|---|---|---:|
| 1 | test/admin-xss-test.js:169 — responsive before/after screenshots | members, member-edit, wizard, entries, entry-edit | 15 |
| 2 | test/dashboard-xss-test.js:70 — before/after pixel equality across four public tabs at 390/768/1440 | dashboard, leaderboard, log, seasons | 12 |
| 3 | test/master-xss-test.js:186 — before/after Master responsive screenshots | dashboard, edit, preview, gyms, requests | 15 |

Tổng **42 case × 10 lượt = 420 cơ hội quan sát**. Đã đối chiếu toàn bộ test có screenshot/comparison: test/frontend-session-test.js:84–86 chỉ lưu ảnh minh họa cho workflow session và kiểm tra overflow, không có assertion so ảnh; scripts/qa-p23.js cũng chỉ chụp ảnh. Không chạy hai phần đó trong visual regression này. Không chạy Auth CLI hoặc workflow Gym.

Lệnh một lượt (PowerShell, từ root repository), giữ cách CI spawn tuần tự và tiếp tục sau failure:

```powershell
$visualArgs = @(
  '--test',
  '--test-reporter=tap',
  '--test-name-pattern=P0[678] |responsive before/after screenshots|before/after Master responsive screenshots|before/after pixel equality',
  '--test-skip-pattern=escape|API names|wizard input|avatar and Map|API failures|real session|all public renderers|API error remains|API Gym/season|persisted preview|all list/API|PNG/JPEG preview|unsafe upload'
)
$visualFailed = $false
foreach ($visualFile in @('test/admin-xss-test.js', 'test/dashboard-xss-test.js', 'test/master-xss-test.js')) {
  & node @visualArgs $visualFile
  if ($LASTEXITCODE -ne 0) { $visualFailed = $true }
}
# $visualFailed là kết quả tổng; không lấy riêng exit của file Master cuối.
```

Parent phải được match để Node đi vào subtest; skip-pattern loại toàn bộ sibling không visual. Đã xác nhận bằng TAP mỗi file chỉ có **1 leaf visual + 1 parent**, không có sibling chạy thừa, không có skip/cancel. Lệnh thực tế thu 10 lượt: `node tmp/p24-2c/collect.cjs`. Collector chỉ gọi đúng các argv trên, redirect stdout/stderr cùng log, lưu UTC start/end/exit và sao chép output sau mỗi file. Chi tiết argv nguyên bản ở mỗi log và [configuration.json](../tmp/p24-2c/configuration.json).

Không chạy thử suite trước 10 lượt và không rerun test sau đó. Không kill process ngoài, xóa cache, đổi env, reset dữ liệu hoặc browser giữa lượt. Browser mới/đóng browser là hành vi sẵn có của từng parent; giữa lượt chỉ lưu metadata/copy ảnh, không sleep nhân tạo. Việc phân tích pixel bằng Sharp diễn ra **sau** khi cả 10 lượt hoàn tất. Có đọc tiến độ TAP và metadata trong lúc thu thập. Đây là workload visual-only theo yêu cầu, không tái tạo phần tải từ các test không visual của full regression.

Môi trường: Windows, Node v24.19.0, Playwright 1.62.1, Edge headless 152.0.4191.66 (msedge mặc định), Sharp 0.35.4. HEAD `4bb04234b84f42a401d5f1cbfecfdca21d24aa59`. Baseline JS hiện hữu trong tmp/p06–p08; không tạo/update baseline. [environment.json](../tmp/p24-2c/environment.json).

## Cách đọc dữ liệu và giới hạn

- Mỗi nhóm dừng tại assertion FAIL đầu tiên. Case sau đó là **NR**, tuyệt đối không suy PASS từ ảnh cũ. Collector so mtime trước/sau file và chỉ copy ảnh/comparison vừa được ghi; analyzer yêu cầu cả before/after mới. Ảnh cũ còn trong tmp/p06–p08 không được dùng làm dữ liệu lượt này.
- Gym/Dashboard dùng PNG Buffer equality, log không có pixel count; số pixel/% được tính offline từ RGBA bằng Sharp, một pixel tính một lần nếu bất kỳ channel khác. Master dùng geometry equality + decoded maxDelta ≤ 1 hiện hữu; comparison JSON gốc được lưu riêng, số đo offline đối chiếu với log. Cả 19 FAIL là mismatch ảnh, không phải timeout/startup/geometry FAIL. Tên lỗi Gym “Layout changed” chỉ là message của Buffer equality, không chứng minh đổi hình học DOM.
- Bảng case ghi FAIL/10 theo yêu cầu, kèm PASS/NR và FAIL/số thực chạy; FAIL/10 không phải ước lượng xác suất của case nếu có NR. Thời gian mỗi lượt/nhóm là đồng hồ thực; visual duration lấy TAP. JSON còn có thứ tự cặp thực tế và timestamp mtime before/after; khoảng giữa hai timestamp chụp không phải toàn bộ duration case. Không có CPU/RAM/DOM/compositor trace hoặc timer cho từng assertion.
- 238 cặp PASS, 19 FAIL, 163 NR. Node TAP: 30 leaf + 30 parent = 60 records, 22 PASS / 38 FAIL; 19 parent FAIL chỉ lan truyền 19 leaf FAIL, không phải 19 lỗi độc lập bổ sung.

## Pattern quan sát và phân loại

| Nhóm visual | PASS/10 | FAIL/10 |
|---|---:|---:|
| Gym | 0 | 10 |
| Dashboard | 5 | 5 |
| Master | 6 | 4 |

**Cấp case:** chỉ Master 390/dashboard PASS đủ 10/10. Không case nào FAIL đủ 10/10. Có 12 case có cả PASS lẫn FAIL trong các lần thực chạy; đây là bằng chứng kết quả không ổn định, chưa chứng minh một quá trình ngẫu nhiên. Gym 1440/entries FAIL 1/1 lần quan sát, 9 NR, chưa thể gọi luôn FAIL. Gym 1440/entry-edit NR 10/10 nên hoàn toàn chưa có dữ liệu. 28 case chỉ thấy PASS khi thực chạy (bao gồm Master 390/dashboard), nhưng 27 trong số đó thiếu ít nhất một lượt.

Ba case được quan tâm: **Master 390/edit 1 FAIL/10, 9 PASS; Gym 390/member-edit 3 FAIL/10, 3 PASS, 4 NR; Dashboard 1440/dashboard 2 FAIL/10, 5 PASS, 3 NR.** Gym dừng ở thứ tự nội bộ 1, 2, 9, 10 hoặc 14; Dashboard ở 1, 5, 6 hoặc 9; Master ở 2, 7, 12 hoặc 13. Không có một vị trí dừng cố định.

**So ảnh:** đã xem trực tiếp 3 diff maps offline: Gym 390/member-edit lượt 02 và 03, Master 768/edit lượt 05. Hai ảnh Gym giống nhau về vùng lệch, thành các dải và mép bên trong bbox [0,255,389,636]; Master chỉ có vài điểm nhỏ rời nhau, bbox [1,247,766,601]. Bbox lớn không có nghĩa mọi pixel bên trong đều lệch. Các số đo toàn bộ artifacts bổ sung:

- Gym 390/member-edit lượt 02/03/09: đúng 5.002 pixel, maxDelta 2; mask IoU=1 cho mọi cặp lượt (intersection=union=5.002).
- Gym 390/members lượt 05/06/07/10: đúng 4.779 pixel, maxDelta 2; mọi mask IoU=1.
- Dashboard 1440/dashboard lượt 04/06: đúng 58.404 pixel, maxDelta 1; mask IoU=1.
- Ngoại lệ về độ lớn: Dashboard 768/leaderboard lượt 08 chỉ 3 pixel; Master 768/edit lượt 05 chỉ 22 pixel; Master 1440/edit và preview hơn 106 nghìn pixel. Toàn bộ FAIL có maxDelta 1–4, cùng kích thước before/after; không phải mọi FAIL cùng một mặt nạ. IoU chỉ xác nhận tọa độ pixel đổi, không xác nhận chiều đổi màu hoặc cơ chế.

Vì vậy **đã thấy pattern lặp vùng ở một số case, chưa thấy một pattern chung giải thích toàn suite**. Không suy đoán font, animation, timing, race hay GPU từ các dữ liệu này; kết quả không đủ để kết luận bug render thật hoặc một lỗi harness cụ thể.

**Thời gian:** mỗi lượt 44,210–57,760 giây. Dashboard visual PASS 8,209–8,407 giây (median 8,248), FAIL 5,208–7,494 (median 7,061). Master PASS 13,311–14,907 (median 13,815), FAIL 6,632–13,095 (median 11,131). Gym FAIL 5,293–12,637 (median 5,645), không có mẫu PASS để đối chiếu. FAIL ngắn hơn đi cùng vòng lặp dừng sớm theo source; không có bằng chứng thời gian ngắn là nguyên nhân lỗi. Không ghi nhận timeout hoặc lượt kéo dài vượt timeout. Dữ liệu không đo mức tranh chấp tài nguyên.

**Viewport:** 390 có 9 FAIL/109 quan sát (31 NR); 768 có 5/87 (53 NR); 1440 có 5/61 (79 NR). FAIL có ở cả ba, không riêng mobile. Số mẫu 1440 bị giảm vì chạy sau; không thể kết luận viewport nào rủi ro hơn từ các số này. File order luôn Gym→Dashboard→Master, viewport order cố định; chưa kiểm định được ảnh hưởng nhân quả của thứ tự/tài nguyên chung. Không xác định được pattern thời gian/thứ tự đủ rõ, cần thêm dữ liệu hoặc thay đổi cách đo.

## Hướng tiếp theo cho P24.2d — chỉ đề xuất

1. Ưu tiên lấp phần thiếu quan sát: nếu được cho phép thay cách đo, thu từng case độc lập hoặc ghi đầy đủ lỗi mà không dừng capture, đồng thời giữ nguyên tiêu chí PASS/FAIL. Gym 1440/entry-edit hiện chưa được quan sát lần nào; không đóng ổn định cho case này.
2. Dùng các mặt nạ lặp lại làm tọa độ mục tiêu để thu geometry/computed-state và timestamp tại trước/after capture. Kiểm tra riêng các mismatch vài pixel và các vùng rộng trước khi gộp cơ chế. Chỉ đề xuất fix render khi có bằng chứng trạng thái/render sai ở vùng đó; cùng vùng lệch chưa tự chứng minh cần sửa code.
3. Muốn kiểm định thứ tự/tài nguyên: thiết kế lượt đổi thứ tự có kiểm soát, đo duration theo case và CPU/RAM cùng lúc. Muốn thay wait hoặc ổn định harness: trước hết cần bằng chứng capture xảy ra khi trạng thái chưa ổn định. Không đề xuất tự tăng wait, nới tolerance hoặc cập nhật baseline từ dữ liệu hiện tại.

## Bảng dữ liệu đầy đủ

P = PASS theo assertion hiện tại; F = FAIL, số pixel RGBA khác biệt (%, max channel delta); NR = NOT RUN do vòng lặp dừng ở failure trước. Pixel metrics Gym/Dashboard được tính offline, không phải log harness. Master giữ tolerance sẵn có maxDelta ≤ 1; PASS không nhất thiết là pixel diff 0.

## Thời gian mỗi lượt (UTC; giờ Việt Nam = UTC +07:00)

| Lượt | Bắt đầu | Kết thúc | Giây | Gym | Dashboard | Master | Exit |
|---|---|---|---:|---|---|---|---:|
| run-01 | 2026-09-10T01:53:45.629Z | 2026-09-10T01:54:43.389Z | 57.760 | FAIL | PASS | PASS | 1 |
| run-02 | 2026-09-10T01:54:43.392Z | 2026-09-10T01:55:30.898Z | 47.506 | FAIL | FAIL | PASS | 1 |
| run-03 | 2026-09-10T01:55:30.899Z | 2026-09-10T01:56:20.792Z | 49.893 | FAIL | PASS | FAIL | 1 |
| run-04 | 2026-09-10T01:56:20.793Z | 2026-09-10T01:57:15.829Z | 55.036 | FAIL | FAIL | PASS | 1 |
| run-05 | 2026-09-10T01:57:15.830Z | 2026-09-10T01:58:00.040Z | 44.210 | FAIL | FAIL | FAIL | 1 |
| run-06 | 2026-09-10T01:58:00.041Z | 2026-09-10T01:58:49.431Z | 49.390 | FAIL | FAIL | PASS | 1 |
| run-07 | 2026-09-10T01:58:49.432Z | 2026-09-10T01:59:40.255Z | 50.823 | FAIL | PASS | FAIL | 1 |
| run-08 | 2026-09-10T01:59:40.256Z | 2026-09-10T02:00:36.123Z | 55.867 | FAIL | FAIL | PASS | 1 |
| run-09 | 2026-09-10T02:00:36.124Z | 2026-09-10T02:01:20.565Z | 44.441 | FAIL | PASS | FAIL | 1 |
| run-10 | 2026-09-10T02:01:20.567Z | 2026-09-10T02:02:10.841Z | 50.274 | FAIL | PASS | PASS | 1 |

## Case × lượt và tỷ lệ FAIL

| Thứ tự dự kiến | Case | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | FAIL/10 | PASS | NR | FAIL/lượt thực chạy |
|---:|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---:|
| 1 | Gym 390/members | P | P | P | P | F 4779 (1.0646%; Δ2) | F 4779 (1.0646%; Δ2) | F 4779 (1.0646%; Δ2) | P | P | F 4779 (1.0646%; Δ2) | 4/10 | 6 | 0 | 4/10 |
| 2 | Gym 390/member-edit | P | F 5002 (1.0352%; Δ2) | F 5002 (1.0352%; Δ2) | P | NR | NR | NR | P | F 5002 (1.0352%; Δ2) | NR | 3/10 | 3 | 4 | 3/6 |
| 3 | Gym 390/wizard | P | NR | NR | P | NR | NR | NR | P | NR | NR | 0/10 | 3 | 7 | 0/3 |
| 4 | Gym 390/entries | P | NR | NR | P | NR | NR | NR | P | NR | NR | 0/10 | 3 | 7 | 0/3 |
| 5 | Gym 390/entry-edit | P | NR | NR | P | NR | NR | NR | P | NR | NR | 0/10 | 3 | 7 | 0/3 |
| 6 | Gym 768/members | P | NR | NR | P | NR | NR | NR | P | NR | NR | 0/10 | 3 | 7 | 0/3 |
| 7 | Gym 768/member-edit | P | NR | NR | P | NR | NR | NR | P | NR | NR | 0/10 | 3 | 7 | 0/3 |
| 8 | Gym 768/wizard | P | NR | NR | P | NR | NR | NR | P | NR | NR | 0/10 | 3 | 7 | 0/3 |
| 9 | Gym 768/entries | P | NR | NR | P | NR | NR | NR | F 2385 (0.2461%; Δ4) | NR | NR | 1/10 | 2 | 7 | 1/3 |
| 10 | Gym 768/entry-edit | P | NR | NR | F 12061 (1.1933%; Δ2) | NR | NR | NR | NR | NR | NR | 1/10 | 1 | 8 | 1/2 |
| 11 | Gym 1440/members | P | NR | NR | NR | NR | NR | NR | NR | NR | NR | 0/10 | 1 | 9 | 0/1 |
| 12 | Gym 1440/member-edit | P | NR | NR | NR | NR | NR | NR | NR | NR | NR | 0/10 | 1 | 9 | 0/1 |
| 13 | Gym 1440/wizard | P | NR | NR | NR | NR | NR | NR | NR | NR | NR | 0/10 | 1 | 9 | 0/1 |
| 14 | Gym 1440/entries | F 49481 (2.7228%; Δ4) | NR | NR | NR | NR | NR | NR | NR | NR | NR | 1/10 | 0 | 9 | 1/1 |
| 15 | Gym 1440/entry-edit | NR | NR | NR | NR | NR | NR | NR | NR | NR | NR | 0/10 | 0 | 10 | — (0 quan sát) |
| 16 | Dashboard 390/dashboard | P | F 2759 (0.6618%; Δ2) | P | P | P | P | P | P | P | P | 1/10 | 9 | 0 | 1/10 |
| 17 | Dashboard 390/leaderboard | P | NR | P | P | P | P | P | P | P | P | 0/10 | 9 | 1 | 0/9 |
| 18 | Dashboard 390/log | P | NR | P | P | P | P | P | P | P | P | 0/10 | 9 | 1 | 0/9 |
| 19 | Dashboard 390/seasons | P | NR | P | P | P | P | P | P | P | P | 0/10 | 9 | 1 | 0/9 |
| 20 | Dashboard 768/dashboard | P | NR | P | P | F 8571 (0.9458%; Δ1) | P | P | P | P | P | 1/10 | 8 | 1 | 1/9 |
| 21 | Dashboard 768/leaderboard | P | NR | P | P | NR | P | P | F 3 (0.0004%; Δ1) | P | P | 1/10 | 7 | 2 | 1/8 |
| 22 | Dashboard 768/log | P | NR | P | P | NR | P | P | NR | P | P | 0/10 | 7 | 3 | 0/7 |
| 23 | Dashboard 768/seasons | P | NR | P | P | NR | P | P | NR | P | P | 0/10 | 7 | 3 | 0/7 |
| 24 | Dashboard 1440/dashboard | P | NR | P | F 58404 (3.4371%; Δ1) | NR | F 58404 (3.4371%; Δ1) | P | NR | P | P | 2/10 | 5 | 3 | 2/7 |
| 25 | Dashboard 1440/leaderboard | P | NR | P | NR | NR | NR | P | NR | P | P | 0/10 | 5 | 5 | 0/5 |
| 26 | Dashboard 1440/log | P | NR | P | NR | NR | NR | P | NR | P | P | 0/10 | 5 | 5 | 0/5 |
| 27 | Dashboard 1440/seasons | P | NR | P | NR | NR | NR | P | NR | P | P | 0/10 | 5 | 5 | 0/5 |
| 28 | Master 390/dashboard | P | P | P | P | P | P | P | P | P | P | 0/10 | 10 | 0 | 0/10 |
| 29 | Master 390/edit | P | P | P | P | P | P | P | P | F 21855 (3.3677%; Δ2) | P | 1/10 | 9 | 0 | 1/10 |
| 30 | Master 390/preview | P | P | P | P | P | P | P | P | NR | P | 0/10 | 9 | 1 | 0/9 |
| 31 | Master 390/gyms | P | P | P | P | P | P | P | P | NR | P | 0/10 | 9 | 1 | 0/9 |
| 32 | Master 390/requests | P | P | P | P | P | P | P | P | NR | P | 0/10 | 9 | 1 | 0/9 |
| 33 | Master 768/dashboard | P | P | P | P | P | P | P | P | NR | P | 0/10 | 9 | 1 | 0/9 |
| 34 | Master 768/edit | P | P | P | P | F 22 (0.0019%; Δ4) | P | P | P | NR | P | 1/10 | 8 | 1 | 1/9 |
| 35 | Master 768/preview | P | P | P | P | NR | P | P | P | NR | P | 0/10 | 8 | 2 | 0/8 |
| 36 | Master 768/gyms | P | P | P | P | NR | P | P | P | NR | P | 0/10 | 8 | 2 | 0/8 |
| 37 | Master 768/requests | P | P | P | P | NR | P | P | P | NR | P | 0/10 | 8 | 2 | 0/8 |
| 38 | Master 1440/dashboard | P | P | P | P | NR | P | P | P | NR | P | 0/10 | 8 | 2 | 0/8 |
| 39 | Master 1440/edit | P | P | P | P | NR | P | F 106626 (5.1243%; Δ4) | P | NR | P | 1/10 | 7 | 2 | 1/8 |
| 40 | Master 1440/preview | P | P | F 106622 (5.1241%; Δ4) | P | NR | P | NR | P | NR | P | 1/10 | 6 | 3 | 1/7 |
| 41 | Master 1440/gyms | P | P | NR | P | NR | P | NR | P | NR | P | 0/10 | 6 | 4 | 0/6 |
| 42 | Master 1440/requests | P | P | NR | P | NR | P | NR | P | NR | P | 0/10 | 6 | 4 | 0/6 |

## Thứ tự thực tế và thời gian theo nhóm

File luôn Gym #1 → Dashboard #2 → Master #3. Trong mỗi nhóm: viewport 390 → 768 → 1440; views theo configuration.json. Số thứ tự dự kiến ở bảng trên; thứ tự thực tế bên dưới bỏ qua NR. Không đảo thứ tự trong phiên này.

| Lượt | Nhóm / thứ tự file | Bắt đầu UTC | Kết thúc UTC | File ms | Visual ms | Thứ tự cặp thực chạy | Parent |
|---|---|---|---|---:|---:|---|---|
| run-01 | Gym #1 | 2026-09-10T01:53:45.633Z | 2026-09-10T01:54:05.953Z | 20320 | 12637.1931 | 1:390/members, 2:390/member-edit, 3:390/wizard, 4:390/entries, 5:390/entry-edit, 6:768/members, 7:768/member-edit, 8:768/wizard, 9:768/entries, 10:768/entry-edit, 11:1440/members, 12:1440/member-edit, 13:1440/wizard, 14:1440/entries | FAIL |
| run-01 | Dashboard #2 | 2026-09-10T01:54:06.016Z | 2026-09-10T01:54:21.806Z | 15790 | 8208.5247 | 15:390/dashboard, 16:390/leaderboard, 17:390/log, 18:390/seasons, 19:768/dashboard, 20:768/leaderboard, 21:768/log, 22:768/seasons, 23:1440/dashboard, 24:1440/leaderboard, 25:1440/log, 26:1440/seasons | PASS |
| run-01 | Master #3 | 2026-09-10T01:54:21.860Z | 2026-09-10T01:54:43.300Z | 21440 | 13808.1439 | 27:390/dashboard, 28:390/edit, 29:390/preview, 30:390/gyms, 31:390/requests, 32:768/dashboard, 33:768/edit, 34:768/preview, 35:768/gyms, 36:768/requests, 37:1440/dashboard, 38:1440/edit, 39:1440/preview, 40:1440/gyms, 41:1440/requests | PASS |
| run-02 | Gym #1 | 2026-09-10T01:54:43.394Z | 2026-09-10T01:54:56.655Z | 13261 | 5656.459 | 1:390/members, 2:390/member-edit | FAIL |
| run-02 | Dashboard #2 | 2026-09-10T01:54:56.668Z | 2026-09-10T01:55:09.544Z | 12876 | 5207.5028 | 3:390/dashboard | FAIL |
| run-02 | Master #3 | 2026-09-10T01:55:09.553Z | 2026-09-10T01:55:30.803Z | 21250 | 13647.7388 | 4:390/dashboard, 5:390/edit, 6:390/preview, 7:390/gyms, 8:390/requests, 9:768/dashboard, 10:768/edit, 11:768/preview, 12:768/gyms, 13:768/requests, 14:1440/dashboard, 15:1440/edit, 16:1440/preview, 17:1440/gyms, 18:1440/requests | PASS |
| run-03 | Gym #1 | 2026-09-10T01:55:30.902Z | 2026-09-10T01:55:44.182Z | 13280 | 5632.889 | 1:390/members, 2:390/member-edit | FAIL |
| run-03 | Dashboard #2 | 2026-09-10T01:55:44.195Z | 2026-09-10T01:55:59.933Z | 15738 | 8212.5878 | 3:390/dashboard, 4:390/leaderboard, 5:390/log, 6:390/seasons, 7:768/dashboard, 8:768/leaderboard, 9:768/log, 10:768/seasons, 11:1440/dashboard, 12:1440/leaderboard, 13:1440/log, 14:1440/seasons | PASS |
| run-03 | Master #3 | 2026-09-10T01:55:59.987Z | 2026-09-10T01:56:20.705Z | 20718 | 12867.109 | 15:390/dashboard, 16:390/edit, 17:390/preview, 18:390/gyms, 19:390/requests, 20:768/dashboard, 21:768/edit, 22:768/preview, 23:768/gyms, 24:768/requests, 25:1440/dashboard, 26:1440/edit, 27:1440/preview | FAIL |
| run-04 | Gym #1 | 2026-09-10T01:56:20.798Z | 2026-09-10T01:56:38.893Z | 18095 | 10396.4101 | 1:390/members, 2:390/member-edit, 3:390/wizard, 4:390/entries, 5:390/entry-edit, 6:768/members, 7:768/member-edit, 8:768/wizard, 9:768/entries, 10:768/entry-edit | FAIL |
| run-04 | Dashboard #2 | 2026-09-10T01:56:38.938Z | 2026-09-10T01:56:54.205Z | 15267 | 7493.5184 | 11:390/dashboard, 12:390/leaderboard, 13:390/log, 14:390/seasons, 15:768/dashboard, 16:768/leaderboard, 17:768/log, 18:768/seasons, 19:1440/dashboard | FAIL |
| run-04 | Master #3 | 2026-09-10T01:56:54.245Z | 2026-09-10T01:57:15.748Z | 21503 | 13858.6669 | 20:390/dashboard, 21:390/edit, 22:390/preview, 23:390/gyms, 24:390/requests, 25:768/dashboard, 26:768/edit, 27:768/preview, 28:768/gyms, 29:768/requests, 30:1440/dashboard, 31:1440/edit, 32:1440/preview, 33:1440/gyms, 34:1440/requests | PASS |
| run-05 | Gym #1 | 2026-09-10T01:57:15.833Z | 2026-09-10T01:57:28.891Z | 13058 | 5405.4067 | 1:390/members | FAIL |
| run-05 | Dashboard #2 | 2026-09-10T01:57:28.900Z | 2026-09-10T01:57:42.810Z | 13910 | 6196.8747 | 2:390/dashboard, 3:390/leaderboard, 4:390/log, 5:390/seasons, 6:768/dashboard | FAIL |
| run-05 | Master #3 | 2026-09-10T01:57:42.837Z | 2026-09-10T01:57:59.997Z | 17160 | 9395.3333 | 7:390/dashboard, 8:390/edit, 9:390/preview, 10:390/gyms, 11:390/requests, 12:768/dashboard, 13:768/edit | FAIL |
| run-06 | Gym #1 | 2026-09-10T01:58:00.044Z | 2026-09-10T01:58:12.996Z | 12952 | 5323.9656 | 1:390/members | FAIL |
| run-06 | Dashboard #2 | 2026-09-10T01:58:13.006Z | 2026-09-10T01:58:27.880Z | 14874 | 7277.61 | 2:390/dashboard, 3:390/leaderboard, 4:390/log, 5:390/seasons, 6:768/dashboard, 7:768/leaderboard, 8:768/log, 9:768/seasons, 10:1440/dashboard | FAIL |
| run-06 | Master #3 | 2026-09-10T01:58:27.918Z | 2026-09-10T01:58:49.346Z | 21428 | 13821.6618 | 11:390/dashboard, 12:390/edit, 13:390/preview, 14:390/gyms, 15:390/requests, 16:768/dashboard, 17:768/edit, 18:768/preview, 19:768/gyms, 20:768/requests, 21:1440/dashboard, 22:1440/edit, 23:1440/preview, 24:1440/gyms, 25:1440/requests | PASS |
| run-07 | Gym #1 | 2026-09-10T01:58:49.435Z | 2026-09-10T01:59:02.377Z | 12942 | 5292.8395 | 1:390/members | FAIL |
| run-07 | Dashboard #2 | 2026-09-10T01:59:02.386Z | 2026-09-10T01:59:18.482Z | 16096 | 8406.9515 | 2:390/dashboard, 3:390/leaderboard, 4:390/log, 5:390/seasons, 6:768/dashboard, 7:768/leaderboard, 8:768/log, 9:768/seasons, 10:1440/dashboard, 11:1440/leaderboard, 12:1440/log, 13:1440/seasons | PASS |
| run-07 | Master #3 | 2026-09-10T01:59:18.566Z | 2026-09-10T01:59:40.186Z | 21620 | 13094.7388 | 14:390/dashboard, 15:390/edit, 16:390/preview, 17:390/gyms, 18:390/requests, 19:768/dashboard, 20:768/edit, 21:768/preview, 22:768/gyms, 23:768/requests, 24:1440/dashboard, 25:1440/edit | FAIL |
| run-08 | Gym #1 | 2026-09-10T01:59:40.259Z | 2026-09-10T01:59:57.854Z | 17595 | 9523.1631 | 1:390/members, 2:390/member-edit, 3:390/wizard, 4:390/entries, 5:390/entry-edit, 6:768/members, 7:768/member-edit, 8:768/wizard, 9:768/entries | FAIL |
| run-08 | Dashboard #2 | 2026-09-10T01:59:57.896Z | 2026-09-10T02:00:12.937Z | 15041 | 7060.5343 | 10:390/dashboard, 11:390/leaderboard, 12:390/log, 13:390/seasons, 14:768/dashboard, 15:768/leaderboard | FAIL |
| run-08 | Master #3 | 2026-09-10T02:00:13.008Z | 2026-09-10T02:00:36.039Z | 23031 | 14907.4776 | 16:390/dashboard, 17:390/edit, 18:390/preview, 19:390/gyms, 20:390/requests, 21:768/dashboard, 22:768/edit, 23:768/preview, 24:768/gyms, 25:768/requests, 26:1440/dashboard, 27:1440/edit, 28:1440/preview, 29:1440/gyms, 30:1440/requests | PASS |
| run-09 | Gym #1 | 2026-09-10T02:00:36.127Z | 2026-09-10T02:00:50.017Z | 13890 | 5734.0968 | 1:390/members, 2:390/member-edit | FAIL |
| run-09 | Dashboard #2 | 2026-09-10T02:00:50.031Z | 2026-09-10T02:01:06.009Z | 15978 | 8296.6616 | 3:390/dashboard, 4:390/leaderboard, 5:390/log, 6:390/seasons, 7:768/dashboard, 8:768/leaderboard, 9:768/log, 10:768/seasons, 11:1440/dashboard, 12:1440/leaderboard, 13:1440/log, 14:1440/seasons | PASS |
| run-09 | Master #3 | 2026-09-10T02:01:06.064Z | 2026-09-10T02:01:20.550Z | 14486 | 6631.996 | 15:390/dashboard, 16:390/edit | FAIL |
| run-10 | Gym #1 | 2026-09-10T02:01:20.570Z | 2026-09-10T02:01:33.898Z | 13328 | 5411.6797 | 1:390/members | FAIL |
| run-10 | Dashboard #2 | 2026-09-10T02:01:33.907Z | 2026-09-10T02:01:49.783Z | 15876 | 8248.1623 | 2:390/dashboard, 3:390/leaderboard, 4:390/log, 5:390/seasons, 6:768/dashboard, 7:768/leaderboard, 8:768/log, 9:768/seasons, 10:1440/dashboard, 11:1440/leaderboard, 12:1440/log, 13:1440/seasons | PASS |
| run-10 | Master #3 | 2026-09-10T02:01:49.834Z | 2026-09-10T02:02:10.756Z | 20922 | 13311.4553 | 14:390/dashboard, 15:390/edit, 16:390/preview, 17:390/gyms, 18:390/requests, 19:768/dashboard, 20:768/edit, 21:768/preview, 22:768/gyms, 23:768/requests, 24:1440/dashboard, 25:1440/edit, 26:1440/preview, 27:1440/gyms, 28:1440/requests | PASS |

## Ảnh FAIL và số đo offline

Bbox inclusive [xMin,yMin,xMax,yMax]. Diff được tạo sau 10 lượt: pixel khác tô magenta, pixel bằng nhau màu đen; không phải ảnh diff gốc do harness tạo. Ảnh before/after là output nguyên gốc.

| Lượt | Case | Kích thước | Pixel khác | % | Max delta | Bbox | Before / After / Diff |
|---|---|---|---:|---:|---:|---|---|
| run-01 | Gym 1440/entries | [[1440,1262],[1440,1262]] | 49481 | 2.7228 | 4 | [0,255,1439,954] | [tmp/p24-2c/run-01/Gym/before-1440-entries.png](../tmp/p24-2c/run-01/Gym/before-1440-entries.png) / [tmp/p24-2c/run-01/Gym/after-1440-entries.png](../tmp/p24-2c/run-01/Gym/after-1440-entries.png) / [tmp/p24-2c/run-01/Gym/diff-1440-entries.png](../tmp/p24-2c/run-01/Gym/diff-1440-entries.png) |
| run-02 | Gym 390/member-edit | [[390,1239],[390,1239]] | 5002 | 1.0352 | 2 | [0,255,389,636] | [tmp/p24-2c/run-02/Gym/before-390-member-edit.png](../tmp/p24-2c/run-02/Gym/before-390-member-edit.png) / [tmp/p24-2c/run-02/Gym/after-390-member-edit.png](../tmp/p24-2c/run-02/Gym/after-390-member-edit.png) / [tmp/p24-2c/run-02/Gym/diff-390-member-edit.png](../tmp/p24-2c/run-02/Gym/diff-390-member-edit.png) |
| run-02 | Dashboard 390/dashboard | [[390,1069],[390,1069]] | 2759 | 0.6618 | 2 | [0,255,389,572] | [tmp/p24-2c/run-02/Dashboard/before-390-dashboard.png](../tmp/p24-2c/run-02/Dashboard/before-390-dashboard.png) / [tmp/p24-2c/run-02/Dashboard/after-390-dashboard.png](../tmp/p24-2c/run-02/Dashboard/after-390-dashboard.png) / [tmp/p24-2c/run-02/Dashboard/diff-390-dashboard.png](../tmp/p24-2c/run-02/Dashboard/diff-390-dashboard.png) |
| run-03 | Gym 390/member-edit | [[390,1239],[390,1239]] | 5002 | 1.0352 | 2 | [0,255,389,636] | [tmp/p24-2c/run-03/Gym/before-390-member-edit.png](../tmp/p24-2c/run-03/Gym/before-390-member-edit.png) / [tmp/p24-2c/run-03/Gym/after-390-member-edit.png](../tmp/p24-2c/run-03/Gym/after-390-member-edit.png) / [tmp/p24-2c/run-03/Gym/diff-390-member-edit.png](../tmp/p24-2c/run-03/Gym/diff-390-member-edit.png) |
| run-03 | Master 1440/preview | [[1440,1445],[1440,1445]] | 106622 | 5.1241 | 4 | [0,247,1439,1047] | [tmp/p24-2c/run-03/Master/before-1440-preview.png](../tmp/p24-2c/run-03/Master/before-1440-preview.png) / [tmp/p24-2c/run-03/Master/after-1440-preview.png](../tmp/p24-2c/run-03/Master/after-1440-preview.png) / [tmp/p24-2c/run-03/Master/diff-1440-preview.png](../tmp/p24-2c/run-03/Master/diff-1440-preview.png) |
| run-04 | Gym 768/entry-edit | [[768,1316],[768,1316]] | 12061 | 1.1933 | 2 | [0,255,767,1051] | [tmp/p24-2c/run-04/Gym/before-768-entry-edit.png](../tmp/p24-2c/run-04/Gym/before-768-entry-edit.png) / [tmp/p24-2c/run-04/Gym/after-768-entry-edit.png](../tmp/p24-2c/run-04/Gym/after-768-entry-edit.png) / [tmp/p24-2c/run-04/Gym/diff-768-entry-edit.png](../tmp/p24-2c/run-04/Gym/diff-768-entry-edit.png) |
| run-04 | Dashboard 1440/dashboard | [[1440,1180],[1440,1180]] | 58404 | 3.4371 | 1 | [0,255,1439,935] | [tmp/p24-2c/run-04/Dashboard/before-1440-dashboard.png](../tmp/p24-2c/run-04/Dashboard/before-1440-dashboard.png) / [tmp/p24-2c/run-04/Dashboard/after-1440-dashboard.png](../tmp/p24-2c/run-04/Dashboard/after-1440-dashboard.png) / [tmp/p24-2c/run-04/Dashboard/diff-1440-dashboard.png](../tmp/p24-2c/run-04/Dashboard/diff-1440-dashboard.png) |
| run-05 | Gym 390/members | [[390,1151],[390,1151]] | 4779 | 1.0646 | 2 | [0,255,389,635] | [tmp/p24-2c/run-05/Gym/before-390-members.png](../tmp/p24-2c/run-05/Gym/before-390-members.png) / [tmp/p24-2c/run-05/Gym/after-390-members.png](../tmp/p24-2c/run-05/Gym/after-390-members.png) / [tmp/p24-2c/run-05/Gym/diff-390-members.png](../tmp/p24-2c/run-05/Gym/diff-390-members.png) |
| run-05 | Dashboard 768/dashboard | [[768,1180],[768,1180]] | 8571 | 0.9458 | 1 | [0,255,767,636] | [tmp/p24-2c/run-05/Dashboard/before-768-dashboard.png](../tmp/p24-2c/run-05/Dashboard/before-768-dashboard.png) / [tmp/p24-2c/run-05/Dashboard/after-768-dashboard.png](../tmp/p24-2c/run-05/Dashboard/after-768-dashboard.png) / [tmp/p24-2c/run-05/Dashboard/diff-768-dashboard.png](../tmp/p24-2c/run-05/Dashboard/diff-768-dashboard.png) |
| run-05 | Master 768/edit | [[793,1445],[793,1445]] | 22 | 0.0019 | 4 | [1,247,766,601] | [tmp/p24-2c/run-05/Master/before-768-edit.png](../tmp/p24-2c/run-05/Master/before-768-edit.png) / [tmp/p24-2c/run-05/Master/after-768-edit.png](../tmp/p24-2c/run-05/Master/after-768-edit.png) / [tmp/p24-2c/run-05/Master/diff-768-edit.png](../tmp/p24-2c/run-05/Master/diff-768-edit.png) |
| run-06 | Gym 390/members | [[390,1151],[390,1151]] | 4779 | 1.0646 | 2 | [0,255,389,635] | [tmp/p24-2c/run-06/Gym/before-390-members.png](../tmp/p24-2c/run-06/Gym/before-390-members.png) / [tmp/p24-2c/run-06/Gym/after-390-members.png](../tmp/p24-2c/run-06/Gym/after-390-members.png) / [tmp/p24-2c/run-06/Gym/diff-390-members.png](../tmp/p24-2c/run-06/Gym/diff-390-members.png) |
| run-06 | Dashboard 1440/dashboard | [[1440,1180],[1440,1180]] | 58404 | 3.4371 | 1 | [0,255,1439,935] | [tmp/p24-2c/run-06/Dashboard/before-1440-dashboard.png](../tmp/p24-2c/run-06/Dashboard/before-1440-dashboard.png) / [tmp/p24-2c/run-06/Dashboard/after-1440-dashboard.png](../tmp/p24-2c/run-06/Dashboard/after-1440-dashboard.png) / [tmp/p24-2c/run-06/Dashboard/diff-1440-dashboard.png](../tmp/p24-2c/run-06/Dashboard/diff-1440-dashboard.png) |
| run-07 | Gym 390/members | [[390,1151],[390,1151]] | 4779 | 1.0646 | 2 | [0,255,389,635] | [tmp/p24-2c/run-07/Gym/before-390-members.png](../tmp/p24-2c/run-07/Gym/before-390-members.png) / [tmp/p24-2c/run-07/Gym/after-390-members.png](../tmp/p24-2c/run-07/Gym/after-390-members.png) / [tmp/p24-2c/run-07/Gym/diff-390-members.png](../tmp/p24-2c/run-07/Gym/diff-390-members.png) |
| run-07 | Master 1440/edit | [[1440,1445],[1440,1445]] | 106626 | 5.1243 | 4 | [0,247,1439,1047] | [tmp/p24-2c/run-07/Master/before-1440-edit.png](../tmp/p24-2c/run-07/Master/before-1440-edit.png) / [tmp/p24-2c/run-07/Master/after-1440-edit.png](../tmp/p24-2c/run-07/Master/after-1440-edit.png) / [tmp/p24-2c/run-07/Master/diff-1440-edit.png](../tmp/p24-2c/run-07/Master/diff-1440-edit.png) |
| run-08 | Gym 768/entries | [[768,1262],[768,1262]] | 2385 | 0.2461 | 4 | [0,255,767,783] | [tmp/p24-2c/run-08/Gym/before-768-entries.png](../tmp/p24-2c/run-08/Gym/before-768-entries.png) / [tmp/p24-2c/run-08/Gym/after-768-entries.png](../tmp/p24-2c/run-08/Gym/after-768-entries.png) / [tmp/p24-2c/run-08/Gym/diff-768-entries.png](../tmp/p24-2c/run-08/Gym/diff-768-entries.png) |
| run-08 | Dashboard 768/leaderboard | [[768,900],[768,900]] | 3 | 0.0004 | 1 | [562,313,639,422] | [tmp/p24-2c/run-08/Dashboard/before-768-leaderboard.png](../tmp/p24-2c/run-08/Dashboard/before-768-leaderboard.png) / [tmp/p24-2c/run-08/Dashboard/after-768-leaderboard.png](../tmp/p24-2c/run-08/Dashboard/after-768-leaderboard.png) / [tmp/p24-2c/run-08/Dashboard/diff-768-leaderboard.png](../tmp/p24-2c/run-08/Dashboard/diff-768-leaderboard.png) |
| run-09 | Gym 390/member-edit | [[390,1239],[390,1239]] | 5002 | 1.0352 | 2 | [0,255,389,636] | [tmp/p24-2c/run-09/Gym/before-390-member-edit.png](../tmp/p24-2c/run-09/Gym/before-390-member-edit.png) / [tmp/p24-2c/run-09/Gym/after-390-member-edit.png](../tmp/p24-2c/run-09/Gym/after-390-member-edit.png) / [tmp/p24-2c/run-09/Gym/diff-390-member-edit.png](../tmp/p24-2c/run-09/Gym/diff-390-member-edit.png) |
| run-09 | Master 390/edit | [[390,1664],[390,1664]] | 21855 | 3.3677 | 2 | [0,255,389,933] | [tmp/p24-2c/run-09/Master/before-390-edit.png](../tmp/p24-2c/run-09/Master/before-390-edit.png) / [tmp/p24-2c/run-09/Master/after-390-edit.png](../tmp/p24-2c/run-09/Master/after-390-edit.png) / [tmp/p24-2c/run-09/Master/diff-390-edit.png](../tmp/p24-2c/run-09/Master/diff-390-edit.png) |
| run-10 | Gym 390/members | [[390,1151],[390,1151]] | 4779 | 1.0646 | 2 | [0,255,389,635] | [tmp/p24-2c/run-10/Gym/before-390-members.png](../tmp/p24-2c/run-10/Gym/before-390-members.png) / [tmp/p24-2c/run-10/Gym/after-390-members.png](../tmp/p24-2c/run-10/Gym/after-390-members.png) / [tmp/p24-2c/run-10/Gym/diff-390-members.png](../tmp/p24-2c/run-10/Gym/diff-390-members.png) |

## Artifacts và tính toàn vẹn

- [Summary JSON](../tmp/p24-2c/summary.json), [summary Markdown](../tmp/p24-2c/summary.md), [timestamps/exit/artifact metadata](../tmp/p24-2c/runs.json), [so mask và timing](../tmp/p24-2c/patterns.json).
- Logs: [run-01.log](../tmp/p24-2c/run-01.log), [run-02.log](../tmp/p24-2c/run-02.log), [run-03.log](../tmp/p24-2c/run-03.log), [run-04.log](../tmp/p24-2c/run-04.log), [run-05.log](../tmp/p24-2c/run-05.log), [run-06.log](../tmp/p24-2c/run-06.log), [run-07.log](../tmp/p24-2c/run-07.log), [run-08.log](../tmp/p24-2c/run-08.log), [run-09.log](../tmp/p24-2c/run-09.log), [run-10.log](../tmp/p24-2c/run-10.log).
- Ảnh before/after nguyên gốc và comparison JSON Master nằm trong `tmp/p24-2c/run-NN/{Gym,Dashboard,Master}/`; diff-*.png là mặt nạ offline mới tạo, không sửa ảnh đầu vào. Mỗi đường dẫn FAIL được liệt kê ở bảng trên; toàn bộ ảnh PASS cũng đã lưu với SHA-256 trong runs.json.
- [Collector](../tmp/p24-2c/collect.cjs), [analyzer](../tmp/p24-2c/analyze.cjs), [mask comparison](../tmp/p24-2c/compare.cjs). Các script này là công cụ thu thập/phân tích trong tmp, không đổi harness.
- [SHA-256 manifest](../tmp/p24-2c/checksums.sha256) cho toàn bộ artifacts, kể cả báo cáo này (manifest không tự hash chính nó). [Hashes trước](../tmp/p24-2c/before-hashes.json) và [sau](../tmp/p24-2c/after-hashes.json) của 151 file tracked + baseline JS khớp hoàn toàn: **0 thay đổi**.
- Working tree đầu phiên đã có modified docs/PRODUCTION-GO-LIVE-PROMPTS.md, test/admin-xss-test.js, test/auth-test.js và untracked P24-2A/P24-2B checkpoints. Giữ nguyên tất cả; phiên này chỉ thêm checkpoint này và artifacts trong tmp/p24-2c. tmp/p06–p08 nhận output ảnh/comparison theo hành vi test bình thường. Không commit; HEAD giữ nguyên.
