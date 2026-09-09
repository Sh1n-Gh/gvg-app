# HANDOFF — Gym vs Gym Tracker (Multi-Tenant)

Bạn (Codex) đang tiếp quản một project **đã chạy được, đã test, KHÔNG phải viết lại từ đầu**.
Hãy đọc kỹ tài liệu này TRƯỚC khi đọc code, để có đúng bối cảnh, tránh đoán sai ý đồ thiết kế
hoặc vô tình phá vỡ các quyết định đã chốt.

---

## 0. NGUỒN SỰ THẬT

1. **`PRD-FINAL.md`** (trong repo) — source of truth DUY NHẤT cho business logic. Nếu code khác PRD, PRD thắng — nhưng phải BÁO CÁO rõ trước khi tự ý sửa, không âm thầm chọn 1 bên.
2. Toàn bộ codebase trong zip — đã qua nhiều vòng audit + implement + test, không phải bản nháp.

Đừng "đoán" business rule còn thiếu. Đừng resurrect field/model đã bị bỏ. Nếu thấy ambiguity ảnh hưởng business logic/schema/security → DỪNG lại và hỏi người dùng, đừng tự quyết.

---

## 1. STACK & KIẾN TRÚC

- **Backend:** Node.js (CommonJS, không TS, không build step) + Express 5 + `better-sqlite3` (đồng bộ — nhiều invariant PRD dựa vào tính đồng bộ này, xem mục 4).
- **Frontend:** Vanilla HTML/CSS/JS thuần, **KHÔNG có bundler, KHÔNG module system**. Mỗi trang là 1 file `.js` load qua `<script src>` bình thường, biến là global. Khi thêm code dùng chung giữa các trang (ví dụ `public/pokemon-types.js`), phải khai báo global và include bằng `<script>` tag ở đúng các trang cần, đặt TRƯỚC script chính của trang đó.
- **DB:** file SQLite, schema ở `db/schema.sql`, tự áp dụng khi boot qua `db/index.js` (idempotent, `CREATE TABLE IF NOT EXISTS`).
- **Business logic core** nằm tập trung ở `engine/index.js` — nhận `db` làm tham số đầu, không phụ thuộc Express, dễ unit-test độc lập. Routes (`routes/*.js`) chỉ là lớp mỏng gọi engine, KHÔNG duplicate business logic.
- **3 khu vực người dùng:**
  - `/g/:slug` — Dashboard công khai (`public/dashboard.html` + `.js`), đọc qua `routes/gym-public.js`.
  - `/g/:slug/admin` — Sub-Admin panel (`public/admin.html` + `.js`), qua `routes/gym-admin.js`, auth bằng header `x-admin-code` riêng từng Gym.
  - `/master` — Master Admin panel (`public/master.html` + `.js`), qua `routes/master.js`, auth bằng header `x-master-admin-code` (global, từ `MASTER_ADMIN_CODE` env, mặc định `master-changeme`).
- **`server.js`** export `createApp(db)` (factory, không tự listen) — cho phép test import app thật mà không cần mở port. Khi chạy `node server.js` trực tiếp (`require.main === module`) mới thực sự listen. **Giữ nguyên pattern này** khi thêm route mới.

⚠️ **Lưu ý routing đặc thù của `/master`:** `routes/master.js` áp `router.use(requireMasterAdmin)` toàn cục — chặn CẢ path gốc `/master`. Vì vậy trong `server.js`, route serve HTML tĩnh cho đúng path `/master` (exact match) phải đăng ký **TRƯỚC** khi mount `masterRoutes`, ngược lại với thứ tự ở `/g/:slug/admin` (nơi auth áp theo từng route riêng lẻ nên thứ tự không quan trọng). Đừng đảo lại thứ tự này nếu không muốn `/master` trả 403 khi load trang.

---

