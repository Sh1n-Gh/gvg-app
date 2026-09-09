# PRD FINAL — Gym vs Gym Tracker (Multi-Tenant)
**Phiên bản:** 2.0 FINAL — gộp từ PRD gốc v1.0 + Addendum Game Mechanics + Correction v2 + Addendum v3 + Addendum v4
**Trạng thái:** Sẵn sàng làm input cho code. Đây là bản DUY NHẤT cần đọc — các file trước đó (v1.0, Addendum riêng lẻ) coi như lịch sử tham khảo, không dùng để code nữa.

---

## 1. Actors

| Actor | Truy cập | Việc chính |
|---|---|---|
| **Master Admin** (bạn) | `/master` (web panel riêng, có login) | Tạo Season Template, tạo/xoá Gym, duyệt Gym Request |
| **Gym Sub-Admin** | `/g/{slug}/admin` (mã riêng từng Gym) | Nhập/sửa/xoá log điểm, quản lý roster, chuyển Season mới, khoá thành viên vi phạm |
| **Public Viewer** | `/g/{slug}` (không cần mã) | Chỉ xem Dashboard/Vé/Xếp hạng/Lịch sử |

**Nguyên lý cốt lõi:** Season Template (8 map, N round, cấu hình vé) là **cấu hình dùng chung mọi Gym**, do Master Admin quản lý. Mỗi Gym có **tiến độ riêng hoàn toàn độc lập** dựa trên cấu hình chung đó.

**Frontend chỉ tập trung 2 nơi dùng thường xuyên:** Sub-Admin panel + Public Dashboard. Master Admin panel là công cụ quản trị riêng (menu như wp-admin), dùng không thường xuyên nhưng vẫn là web UI thật (không phải script).

---

## 2. Data Model (bản cuối cùng)

```sql
season_templates
├── id, name, is_active, created_at
├── last_defined_round_number   -- VD: 15 (khác nhau mỗi mùa)
├── repeat_max_score             -- max_score lặp lại CỐ ĐỊNH cho Round > last_defined_round_number (NULL = không lặp)
├── battle_start_at              -- ISO UTC, mốc bắt đầu phát vé
├── ticket_day1_amount           -- vé/thành viên nhận ngày đầu (VD: 12)
├── ticket_daily_amount          -- vé/thành viên/ngày các ngày sau (VD: 3)
├── ticket_regen_days            -- số ngày còn lại được nhận thêm sau ngày đầu (VD: 6)

season_template_maps
├── id, season_template_id, name, type_weakness, image_url, note (text tự do — KHÔNG có gimmick cấu trúc, xem mục 9), order_index

season_template_rounds
├── id, season_template_id, round_number, max_score, order_index
    -- max_score ĐỘC LẬP từng round, KHÔNG bắt buộc tăng dần (mỗi Round = 1 Boss riêng, không cộng dồn)

gyms
├── id, name, slug (UNIQUE), admin_code (UNIQUE), contact_info, deleted_at (soft-delete), created_at

gym_seasons
├── id, gym_id, season_template_id, is_active, created_at
    -- 1 Gym có nhiều dòng theo thời gian (nhiều mùa đã tham gia), chỉ 1 dòng is_active=1 tại 1 thời điểm

gym_round_map_progress
├── id, gym_season_id, round_number, season_template_map_id, current_points
├── UNIQUE(gym_season_id, round_number, season_template_map_id)
    -- Mỗi Round có dòng progress RIÊNG cho từng map — Round mới = dòng mới = tự "reset về 0"

gym_round_status
├── id, gym_season_id, round_number, status ('pending' | 'active' | 'completed')
├── UNIQUE(gym_season_id, round_number)
    -- Tạo lazy: chỉ tạo dòng khi Gym THỰC SỰ chạm tới round đó (kể cả round thuộc vùng lặp repeat_max_score)

members
├── id, gym_season_id, name, avatar_url, is_banned, banned_at, created_at
├── UNIQUE(gym_season_id, name)
    -- Thuộc gym_season (không phải gym) — mỗi mùa có roster riêng, mùa cũ giữ nguyên lịch sử

entries
├── id, gym_season_id, round_number, season_template_map_id, member_id,
│   tickets_used, points_scored, created_at, updated_at
    -- round_number là số nguyên thường (KHÔNG phải FK tới season_template_rounds,
    --  vì round thuộc vùng lặp repeat_max_score không có dòng tương ứng trong bảng đó)

gym_requests
├── id, gym_name, desired_slug, contact_info, note,
│   status ('pending' | 'approved' | 'rejected'), reject_reason, created_at, reviewed_at
```

