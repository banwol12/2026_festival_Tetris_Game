# 2026 Digitalarts Tetris

데스크탑·랩탑 브라우저에서 키보드로 즐기는 테트리스 웹 게임입니다. 빌드 도구 없이 순수 HTML / CSS / JavaScript로 만들어져 있어 로컬 및 Vercel 등 정적 호스팅에 그대로 올릴 수 있으며, Cloudflare Worker + D1 Database를 통한 **실시간 온라인 랭킹 시스템**이 기본 연동되어 있습니다.

---

## 🎮 주요 기능

- **표준 가이드라인 룰**: 7-bag 랜덤, SRS 회전(월 킥), 고스트 피스, 홀드, NEXT 5개
- **점수 시스템**: 싱글/더블/트리플/테트리스, T-스핀, 백투백, 콤보, 소프트/하드 드롭 보너스
- **레벨 & 속도**: 레벨별 낙하 속도 상승(가이드라인 커브), 시작 레벨 1~10 선택 가능
- **조작감 최적화**: 락 딜레이 + 무브 리셋(15회), DAS/ARR 키 반복 최적화
- **실시간 온라인 랭킹 (Cloudflare D1)**:
  - 전 세계/행사장 플레이어의 실시간 점수 등록 및 TOP 10 랭킹 조회
  - 실시간 연동 상태 표시 (`ONLINE (D1)` / `LOCAL` 뱃지)
  - 네트워크 단절 시 게임 중단 없이 `localStorage` 기반 로컬 랭킹으로 자동 폴백
- **오디오**: Web Audio 합성 효과음 + BGM(코로베이니키), 효과음/BGM 개별 토글 지원
- **전체화면 모드 (F 키)**: 행사장 키오스크·프로젝터 디스플레이 지원

---

## ⌨️ 조작법

| 키 | 동작 |
| :--- | :--- |
| **← →** | 이동 (시작 화면에서는 레벨 선택) |
| **↓** | 소프트 드롭 |
| **Space** | 하드 드롭 |
| **↑ / X** | 시계 방향 회전 |
| **Z / Ctrl** | 반시계 방향 회전 |
| **C / Shift** | 홀드 |
| **P / Esc** | 일시정지 |
| **R** | 다시 시작 |
| **F** | 전체화면 |
| **M** | 효과음 토글 |
| **Enter** | 시작 / 계속 / 랭킹 등록 |

---

## 💻 로컬 실행

정적 파일 기반이므로 별도의 빌드 과정 없이 웹 서버로 바로 실행할 수 있습니다.

```bash
python3 -m http.server 8766
```

브라우저에서 <http://localhost:8766> 접속 시, 배포된 Cloudflare Worker와 자동 연동되어 바로 실시간 온라인 랭킹을 이용할 수 있습니다.

---

## ☁️ Cloudflare 연동 현황 (D1 & Worker)

본 프로젝트는 Cloudflare의 Serverless 백엔드 및 분산 SQLite 데이터베이스(D1)와 연동되어 있습니다.

### 연동 인프라 정보
- **Database**: Cloudflare D1 `digitalarts-tetris` (`86d8182b-aee4-4671-82c5-d751ec75a2ce`)
- **Worker 엔드포인트**: `https://digitalarts-tetris.hjahn0523.workers.dev/api/ranking`
- **테이블 상태**: `rankings` 테이블 및 인덱스(`idx_rankings_score`) 구성 완료
- **프론트엔드 설정**: [js/config.js](file:///Users/hyunjunahn/Desktop/DIA/js/config.js)의 `RANKING_API_URL`에 배포된 Worker 주소가 기본 설정되어 있어, 어떤 환경에서 접속하든 D1 온라인 랭킹이 즉시 작동합니다.

### Worker 재배포 및 D1 관리 명령어

```bash
# Cloudflare Worker 재배포
npx wrangler deploy

# 원격 D1 테이블 데이터 확인
npx wrangler d1 execute digitalarts-tetris --remote --command="SELECT * FROM rankings ORDER BY score DESC LIMIT 10;"

# 스키마 재적용이 필요한 경우
npx wrangler d1 execute digitalarts-tetris --remote --file=schema.sql
```

---

## 🚀 배포 가이드

### 1. Cloudflare Pages로 배포 시
1. Cloudflare 대시보드에서 GitHub 저장소(`banwol12/2026_festival_Tetris_Game`) 연결
2. Framework Preset: **None** (정적 디렉터리 배포)
3. **Settings > Functions > D1 Database Bindings**에서:
   - Variable Name: `DB`
   - D1 Database: `digitalarts-tetris`
   바인딩을 연결하면 `functions/api/ranking.js`가 활성화되어 풀스택 Pages로 구동됩니다.

### 2. Vercel 배포 시
1. <https://vercel.com/new> 에서 저장소 Import
2. Framework Preset: **Other**, Build/Output 설정은 비워두고 배포
3. 클라이언트가 기본적으로 Cloudflare Worker API를 직접 호출(CORS 허용)하므로 별도 서버 설정 없이 온라인 랭킹이 즉시 연동됩니다.

---

## 📁 프로젝트 구조

```
├── index.html                 # 메인 화면 및 마크업 (게임 보드, UI 패널, 모달)
├── css/
│   └── style.css              # 사이버펑크/네온 테마, 반응형 레이아웃, 이펙트
├── js/
│   ├── config.js              # 게임 상수, SRS 회전 킥 테이블, 점수 규칙, API URL
│   ├── game.js                # 테트리스 핵심 엔진 (7-bag, 충돌 검사, 회전, 라인 삭제)
│   ├── render.js              # Canvas 렌더러 (보드, 고스트, 홀드/넥스트 프리뷰)
│   ├── input.js               # 키보드 입력 및 DAS/ARR 처리
│   ├── audio.js               # Web Audio 합성 효과음 및 BGM 사운드 엔진
│   └── main.js                # UI 상호작용, 랭킹 비동기 동기화, 게임 루프
├── worker.js                  # Cloudflare Worker REST API (/api/ranking)
├── wrangler.toml              # Cloudflare Worker & D1 데이터베이스 바인딩 설정
├── schema.sql                 # D1 rankings 테이블 및 인덱스 DDL
├── functions/api/ranking.js   # Cloudflare Pages Functions 풀스택 API
├── .cursor/mcp.json           # Cursor IDE용 Cloudflare Remote MCP 설정
├── .vscode/mcp.json           # VSCode용 Cloudflare Remote MCP 설정
└── .agents/skills/            # Cloudflare 공식 Agent Skills (Wrangler, D1 등)
```
