# TRAVEL_DEAL_WORKFLOW

## Purpose
Travel Deal 콘텐츠의 수집 → 초안 → 검수 → 발행 → 회고 흐름을 정의한다.

## Current State
Gondola MCP + Supabase + 수동 검수 하이브리드 파이프라인.

## Pipeline Overview
```
[Gondola MCP]
     │
     ↓  (Claude에서 MCP 호출, JSON 배열 출력)
[collect-gondola-deals.js]
     │  · 유효성 필터 (가격 범위, URL 형식)
     │  · 중복 제거 (city + hotel + check_in + nights)
     │  · hotel_deals upsert + deal_snapshots insert
     ↓
[hotel_deals 테이블]
     │
     ↓  (주기적/요청 시)
[generate-travel-deal-drafts.js]
     │  · posts.status='draft' 생성
     │  · source_deal_id로 중복 방지
     ↓
[admin 검수]
     │  · 본문 보강 (context, preset_id 교체)
     │  · SEO title / excerpt 다듬기
     ↓
[published]
     │
     ↓
[GA 이벤트 + affiliate_click_logs]
```

## Workflow Steps

### 1. Deal 수집
**주기**: 주 1-2회 또는 필요 시

**방법 A — Claude에서 Gondola MCP 호출 + 파이프**
```bash
# 출력 JSON을 수집 스크립트로 파이프
cat gondola-output.json | node scripts/collect-gondola-deals.js
```

**방법 B — 드라이런 검증**
```bash
node scripts/collect-gondola-deals.js --input gondola-output.json --dry-run
```

**입력 JSON 스키마**:
```json
[
  {
    "city": "seoul",
    "hotel_name": "Grand Hyatt Seoul",
    "check_in": "2026-05-15",
    "nights": 3,
    "cash_price": 280.00,
    "points_price": 40000,
    "provider": "hyatt",
    "deeplink": "https://...",
    "preset_id": "hyatt-seoul",
    "featured": false
  }
]
```

### 2. 초안 생성
```bash
# 최신 active 딜 10건에 대해 draft 생성
node scripts/generate-travel-deal-drafts.js --limit 10

# 드라이런
node scripts/generate-travel-deal-drafts.js --limit 5 --dry-run
```

### 3. 검수 (admin)
- [admin/](../admin/) → Posts → status=draft 탭
- 각 draft 열기 → 다음 확인:
  - [ ] `[affiliate preset="..."]` 슬롯이 실제 등록된 preset ID로 대체되었는가
  - [ ] "Why this deal stands out" 섹션에 컨텍스트 추가
  - [ ] SEO title이 자연스럽고 60자 이내
  - [ ] excerpt가 160자 이내
  - [ ] 카테고리가 Travel

### 4. 발행
- 검수 완료 후 status → published
- 자동으로 `/blog/{slug}` 및 sitemap에 반영

### 5. 회고 (주간)
- GA4에서 `affiliate_outbound_click` 이벤트 집계
- 상위 CTR 딜 / 하위 CTR 딜 비교
- preset 구성, CTA 위치, 제목 패턴 중 개선 포인트 도출

## KPIs
- 주간 자동 초안 생성: ≥ 5
- 검수-발행 리드타임: 딜 1건당 ≤ 15분
- 발행 후 CTR (Phase 1 KPI): ≥ 3%

## Quality Guards
1. 어필리에이트 Disclosure 미포함 시 발행 금지 (템플릿에 기본 포함)
2. preset_id가 `REPLACE_WITH_PRESET_ID` 상태로 남아있으면 렌더 시 위젯 비어짐 → 검수 단계에서 반드시 교체
3. `source_deal_id` unique index로 같은 딜에 중복 초안 생성 차단
4. 가격 0 또는 비정상 범위 자동 필터

## Related Docs
- [GONDOLA_MONETIZATION_PLAN.md](GONDOLA_MONETIZATION_PLAN.md)
- [DB.md](DB.md)
- [API.md](API.md)
- [ROADMAP.md](ROADMAP.md)