**Đã loại bỏ khỏi thiết kế cũ:** `gym_map_progress` (1 cột cộng dồn xuyên mùa — sai mô hình), `repeat_round_delta` (cộng dồn — sai, đã thay bằng `repeat_max_score` cố định), `entries.created_by` (không cần định danh sub-admin, dùng chung 1 mã/Gym).

---

## 3. Business Logic — Engine (lõi quan trọng nhất, cần test kỹ trước khi làm API)

### 3.1 `getRoundConfig(season_template_id, round_number)`
```
1. Tìm trong season_template_rounds theo round_number
2. Nếu có → trả về { round_number, max_score }
3. Nếu không có VÀ round_number > last_defined_round_number VÀ repeat_max_score != NULL
   → trả về { round_number, max_score: repeat_max_score }  (tính động, không lưu DB)
4. Ngược lại → trả về null (hết nội dung khả dụng)
```

### 3.2 `recomputeRoundChain(gym_season_id)` — chạy lại sau MỌI thay đổi ảnh hưởng tiến độ
```
round_number = 1
found_active = false
while true:
    config = getRoundConfig(season_template_id, round_number)
    if config == null: break

    progress = gym_round_map_progress của gym_season + round_number này (8 map)
    all_cleared = mọi map đều có current_points >= config.max_score
                  (map chưa có dòng progress = current_points mặc định 0)

    if all_cleared:
        gym_round_status(round_number) = 'completed'  (tạo dòng nếu chưa có)
    else if not found_active:
        gym_round_status(round_number) = 'active'      (tạo dòng nếu chưa có)
        found_active = true
    else:
        gym_round_status(round_number) = 'pending'
        break

    round_number += 1
```
**Tính chất quan trọng:** Hàm này **idempotent** — chạy lại bao nhiêu lần với cùng dữ liệu đều ra kết quả giống nhau. Tự động xử lý đúng cả trường hợp Master Admin sửa `max_score` khiến 1 Round đã complete "mở lại" (cascade các round sau nó về `pending`).

**Gọi hàm này khi:** (a) ngay sau khi tạo `gym_season` mới (khởi tạo Round 1 = active từ đầu, không cần chờ Entry đầu tiên) | (b) tạo/sửa/xoá 1 Entry (chỉ gym_season đó) | (c) Master Admin sửa `max_score` 1 Round trong Season Template (lặp qua **tất cả** `gym_season` đang dùng template đó).

### 3.2b Sửa/Xoá Entry của Round đã `completed` — ĐÃ CHỐT: cho phép
Sub-Admin **được phép** sửa/xoá Entry dù Round chứa nó đã `completed` — hệ thống tự `recomputeRoundChain` sau thao tác, tự cascade reopen nếu điểm tụt dưới trần (logic **giống hệt** khi Master Admin sửa `max_score`, đã test kỹ ở Phase 1). Không cần confirm dialog đặc biệt ở tầng Sub-Admin (khác với Master Admin sửa `max_score` — vẫn cần cảnh báo vì ảnh hưởng nhiều Gym cùng lúc).

### 3.2c Ràng buộc khi tạo Entry MỚI — chỉ round đang active
Entry **mới** chỉ được tạo cho **đúng Round đang active** của gym_season đó — không tạo được cho Round đã qua (dùng chức năng Sửa nếu cần chỉnh Round cũ) hay Round chưa tới. Nếu không còn Round active (`hasCompletedEverything = true`) → chặn hoàn toàn, trả lỗi rõ ràng.

