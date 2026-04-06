# ARCHITECTURE

## Purpose
Korea Decode의 시스템 아키텍처와 데이터 흐름을 설명한다.

## Current State
프레임워크 없는 정적 사이트 + Cloudflare Workers 서버리스 백엔드 + Supabase DB 구조.

## System Overview
```
[Browser] ──→ [Cloudflare Pages (Static)]
                    │
                    ├── /assets/js/*.js (Frontend Modules)
                    ├── /index.html, /blog/, /decode/, etc.
                    │
                    └── /functions/ (Cloudflare Workers)
                            │
                            ├── _middleware.js (CORS, Auth)
                            ├── api/posts.js ──→ [Supabase PostgreSQL]
                            ├── api/decode.js ──→ [Gemini API] / [Workers AI]
                            ├── image-proxy.js ──→ [Unsplash/Pexels]
                            └── ga-proxy.js ──→ [Google Analytics]
```

## Frontend Architecture
- **SPA-like routing**: 각 섹션(/blog, /decode, /about 등)은 독립 HTML + JS
- **Module System**: ES Modules로 기능 분리
  - `components.js` — Header, Footer, Navigation 공통 컴포넌트
  - `home.js` — 홈페이지 로직 (Hero, Magazine Grid)
  - `blog-list.js` — 블로그 목록, 필터링, 검색
  - `decode.js` — AI 문화 해석 UI
  - `analytics.js` — GA 이벤트 추적
  - `supabase-config.js` — Supabase 클라이언트 초기화

## Backend Architecture (Cloudflare Workers)
- **Middleware**: 모든 요청에 CORS 헤더 적용, 인증 처리
- **API Endpoints**: RESTful JSON API
- **AI Proxy**: Gemini API 호출을 Workers에서 중계 (API 키 보호)
- **Image Proxy**: 외부 이미지 최적화 및 캐싱
- **GA Proxy**: 서버사이드 Analytics 추적

## Data Flow
1. **포스트 조회**: Browser → `/api/posts` → Supabase → JSON Response
2. **AI Decode**: Browser → `/api/decode` → Gemini API (fallback: Workers AI) → JSON Response
3. **이미지**: Browser → `/functions/image-proxy` → Unsplash/Pexels → Optimized Image

## Current Rules
- 모든 API 키는 Cloudflare Workers 환경에서만 접근 (프론트엔드 노출 금지)
- Supabase는 anon key + RLS로 프론트엔드 직접 접근 허용
- AI 요청은 rate limiting 적용 (Supabase `ai_rate_limits` 테이블)

## Related Docs
- [DB.md](DB.md) — 데이터베이스 스키마
- [AI_SYSTEMS.md](AI_SYSTEMS.md) — AI 기능 상세
- [API.md](API.md) — 외부 API 목록
