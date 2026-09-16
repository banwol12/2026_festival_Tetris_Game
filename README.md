# 2026 Digitalarts Tetris

데스크탑·랩탑 브라우저에서 키보드로 즐기는 초고속 테트리스 웹 게임입니다. 조각이 나오자마자 바닥에 꽂히는 20G 방식이라, 락 딜레이(0.5초, 이동·회전 시 최대 15회 연장) 안에 밀고 돌려서 자리를 잡아야 합니다. 빌드 도구 없이 순수 HTML / CSS / JavaScript로 만들어져 있어 Vercel 등 정적 호스팅에 그대로 올릴 수 있습니다.

## 기능

- 표준 가이드라인 룰: 7-bag 랜덤, SRS 회전(월 킥), 고스트 피스, 홀드, NEXT 5개
- 점수: 싱글/더블/트리플/테트리스, T-스핀, 백투백, 콤보, 소프트/하드 드롭 보너스
- 즉시 낙하(20G): 레벨 선택 없이 Enter 한 번으로 바로 시작
- 점수 구간마다 레벨 상승(L2 1,000 / L3 3,000 / L4 6,000 / L5 10,000 …, 최대 20), 레벨이 오를수록 락 딜레이가 0.5초에서 40ms씩 줄어 최소 0.16초까지 → 점점 빨라짐
- 락 딜레이 + 무브 리셋(15회), DAS/ARR 키 반복으로 바닥에서 미끄러뜨리기
- NEXT는 다음 블록 하나만 표시, 시작·일시정지·게임오버는 전체 화면 오버레이
- 로컬 랭킹(TOP 10, 이름 등록), 최고 점수, 플레이 시간 표시 (`localStorage` 저장)
- Web Audio 합성 효과음 + BGM(코로베이니키), 효과음/BGM 개별 토글
- 전체화면 모드(F 키) — 행사장 키오스크·프로젝터용

## 조작

| 키 | 동작 |
| --- | --- |
| ← → | 이동 |
| Space | 즉시 고정(하드 드롭) |
| ↑ / X | 시계 방향 회전 |
| Z / Ctrl | 반시계 방향 회전 |
| C / Shift | 홀드 |
| P / Esc | 일시정지 |
| R | 다시 시작 |
| F | 전체화면 |
| M | 효과음 토글 |
| Enter | 시작 / 계속 |

## 로컬 실행

정적 파일이라 아무 웹 서버로 열면 됩니다.

```bash
python3 -m http.server 8766
```

브라우저에서 <http://localhost:8766> 접속.

## Vercel 배포

### 방법 1: GitHub 연동 (권장)

1. <https://vercel.com/new> 에서 `banwol12/2026_festival_Tetris_Game` 저장소 Import
2. Framework Preset은 **Other**, Build Command / Output Directory는 비워 두고 Deploy
3. 이후 `main` 브랜치에 푸시할 때마다 자동 배포

### 방법 2: Vercel CLI

```bash
npx vercel --prod --token <VERCEL_TOKEN>
```

## 구조

```
index.html        마크업 + 화면(시작/일시정지/게임오버)
css/style.css     테마, 데스크탑 3단 레이아웃, 이펙트 애니메이션
js/config.js      보드 크기, 테트로미노, SRS 킥 테이블, 점수표, INSTANT_GRAVITY 스위치
js/game.js        게임 로직(생성, 충돌, 회전, 락, 라인 클리어, 점수)
js/render.js      캔버스 렌더링(보드, 고스트, 홀드/넥스트 미리보기)
js/input.js       키보드 입력(DAS/ARR)
js/audio.js       Web Audio 효과음 + BGM 시퀀서
js/main.js        UI 연결, 랭킹, 전체화면, 메인 루프
```