### 3.3 `calculateTicketsGranted(season_template, member, now)`
```
elapsed_days = clamp(floor((now - battle_start_at) / 1 ngày), 0, ticket_regen_days)
if now < battle_start_at: return 0
return ticket_day1_amount + ticket_daily_amount × elapsed_days
```
Tính **per-member** (mỗi thành viên đều theo công thức này, không phải tổng cả Gym). Tính real-time mỗi lần gọi, không cache.

### 3.4 `ticketsRemaining(gym_season_id, member_id, season_template, now)`
```
= calculateTicketsGranted(season_template, member, now)
  − SUM(entries.tickets_used WHERE member_id = member_id AND gym_season_id = gym_season_id)
```

### 3.5 `calculateCombinedScore(gym_season_id)`
```
= SUM(current_points) của TẤT CẢ gym_round_map_progress thuộc gym_season này
  − SUM(points_scored) của các entries thuộc member có is_banned = true
```
(Điểm tiến độ Map/Round KHÔNG bị trừ khi ban — chỉ số hiển thị "chính thức" mới trừ, theo Engine 3 đã chốt)

### 3.6 `round_progress_pct(map, current_round)`
```
= current_points (của round hiện tại, map đó) / current_round.max_score × 100
```
(Đơn giản — KHÔNG còn công thức "tính theo khoảng giữa 2 round" như bản thiết kế v3 cũ đã sai)

---

## 4. Flow quan trọng — Tham gia Season mới (Sub-Admin)

Hiện banner trong khu Sub-Admin khi `season_templates.is_active` khác với season_template mà `gym_seasons` đang active của Gym dùng.

**3 bước:** Copy (hiển thị sẵn roster hiện tại) → Edit (sửa/thêm/xoá dòng thành viên) → Submit (`POST /g/:slug/admin/seasons/switch`) →
- Tạo `gym_season` mới (season_template = bản đang active toàn hệ thống), set cũ `is_active=0`
- Tạo `members` MỚI theo danh sách đã edit (không update members cũ — giữ nguyên lịch sử mùa trước)
- Không cần khởi tạo `gym_round_map_progress`/`gym_round_status` trước — tự tạo lazy khi có Entry đầu tiên

---

## 5. Xử lý thành viên bị Banned

| Vị trí | Logic |
|---|---|
| `gym_round_map_progress` | Không đổi — điểm tiến độ giữ nguyên |
| Combined Score (banner) | Trừ điểm người banned (mục 3.5) |
| Leaderboard | Vẫn hiện, có badge "🚫 Đã khoá", loại khỏi thứ hạng |
| Form nhập log | Member banned không chọn được / disabled |
| API tạo entry | Từ chối nếu `member.is_banned = true` |

`PATCH /g/:slug/admin/members/:id/ban` — đảo ngược được (khoá/mở khoá).

---

## 6. Soft-delete Gym

`gyms.deleted_at` — set khi xoá, không đụng dữ liệu liên quan. Gym đã xoá: public trả 404, mã admin cũ vô hiệu, slug bị "giữ chỗ" (không cho Gym mới dùng lại slug đó trừ khi đổi slug Gym cũ trước). Có nút "Khôi phục" ở `/master/gyms` (tab riêng).

---

## 7. Module Master Admin Panel (`/master`, web UI có menu)

**Menu:** Dashboard | Season Templates | Gyms | Gym Requests

| Trang | Việc chính |
|---|---|
| Season Templates | Form: Tên, 8 Map (tên/type/ảnh/ghi chú tự do), N Round (nhập tay điểm trần từng round, không bắt buộc tăng dần), `repeat_max_score`, cấu hình vé (ngày giờ bắt đầu GMT+7 → convert UTC, vé ngày 1, vé/ngày, số ngày regen). Sau khi lưu → tự xuất JSON snapshot vào `season-configs/`. |
| Gyms | Danh sách + tạo mới (slug validate real-time) + đổi slug + xoá (soft)/khôi phục |
| Gym Requests | Duyệt (mở modal điền sẵn từ request) / Từ chối |

