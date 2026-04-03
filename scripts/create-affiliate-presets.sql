-- ============================================================
-- Korea Decode: affiliate_presets table
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

CREATE TABLE IF NOT EXISTS affiliate_presets (
  id            text PRIMARY KEY,                     -- slug like 'klook-seoul-tour'
  label         text NOT NULL,                        -- 'Klook Seoul Tours'
  provider      text DEFAULT 'custom',                -- 'klook', 'coupang', 'amazon', 'custom'
  category      text,                                 -- 'travel', 'beauty', 'food', 'kpop', 'culture'
  code          text NOT NULL,                        -- actual HTML/script code
  is_active     boolean DEFAULT true,
  click_count   integer DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE affiliate_presets ENABLE ROW LEVEL SECURITY;

-- Allow public read (anon key can fetch presets for SSR rendering)
CREATE POLICY "Allow public read on affiliate_presets"
  ON affiliate_presets FOR SELECT
  USING (true);

-- Allow authenticated users to manage presets (admin)
CREATE POLICY "Allow authenticated insert on affiliate_presets"
  ON affiliate_presets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update on affiliate_presets"
  ON affiliate_presets FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete on affiliate_presets"
  ON affiliate_presets FOR DELETE
  TO authenticated
  USING (true);

-- Also allow anon key insert/update/delete for admin panel (uses anon key)
CREATE POLICY "Allow anon insert on affiliate_presets"
  ON affiliate_presets FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anon update on affiliate_presets"
  ON affiliate_presets FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon delete on affiliate_presets"
  ON affiliate_presets FOR DELETE
  TO anon
  USING (true);
