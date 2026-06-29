#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
미국 섹터 ETF 50일 이격도 트래커 — 데이터 수집/계산 스크립트

GICS 11개 섹터 SPDR ETF의 일봉을 yfinance로 받아
50일 이동평균(SMA)과 이격도를 구하고, 고정 임계값으로 구간을 판정해
data/summary.json (메인 순위표용)과 data/{티커}.json (섹터별 시계열)을 생성한다.

이격도(%) = 당일 종가 / 50일 이동평균 * 100
구간 기준(이그전 코스피 기준값 고정 적용): >=130 과열 / 120-130 경계 / 105-120 정상 / <=105 과열해소
"""

import json
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

# ── 설정 (상수로 분리: 향후 한 곳만 바꾸면 됨) ──────────────────────────
MA_SHORT = 10           # 단기 이동평균 (상승장 판정용)
MA_MID = 20             # 중기 이동평균 (상승장 판정용)
MA_PERIOD = 50          # 이격도 기준 이동평균
MA_SLOPE_LOOKBACK = 5   # 이평선 '상승/하락' 판정 기준: 며칠 전 대비 기울기로 볼지(거래일)
HISTORY_PERIOD = "6y"   # 수집 범위. 5Y 차트 토글 + MA50 워밍업 여유를 위해 넉넉히 받는다
SERIES_KEEP_DAYS = 1300 # {티커}.json에 보관할 최근 거래일 수 (약 5년치, 차트 기간 토글용)

# 구간 임계값 (고정)
ZONE_COOLDOWN_MAX = 105   # <=105 : 과열 해소(cooldown)
ZONE_NORMAL_MAX = 120     # 105~120 : 정상(normal)
ZONE_WARNING_MAX = 130    # 120~130 : 경계(warning), >=130 : 과열(overheated)

KST = timezone(timedelta(hours=9))

# 추적 대상 11개 SPDR 섹터 ETF (설계서 2장)
SECTORS = [
    {"ticker": "XLK",  "name_ko": "정보기술",        "name_en": "Technology Select Sector SPDR ETF",            "theme": "AI·반도체·소프트웨어"},
    {"ticker": "XLC",  "name_ko": "커뮤니케이션 서비스", "name_en": "Communication Services Select Sector SPDR ETF", "theme": "광고·미디어·플랫폼"},
    {"ticker": "XLY",  "name_ko": "임의소비재",       "name_en": "Consumer Discretionary Select Sector SPDR ETF", "theme": "소비 사이클·자동차·이커머스"},
    {"ticker": "XLP",  "name_ko": "필수소비재",       "name_en": "Consumer Staples Select Sector SPDR ETF",       "theme": "경기 둔화 방어·마진"},
    {"ticker": "XLI",  "name_ko": "산업재",          "name_en": "Industrial Select Sector SPDR ETF",            "theme": "제조·인프라·방산·물류"},
    {"ticker": "XLB",  "name_ko": "소재",            "name_en": "Materials Select Sector SPDR ETF",             "theme": "원자재·화학·금속"},
    {"ticker": "XLE",  "name_ko": "에너지",          "name_en": "Energy Select Sector SPDR ETF",                "theme": "유가·정제마진·현금흐름"},
    {"ticker": "XLF",  "name_ko": "금융",            "name_en": "Financial Select Sector SPDR ETF",             "theme": "금리·신용·자본시장"},
    {"ticker": "XLV",  "name_ko": "헬스케어",        "name_en": "Health Care Select Sector SPDR ETF",           "theme": "방어 성장·정책 리스크"},
    {"ticker": "XLU",  "name_ko": "유틸리티",        "name_en": "Utilities Select Sector SPDR ETF",             "theme": "전력수요·배당·금리"},
    {"ticker": "XLRE", "name_ko": "부동산",          "name_en": "Real Estate Select Sector SPDR ETF",           "theme": "금리·REITs·배당"},
]

# 상단에 표시할 미국 주요 지수 4종.
# yfinance 심볼은 '^'로 시작하지만 파일명/URL용 식별자(slug)는 '^'를 뺀 값을 쓴다.
INDICES = [
    {"ticker": "^GSPC", "slug": "GSPC", "name_ko": "S&P 500",   "name_en": "S&P 500 Index",                  "theme": "미국 대형주 500"},
    {"ticker": "^IXIC", "slug": "IXIC", "name_ko": "나스닥 종합", "name_en": "Nasdaq Composite Index",         "theme": "기술주 중심 종합지수"},
    {"ticker": "^DJI",  "slug": "DJI",  "name_ko": "다우존스",    "name_en": "Dow Jones Industrial Average",   "theme": "대형 우량주 30"},
    {"ticker": "^RUT",  "slug": "RUT",  "name_ko": "러셀 2000",   "name_en": "Russell 2000 Index",             "theme": "미국 소형주 2000"},
]

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def classify_zone(disparity: float) -> str:
    """이격도 값을 구간 코드로 변환한다."""
    if disparity >= ZONE_WARNING_MAX:
        return "overheated"
    if disparity >= ZONE_NORMAL_MAX:
        return "warning"
    if disparity >= ZONE_COOLDOWN_MAX:
        return "normal"
    return "cooldown"


def fetch_history(ticker: str, retries: int = 3) -> pd.DataFrame:
    """yfinance에서 일봉 종가를 받는다. 실패 시 재시도."""
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            df = yf.Ticker(ticker).history(period=HISTORY_PERIOD, interval="1d", auto_adjust=True)
            if df is not None and not df.empty and "Close" in df.columns:
                return df
            last_err = f"빈 데이터 (시도 {attempt})"
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        time.sleep(2 * attempt)
    raise RuntimeError(f"{ticker} 수집 실패: {last_err}")


def compute_series(df: pd.DataFrame) -> pd.DataFrame:
    """종가에서 MA10/20/50과 이격도를 계산한 시계열 DataFrame을 만든다."""
    out = pd.DataFrame(index=df.index)
    close = df["Close"]
    out["price"] = close.round(2)
    out["ma10"] = close.rolling(window=MA_SHORT, min_periods=MA_SHORT).mean().round(2)
    out["ma20"] = close.rolling(window=MA_MID, min_periods=MA_MID).mean().round(2)
    out["ma50"] = close.rolling(window=MA_PERIOD, min_periods=MA_PERIOD).mean().round(2)
    out["disparity"] = (close / out["ma50"] * 100).round(2)
    out = out.dropna(subset=["ma50", "disparity"])  # MA50 계산 전 구간 제거
    return out


def classify_market(series: pd.DataFrame, lookback: int = MA_SLOPE_LOOKBACK) -> dict:
    """최신 시점의 추세를 10·20일선으로 판정한다 (할투/쿨라매기 추세추종 슬라이드1 규칙).

    상승장 = 10일선 상승 & 20일선 상승 & 10일선 > 20일선
    하락장 = 10일선 하락 & 20일선 하락 & 10일선 < 20일선
    그 외   = 횡보장
    '상승/하락'은 lookback 거래일 전 대비 기울기로 본다.
    score(-100~100)는 게이지 바늘 위치용 추세 강도(갭+기울기 가중합).
    """
    if len(series) <= lookback:
        return None
    ma10, ma20 = series["ma10"], series["ma20"]
    n10, n20 = float(ma10.iloc[-1]), float(ma20.iloc[-1])
    p10, p20 = float(ma10.iloc[-1 - lookback]), float(ma20.iloc[-1 - lookback])
    up10, up20, cross = n10 > p10, n20 > p20, n10 > n20
    if up10 and up20 and cross:
        state, label = "bull", "상승장"
    elif (not up10) and (not up20) and (not cross):
        state, label = "bear", "하락장"
    else:
        state, label = "sideways", "횡보장"

    spread = (n10 - n20) / n20 * 100      # 10·20선 이격(%)
    s10 = (n10 / p10 - 1) * 100           # 10일선 기울기(%)
    s20 = (n20 / p20 - 1) * 100           # 20일선 기울기(%)

    def clamp(x, lo, hi):
        return max(lo, min(hi, x))

    score = (0.4 * clamp(spread / 2.0, -1, 1)
             + 0.3 * clamp(s10 / 3.0, -1, 1)
             + 0.3 * clamp(s20 / 2.0, -1, 1)) * 100
    return {
        "state": state,
        "label": label,
        "score": round(score, 1),
        "cross": cross,
        "up10": up10,
        "up20": up20,
        "spread_pct": round(spread, 2),
        "slope10_pct": round(s10, 2),
        "slope20_pct": round(s20, 2),
    }


def process_entry(meta: dict, kind: str) -> dict:
    """티커 하나(섹터 ETF 또는 지수)를 수집·계산하고 시계열 JSON을 쓴 뒤,
    summary 용 스냅샷 dict를 반환한다. 실패 시 예외를 올린다.

    kind: "sector" | "index" — 프론트에서 가격 단위($) 표기를 구분하는 데 쓴다.
    파일/URL 식별자는 slug(없으면 ticker). yfinance 조회는 ticker(지수는 '^...').
    """
    symbol = meta["ticker"]
    file_id = meta.get("slug", symbol)

    df = fetch_history(symbol)
    series = compute_series(df)
    if series.empty:
        raise RuntimeError("MA50 계산 가능한 데이터 부족")

    last = series.iloc[-1]
    as_of_date = series.index[-1].strftime("%Y-%m-%d")
    disparity = float(last["disparity"])
    market = classify_market(series)

    # 개별 시계열 JSON (최근 SERIES_KEEP_DAYS 일)
    tail = series.tail(SERIES_KEEP_DAYS)
    payload = {
        "ticker": file_id,
        "symbol": symbol,
        "kind": kind,
        "name_ko": meta["name_ko"],
        "name_en": meta["name_en"],
        "theme": meta["theme"],
        "ma_period": MA_PERIOD,
        "ma_periods": [MA_SHORT, MA_MID, MA_PERIOD],
        "slope_lookback": MA_SLOPE_LOOKBACK,
        "market": market,
        "series": [
            {
                "date": idx.strftime("%Y-%m-%d"),
                "price": float(row["price"]),
                "ma10": float(row["ma10"]),
                "ma20": float(row["ma20"]),
                "ma50": float(row["ma50"]),
                "disparity": float(row["disparity"]),
            }
            for idx, row in tail.iterrows()
        ],
    }
    (DATA_DIR / f"{file_id}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    mlabel = market["label"] if market else "-"
    print(f"  [OK] {symbol:6s} 이격도 {disparity:6.2f}%  ({classify_zone(disparity)})  추세 {mlabel}  as_of {as_of_date}")
    return {
        "ticker": file_id,
        "symbol": symbol,
        "kind": kind,
        "name_ko": meta["name_ko"],
        "name_en": meta["name_en"],
        "theme": meta["theme"],
        "price": float(last["price"]),
        "ma10": float(last["ma10"]),
        "ma20": float(last["ma20"]),
        "ma50": float(last["ma50"]),
        "disparity": disparity,
        "zone": classify_zone(disparity),
        "market": market,
        "as_of_date": as_of_date,
    }


def build():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(KST)
    summary_sectors = []
    summary_indices = []
    errors = []

    print("지수 수집…")
    for meta in INDICES:
        try:
            summary_indices.append(process_entry(meta, "index"))
        except Exception as e:  # noqa: BLE001
            errors.append(meta["ticker"])
            print(f"  [FAIL] {meta['ticker']}: {e}", file=sys.stderr)

    print("섹터 수집…")
    for meta in SECTORS:
        try:
            summary_sectors.append(process_entry(meta, "sector"))
        except Exception as e:  # noqa: BLE001
            errors.append(meta["ticker"])
            print(f"  [FAIL] {meta['ticker']}: {e}", file=sys.stderr)

    if not summary_sectors:
        print("수집된 섹터가 하나도 없습니다. 중단.", file=sys.stderr)
        sys.exit(1)

    # 섹터: 이격도 내림차순 정렬 후 rank 부여 (과열 섹터가 위로)
    summary_sectors.sort(key=lambda s: s["disparity"], reverse=True)
    for i, s in enumerate(summary_sectors, start=1):
        s["rank"] = i
    # 지수: 정의한 순서(S&P→나스닥→다우→러셀) 유지

    all_dates = [s["as_of_date"] for s in summary_sectors] + [s["as_of_date"] for s in summary_indices]
    as_of = max(all_dates)
    summary = {
        "updated_at": now.isoformat(timespec="seconds"),
        "as_of_date": as_of,
        "ma_period": MA_PERIOD,
        "ma_periods": [MA_SHORT, MA_MID, MA_PERIOD],
        "slope_lookback": MA_SLOPE_LOOKBACK,
        "zones": {
            "cooldown_max": ZONE_COOLDOWN_MAX,
            "normal_max": ZONE_NORMAL_MAX,
            "warning_max": ZONE_WARNING_MAX,
        },
        "indices": summary_indices,
        "sectors": summary_sectors,
    }
    (DATA_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n완료: 지수 {len(summary_indices)}/{len(INDICES)} · 섹터 {len(summary_sectors)}/{len(SECTORS)} 생성, as_of {as_of}")
    if errors:
        print(f"실패 티커: {', '.join(errors)}", file=sys.stderr)
        # 일부 실패해도 partial 생성은 허용하되 비정상 종료 코드로 알림
        sys.exit(2)


if __name__ == "__main__":
    build()
