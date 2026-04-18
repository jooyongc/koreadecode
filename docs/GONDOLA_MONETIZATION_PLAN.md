# GONDOLA_MONETIZATION_PLAN

## Purpose
`koreadecode.com` 내에서 Gondola MCP 기반 Travel 어필리에이트 수익화를 실행하기 위한 개발 계획서.

## Scope
- 모델: 콘텐츠 + 어필리에이트 (기존 3번 전략)
- 범위: Korea Decode 기존 스택(Static + Cloudflare Functions + Supabase + Admin) 내 구현
- 목표: 트래픽/클릭/예약 전환/자동화까지 단계적 고도화

## Product Goal
Korea Decode의 Travel 콘텐츠를 데이터 기반 "Hotel Deal 인사이트"로 확장해,
검색 유입과 예약 전환을 동시에 만드는 수익화 채널을 구축한다.

## North Star Metrics
- `Travel Deal Posts / month`
- `Affiliate CTR` (포스트 내 딜 CTA 클릭률)
- `Booking Conversion Rate` (클릭 대비 예약 전환율, 파트너 리포트 기준)
- `Revenue / month` (어필리에이트 커미션)

## Phase Plan (8주)

### Phase 1 (1-2주): MVP 런칭
#### Goal
최소 기능으로 "Travel Deal형 콘텐츠"를 빠르게 발행하고 전환 데이터를 수집한다.

#### Deliverables
1. Travel Deal 포스트 템플릿 (에디터용)
2. 딜 CTA 블록/디스클레이머 표준 문구
3. Travel 카테고리용 어필리에이트 프리셋 세트
4. 포스트 내 클릭 이벤트 로깅 기본값

#### Work Items
1. `admin`에 Travel 딜 템플릿 삽입 버튼 추가
2. `[affiliate preset="..."]` 숏코드 운영 가이드 반영
3. Travel 전용 preset 10종 등록 (서울/부산/제주 + 호텔 체인별)
4. 포스트 하단/본문 중간 CTA 위치 A/B 기본 패턴 정의

#### KPI Gate
- Travel 포스트 10개 이상 발행
- CTR 3% 이상

### Phase 2 (3-4주): 데이터 계층 구축
#### Goal
딜 데이터 저장/조회/재사용이 가능한 구조를 만든다.

#### Deliverables
1. `hotel_deals` 테이블
2. `deal_snapshots` 테이블 (가격/포인트 이력)
3. `affiliate_click_logs` 테이블
4. `/api/travel-deals` API 엔드포인트

#### Suggested Schema (초안)
- `hotel_deals`: 도시, 호텔명, 체크인/박수, 현금가, 포인트가, CPP, 공급자, 딥링크, 상태
- `deal_snapshots`: deal_id, 수집시각, 가격/포인트 변경분
- `affiliate_click_logs`: post_slug, preset_id, clicked_at, referrer, user_agent_hash

#### KPI Gate
- 유효 딜 100건 이상 적재
- API p95 500ms 이하

### Phase 3 (5-6주): 자동 콘텐츠 파이프라인
#### Goal
Gondola 데이터 기반 포스트 초안을 주기적으로 생성해 편집 생산성을 높인다.

#### Deliverables
1. 데이터 수집 스크립트 (Gondola MCP 호출)
2. 초안 생성 스크립트 (Deal JSON → Article Draft)
3. Admin 검수/발행 워크플로우 문서

#### Workflow
1. 스케줄 실행
2. 도시별 딜 수집
3. 품질 필터(이상치/중복/유효 링크) 적용
4. AI 초안 생성
5. `draft`로 저장
6. 에디터 검수 후 발행

#### KPI Gate
- 주간 자동 초안 5개 이상
- 편집 리드타임 50% 단축

### Phase 4 (7-8주): 전환 최적화
#### Goal
딜 허브 페이지와 이벤트 분석으로 수익 지표를 개선한다.

#### Deliverables
1. `/travel-deals` 허브 페이지
2. 필터 UI (도시/예산/포인트 여부)
3. GA 이벤트 표준화 (`deal_cta_click`, `affiliate_outbound_click`)
4. CTA/배치 A/B 실험

#### KPI Gate
- CTR 5% 이상
- 예약 전환율 1.5% 이상

## Architecture Changes
1. **Frontend**
   - `travel-deals` 페이지 신설
   - 딜 카드 컴포넌트 + CTA 컴포넌트
2. **Backend (Cloudflare Functions)**
   - `/api/travel-deals` 추가
   - 클릭 로깅 endpoint 추가(필요 시)
3. **Database (Supabase)**
   - 딜/스냅샷/클릭 로그 테이블 + RLS
4. **Admin**
   - 딜 템플릿 생성 + 프리셋 관리 강화

## Compliance & Risk
1. 어필리에이트 고지 문구를 모든 딜 포스트에 포함
2. 자동 생성 글은 "검수 후 발행" 원칙 유지
3. API 키는 Cloudflare Secret만 사용 (코드/공개 설정 노출 금지)
4. 가격/포인트 정보는 "수집 시점" 명시

## Backlog (Execution Ready)
1. `feat: travel-deals schema sql` 작성
2. `feat: /api/travel-deals` 구현
3. `feat: admin travel-deal template action` 구현
4. `feat: travel-deals page` 구현
5. `chore: analytics events + dashboard query` 정리

## Definition of Done
1. Travel 딜 포스트 20개 이상 누적
2. 클릭/전환 측정 가능 상태(대시보드 확인 가능)
3. 자동 초안 생성이 주간 기준 안정 실행
4. 운영 문서(작성/검수/발행/회고) 완료

## Related Docs
- [ROADMAP.md](ROADMAP.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [API.md](API.md)
- [DB.md](DB.md)
