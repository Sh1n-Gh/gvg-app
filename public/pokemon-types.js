// ===== POKEMON TYPES — mapping tập trung dùng chung cho toàn bộ frontend =====
// Không dùng module/import — project này là static JS thuần (script tag), nên khai báo
// biến global để master.js / admin.js / dashboard.js đều dùng chung 1 nguồn duy nhất.
// Icon SVG được lưu cục bộ trong /assets/pokemon-types để không phụ thuộc CDN.
// Nguồn: partywhale/pokemon-type-icons (MIT), xem LICENSE.txt trong thư mục asset.

const POKEMON_TYPES = [
  { value: 'normal', label: 'Normal', icon: '/assets/pokemon-types/normal.svg' },
  { value: 'fire', label: 'Fire', icon: '/assets/pokemon-types/fire.svg' },
  { value: 'water', label: 'Water', icon: '/assets/pokemon-types/water.svg' },
  { value: 'electric', label: 'Electric', icon: '/assets/pokemon-types/electric.svg' },
  { value: 'grass', label: 'Grass', icon: '/assets/pokemon-types/grass.svg' },
  { value: 'ice', label: 'Ice', icon: '/assets/pokemon-types/ice.svg' },
  { value: 'fighting', label: 'Fighting', icon: '/assets/pokemon-types/fighting.svg' },
  { value: 'poison', label: 'Poison', icon: '/assets/pokemon-types/poison.svg' },
  { value: 'ground', label: 'Ground', icon: '/assets/pokemon-types/ground.svg' },
  { value: 'flying', label: 'Flying', icon: '/assets/pokemon-types/flying.svg' },
  { value: 'psychic', label: 'Psychic', icon: '/assets/pokemon-types/psychic.svg' },
  { value: 'bug', label: 'Bug', icon: '/assets/pokemon-types/bug.svg' },
  { value: 'rock', label: 'Rock', icon: '/assets/pokemon-types/rock.svg' },
  { value: 'ghost', label: 'Ghost', icon: '/assets/pokemon-types/ghost.svg' },
  { value: 'dragon', label: 'Dragon', icon: '/assets/pokemon-types/dragon.svg' },
  { value: 'dark', label: 'Dark', icon: '/assets/pokemon-types/dark.svg' },
  { value: 'steel', label: 'Steel', icon: '/assets/pokemon-types/steel.svg' },
  { value: 'fairy', label: 'Fairy', icon: '/assets/pokemon-types/fairy.svg' },
];

const POKEMON_TYPE_MAP = Object.fromEntries(POKEMON_TYPES.map(t => [t.value, t]));

// Chuẩn hoá 1 giá trị type_weakness cũ/lạ (có thể null, chuỗi tự do, sai hoa-thường...) về
// đúng 1 key hợp lệ trong POKEMON_TYPES, hoặc null nếu không nhận diện được (an toàn, không crash).
function normalizePokemonType(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return Object.hasOwn(POKEMON_TYPE_MAP, key) ? key : null;
}

// Render <option> cho dropdown chọn Type (dùng ở Master Admin — Season Template Maps)
function pokemonTypeOptionsHtml(selectedRaw) {
  const selectedKey = normalizePokemonType(selectedRaw);
  const emptyOption = `<option value="" ${!selectedKey ? 'selected' : ''}>— Không có —</option>`;
  const options = POKEMON_TYPES.map(t =>
    `<option value="${t.value}" ${t.value === selectedKey ? 'selected' : ''}>${t.label}</option>`
  ).join('');
  return emptyOption + options;
}

// Render badge chỉ-icon (không hiện text) dùng ở mọi nơi hiển thị Type Weakness (map card, log entry...)
// title="" giữ label đầy đủ cho accessibility/tooltip (hover), aria-label cho screen reader.
function pokemonTypeIconHtml(raw, cls = 'type-icon') {
  const key = normalizePokemonType(raw);
  if (!key) return '';
  const t = POKEMON_TYPE_MAP[key];
  return `<img class="${cls}" src="${t.icon}" alt="${t.label}" title="${t.label}">`;
}