## 2. TRẠNG THÁI HIỆN TẠI THEO PHASE (tự suy ra từ code, KHÔNG có tài liệu Phase chính thức trong repo)

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 1 | Engine lõi (`getRoundConfig`, `recomputeRoundChain`, tickets, combined score, entry create/edit/delete) | ✅ Xong, test kỹ |
| 2 | API Gym Admin + Public | ✅ Xong |
| 3–4 | Frontend Sub-Admin + Public Dashboard (season switch wizard, banned badge, leaderboard...) | ✅ Xong |
| 5 | Master Admin **backend** API (Season Templates CRUD, Gyms CRUD/soft-delete, snapshot export) | ✅ Xong |
| 6 | Master Admin **frontend** (web UI thật, không phải script) | ✅ Xong (vừa hoàn thành gần đây) |
| 6.5 | **UX improvement round** (task gần nhất — xem mục 3) | ✅ Xong, đã test |
| 7 | Gym Requests — approve/reject đầy đủ (hiện chỉ có GET danh sách, có comment `// nối đầy đủ ở Phase 7` trong `routes/master.js`) | ⏳ CHƯA làm — đây rất có thể là việc tiếp theo |

---

## 3. VIỆC VỪA HOÀN THÀNH (task gần nhất, đã test đầy đủ)

Cải tiến UX cho Master Admin + Log Entry management:

1. **`public/pokemon-types.js` (MỚI)** — mapping tập trung 18 Pokemon Type (đúng thứ tự PRD) → icon emoji + label. Dùng chung cho `master.js` (dropdown chọn type), `admin.js` (icon trong log), `dashboard.js` (icon trong map card). Có `normalizePokemonType()` xử lý an toàn dữ liệu cũ/sai (không crash, trả `null` nếu không nhận diện được).
2. **Type Weakness giờ là dropdown enum**, không còn free-text. Validate cả 2 lớp: frontend (dropdown chỉ có 18 option) VÀ backend (`routes/master.js` — `VALID_POKEMON_TYPES` set, validate trong `validateSeasonPayload`). ⚠️ Danh sách 18 type được lặp lại ở CẢ HAI file (`public/pokemon-types.js` và `routes/master.js`) vì frontend/backend không share module được (frontend không có bundler). Nếu sửa danh sách type, PHẢI sửa cả 2 nơi — có comment nhắc ở cả 2 file.
3. **Round auto-numbering** trong Master Admin form — `round_number` không cho nhập tay nữa, tự tính theo vị trí row (1, 2, 3...). ⚠️ XEM MỤC 5 (RỦI RO) — có 1 rủi ro đã biết liên quan đến việc này, đọc kỹ trước khi động vào phần Rounds.
4. **Entry Edit UX** — khám phá ra rằng **backend đã có sẵn từ trước** (`engine.editEntry()` + `PATCH /g/:slug/admin/entries/:id`), đầy đủ transaction/delta/validate/reopen-cascade, KHÔNG cần thêm code backend. Chỉ cần sửa frontend: `admin.js` giờ có flow Edit → Save/Cancel rõ ràng (trước đây input luôn hiện sẵn, không có nút Cancel tường minh).
5. **Map avatar + Type icon trong Log Entry list** — `routes/gym-admin.js`'s `GET /entries` giờ SELECT thêm `mp.image_url as map_image, mp.type_weakness as map_type`; `admin.js` hiển thị avatar + icon trong mỗi log card.
6. **Member avatar edit sau khi save** — khám phá ra backend (`PATCH /g/:slug/admin/members/:id`) đã hỗ trợ `avatar_url` từ trước, chỉ thiếu input ở frontend. Đã thêm input avatar vào mỗi member row trong `admin.js`.
7. **Cải thiện thông báo lỗi** trong `engine.editEntry()` — khi vượt `max_score`, giờ báo rõ "còn thiếu N pts" (đồng nhất với `createEntry`), thay vì chỉ báo mốc max_score.

**Test đã thêm (đều PASS):**
- `test/engine-test.js`: +6 case mới (edit trong hạn mức, edit vượt hạn mức + đúng message, edit bị reject không đổi progress, ticket range khi edit, **xác nhận sửa entry lịch sử của member đã banned vẫn được PHÉP** — đúng PRD, chỉ chặn tạo entry MỚI chứ không chặn sửa/xoá entry cũ).
- `test/master-routes-smoke-test.js`: +3 case (type không hợp lệ → 400, type hợp lệ không phân biệt hoa/thường → 200, giá trị được chuẩn hoá lowercase khi lưu).
- **Tổng: 56/56 test PASS** (`npm test` = `engine-test.js` + `master-routes-smoke-test.js`).
- Đã verify thủ công qua curl end-to-end: tạo season có type → activate → tạo gym → tạo entry → sửa entry (map_image/map_type trả đúng trong response) → sửa avatar member — tất cả hoạt động đúng.

