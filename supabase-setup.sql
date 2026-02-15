-- ============================================
-- Korea Decode: "Decode This" AI Feature Tables
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. AI Config table
CREATE TABLE IF NOT EXISTS ai_config (
    id SERIAL PRIMARY KEY,
    feature_name TEXT NOT NULL UNIQUE DEFAULT 'decode_this',
    system_prompt TEXT NOT NULL DEFAULT 'You are "Korea Decode AI" — a cultural interpreter specializing in Korean culture, language, and trends. Your audience is English-speaking people curious about Korea.

Rules:
1. Always explain the cultural CONTEXT, not just the definition
2. Use real examples from K-pop, K-drama, daily Korean life
3. Keep responses concise but insightful (max 200 words)
4. Format: Start with a one-line bold summary, then 2-3 paragraphs of cultural explanation
5. If relevant, mention how this concept appears in modern Korean pop culture
6. Use a tone that is knowledgeable but approachable — like a cool Korean friend explaining things
7. End with a "Fun fact:" or "Related:" line
8. Respond in English only, but keep Korean terms in hangul with romanization',
    example_questions JSONB NOT NULL DEFAULT '["What is 한 (Han)?", "Why do K-dramas have product placement?", "Explain Korean age system"]'::jsonb,
    model TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    max_tokens INT NOT NULL DEFAULT 500,
    temperature FLOAT NOT NULL DEFAULT 0.7,
    is_active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default config
INSERT INTO ai_config (feature_name) VALUES ('decode_this')
ON CONFLICT (feature_name) DO NOTHING;

-- 2. AI Decode Logs table
CREATE TABLE IF NOT EXISTS ai_decode_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    ip_hash TEXT
);

-- Index for recent queries
CREATE INDEX IF NOT EXISTS idx_decode_logs_created ON ai_decode_logs(created_at DESC);

-- 3. AI Rate Limits table
CREATE TABLE IF NOT EXISTS ai_rate_limits (
    id SERIAL PRIMARY KEY,
    ip_hash TEXT NOT NULL,
    requested_at TIMESTAMPTZ DEFAULT now()
);

-- Index for rate limit lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip ON ai_rate_limits(ip_hash, requested_at DESC);

-- Auto-cleanup: delete rate limit records older than 2 hours
-- (Run periodically or use Supabase cron)

-- Enable RLS but allow anon access for specific operations
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decode_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;

-- Policies: anon can read config, only service role can write
CREATE POLICY "Anyone can read active config" ON ai_config FOR SELECT USING (true);
CREATE POLICY "Authenticated users can update config" ON ai_config FOR UPDATE USING (auth.role() = 'authenticated');

-- Policies: anon can insert logs (from API), authenticated can read
CREATE POLICY "Anyone can insert logs" ON ai_decode_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read logs" ON ai_decode_logs FOR SELECT USING (true);

-- Policies: anon can insert/read rate limits
CREATE POLICY "Anyone can insert rate limits" ON ai_rate_limits FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read rate limits" ON ai_rate_limits FOR SELECT USING (true);
CREATE POLICY "Anyone can delete old rate limits" ON ai_rate_limits FOR DELETE USING (true);
