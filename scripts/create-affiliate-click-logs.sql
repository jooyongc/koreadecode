-- ============================================================
-- Korea Decode: affiliate_click_logs table
-- 어필리에이트 클릭 로그 (GA 보완 + 파트너 리포트 대조용)
-- ============================================================

CREATE TABLE IF NOT EXISTS affiliate_click_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_slug        text,
  preset_id        text,                            -- affiliate_presets.id (FK 아님 — 프리셋 삭제 후에도 로그 보존)
  deal_id          uuid,                            -- optional, if from /travel-deals hub
  clicked_at       timestamptz DEFAULT now(),
  referrer         text,
  user_agent_hash  text,                            -- SHA-256 truncated (no raw UA stored)
  country_code     text,                            -- from CF request
  source           text DEFAULT 'web'               -- 'web', 'rss', etc.
);

CREATE INDEX IF NOT EXISTS idx_affiliate_click_logs_preset ON affiliate_click_logs(preset_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_click_logs_slug ON affiliate_click_logs(post_slug);
CREATE INDEX IF NOT EXISTS idx_affiliate_click_logs_clicked ON affiliate_click_logs(clicked_at DESC);

ALTER TABLE affiliate_click_logs ENABLE ROW LEVEL SECURITY;

-- Anon may INSERT only (client-side beacon or server proxy)
-- SELECT/UPDATE/DELETE restricted to authenticated (admin dashboards)
CREATE POLICY "Allow anon insert on affiliate_click_logs"
  ON affiliate_click_logs FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow authenticated read on affiliate_click_logs"
  ON affiliate_click_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated manage on affiliate_click_logs"
  ON affiliate_click_logs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
