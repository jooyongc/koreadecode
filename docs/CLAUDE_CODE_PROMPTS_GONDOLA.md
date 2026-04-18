# CLAUDE_CODE_PROMPTS_GONDOLA

## Purpose
Gondola MCP 기반 Travel 수익화 기능을 Korea Decode 코드베이스에 구현할 때, Claude Code에 바로 사용할 수 있는 실행 프롬프트 모음.

## Usage Rule
1. 한 번에 하나의 프롬프트만 실행
2. 실행 후 반드시 테스트/검증 결과를 커밋 메시지 초안과 함께 출력
3. 프롬프트는 필요에 따라 `파일 경로`, `테이블명`, `엔드포인트명`만 바꿔 재사용

---

## Prompt 1 — Phase 1 MVP 구현
```text
You are working in the Korea Decode repository.

Goal:
Implement Phase 1 MVP for Travel Deal monetization using existing affiliate shortcode flow.

Requirements:
1) Add a reusable "Travel Deal post template insert" action in admin editor UI.
2) Keep current shortcode format: [affiliate preset="preset-id"].
3) Ensure rendered post page still resolves shortcode server-side in functions/blog/[slug].js.
4) Add standard affiliate disclosure section snippet to the template.
5) Do not introduce frameworks. Use existing vanilla JS style.

Files to inspect first:
- /admin/index.html
- /admin/admin.js
- /functions/blog/[slug].js

Output format:
1) Summary of changes
2) File-by-file diff explanation
3) Manual test checklist
4) Suggested commit message (Korean, feat: prefix)
```

## Prompt 2 — Supabase 스키마 추가
```text
You are working in the Korea Decode repository.

Goal:
Add SQL migration files for Travel Deal data model.

Create:
1) /scripts/create-hotel-deals.sql
2) /scripts/create-deal-snapshots.sql
3) /scripts/create-affiliate-click-logs.sql

Schema requirements:
- Include primary keys, created_at/updated_at defaults.
- Enable RLS on all new tables.
- Add policies aligned with current project style:
  - public read where needed for published deal data
  - write/update via authenticated/service paths
- Add useful indexes for city/date/filter queries.

Also update docs:
- /docs/DB.md
- /docs/QUICK_REF.md (new tables section)

Output format:
1) SQL design rationale
2) Created files and exact table/policy names
3) Query examples for validation
4) Suggested commit message (feat:)
```

## Prompt 3 — `/api/travel-deals` 엔드포인트 구현
```text
You are working in the Korea Decode repository.

Goal:
Implement GET /api/travel-deals on Cloudflare Functions with Supabase REST backend.

Requirements:
1) Create /functions/api/travel-deals.js
2) Query params:
   - city
   - checkin
   - nights
   - points_only (boolean)
   - page, limit
3) Response JSON:
   {
     deals: [],
     total: number,
     page: number,
     totalPages: number
   }
4) Follow existing CORS and error-handling style from /functions/api/posts.js.
5) Add cache headers suitable for deal list endpoint.

Also update docs:
- /docs/API.md
- /docs/QUICK_REF.md

Output format:
1) Endpoint behavior summary
2) Validation examples (curl)
3) Failure cases handled
4) Suggested commit message (feat:)
```

## Prompt 4 — Travel Deals 허브 페이지 구현
```text
You are working in the Korea Decode repository.

Goal:
Create a mobile-first Travel Deals hub page that fits existing dark theme.

Requirements:
1) Add /travel-deals/index.html
2) Add JS module at /assets/js/travel-deals.js
3) Add CSS at /assets/css/pages/travel-deals.css
4) Render cards from /api/travel-deals
5) Provide filters for city and points_only
6) Include clear affiliate disclosure text
7) Keep typography/color consistent with existing brand tokens

Do not use frameworks.
Reuse existing component patterns where possible.

Output format:
1) UX structure summary
2) API integration summary
3) Responsive behavior notes
4) Suggested commit message (feat:)
```

## Prompt 5 — 클릭 추적 및 분석 이벤트
```text
You are working in the Korea Decode repository.

Goal:
Track outbound affiliate interactions for Travel Deal content.

Requirements:
1) Define GA events:
   - deal_cta_click
   - affiliate_outbound_click
   - deal_filter_change
2) Instrument events in:
   - Travel Deals page
   - Blog post affiliate CTA block (if applicable)
3) Add server-side click logging endpoint only if needed for attribution.
4) Keep PII out of analytics payloads.

Update docs:
- /docs/API.md (if endpoint added)
- /docs/ARCHITECTURE.md (event flow)

Output format:
1) Event taxonomy table
2) Tracking points by file
3) QA checklist
4) Suggested commit message (feat:/chore:)
```

## Prompt 6 — 주간 자동 초안 파이프라인
```text
You are working in the Korea Decode repository.

Goal:
Create a script pipeline that converts Travel deal data into draft posts for editorial review.

Requirements:
1) Add /scripts/generate-travel-deal-drafts.js
2) Input: latest deal records from Supabase
3) Output: draft posts in posts table (status=draft) with:
   - SEO title
   - excerpt
   - body with affiliate shortcode slots
4) Include guardrails:
   - dedupe similar drafts
   - skip low-quality/insufficient data
   - log generation result
5) No direct secret exposure in code.

Also add:
- /docs/ROADMAP.md update for completed/next tasks

Output format:
1) Pipeline stages
2) Idempotency/dedupe strategy
3) Dry-run instructions
4) Suggested commit message (feat:)
```

## Prompt 7 — QA/릴리즈 준비
```text
You are working in the Korea Decode repository.

Goal:
Run pre-release verification for Travel Deal monetization features.

Checklist:
1) API contract test for /api/travel-deals
2) SSR shortcode rendering regression check on /blog/[slug]
3) Mobile UI checks for /travel-deals
4) Affiliate disclosure presence checks
5) Basic SEO checks (title/description/canonical)
6) No secret leakage in repo-tracked files

Output format:
1) Findings (severity ordered)
2) Pass/Fail table by checklist item
3) Required fixes
4) Release recommendation
```

---

## One-shot Master Prompt (옵션)
```text
You are working in the Korea Decode repository.
Implement the Gondola-based Travel monetization roadmap in iterative commits:
Phase1 MVP -> Phase2 schema/API -> Phase3 travel hub -> Phase4 tracking.

Rules:
- No frameworks; vanilla JS only.
- Keep dark theme and existing design system.
- Respect current Cloudflare Functions + Supabase architecture.
- Never expose secrets in frontend or tracked config.
- For each phase, provide:
  1) changed files
  2) test steps
  3) risk notes
  4) commit message proposal

Start with Phase 1 only. Wait for confirmation before Phase 2.
```

## Related Docs
- [GONDOLA_MONETIZATION_PLAN.md](GONDOLA_MONETIZATION_PLAN.md)
- [ROADMAP.md](ROADMAP.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
