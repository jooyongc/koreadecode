# QUICK_REF

## Purpose
자주 참조하는 명령어, URL, 환경변수를 한눈에 확인하는 치트시트.

## Commands
```bash
# 로컬 개발 (Cloudflare Pages 로컬 서버)
npx wrangler pages dev .

# 배포
npx wrangler pages deploy .

# Git 워크플로우
git add <files>
git commit -m "feat: 설명"
git push origin main
```

## API Endpoints (Cloudflare Workers)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/posts` | GET | 포스트 목록 (pagination, filter, search) |
| `/api/decode` | POST | AI 문화 해석 요청 |
| `/functions/ai-proxy.js` | POST | AI 프록시 |
| `/functions/image-proxy.js` | GET | 이미지 최적화 프록시 |
| `/functions/ga-proxy.js` | POST | GA 추적 프록시 |

## Environment Variables (wrangler.toml)
| Variable | Type | Location |
|----------|------|----------|
| `SUPABASE_URL` | Public | wrangler.toml [vars] |
| `SUPABASE_ANON_KEY` | Public | wrangler.toml [vars] |
| `GEMINI_API_KEY` | Secret | Cloudflare Dashboard |
| `UNSPLASH_ACCESS_KEY` | Secret | Cloudflare Dashboard |
| `PEXELS_API_KEY` | Secret | Cloudflare Dashboard |
| `GA_SERVICE_ACCOUNT` | Secret | Cloudflare Dashboard |

## Key URLs
- GitHub: https://github.com/jooyongc/koreadecode
- Supabase Dashboard: https://supabase.com/dashboard/project/agkkvtfwqmzgbrqhvohs
- WordPress Legacy: https://koreadecode.mycafe24.com

## Related Docs
- [DEPLOY.md](DEPLOY.md)
- [API.md](API.md)
