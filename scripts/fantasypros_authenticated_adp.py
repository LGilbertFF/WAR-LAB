#!/usr/bin/env python3
"""Local authenticated FantasyPros ADP sync.

This opens a real browser with a persistent local profile. Sign in manually when
prompted; the script then reads the rendered ADP tables and writes only cleaned
ADP rows to data/historical_adp.csv and data/war/historical_adp.json.gz.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PROFILE_DIR = ROOT / ".local" / "fantasypros-profile"
ADP_URLS = {
    "ppr": "https://www.fantasypros.com/nfl/adp/ppr-overall.php",
    "half": "https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php",
    "standard": "https://www.fantasypros.com/nfl/adp/overall.php",
}


def split_player_team(value: str) -> tuple[str, str]:
    text = str(value or "").strip()
    text = re.sub(r"\s*\(.*?\)", "", text).strip()
    parts = text.split()
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{2,3}", parts[-1]):
        return " ".join(parts[:-1]).strip(), parts[-1]
    if len(parts) >= 3 and re.fullmatch(r"[A-Z]{2,3}", parts[-2]) and re.fullmatch(r"[A-Z]", parts[-1]):
        return " ".join(parts[:-2]).strip(), parts[-2]
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]", parts[-1]):
        return " ".join(parts[:-1]).strip(), ""
    return text, ""


def clean_adp_player_name(value: str) -> str:
    text = str(value or "").strip()
    return re.sub(r"\s+[A-Z]\.\s+.+$", "", text).strip()


def add_query_params(url: str, **params: object) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({key: str(value) for key, value in params.items() if value is not None})
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def normalize_adp_table(df: pd.DataFrame, scoring: str, year: int) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    source_col = next(
        (col for col in df.columns if "player" in str(col).lower().replace(" ", "")),
        df.columns[1] if len(df.columns) > 1 else df.columns[0],
    )
    rank_col = next((col for col in df.columns if str(col).lower() == "rank"), None)
    avg_col = next((col for col in df.columns if str(col).lower() in {"avg", "adp"}), None)
    pos_col = next((col for col in df.columns if str(col).upper() == "POS"), None)
    if avg_col is None:
        return pd.DataFrame()
    extracted = df[source_col].apply(split_player_team)
    players = extracted.apply(lambda item: clean_adp_player_name(item[0]))
    out = pd.DataFrame(
        {
            "Year": year,
            "Scoring": scoring,
            "Player": players,
            "Team": extracted.apply(lambda item: item[1]),
            "ADP Rank": pd.to_numeric(df.get(rank_col), errors="coerce") if rank_col else None,
            "POS": df.get(pos_col, "") if pos_col else "",
            "ADP": pd.to_numeric(df.get(avg_col), errors="coerce"),
        }
    )
    out = out[out["Player"].astype(str).str.len().gt(0) & out["ADP"].notna()].copy()
    return out


async def rendered_tables(page) -> list[pd.DataFrame]:
    try:
        table_rows = await page.evaluate(
            """
            () => Array.from(document.querySelectorAll('table')).map((table) => ({
              headers: Array.from(table.querySelectorAll('thead th')).map((th) => th.innerText.trim()),
              rows: Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
                Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim())
              )
            }))
            """
        )
    except Exception:
        return []
    frames: list[pd.DataFrame] = []
    for table in table_rows:
        headers = table.get("headers") or []
        rows = [row[: len(headers)] for row in table.get("rows") or [] if row]
        header_text = " ".join(headers).lower()
        if headers and rows and "player" in header_text and ("avg" in header_text or "adp" in header_text):
            frames.append(pd.DataFrame(rows, columns=headers))
    return frames


async def scrape_year_scoring(page, year: int, scoring: str, login_wait_seconds: int, min_rows: int) -> pd.DataFrame:
    url = add_query_params(ADP_URLS[scoring], export="xls", year=year)
    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    try:
        await page.locator("table").first.wait_for(state="visible", timeout=8_000)
    except Exception:
        pass
    frames = [normalize_adp_table(frame, scoring, year) for frame in await rendered_tables(page)]
    frames = [frame for frame in frames if not frame.empty]
    if frames and len(frames[0]) >= min_rows:
        return frames[0]
    if login_wait_seconds > 0:
        print()
        visible_rows = len(frames[0]) if frames else 0
        print(f"Only {visible_rows:,} ADP rows were visible for {year} {scoring}.")
        print(f"If the browser is asking you to sign in, complete the login. Checking for up to {login_wait_seconds} seconds...")
        elapsed = 0
        while elapsed < login_wait_seconds:
            await page.wait_for_timeout(5_000)
            elapsed += 5
            frames = [normalize_adp_table(frame, scoring, year) for frame in await rendered_tables(page)]
            frames = [frame for frame in frames if not frame.empty]
            if frames and len(frames[0]) >= min_rows:
                return frames[0]
    return pd.DataFrame()


def save_adp(rows: list[pd.DataFrame], output: Path, append_existing: bool) -> pd.DataFrame:
    frames = []
    if append_existing and output.exists():
        frames.append(pd.read_csv(output, low_memory=False))
    frames.extend(row for row in rows if not row.empty)
    combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if combined.empty:
        return combined
    combined = combined.drop_duplicates(subset=["Year", "Scoring", "Player", "POS"], keep="last")
    combined = combined.sort_values(["Year", "Scoring", "ADP"], kind="stable")
    output.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(output, index=False, quoting=csv.QUOTE_MINIMAL)
    return combined


def export_browser_json() -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from export_war_data import MANIFEST_PATH, export_historical_adp

    manifest = {}
    if MANIFEST_PATH.exists():
        import json

        try:
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}
    export_historical_adp(manifest)
    manifest["version"] = 1
    manifest["updated_at"] = pd.Timestamp.utcnow().isoformat()
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    import json

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


async def async_main(args: argparse.Namespace) -> None:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise SystemExit(
            "Install Playwright first:\n"
            "  python -m pip install playwright\n"
            "  python -m playwright install chromium"
        ) from exc

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[pd.DataFrame] = []
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1440, "height": 950},
        )
        page = context.pages[0] if context.pages else await context.new_page()
        for year in range(args.start_year, args.end_year + 1):
            for scoring in args.scoring:
                frame = await scrape_year_scoring(page, year, scoring, args.login_wait_seconds, args.min_rows)
                if frame.empty:
                    print(f"skipped {year} {scoring}: no table found")
                    continue
                rows.append(frame)
                print(f"scraped {year} {scoring}: {len(frame):,} rows")
        await context.close()

    combined = save_adp(rows, args.output, args.append_existing)
    if combined.empty:
        raise SystemExit("No ADP rows were scraped.")
    print(f"wrote {len(combined):,} rows to {args.output}")
    if args.export_json:
        export_browser_json()
        print("exported data/war/historical_adp.json.gz and updated data/war/manifest.json")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape FantasyPros ADP through a local logged-in browser session.")
    parser.add_argument("--start-year", type=int, default=2020)
    parser.add_argument("--end-year", type=int, default=2025)
    parser.add_argument("--scoring", nargs="+", choices=sorted(ADP_URLS), default=["ppr", "half", "standard"])
    parser.add_argument("--output", type=Path, default=DATA_DIR / "historical_adp.csv")
    parser.add_argument("--append-existing", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--login-wait-seconds", type=int, default=600)
    parser.add_argument("--min-rows", type=int, default=100)
    parser.add_argument("--export-json", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args(argv)


def main() -> None:
    import asyncio

    asyncio.run(async_main(parse_args()))


if __name__ == "__main__":
    main()
