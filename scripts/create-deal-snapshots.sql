-- ============================================================
-- Korea Decode: deal_snapshots table
-- 가격/포인트 이력 저장 (트렌드 분석용)
-- Run this AFTER create-hotel-deals.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES hotel_deals(id) ON DELETE CASCADE,
  captured_at   timestamptz DEFAULT now(),
  cash_price    numeric(12, 2),
  points_price  integer,
  cpp           numeric(6, 3),
  diff          jsonb DEFAULT '{}'::jsonb,          -- previous-vs-current deltas
  source        text DEFAULT 'gondola'
);

CREATE INDEX IF NOT EXISTS idx_deal_snapshots_deal ON deal_snapshots(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_snapshots_captured ON deal_snapshots(captured_at DESC);

ALTER TABLE deal_snapshots ENABLE ROW LEVEL SECURITY;

-- Public read (for showing price history charts if needed later)
CREATE POLICY "Allow public read on deal_snapshots"
  ON deal_snapshots FOR SELECT
  USING (true);

-- Admin write (anon + authenticated)
CREATE POLICY "Allow anon insert on deal_snapshots"
  ON deal_snapshots FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow authenticated all on deal_snapshots"
  ON deal_snapshots FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
