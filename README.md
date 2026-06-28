# 미국 섹터 ETF 이격도 트래커

GICS 11개 섹터를 대표하는 **SPDR 섹터 ETF의 50일 이격도**를 매일 자동으로 계산해, 어느 섹터가 과열·정상·과열 해소 구간에 있는지 한눈에 보여주는 정적 웹서비스입니다. 이은택의 그림전략(이그전) 50일 이격도 해석법을 기준틀로 삼습니다.

> 코스피 단일 지수 트래커([andy-0401.github.io/kospi-ma-disparity](https://andy-0401.github.io/kospi-ma-disparity/))의 패턴을 미국 섹터 ETF 11개로 확장한 프로젝트입니다.

## 이격도란?

```
이격도(%) = 당일 종가 ÷ 50일 이동평균 × 100
```

가격이 50일 평균선 대비 얼마나 위/아래에 있는지를 나타내는 비율 지표입니다. ETF 가격은 달러 기준이지만 이격도는 비율이라 환율과 무관합니다.

| 구간 | 이격도 | 행동 가이드 |
|---|---|---|
| 🔴 과열 | ≥ 130 | 추격매수(패닉 바잉) 자제 |
| 🟠 경계 | 120 – 130 | 분할·속도 조절 관심 |
| 🟢 정상 | 105 – 120 | 추세 추종 유효 |
| 🔵 과열 해소 | ≤ 105 | 투매 자제, 조정 끝난 섹터부터 매수 |

## 추적 대상 (11개 SPDR 섹터 ETF)

`XLK` 정보기술 · `XLC` 커뮤니케이션 서비스 · `XLY` 임의소비재 · `XLP` 필수소비재 · `XLI` 산업재 · `XLB` 소재 · `XLE` 에너지 · `XLF` 금융 · `XLV` 헬스케어 · `XLU` 유틸리티 · `XLRE` 부동산

## 구조

```
us-sector-disparity/
├── .github/workflows/update.yml   # 매 거래일 자동 갱신 (cron)
├── scripts/update_data.py         # yfinance 수집·계산·JSON 생성
├── data/
│   ├── summary.json               # 11개 섹터 현재 스냅샷 (메인 순위표)
│   └── XLK.json … XLRE.json        # 섹터별 시계열 (상세 차트)
├── assets/app.js, style.css       # 렌더 로직·스타일
├── index.html                     # 메인: 순위표 / 히트맵
├── sector.html                    # 상세: 개별 섹터 차트·게이지
└── requirements.txt
```

프론트엔드와 데이터는 분리되어 있습니다. 프론트는 항상 같은 모양의 JSON을 읽으므로, 향후 동적 백엔드(FastAPI·서버리스)를 붙일 때 데이터 출처만 정적 JSON → API로 바꾸면 화면 코드는 그대로 재사용됩니다.

## 자동화

GitHub Actions가 **평일 22:00 UTC(=한국시간 07:00)** 에 `update_data.py`를 실행해 데이터를 갱신하고 `data/`에 커밋합니다. 미국 증시 마감(동부 16:00) 후 일봉이 안정적으로 잡힌 뒤 실행됩니다. 수동 실행(`workflow_dispatch`)도 가능합니다.

## 로컬 실행

```bash
pip install -r requirements.txt
python scripts/update_data.py      # data/*.json 생성
python -m http.server 8000         # http://localhost:8000 접속
```

## 배포 (GitHub Pages)

1. 이 저장소를 GitHub에 푸시합니다.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, 브랜치 `main` / 루트(`/`) 선택.
3. 잠시 후 `https://<사용자명>.github.io/us-sector-disparity/` 에서 공개됩니다.
4. **Actions** 탭에서 워크플로를 한 번 수동 실행(Run workflow)해 최신 데이터를 커밋합니다.

## 한계 / 주의사항

- 본 서비스는 **정보 제공용이며 투자 권유가 아닙니다.** 투자 판단의 책임은 이용자 본인에게 있습니다.
- 105/120/130 임계값은 코스피 기준으로 만들어진 값이라, 섹터별 변동성 차이(기술주는 자주 과열권, 유틸리티는 거의 도달 안 함)로 섹터 간 절대 비교에는 한계가 있습니다. 추후 섹터별 상대 기준(백분위·z점수) 보정은 검토 여지로 남깁니다.
- 데이터는 무료 공개 소스(yfinance/Yahoo)에 의존하므로 지연·결측·일시적 접근 차단이 발생할 수 있습니다.
