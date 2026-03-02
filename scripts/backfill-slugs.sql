-- Korea Decode: Backfill slugs for existing posts
-- Run this in Supabase SQL Editor

-- 1. Add slug column if it doesn't exist
ALTER TABLE posts ADD COLUMN IF NOT EXISTS slug TEXT;

-- 2. Create unique index on slug (allows NULL for now)
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug) WHERE slug IS NOT NULL;

-- 3. Generate slugs from titles for posts without slugs
UPDATE posts
SET slug = lower(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          title,
          '[^a-zA-Z0-9\s-]', '', 'g'  -- Remove non-alphanumeric (except spaces and hyphens)
        ),
        '\s+', '-', 'g'               -- Replace spaces with hyphens
      ),
      '-+', '-', 'g'                  -- Collapse multiple hyphens
    ),
    '^-|-$', '', 'g'                  -- Trim leading/trailing hyphens
  )
)
WHERE slug IS NULL OR slug = '';

-- 4. Handle duplicate slugs by appending a number
WITH duplicates AS (
  SELECT id, slug, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at) as rn
  FROM posts
  WHERE slug IS NOT NULL
)
UPDATE posts
SET slug = posts.slug || '-' || (d.rn)::text
FROM duplicates d
WHERE posts.id = d.id AND d.rn > 1;

-- 5. Verify: list all posts with their slugs
SELECT id, title, slug, status, created_at
FROM posts
ORDER BY created_at DESC;
