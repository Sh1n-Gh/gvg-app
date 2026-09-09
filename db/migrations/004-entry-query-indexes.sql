-- P18: measured plans, latency and write/storage costs in docs/P18-CHECKPOINT.md.
CREATE INDEX idx_entries_member_season ON entries(member_id, gym_season_id);
CREATE INDEX idx_entries_season_created ON entries(gym_season_id, created_at DESC);
