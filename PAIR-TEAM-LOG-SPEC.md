# Đặc tả chức năng ghi nhận Team và Invest trong Log

> Trạng thái: Đã nghiên cứu và chốt yêu cầu, chưa triển khai code  
> Ngày tổng hợp: 2026-09-04  
> Phạm vi: Form ghi log, lịch sử log và dữ liệu Sync Pair

## 1. Mục đích

Bổ sung vào mỗi lượt ghi log thông tin team Sync Pair đã sử dụng để:

- Đối soát đội hình thực tế của từng lượt chơi.
- Biết mức đầu tư của từng Sync Pair tại thời điểm ghi log.
- Tạo nền tảng cho thống kê Pair/Team theo thành viên, Map, Round, số vé và điểm.
- Hỗ trợ tham khảo lại đội hình hiệu quả cho các lượt chơi sau.

Thông tin team là dữ liệu bắt buộc đối với log mới sau khi chức năng được triển khai. Các log lịch sử đã tồn tại trước migration vẫn được phép không có team.

## 2. Nguồn dữ liệu Sync Pair đã kiểm tra

### Nguồn chính

- Tracker: https://pomasters.github.io/SyncPairsTracker/
- Trang icon: https://pomasters.github.io/SyncPairsTracker/icons/
- Repository: https://github.com/pomasters/SyncPairsTracker
- Dataset JSON: https://raw.githubusercontent.com/pomasters/SyncPairsTracker/refs/heads/main/js/syncpairs.json
- Thư mục icon: https://github.com/pomasters/SyncPairsTracker/tree/main/icons
- UX tham khảo: https://bookpomastowers.xyz/tracker

### Kết quả kiểm tra tại ngày 2026-09-04

- Phiên bản dataset: `v2.71.0`.
- Tổng số Sync Pair: `636`.
- Khóa ghép `dexNumber|pokemonNumber`: `636` giá trị duy nhất, không trùng.
- Tổng tham chiếu ảnh: `1.524`.
- Tổng file ảnh duy nhất: `1.496`.
- Pair mới nhất trong dataset có `releaseDate = 2026-08-16`.
- File JSON khoảng 669 KB, phù hợp để import định kỳ.

### Trường dữ liệu có sẵn

Dataset cung cấp các trường cần thiết để dựng catalog và tìm kiếm:

- `dexNumber`
- `trainerName`
- `trainerAlt`
- `pokemonNumber`
- `pokemonName`
- `pokemonGender`
- `pokemonForm`
- `pokemonType`
- `pokemonWeak`
- `syncPairRole`
- `syncPairRoleEX`
- `syncPairEXPose`
- `syncPairEXColor`
- `syncPairSuperawakening`
- `syncPairRarity`
- `releaseDate`
- `syncPairAcquisition`
- `syncPairRegion`
- `images`
- `themes`
- `tags`

Dataset không chứa Invest của từng người chơi. Invest phải được ứng dụng tự quản lý và lưu snapshot theo từng log.

## 3. Quyền sử dụng icon

Icon được ghi nhận là do Sages tạo. Trước khi đưa icon vào production cần:

1. Xin phép Sages bằng văn bản hoặc nội dung có thể lưu lại.
2. Lưu bằng chứng cho phép sử dụng trong hồ sơ dự án.
3. Thêm attribution trong project và trang phù hợp của website.
4. Import icon về server/CDN do ứng dụng quản lý, không hotlink trực tiếp lâu dài.
5. Giữ thông tin đây là dự án không chính thức và quyền sở hữu Pokémon thuộc các chủ sở hữu tương ứng.

Repository public không tự động đồng nghĩa với việc toàn bộ artwork được phép sao chép/phân phối. Việc xin phép vẫn là điều kiện trước production.

## 4. Định nghĩa Invest đã chốt

Mỗi Pair trong team có các thuộc tính sau:

| Thuộc tính | Quy tắc |
|---|---|
| Move Level | Bắt buộc, giá trị nguyên từ `1` đến `10` |
| Hiển thị Move Level | `1/5` đến `10/5`; không hiển thị thêm chữ SA |
| Ý nghĩa `6/5`–`10/5` | Tương ứng SA1–SA5 nhưng UI chỉ hiện dạng `N/5` |
| Level | Không bắt buộc; nếu nhập phải là số nguyên từ `1` đến `200` |
| Trạng thái EX | Một lựa chọn duy nhất: `Không có`, `EX` hoặc `EXR` |
| EX và EXR | Không hiển thị/lưu như hai badge độc lập |

### Giá trị mặc định đề xuất

- Move Level: `1/5`.
- Level: để trống.
- Trạng thái EX: `Không có`.

### Hiển thị gọn

Ví dụ có Level:

```text
[Icon] Jasmine (Academy)
       1/5   Lv 180   EX
```

Ví dụ không có Level:

```text
[Icon] Alder (Arc Suit)
       7/5   EXR
```

Level bị bỏ trống thì không hiển thị badge `Lv`.

## 5. Quy tắc Team trong một Log