---

## 4. BUSINESS INVARIANTS BẮT BUỘC (đừng vô tình phá khi sửa code)

- Mỗi Gym chỉ có 1 `gym_season` active tại 1 thời điểm; member thuộc `gym_season`, không share giữa mùa.
- `getRoundConfig()`: round có định nghĩa trong `season_template_rounds` → dùng max_score đó; round ngoài phạm vi (> `last_defined_round_number`) → dùng `repeat_max_score` cố định (không cộng dồn); không có config hợp lệ → trả `null`.
- `recomputeRoundChain()` phải idempotent, xử lý đúng active/completed/pending/reopen/cascade — đặc biệt khi sửa/xoá Entry của Round đã completed (tự reopen + cascade các Round sau về pending).
- Entry MỚI chỉ tạo được cho Round đang active. Entry CŨ có thể sửa/xoá kể cả khi Round đã completed (Sub-Admin có quyền này).
- `tickets_used` nguyên 1–3, tổng không vượt số vé được cấp tại thời điểm kiểm tra (trừ giá trị cũ khi đang edit chính entry đó).
- `points_scored` không được làm tổng progress của (gym_season, round, map) vượt `max_score` (loại trừ giá trị cũ của entry đang sửa).
- Banned member: KHÔNG tạo được Entry mới; **NHƯNG entry lịch sử cũ của họ vẫn sửa/xoá được bình thường** (đã xác nhận qua test, PRD không cấm việc này — invariant #3 trong PRD chỉ nói "không tạo được Entry mới").
- `gym_round_map_progress.current_points` luôn phải phản ánh đúng tổng points hợp lệ — mọi thay đổi Entry phải bọc chung 1 transaction với update progress, không có API nào sửa `current_points` độc lập.
- `entries.round_number` là **plain INTEGER, KHÔNG có FK** tới `season_template_rounds.id`. Đây là điểm quan trọng — xem rủi ro ở mục 5.

---

## 5. RỦI RO ĐÃ BIẾT — CHƯA GIẢI QUYẾT, CẦN CÂN NHẮC KHI ĐỘNG VÀO

**Round renumbering trên Season Template đang có Gym sử dụng:**
`entries.round_number` là số nguyên thuần, không có khoá ngoại — nó là liên kết DUY NHẤT giữa 1 entry lịch sử và "đây là round nào". Khi Master Admin sửa 1 Season Template đã có Gym đang dùng (`PATCH /master/season-templates/:id`), backend hiện tại **xoá hết** `season_template_rounds` cũ rồi **chèn lại từ đầu** theo đúng thứ tự mảng gửi lên. Nếu Master Admin xoá 1 Round ở giữa danh sách (không phải cuối), các Round sau sẽ bị dồn số xuống — làm thay đổi Ý NGHĨA của "Round 2", "Round 3"... đối với các entry ĐÃ GHI NHẬN của các Gym đang dùng template đó.

- Rủi ro này **đã tồn tại từ trước** (thuộc thiết kế Phase 5 backend, không phải do task gần nhất tạo ra).
- Việc thêm "round auto-numbering" ở task gần nhất KHÔNG làm rủi ro này nặng hơn về mặt kỹ thuật, nhưng làm nó DỄ xảy ra hơn (trước đây user tự gõ số nên có thể tự né gap, giờ hệ thống tự động theo vị trí).
- Đã thêm cảnh báo rõ ràng trong dialog xác nhận ở `master.js` (khi sửa season có `gym_count > 0`), nhưng đây chỉ là warning UI, KHÔNG phải giải pháp kỹ thuật triệt để.
- **Chưa quyết định giải pháp lâu dài** (ví dụ: chỉ cho phép thêm Round ở cuối khi đã có Gym dùng; hoặc disable nút Xoá cho row không phải cuối cùng khi `gym_count > 0`; hoặc redesign lưu round theo id thay vì number). Đây là ứng viên tốt để hỏi người dùng trước khi tự quyết, vì đụng đến schema/business logic.

---

## 6. CÁCH CHẠY / TEST (lưu ý môi trường)

```bash
npm install --nodedir=/usr/include/node   # ⚠️ better-sqlite3 cần compile native binding.
                                            # `npm install` thường KHÔNG dùng flag này sẽ lỗi 403 khi
                                            # node-gyp cố tải header từ nodejs.org (domain có thể bị chặn
                                            # tuỳ môi trường sandbox). Header của Node đã có sẵn tại
                                            # /usr/include/node trong môi trường build — trỏ thẳng vào đó.
npm test        # chạy engine-test.js + master-routes-smoke-test.js (56 test, KHÔNG dùng supertest —
                # dùng http.createServer thật + fetch built-in của Node, xem lý do ở mục 7)
npm start       # = node server.js, đọc PORT/DB_PATH/MASTER_ADMIN_CODE từ env (có .env.example)
```

Sau khi chạy `npm test` hoặc test script thủ công, kiểm tra lại `season-configs/` và `test/*.db*` không còn file rác (2 test suite đều tự dọn dẹp, nhưng nếu test crash giữa chừng có thể sót lại).

---

## 7. TRIẾT LÝ TEST CỦA PROJECT NÀY

- KHÔNG dùng framework test (không Jest/Mocha/supertest). Test là script Node thuần, tự đếm pass/fail, `process.exit(fail>0?1:0)`.
- `test/engine-test.js` — test business logic thuần ở tầng `engine/`, không qua HTTP.
- `test/master-routes-smoke-test.js` — test tầng route/HTTP thật, dùng `http.createServer` + `fetch` built-in của Node (Node ≥18 có sẵn, không cần cài thêm). Trước khi thêm dependency test mới (vd supertest), hãy tự hỏi "http+fetch có làm được không" — thường là có.
- Mỗi test suite tự tạo DB SQLite riêng (file tạm), tự dọn dẹp ở cuối kể cả khi fail giữa chừng (đặt cleanup trong khối cuối cùng chạy được, hoặc dùng try/finally nếu cần chắc chắn hơn).

---

## 8. NGUYÊN TẮC LÀM VIỆC TIẾP (áp dụng lại cho mọi task sau này trên project này)

1. **Không rewrite, ưu tiên reuse.** Đọc kỹ implementation hiện tại trước khi sửa — nhiều lần task yêu cầu "thêm tính năng X" nhưng backend đã có sẵn 80-90%, chỉ thiếu phần UI hoặc 1 cột SELECT.
2. **Audit trước, code sau.** Với task lớn/mơ hồ: đọc code + PRD, báo cáo hiện trạng, liệt kê file sẽ đổi, rồi mới code.
3. **Business logic tập trung ở `engine/`**, routes chỉ gọi. Đừng nhét logic vào frontend hay duplicate giữa API/UI.
4. **Không tự quyết định thay khi ambiguous** — đặc biệt nếu đụng schema, business rule đã chốt trong PRD, hoặc rủi ro data integrity (xem mục 5 làm ví dụ mẫu về cách flag risk thay vì tự sửa).
5. **Preserve existing behavior** — trước khi sửa 1 hàm/API dùng chung, đọc hết nơi gọi nó + test liên quan.
6. **Test-first cho mọi business logic mới**, chạy lại toàn bộ suite (không chỉ phần mới) trước khi báo "done".
7. **Không over-engineer** — không tự thêm abstraction/dependency/framework/cache/queue nếu task không cần. Ví dụ gần nhất: dùng emoji làm icon thay vì thêm icon library, vì project vốn không có bundler/asset pipeline.

---

## 9. VIỆC CÓ THỂ CẦN LÀM TIẾP (gợi ý, không phải chỉ định — vẫn nên hỏi người dùng trước khi bắt đầu)

- **Phase 7 — Gym Requests đầy đủ**: hiện `routes/master.js` chỉ có `GET /gym-requests` (list). Cần thêm approve/reject, và ở phía public cần form đăng ký Gym mới (`POST /gym-requests`) — hiện `public/index.html` có sẵn chỗ cho việc này nhưng logic đăng ký chưa nối.
- **Giải quyết rủi ro round-renumbering** ở mục 5 — cần quyết định hướng đi rồi mới code.
- Xem lại `test/test.db*` / `season-configs/*.json` có bị commit nhầm vào git không (nếu project dùng git — repo hiện đưa qua dạng zip nên chưa rõ tình trạng git).
