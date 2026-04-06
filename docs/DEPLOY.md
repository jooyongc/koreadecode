# DEPLOY

## Purpose
Cloudflare Pages 배포 절차를 정리한다.

## Current State
Cloudflare Pages에서 정적 파일 + Workers Functions로 배포 중.

## Deployment Flow
```
[Local Development]
        │
        ↓ git push origin main
[GitHub: jooyongc/koreadecode]
        │
        ↓ (Cloudflare Pages auto-deploy 또는 수동)
[Cloudflare Pages]
        ├── Static files (/, /blog, /about, etc.)
        └── Workers Functions (/functions/*)
```

## Commands
```bash
# 로컬 테스트 (Workers 포함)
npx wrangler pages dev .

# 수동 배포
npx wrangler pages deploy .

# Git을 통한 배포
git add <files>
git commit -m "feat: 설명"
git push origin main
```

## Configuration
- `wrangler.toml` — Cloudflare 설정 (AI binding, 환경변수)
- Secret 관리: Cloudflare Dashboard → Pages → Settings → Environment variables

## Current Rules
- `main` 브랜치 push 시 자동 배포 (Cloudflare Pages 연동 시)
- Secret은 wrangler.toml에 포함하지 않음
- 배포 전 로컬 `wrangler pages dev`로 테스트 권장

## Checklist
- [ ] 코드 변경 후 로컬 테스트
- [ ] git commit & push
- [ ] Cloudflare Pages 배포 확인
- [ ] 라이브 사이트에서 기능 확인

## Related Docs
- [QUICK_REF.md](QUICK_REF.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