- Một log mới phải có tối thiểu `1` Pair.
- Một log có tối đa `3` Pair.
- Pair thứ hai và thứ ba là tùy chọn.
- Không cho chọn trùng cùng một Pair trong một team.
- Có thể xóa hoặc thay thế từng Pair trước khi lưu.
- Khi sửa log mới, team sau khi sửa vẫn phải còn ít nhất một Pair.
- Log cũ trước migration được phép có `0` Pair để đảm bảo tương thích dữ liệu.
- Thứ tự slot `1–3` phải được giữ lại để hiển thị đúng đội hình đã nhập.

## 6. Validation theo năng lực của Pair

- Move Level phải nằm trong `1–10`.
- Nếu `syncPairSuperawakening = false`, Move Level tối đa là `5/5`.
- Nếu `syncPairSuperawakening = true`, cho phép đến `10/5`.
- Nếu Pair không có `syncPairRoleEX`, tùy chọn `EXR` bị vô hiệu hóa.
- Level để trống là hợp lệ.
- Nếu có Level, giá trị phải là số nguyên `1–200`.
- Trạng thái EX chỉ nhận một trong ba giá trị: `none`, `ex`, `exr`.
- Backend phải validation lại toàn bộ quy tắc; không chỉ dựa vào frontend.

## 7. Trải nghiệm tìm và chọn Pair

### Vị trí trong form ghi log

```text
Thành viên
Map
Team đã sử dụng
Số vé
Điểm
```

### Luồng chọn

1. Khu vực Team ban đầu hiển thị nút `+ Thêm Pair`.
2. Khi nhấn, mở ô tìm kiếm.
3. Người dùng nhập Trainer, Pokémon hoặc tên biến thể.
4. Hiển thị danh sách kết quả có icon và tên đầy đủ.
5. Chọn một kết quả để thêm vào slot tiếp theo.
6. Sau khi chọn mới hiển thị các control Invest.
7. Nút `+ Thêm Pair` tiếp tục hiện cho đến khi đủ ba Pair.

Ví dụ kết quả:

```text
[icon] Leaf & Eevee
[icon] Leaf (Sygna Suit) & Venusaur
[icon] Leaf (Variety) & Clefable
```

### Xếp hạng kết quả tìm kiếm đề xuất

1. Trainer bắt đầu bằng keyword.
2. Pokémon bắt đầu bằng keyword.
3. Trainer/Pokémon/biến thể chứa keyword.
4. Pair thành viên vừa sử dụng gần đây.
5. Các kết quả còn lại.

Chỉ render khoảng 8–12 kết quả đầu; không tải đồng thời toàn bộ 1.496 icon.

### Trạng thái sau khi chọn

Desktop:

```text
[Icon] Benga & Volcarona
Move Lv [1/5 ▼]   Level [___]   Trạng thái [ — | EX | EXR ]   [×]
```

Mobile:

```text
[Icon] Benga & Volcarona                                  [×]
[1/5 ▼] [Lv ___] [— | EX | EXR]
```

Trên Mobile nên dùng bottom sheet hoặc panel rộng toàn màn hình để tìm Pair. Trên PC có thể dùng dropdown bên dưới ô tìm kiếm.

## 8. Giảm thao tác lặp lại

Nếu mỗi lần ghi log đều phải cấu hình lại Invest cho ba Pair thì trải nghiệm sẽ quá chậm. Cần tách hai tầng dữ liệu:

### Roster hiện tại của thành viên

Lưu Invest gần nhất của Pair đối với từng thành viên và dùng làm giá trị mặc định lần sau.

### Snapshot trong Log

Lưu bản sao Invest tại đúng thời điểm ghi log. Khi thành viên nâng cấp Pair sau này, log cũ không được thay đổi.

Các tiện ích nên có:

- `Dùng lại team gần nhất`.
- `Sao chép team từ lượt trước`.
- Ưu tiên Pair vừa dùng trong kết quả tìm kiếm.
- Tự điền Invest gần nhất khi chọn lại Pair.

## 9. Hiển thị trong lịch sử

Mặc định hiển thị ba icon nhỏ và badge Invest để không làm thẻ log quá cao:

```text
Yudar · Falkner · 3 vé · 98,000 điểm

[Icon 1] 6/5 EXR   [Icon 2] 3/5 EX   [Icon 3] 1/5
```

- Level có thể hiển thị khi mở chi tiết log hoặc bên dưới Pair nếu còn đủ không gian.
- Khi sửa log phải sửa được Pair, Move Level, Level và trạng thái EX.
- Log không có team do được tạo trước migration hiển thị `Chưa có dữ liệu team`, không báo lỗi.

## 10. Mô hình dữ liệu đề xuất

Tên bảng có thể điều chỉnh theo convention thực tế khi triển khai.

### `sync_pairs`

Catalog Pair do hệ thống quản lý:

```text
id
source
source_key
trainer_name
trainer_alt
pokemon_name
pokemon_number
type
role
ex_role
supports_ex
supports_superawakening
rarity
release_date
icon_normal_path
icon_ex_path
is_active
source_version
created_at
updated_at
```

