// Lightweight frontend contract tests for the no-build, vanilla-JS UI.
// No DOM/test dependency is added: pure shared helpers are evaluated in a VM,
// while page wiring is checked as source contracts and covered end-to-end by the HTTP smoke test.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
let fail = 0;

function check(label, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label} ${detail}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

console.log('\n=== FRONTEND UX CONTRACTS ===');

const pokemonTypesSource = read('public/pokemon-types.js');
const pokemonContext = {};
vm.createContext(pokemonContext);
vm.runInContext(`${pokemonTypesSource}\n;globalThis.__exports = { POKEMON_TYPES, normalizePokemonType, pokemonTypeOptionsHtml, pokemonTypeIconHtml };`, pokemonContext);

const typeApi = pokemonContext.__exports;
const expectedTypes = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
];
check('Có đúng 18 Pokemon Type theo đúng thứ tự',
  JSON.stringify(typeApi.POKEMON_TYPES.map(type => type.value)) === JSON.stringify(expectedTypes));
check('Mỗi Pokemon Type dùng SVG cục bộ tập trung',
  typeApi.POKEMON_TYPES.every(type => type.icon?.startsWith('/assets/pokemon-types/') && type.icon.endsWith('.svg')));
check('Type cũ được chuẩn hoá không phân biệt hoa/thường', typeApi.normalizePokemonType(' FIRE ') === 'fire');
check('Type lạ trả fallback an toàn', typeApi.normalizePokemonType('not-a-type') === null && typeApi.pokemonTypeIconHtml('not-a-type') === '');
check('Type icon render bằng ảnh SVG thay cho emoji',
  /<img class="type-icon" src="\/assets\/pokemon-types\/fire\.svg"/.test(typeApi.pokemonTypeIconHtml('fire')));

const typeAssetPath = path.join(__dirname, '..', 'public', 'assets', 'pokemon-types');
check('Có đủ 18 file SVG và license của bộ icon',
  fs.readdirSync(typeAssetPath).filter(file => file.endsWith('.svg')).length === 18
  && fs.existsSync(path.join(typeAssetPath, 'LICENSE.txt')));

const optionMarkup = typeApi.pokemonTypeOptionsHtml('water');
check('Dropdown sinh đủ 18 value hợp lệ', expectedTypes.every(type => optionMarkup.includes(`value="${type}"`)));
check('Dropdown đánh dấu đúng value đã lưu', /<option value="water" selected>Water<\/option>/.test(optionMarkup));

