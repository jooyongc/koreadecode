# DB

## Purpose
Supabase PostgreSQL 데이터베이스 스키마 및 보안 정책을 정의한다.

## Current State
Supabase 프로젝트 `agkkvtfwqmzgbrqhvohs`에서 운영 중. RLS 활성화.

## Tables

### `posts`
블로그 포스트 콘텐츠 저장. WordPress에서 마이그레이션된 데이터 포함.
- 카테고리: K-Food, K-Beauty, Travel, K-Pop, Culture

### `ai_config`
AI Decode 기능 설정값 저장.
- 모델 선택, 프롬프트 템플릿, 기능 on/off

### `ai_decode_logs`
AI 질문/응답 로그 기록.

### `ai_rate_limits`
사용자별 AI 요청 횟수 제한.
- IP 기반 rate limiting

## Current Rules
- 모든 테이블에 **RLS (Row Level Security)** 활성화
- 프론트엔드는 `anon` 역할로 접근 — 읽기만 허용
- 쓰기 작업은 Cloudflare Workers (service role 또는 API 경유)에서만 수행
- 스키마 변경은 `supabase-setup.sql` 및 `scripts/` 디렉토리의 SQL 파일로 관리

## Schema Reference
- 전체 스키마: `/supabase-setup.sql`
- 마이그레이션 스크립트: `/scripts/backfill-slugs.sql`, `/scripts/create-affiliate-presets.sql`

## Related Docs
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [AI_SYSTEMS.md](AI_SYSTEMS.md)
