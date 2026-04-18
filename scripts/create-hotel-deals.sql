-- ============================================================
-- Korea Decode: hotel_deals table
-- Gondola 기반 호텔 딜 원본 데이터
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS hotel_deals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city          text NOT NULL,                     -- 'seoul', 'busan', 'jeju', 'tokyo' ...
  hotel_name    text NOT NULL,
  check_in      date,
  nights        integer DEFAULT 1,
  cash_price    numeric(12, 2),                    -- USD
  points_price  integer,                           -- loyalty program points
  cpp           numeric(6, 3),                     -- Cents Per Point (value metric)
  provider      text DEFAULT 'custom',             -- 'klook', 'booking', 'marriott', 'hilton', 'custom'
  deeplink      text,                              -- affiliate URL
  preset_id     text REFERENCES affiliate_presets(id) ON DELETE SET NULL,
  status        text DEFAULT 'active',             -- 'active' | 'archived'
  featured      boolean DEFAULT false,
  source        text DEFAULT 'gondola',            -- 'gondola', 'manual', etc.
  meta          jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Useful indexes for common filters
CREATE INDEX IF NOT EXISTS idx_hotel_deals_city ON hotel_deals(city);
CREATE INDEX IF NOT EXISTS idx_hotel_deals_status ON hotel_deals(status);
CREATE INDEX IF NOT EXISTS idx_hotel_deals_check_in ON hotel_deals(check_in);
CREATE INDEX IF NOT EXISTS idx_hotel_deals_featured ON hotel_deals(featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_hotel_deals_points ON hotel_deals(points_price) WHERE points_price IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE hotel_deals ENABLE ROW LEVEL SECURITY;

-- Public read for active deals (hub page / API)
CREATE POLICY "Allow public read on hotel_deals"
  ON hotel_deals FOR SELECT
  USING (true);

-- Admin (anon key from admin panel) and authenticated can write
CREATE POLICY "Allow anon insert on hotel_deals"
  ON hotel_deals FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon update on hotel_deals"
  ON hotel_deals FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon delete on hotel_deals"
  ON hotel_deals FOR DELETE
  TO anon
  USING (true);

CREATE POLICY "Allow authenticated all on hotel_deals"
  ON hotel_deals FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