⚠️ Sửa `max_score` 1 Round đã có Gym hoàn thành → dialog cảnh báo rõ số Gym ảnh hưởng trước khi lưu.

---

## 8. Module đăng ký Gym công khai (F) — **ưu tiên thấp, làm sau cùng**

Trang chủ hệ thống: form nhập slug để xem Gym + nút "Đăng ký Gym mới" → `POST /public/gym-requests` (chặn trùng `contact_info` với Gym đang hoạt động hoặc request đang pending khác).

---

## 9. Việc đã gác lại (Backlog, không làm ở bản này)

| Hạng mục | Ghi chú |
|---|---|
| Module Gimmick chi tiết (theo Circuit, lặp chu kỳ 3, khác offset mỗi map) | Map chỉ có 1 ô "Ghi chú" tự do tạm thời. Cần buổi làm việc riêng để mô hình hoá pattern lặp trước khi triển khai. |
| Roster Sync Pair theo Type/Move Level/EX Level | Ý tưởng đã bàn, chưa triển khai |
| Backup/Restore tự động | Chưa cần ở giai đoạn này |
| Audit log (ai sửa gì) | Dùng chung 1 mã/Gym, không định danh từng sub-admin |
| Xem lại chi tiết từng Round đã qua trong CÙNG 1 mùa | Xác nhận không cần — chỉ cần Round hiện tại + Combined Score |
| Rate-limit chống dò mã admin | Rủi ro đã biết, chấp nhận ở quy mô nhỏ |
| Master Admin xem leaderboard liên-Gym | Kiến trúc hỗ trợ tốt nếu cần làm sau, hiện chưa cần |

---

## 10. UI đặc thù cần nhớ khi code Dashboard
- Grid 8 map: **4 cột × 2 hàng** cố định (desktop), co về **2 cột × 4 hàng** (mobile), giữ đúng thứ tự đọc trái→phải, trên→dưới.
- Banner: Round hiện tại + Combined Score (to, nổi bật) + Tổng vé chưa dùng.
- Theme màu Pokémon (navy/gold/coral/mint) đã thống nhất từ trước, giữ nguyên.

---

## 11. Business Invariants (bất biến bắt buộc đúng mọi lúc)

1. Mỗi `gym` chỉ có duy nhất 1 `gym_season` với `is_active=1` tại 1 thời điểm.
2. Mỗi `gym_season` có roster `members` riêng — không share member giữa các mùa (kể cả trùng tên).
3. Thành viên `is_banned=true` không tạo được Entry mới (vẫn xem được lịch sử cũ).
4. Tổng `tickets_used` của 1 member trong 1 `gym_season` không được vượt `calculateTicketsGranted()` tại thời điểm kiểm tra.
5. `gym_round_map_progress.current_points` luôn phản ánh đúng tổng `points_scored` hợp lệ của các Entry cùng (gym_season, round_number, map) — đảm bảo bằng cách mọi thay đổi Entry đều bọc chung 1 transaction với việc cập nhật progress (không có API nào sửa `current_points` độc lập ngoài luồng Entry).
6. Tại 1 thời điểm, chỉ Round đầu tiên **chưa** `completed` mới ở trạng thái `active`; mọi Round sau nó là `pending`.
7. Round thuộc vùng lặp (> `last_defined_round_number`) luôn dùng `repeat_max_score` cố định — không cộng dồn, không đổi theo round_number.
8. Không có cấu hình Round hợp lệ (`getRoundConfig` trả `null`) → không tạo được Entry mới cho round đó.
9. Soft-delete Gym không xoá bất kỳ dữ liệu lịch sử nào (`gym_seasons`, `members`, `entries` giữ nguyên).
10. `tickets_used` mỗi Entry luôn trong khoảng 1-3 (số nguyên).
11. Entry mới chỉ tạo được cho Round đang `active`; sửa/xoá Entry không bị giới hạn theo trạng thái Round.
12. Vì `better-sqlite3` chạy đồng bộ trên Node.js đơn luồng, mỗi request xử lý Entry/Progress chạy trọn vẹn không bị chen ngang — đảm bảo atomic tự nhiên mà không cần thêm cơ chế lock. ⚠️ Giả định này **gắn chặt với lựa chọn driver DB đồng bộ** — nếu sau này đổi sang driver bất đồng bộ, phải bổ sung transaction/lock tường minh.

