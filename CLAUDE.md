# Korea Decode — Claude Code Global Rules

## Project Identity
- **Korea Decode**: 한국 문화를 영어권 독자에게 전달하는 웹 콘텐츠 플랫폼
- K-Pop, K-Beauty, K-Food, Travel, Culture 카테고리 운영
- 프레임워크 없는 순수 HTML/CSS/JavaScript (ES Modules) 프로젝트

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3 (Custom Properties), Vanilla JS (ES Modules) |
| Backend | Cloudflare Workers (Functions) |
| Database | Supabase (PostgreSQL + RLS) |
| AI | Gemini API (primary), Cloudflare Workers AI / Llama 3.3 (fallback) |
| Hosting | Cloudflare Pages |
| Analytics | Google Analytics |
| Icons | Phosphor Icons |
| Fonts | Syncopate, Space Grotesk, Inter (Google Fonts) |

## Repository
- **GitHub**: https://github.com/jooyongc/koreadecode
- **Branch**: `main`
- **배포**: Cloudflare Pages (wrangler.toml 기반)

## File Structure Convention
```
/                     → Static pages (index.html, about/, blog/, decode/, etc.)
/assets/css/          → Modular CSS (global, layout, components, pages/)
/assets/js/           → Frontend JS modules
/functions/           → Cloudflare Workers serverless functions
/functions/api/       → REST API endpoints (decode, posts)
/scripts/             → Utility/migration scripts
/docs/                → Project documentation (active)
/docs/ref/            → Archived/reference documentation
```

## Coding Rules
1. **No frameworks** — 순수 JS만 사용. 라이브러리는 CDN + SRI 해시로 로드
2. **ES Modules** — import/export 패턴 사용
3. **Dark theme default** — 액센트 컬러 `#CCFF00`
4. **Mobile-first responsive** — CSS Grid/Flexbox 기반
5. **Supabase RLS** — 모든 테이블에 Row Level Security 적용
6. **환경변수** — API 키는 Cloudflare Dashboard에서 Secret으로 관리, wrangler.toml에 직접 노출하지 않음

## Commit Convention
- `feat:` 새 기능
- `fix:` 버그 수정
- `docs:` 문서 변경
- `refactor:` 리팩토링
- `chore:` 기타 작업
- 커밋 메시지는 한국어 허용

## Key External Services
- **Supabase Project**: `agkkvtfwqmzgbrqhvohs`
- **WordPress Legacy**: `koreadecode.mycafe24.com` (데이터 마이그레이션 원본)
- **도메인**: Cloudflare Pages를 통해 배포

## Documentation
- 문서 체계는 `docs/INDEX.md` 참조
- 현재 운영 규칙만 Active docs에 유지, 과거 기록은 `docs/ref/`로 이동