`source_key` đề xuất lấy từ `dexNumber|pokemonNumber`, nhưng quan hệ trong database luôn dùng `sync_pairs.id` nội bộ.

### `member_sync_pair_profiles`

Roster/Invest hiện tại dùng để tự điền:

```text
id
member_id
sync_pair_id
move_level
pair_level NULL
ex_status
updated_at
```

Unique constraint đề xuất: `(member_id, sync_pair_id)`.

### `entry_team_pairs`

Snapshot team của từng log:

```text
id
entry_id
slot
sync_pair_id
move_level_snapshot
pair_level_snapshot NULL
ex_status_snapshot
pair_name_snapshot
icon_path_snapshot
created_at
```

Constraints đề xuất:

- Unique `(entry_id, slot)`.
- Unique `(entry_id, sync_pair_id)`.
- `slot` trong `1–3`.
- `move_level_snapshot` trong `1–10`.
- `pair_level_snapshot` NULL hoặc trong `1–200`.
- `ex_status_snapshot` trong `none|ex|exr`.

Nên dùng bảng quan hệ thay vì nhét team vào một cột JSON để sau này filter và thống kê dễ dàng.

## 11. Chiến lược catalog và icon

- Không gọi trực tiếp dataset bên thứ ba mỗi lần mở form.
- Import dataset về database hoặc file nội bộ của project.
- Lưu `source_version` và thời điểm cập nhật.
- Không xóa cứng Pair cũ; chỉ đánh dấu `is_active = false` để lịch sử không mất liên kết.
- Có thể lọc Pair chưa phát hành bằng `releaseDate`.
- Icon thường: ưu tiên ảnh 5★ phù hợp làm canonical icon.
- Nếu trạng thái là EX và có ảnh EX, có thể chuyển sang icon EX.
- Pair có nhiều form/ảnh cần quy tắc chọn canonical riêng; không dựa mù quáng vào phần tử đầu tiên của mảng `images`.

## 12. Khả năng mở rộng sau này

Sau khi có dữ liệu Team, có thể bổ sung:

- Filter lịch sử theo Sync Pair.
- Pair được dùng nhiều nhất theo thành viên/Map/Round.
- Điểm trung bình và hiệu suất vé theo Pair.
- So sánh hiệu quả theo Move Level hoặc EX/EXR.
- Team thường dùng cho từng Map.
- Gợi ý team từ lịch sử có điểm cao.
- Trang roster của từng thành viên.

Các báo cáo này không thuộc phạm vi triển khai đầu tiên nhưng mô hình dữ liệu phải hỗ trợ ngay từ đầu.

## 13. Phân kỳ triển khai đề xuất

### Giai đoạn 1 — Chức năng cốt lõi

- Import catalog Sync Pair.
- Quản lý icon nội bộ.
- Tìm kiếm và chọn tối đa ba Pair.
- Move Level, Level và trạng thái EX.
- Validation frontend/backend.
- Lưu snapshot team theo log.
- Hiển thị và sửa team trong lịch sử.
- Migration tương thích log cũ.

### Giai đoạn 2 — Tối ưu thao tác

- Roster hiện tại theo thành viên.
- Tự điền Invest gần nhất.
- Dùng lại/sao chép team trước.
- Pair gần đây và tìm kiếm ưu tiên.

### Giai đoạn 3 — Phân tích

- Filter theo Pair.
- Thống kê mức sử dụng và hiệu suất.
- Gợi ý team theo Map/Round.

## 14. Các quyết định còn cần xác nhận khi bắt đầu triển khai

1. Khi chọn `EXR`, có cần ngầm hiểu Pair cũng đã EX hay không. UI vẫn chỉ hiển thị một badge `EXR`.
2. Có triển khai roster/tự điền Invest ngay trong giai đoạn đầu hay để sang giai đoạn 2.
3. Level mặc định để trống hay tự điền theo roster gần nhất; đề xuất dùng roster gần nhất nếu đã có.
4. Team có được sao chép từ log gần nhất của cùng thành viên trên mọi Map, hay chỉ cùng Map.
5. Quy tắc canonical icon cho Player/Bettie/Scottie và Pair có nhiều form.

## 15. Tiêu chí hoàn thành tối thiểu

- Tìm được Pair bằng Trainer hoặc Pokémon.
- Kết quả có icon, tên và biến thể rõ ràng.
- Chọn được 1–3 Pair, không trùng.
- Move Level hiển thị đúng `1/5–10/5`.
- Level bỏ trống được và không vượt quá 200.
- Chọn duy nhất một trạng thái `Không có/EX/EXR`.
- Pair không có SA/EXR bị giới hạn đúng.
- Log mới không thể lưu nếu chưa có Pair.
- Log cũ không team vẫn đọc/sửa dữ liệu cũ an toàn.
- Sửa log không làm mất thứ tự Team hoặc thay đổi snapshot ngoài ý muốn.
- Giao diện tìm/chọn hoạt động tốt trên PC và Mobile.
- Không phụ thuộc runtime vào website bên thứ ba.

