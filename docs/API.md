# API

## Purpose
외부 API 연동 목록과 사용 방식을 정리한다.

## Current State
모든 외부 API 호출은 Cloudflare Workers를 통해 프록시된다.

## External APIs

| Service | Purpose | Auth | Proxy |
|---------|---------|------|-------|
| Supabase REST | DB CRUD | anon key (public) | Direct (frontend) |
| Gemini API | AI 문화 해석 (primary) | API Key (secret) | `/api/decode` |
| Cloudflare Workers AI | AI fallback (Llama 3.3) | AI Binding | `/api/decode` |
| Unsplash | 이미지 검색 | Access Key (secret) | `/functions/image-proxy.js` |
| Pexels | 이미지 검색 (보조) | API Key (secret) | `/functions/image-proxy.js` |
| Google Analytics | 사용자 추적 | Service Account (secret) | `/functions/ga-proxy.js` |

## Internal API Endpoints

### GET `/api/posts`
- **Query params**: `category`, `page`, `limit`, `search`, `slug`
- **Response**: `{ posts: [...], total: number }`

### POST `/api/decode`
- **Body**: `{ question: string }`
- **Response**: `{ answer: string, model: string }`
- **Rate limited**: IP 기반

## Current Rules
- Secret 키는 절대 프론트엔드에 노출하지 않음
- 모든 프록시 엔드포인트에 CORS 헤더 적용
- 이미지 프록시는 캐싱 적용

## Related Docs
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [AI_SYSTEMS.md](AI_SYSTEMS.md)
- [QUICK_REF.md](QUICK_REF.md)
