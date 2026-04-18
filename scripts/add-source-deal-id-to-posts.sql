-- ============================================================
-- Korea Decode: posts 테이블에 source_deal_id 컬럼 추가
-- 자동 생성된 Travel Deal 초안의 원본 hotel_deals 레코드 추적
-- Run after create-hotel-deals.sql
-- ============================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS source_deal_id uuid REFERENCES hotel_deals(id) ON DELETE SET NULL;

-- Unique partial index — 같은 딜로 중복 초안 생성 방지
-- (NULL은 허용 — 기존 수동 포스트는 모두 NULL이므로 충돌 없음)
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_source_deal_id_unique
  ON posts(source_deal_id)
  WHERE source_deal_id IS NOT NULL;