---

## 12. Edge Case Matrix

| Case | Expected behavior |
|---|---|
| Entry làm Round vừa đủ max (tất cả map) | Round → `completed`, Round tiếp theo → `active` |
| Entry làm 1 map đủ max nhưng map khác chưa | Round vẫn `active` |
| Entry khiến điểm vượt max_score | Reject, báo rõ "còn thiếu bao nhiêu pts" |
| Sửa Entry của Round `active` (bình thường) | Cập nhật progress, recompute (thường không đổi trạng thái Round) |
| Sửa Entry của Round `completed` làm tụt điểm dưới max | Round đó tự `active` lại, mọi Round sau cascade về `pending` |
| Xoá Entry của Round `completed` | Same as trên — tự reopen + cascade |
| Tạo Entry cho Round không phải Round đang active | Reject ngay, không cho tạo |
| Hết vé (`tickets_used > remaining`) | Reject, trả về số vé còn lại chính xác |
| `tickets_used` ngoài khoảng 1-3 | Reject validate |
| Member bị banned cố tạo Entry | Reject |
| Member được unban | Chọn lại được trong form ngay; Entry cũ giữ nguyên; Combined Score tự cộng lại (vì công thức tính live theo `is_banned` hiện tại, không cache) |
| Gym hoàn thành Round cuối, KHÔNG có `repeat_max_score` | `getActiveRoundNumber` = null, `hasCompletedEverything` = true, chặn Entry mới, Dashboard hiện banner "Đã hoàn thành toàn bộ nội dung hiện có" |
| Gym hoàn thành Round cuối, CÓ `repeat_max_score` | Round mới tự tính động (không cần tạo dòng `season_template_rounds`), tiếp tục chơi bình thường |
| Master Admin giảm `max_score` 1 Round đã completed | Không đổi gì nếu vẫn còn ≥ điểm đã đạt; nếu điểm đã đạt giờ VƯỢT max mới — vẫn giữ `completed` (không "quá tải ngược", chỉ kiểm tra `>=`) |
| Master Admin tăng `max_score` 1 Round đã completed | Nếu điểm hiện tại < max mới → reopen + cascade các Round sau về `pending` |
| Hai request Entry đồng thời (2 Sub-Admin cùng Gym) | Không mất update — nhờ tính đồng bộ của `better-sqlite3`/Node (xem Invariant #12) |
| Hai request "chuyển Season" đồng thời | Cần thêm kiểm tra tại tầng API (Phase 2, chưa code) — về nguyên tắc chỉ 1 `gym_season` được `is_active=1`, request sau phải đọc lại trạng thái mới nhất trước khi ghi |
| Season Switch — roster có người đang banned | **Loại trừ khỏi danh sách copy mặc định** ở bước "Copy" (không tự động mang người banned sang mùa mới). Nếu Sub-Admin tự gõ lại đúng tên ở bước Edit → tạo thành viên MỚI hoàn toàn, không mang theo trạng thái banned (hệ thống không có cách xác định đó là "cùng 1 người" giữa 2 mùa) |
| Season Switch giữa chừng (mùa cũ chưa xong) | Cho phép tự do, không bắt buộc phải hoàn thành mùa cũ mới được chuyển — mùa cũ đóng băng, xem lại qua Season Archive |

---

## 13. Cập nhật Flow "Tham gia Season mới" — loại trừ Banned khỏi bước Copy
Bổ sung cho mục 4: ở **Bước 1 — Copy**, danh sách roster hiển thị sẵn để edit **tự động loại bỏ mọi member có `is_banned=true`** của mùa cũ — không hiện trong danh sách copy, Sub-Admin phải tự gõ tay nếu thực sự muốn thêm lại (trường hợp này tạo member hoàn toàn mới, xem Edge Case Matrix).