const masterJs = read('public/master.js');
const masterHtml = read('public/master.html');
check('Map Type dùng select, không dùng text input', /<select class="map-type">/.test(masterJs));
check('Round submit luôn sinh round_number từ vị trí row', /round_number:\s*i \+ 1/.test(masterJs));
check('Master dùng file upload PNG/JPEG thay cho ô nhập URL ảnh Map',
  /type="file" class="map-image-file" accept="[^"]*image\/png[^"]*image\/jpeg/.test(masterJs)
  && !/placeholder="(?:URL|Image URL)/i.test(masterJs));
check('Master upload ảnh qua API riêng và giữ URL nội bộ sau upload',
  /api\('\/map-images',[\s\S]*body:\s*file/.test(masterJs) && /return result\.image_url/.test(masterJs));
check('Repeat max_score lấy trực tiếp từ max_score của Round cuối',
  /repeat_max_score:\s*rounds\[rounds\.length - 1\]\.max_score/.test(masterJs)
  && !/id="st-repeat-max"/.test(masterHtml));
check('Script Pokemon Type được load trước Master page script',
  masterHtml.indexOf('/pokemon-types.js') < masterHtml.indexOf('/master.js'));

const adminJs = read('public/admin.js');
const adminHtml = read('public/admin.html');
const adminUtilsSource = read('public/admin-utils.js');
const styleCss = read('public/style.css');
check('Ảnh Map upload được đưa về khung cố định và crop đồng đều',
  /\.map-image-preview\s*\{[\s\S]*?width:\s*64px;[\s\S]*?height:\s*64px;/.test(styleCss)
  && /\.map-image-preview img\s*\{[^}]*object-fit:\s*cover/.test(styleCss));
const adminUtilsContext = {};
vm.createContext(adminUtilsContext);
vm.runInContext(`${adminUtilsSource}\n;globalThis.__exports = { prioritizeEntryMaps, filterAdminLogRows };`, adminUtilsContext);
const adminUtils = adminUtilsContext.__exports;

const prioritizedMapIds = adminUtils.prioritizeEntryMaps([
  { id: 1, status: 'ended' },
  { id: 2, status: 'open' },
  { id: 3, status: 'ended' },
  { id: 4, status: 'open' },
]).map(map => map.id);
check('Dropdown ghi log ưu tiên Map chưa clear và giữ thứ tự trong từng nhóm',
  JSON.stringify(prioritizedMapIds) === JSON.stringify([2, 4, 1, 3]));

const filteredLogIds = adminUtils.filterAdminLogRows([
  { id: 1, member_id: 10, round_number: 1, season_template_map_id: 100 },
  { id: 2, member_id: 10, round_number: 2, season_template_map_id: 200 },
  { id: 3, member_id: 20, round_number: 2, season_template_map_id: 200 },
], { memberId: '10', roundNumber: '2', mapId: '200' }).map(row => row.id);
check('Bộ lọc log kết hợp Thành viên + Round + Map chính xác',
  JSON.stringify(filteredLogIds) === JSON.stringify([2]));
check('Bộ lọc rỗng giữ nguyên toàn bộ log',
  adminUtils.filterAdminLogRows([{ id: 1 }, { id: 2 }], {}).length === 2);

check('Sub-Admin có hai tab Thành viên và Lượt chơi',
  /data-admin-tab="members"/.test(adminHtml) && /data-admin-tab="entries"/.test(adminHtml)
  && /id="admin-tab-members"/.test(adminHtml) && /id="admin-tab-entries"/.test(adminHtml));
check('Quản lý lượt chơi có đủ ba bộ lọc và nút reset',
  /id="log-filter-member"/.test(adminHtml) && /id="log-filter-round"/.test(adminHtml)
  && /id="log-filter-map"/.test(adminHtml) && /id="log-filter-reset"/.test(adminHtml));
check('Entry có flow Sửa/Lưu/Huỷ và gọi PATCH bản ghi hiện tại',
  /class="btn btn-secondary ed-edit"/.test(adminJs)
  && /class="btn btn-secondary ed-cancel"/.test(adminJs)
  && /api\(`\/entries\/\$\{id\}`,[\s\S]*method: 'PATCH'/.test(adminJs));
check('Log Entry render map image và Type icon dùng chung',
  /avatarHtml\(r\.map_image/.test(adminJs) && /pokemonTypeIconHtml\(r\.map_type\)/.test(adminJs));
check('Member có flow Sửa/Lưu/Huỷ và gọi PATCH, không tạo mới',
  /class="btn btn-secondary mem-edit"/.test(adminJs)
  && /class="btn btn-secondary mem-cancel"/.test(adminJs)
  && /api\(`\/members\/\$\{id\}`,[\s\S]*method: 'PATCH'/.test(adminJs));
check('Member edit có layout responsive',
  /\.member-edit-row/.test(styleCss) && /\.wizard-row, \.member-edit-row\s*\{\s*grid-template-columns: 1fr/.test(styleCss));
check('Script Pokemon Type được load trước Admin page script',
  adminHtml.indexOf('/pokemon-types.js') < adminHtml.indexOf('/admin.js'));
check('Admin utility được load trước Admin page script',
  adminHtml.indexOf('/admin-utils.js') < adminHtml.indexOf('/admin.js'));

const dashboardJs = read('public/dashboard.js');
const dashboardHtml = read('public/dashboard.html');
check('Trang Gym tích hợp tab Admin có khoá mật khẩu và hai khu quản trị',
  /data-tab="admin"/.test(dashboardHtml) && /id="lock-box"/.test(dashboardHtml)
  && /type="password" id="admin-code"/.test(dashboardHtml)
  && /data-admin-tab="members"/.test(dashboardHtml) && /data-admin-tab="entries"/.test(dashboardHtml)
  && /id="admin-tab-members"/.test(dashboardHtml) && /id="admin-tab-entries"/.test(dashboardHtml));
check('Leaderboard hiển thị đủ điểm, vé cấp/dùng/còn/sẽ nhận và trung bình',
  /Tổng điểm/.test(dashboardJs) && /Vé đã cấp/.test(dashboardJs) && /Vé đã dùng/.test(dashboardJs)
  && /Vé còn lại/.test(dashboardJs) && /Vé sẽ nhận thêm/.test(dashboardJs) && /Điểm \/ vé/.test(dashboardJs)
  && /tickets_granted/.test(dashboardJs) && /tickets_future/.test(dashboardJs)
  && /average_points_per_ticket/.test(dashboardJs));
check('Tab Vé riêng đã được loại bỏ khỏi trang Gym',
  !/data-tab="tickets"/.test(dashboardHtml) && !/id="tab-tickets"/.test(dashboardHtml));
check('Lịch sử public có filter Thành viên, Round, Map và nút reset',
  /id="public-log-filter-member"/.test(dashboardHtml)
  && /id="public-log-filter-round"/.test(dashboardHtml)
  && /id="public-log-filter-map"/.test(dashboardHtml)
  && /id="public-log-filter-reset"/.test(dashboardHtml)
  && /filterAdminLogRows\(publicLogRowsCache/.test(dashboardJs));
check('Script Admin được cô lập và load sau Dashboard để không xung đột',
  /^\(\(\) => \{/.test(adminJs)
  && dashboardHtml.indexOf('/admin-utils.js') < dashboardHtml.indexOf('/dashboard.js')
  && dashboardHtml.indexOf('/dashboard.js') < dashboardHtml.indexOf('/admin.js'));
check('Leaderboard ưu tiên tổng điểm, điểm trung bình và gom thông tin vé',
  /leaderboard-score-value/.test(dashboardJs) && /leaderboard-average/.test(dashboardJs)
  && /leaderboard-ticket-list/.test(dashboardJs) && /leaderboard-ticket-heading/.test(dashboardJs)
  && /\.leaderboard-score-value\s*\{[^}]*font-size: 30px/.test(styleCss));
check('Leaderboard Mobile dùng dòng compact để xem 4-5 thành viên',
  /@media \(max-width: 600px\)[\s\S]*?\.leaderboard-row\s*\{[^}]*min-height: 68px/.test(styleCss)
  && /\.leaderboard-ticket-list\s*\{[^}]*display: flex/.test(styleCss)
  && /\.ticket-label-short, \.ticket-future-suffix\s*\{\s*display: inline !important/.test(styleCss));
check('Cụm vé Mobile căn giữa cùng một dòng',
  /\.leaderboard-ticket-list\s*\{[^}]*align-items: center[^}]*line-height: 1/.test(styleCss)
  && /\.leaderboard-ticket\s*\{[^}]*align-items: center[^}]*line-height: 1/.test(styleCss)
  && /leaderboard-ticket \+ \.leaderboard-ticket::before\s*\{[^}]*font-size: 8px[^}]*line-height: 1/.test(styleCss));
check('Dashboard có hai bảng overview Điểm và Vé',
  /id="score-overview"/.test(dashboardHtml) && /id="ticket-overview"/.test(dashboardHtml));
check('Bảng điểm dùng heatmap và đổi màu chữ theo độ đậm',
  /function scoreHeatStyle/.test(dashboardJs) && /lightness < 57/.test(dashboardJs));
check('Bảng vé nối thứ tự tickets bằng dấu gạch ngang',
  /tickets\.join\('-'\)/.test(dashboardJs));
check('Điện thoại giữ lưới Dashboard 4 Map mỗi hàng',
  /@media \(max-width: 700px\)[\s\S]*?\.map-cards\s*\{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(styleCss));
check('Điện thoại rút gọn riêng cột Member và cột Round',
  /score-overview-table \.overview-row-header\s*\{[\s\S]*?min-width: 96px !important/.test(styleCss)
  && /ticket-overview-table \.overview-row-header\s*\{[\s\S]*?min-width: 68px !important/.test(styleCss)
  && /\.overview-member-name[\s\S]*?text-overflow: ellipsis/.test(styleCss));

const authClient = read('public/auth-client.js');
check('P05 frontend không giữ/gửi legacy credential hay dùng browser storage',
  !/masterCode|adminCode|x-master-admin-code|x-admin-code|localStorage|sessionStorage/.test(masterJs + adminJs + authClient));
check('P05 helper auth được load trước frontend Master và Gym',
  masterHtml.indexOf('/auth-client.js') < masterHtml.indexOf('/master.js')
  && dashboardHtml.indexOf('/auth-client.js') < dashboardHtml.indexOf('/admin.js'));

console.log(`\n${'='.repeat(50)}`);
console.log(`KẾT QUẢ: ${pass} PASS / ${fail} FAIL (tổng ${pass + fail} test)`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);
