-- Korea Decode: Create site_settings table for homepage hero and content management
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS site_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read settings (needed for public homepage)
CREATE POLICY "Public can read site_settings"
  ON site_settings FOR SELECT
  USING (true);

-- Only authenticated users can update
CREATE POLICY "Authenticated users can update site_settings"
  ON site_settings FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert site_settings"
  ON site_settings FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Seed default hero settings
INSERT INTO site_settings (key, value) VALUES
('hero', '{
  "label": "Welcome to Korea Decode",
  "title_before": "Decoding",
  "title_highlight": "Korea",
  "title_after": ", One Story at a Time",
  "description": "Your English-language guide to Korean culture, food, beauty, travel, and trends. We break down the nuances of Korean life so you can experience it like a local.",
  "bg_image": "https://images.unsplash.com/photo-1617469767053-d3b523a0b982?auto=format&fit=crop&w=1920&q=80",
  "cta_primary_text": "Read Blog",
  "cta_primary_url": "/blog",
  "cta_secondary_text": "Try Decode This",
  "cta_secondary_url": "/decode"
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
