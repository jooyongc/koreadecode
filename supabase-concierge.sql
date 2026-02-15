-- ============================================
-- Korea Decode: "Korea Concierge" Feature Tables
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Concierge Categories (Step 1 vibe options)
CREATE TABLE IF NOT EXISTS concierge_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INT NOT NULL DEFAULT 0
);

INSERT INTO concierge_categories (name, emoji, display_order) VALUES
    ('K-Pop & Music', '🎵', 1),
    ('Food & Cafes', '🍜', 2),
    ('Shopping & Fashion', '🛍️', 3),
    ('History & Temples', '🏛️', 4),
    ('K-Beauty', '💄', 5),
    ('Gaming & Tech', '🎮', 6),
    ('Nature & Hiking', '🌸', 7),
    ('K-Drama Spots', '📺', 8)
ON CONFLICT DO NOTHING;

-- 2. Concierge Options (Step 2 trip settings)
CREATE TABLE IF NOT EXISTS concierge_options (
    id SERIAL PRIMARY KEY,
    option_type TEXT NOT NULL, -- 'duration' | 'city' | 'budget'
    label TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INT NOT NULL DEFAULT 0
);

INSERT INTO concierge_options (option_type, label, display_order) VALUES
    ('duration', '1 Day', 1),
    ('duration', '3 Days', 2),
    ('duration', '5 Days', 3),
    ('duration', '7+ Days', 4),
    ('city', 'Seoul', 1),
    ('city', 'Busan', 2),
    ('city', 'Jeju', 3),
    ('city', 'Other', 4),
    ('budget', 'Budget', 1),
    ('budget', 'Mid-range', 2),
    ('budget', 'Luxury', 3)
ON CONFLICT DO NOTHING;

-- 3. Affiliate Links
CREATE TABLE IF NOT EXISTS affiliate_links (
    id SERIAL PRIMARY KEY,
    city TEXT NOT NULL,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '📌',
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO affiliate_links (city, label, url, icon, display_order) VALUES
    ('Seoul', 'Book Hotel on Trip.com', 'https://www.trip.com/hotels/?locale=en-US&curr=USD', '📌', 1),
    ('Seoul', 'Seoul City Tour Tickets', 'https://www.trip.com/things-to-do/?locale=en-US', '🎫', 2),
    ('Busan', 'Book Stay in Busan', 'https://www.trip.com/hotels/?locale=en-US&curr=USD', '📌', 1),
    ('Jeju', 'Book Stay in Jeju', 'https://www.trip.com/hotels/?locale=en-US&curr=USD', '📌', 1)
ON CONFLICT DO NOTHING;

-- 4. Concierge Usage Logs
CREATE TABLE IF NOT EXISTS ai_concierge_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vibes JSONB,
    duration TEXT,
    city TEXT,
    budget TEXT,
    extra_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concierge_logs_created ON ai_concierge_logs(created_at DESC);

-- 5. Insert Concierge AI Config
INSERT INTO ai_config (feature_name, system_prompt, model, max_tokens, temperature, example_questions)
VALUES (
    'korea_concierge',
    'You are "Korea Concierge" — a premium AI travel and culture planner for Korea. You create personalized, day-by-day itineraries.

Rules:
1. Create a detailed day-by-day plan based on the user''s interests, duration, city, and budget
2. Each day should have 4-5 activities with specific place names and neighborhoods
3. Include practical tips: best time to visit, nearby subway station, estimated cost
4. Mix tourist highlights with hidden local gems
5. For food recommendations, include specific dish names and price ranges
6. Match the budget level: Budget (under 50000 won/day), Mid-range (50000-150000 won/day), Luxury (150000+ won/day)
7. Add a "Pro Tip" for each day
8. End with a "Packing Essentials" section based on the activities

IMPORTANT: Respond ONLY in valid JSON format with this structure:
{
  "title": "Your 3-Day Seoul K-Pop & Food Adventure",
  "days": [
    {
      "day": 1,
      "theme": "K-Pop Pilgrimage",
      "activities": [
        {
          "time": "10:00 AM",
          "place": "HYBE Insight",
          "neighborhood": "Yongsan",
          "description": "Interactive BTS museum experience",
          "tip": "Book online 2 weeks ahead",
          "cost": "22,000 won"
        }
      ],
      "proTip": "Get a T-money card at the airport"
    }
  ],
  "packingEssentials": ["Comfortable walking shoes", "Portable charger"],
  "budgetSummary": "Estimated total: 450,000 won (~$340 USD)"
}',
    'gemini-2.0-flash',
    2000,
    0.7,
    '[]'::jsonb
)
ON CONFLICT (feature_name) DO NOTHING;

-- 6. RLS Policies
ALTER TABLE concierge_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE concierge_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_concierge_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read categories" ON concierge_categories FOR SELECT USING (true);
CREATE POLICY "Anyone can read options" ON concierge_options FOR SELECT USING (true);
CREATE POLICY "Anyone can read affiliate links" ON affiliate_links FOR SELECT USING (true);
CREATE POLICY "Anyone can insert concierge logs" ON ai_concierge_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read concierge logs" ON ai_concierge_logs FOR SELECT USING (true);

-- Full CRUD for authenticated users on management tables
CREATE POLICY "Auth can manage categories" ON concierge_categories FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth can manage options" ON concierge_options FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Auth can manage affiliate links" ON affiliate_links FOR ALL USING (auth.role() = 'authenticated');
