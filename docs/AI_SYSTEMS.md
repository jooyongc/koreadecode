# AI_SYSTEMS

## Purpose
"Decode This" AI 문화 해석 기능의 구조와 API 연동을 설명한다.

## Current State
Gemini API를 Primary로, Cloudflare Workers AI (Llama 3.3)를 Fallback으로 운영 중.

## Feature: Decode This
사용자가 한국 문화 관련 질문을 입력하면 AI가 문화적 맥락을 포함한 해석을 제공하는 기능.

### Flow
```
[User Input] → [Frontend decode.js]
                    │
                    ↓
            [POST /api/decode]
                    │
                    ├── Try: Gemini API (GEMINI_API_KEY)
                    │         ↓ (실패 시)
                    └── Fallback: Cloudflare Workers AI (Llama 3.3)
                                  ↓
                          [JSON Response] → [Frontend Render]
```

### Rate Limiting
- Supabase `ai_rate_limits` 테이블로 IP 기반 제한
- Cloudflare Workers 미들웨어에서 체크

### Configuration
- `ai_config` 테이블에서 모델/프롬프트 설정 관리
- Gemini API 키: Cloudflare Dashboard Secret

## Current Rules
- AI 프록시는 반드시 Cloudflare Workers를 경유 (API 키 프론트엔드 노출 금지)
- 모든 AI 요청/응답은 `ai_decode_logs`에 기록
- Rate limit 초과 시 사용자에게 안내 메시지 표시

## Related Docs
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DB.md](DB.md)
- [API.md](API.md)
