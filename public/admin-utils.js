// Các helper thuần cho trang Sub-Admin. Tách khỏi DOM để dễ kiểm thử và giữ
// behavior sắp xếp/lọc nhất quán mà không cần thêm dependency frontend.

function prioritizeEntryMaps(mapRows) {
  return (mapRows || [])
    .map((map, originalIndex) => ({ map, originalIndex }))
    .sort((left, right) => {
      const leftCleared = left.map.status === 'ended' ? 1 : 0;
      const rightCleared = right.map.status === 'ended' ? 1 : 0;
      return leftCleared - rightCleared || left.originalIndex - right.originalIndex;
    })
    .map(item => item.map);
}

function filterAdminLogRows(rows, filters = {}) {
  const memberId = String(filters.memberId || '');
  const roundNumber = String(filters.roundNumber || '');
  const mapId = String(filters.mapId || '');

  return (rows || []).filter(row =>
    (!memberId || String(row.member_id) === memberId)
    && (!roundNumber || String(row.round_number) === roundNumber)
    && (!mapId || String(row.season_template_map_id) === mapId)
  );
}
