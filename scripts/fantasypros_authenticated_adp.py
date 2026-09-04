#!/usr/bin/env python3
"""Download FantasyPros ADP CSVs through a local logged-in browser session.

The public FantasyPros ADP HTML can hide the full table, so this script uses the
site's own Export CSV button from a persistent local browser profile. Sign in
manually when prompted, or provide FANTASYPROS_USERNAME and
FANTASYPROS_PASSWORD as local environment variables.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PROFILE_DIR = ROOT / ".local" / "fantasypros-profile"
DOWNLOAD_DIR = ROOT / ".local" / "fantasypros-downloads"
ADP_URLS = {
    "ppr": "https://www.fantasypros.com/nfl/adp/ppr-overall.php",
    "half": "https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php",
    "standard": "https://www.fantasypros.com/nfl/adp/overall.php",
}


def add_query_params(url: str, **params: object) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({key: str(value) for key, value in params.items() if value is not None})
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def clean_player_name(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s*\(.*?\)", "", text).strip()
    text = re.sub(r"\s+[A-Z]\.\s+.+$", "", text).strip()
    text = re.sub(r"\s+(?:[A-Z]{2,3}(?:\s+[A-Z])?|[A-Z])$", "", text).strip()
    return text


def split_player_team(value: str) -> tuple[str, str]:
    text = str(value or "").strip()
    text = re.sub(r"\s*\(.*?\)", "", text).strip()
    parts = text.split()
    if len(parts) >= 3 and re.fullmatch(r"[A-Z]{2,3}", parts[-2]) and re.fullmatch(r"[A-Z]", parts[-1]):
        return " ".join(parts[:-2]).strip(), parts[-2]
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{2,3}", parts[-1]):
        return " ".join(parts[:-1]).strip(), parts[-1]
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]", parts[-1]):
        return " ".join(parts[:-1]).strip(), ""
    return text, ""


def normalize_adp_download(df: pd.DataFrame, scoring: str, year: int) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    df.columns = [str(col).strip() for col in df.columns]
    source_col = next(
        (col for col in df.columns if "player" in col.lower().replace(" ", "")),
        df.columns[1] if len(df.columns) > 1 else df.columns[0],
    )
    rank_col = next((col for col in df.columns if col.lower() in {"rank", "rk"} or col == "#"), None)
    avg_col = next((col for col in df.columns if col.lower() in {"avg", "adp"}), None)
    pos_col = next((col for col in df.columns if col.upper() == "POS"), None)
    team_col = next((col for col in df.columns if col.upper() in {"TEAM", "TM"}), None)
    if avg_col is None:
        raise RuntimeError(f"Downloaded ADP file for {year} {scoring} did not include an ADP/AVG column.")

    extracted = df[source_col].apply(split_player_team)
    players = extracted.apply(lambda item: clean_player_name(item[0]))
    out = pd.DataFrame(
        {
            "Year": year,
            "Scoring": scoring,
            "Player": players,
            "Team": df.get(team_col, extracted.apply(lambda item: item[1])) if team_col else extracted.apply(lambda item: item[1]),
            "ADP Rank": pd.to_numeric(df.get(rank_col), errors="coerce") if rank_col else range(1, len(df) + 1),
            "POS": df.get(pos_col, "") if pos_col else "",
            "ADP": pd.to_numeric(df.get(avg_col), errors="coerce"),
        }
    )
    out = out[out["Player"].astype(str).str.len().gt(0) & out["ADP"].notna()].copy()
    return out


def read_downloaded_table(path: Path, scoring: str, year: int) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".csv", ".txt"}:
        df = pd.read_csv(path, low_memory=False)
    elif suffix in {".xls", ".xlsx"}:
        frames = pd.read_html(path)
        df = frames[0] if frames else pd.DataFrame()
    else:
        try:
            df = pd.read_csv(path, low_memory=False)
        except Exception:
            frames = pd.read_html(path)
            df = frames[0] if frames else pd.DataFrame()
    return normalize_adp_download(df, scoring, year)


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


def read_manifest(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def manifest_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(ROOT).as_posix()
    except ValueError:
        return resolved.as_posix()


def write_scrape_manifest(**values: object) -> None:
    manifest_path = DATA_DIR / "scrape_manifest.json"
    manifest = read_manifest(manifest_path)
    manifest.update({"updated_at": pd.Timestamp.utcnow().isoformat(), **values})
    for key in ["current_adp_error"]:
        if values.get("current_adp_stale") is False:
            manifest.pop(key, None)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def export_current_json() -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from export_war_data import MANIFEST_PATH, export_current

    manifest = read_manifest(MANIFEST_PATH)
    export_current(manifest)
    manifest["version"] = 1
    manifest["updated_at"] = pd.Timestamp.utcnow().isoformat()
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def export_historical_json() -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from export_war_data import MANIFEST_PATH, export_historical_adp

    manifest = read_manifest(MANIFEST_PATH)
    export_historical_adp(manifest)
    manifest["version"] = 1
    manifest["updated_at"] = pd.Timestamp.utcnow().isoformat()
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


async def locator_visible(locator, timeout: int = 2_000) -> bool:
    try:
        return await locator.is_visible(timeout=timeout)
    except Exception:
        return False


async def ensure_signed_in(page, login_wait_seconds: int) -> None:
    sign_in = page.locator("a.cta-sign-in-btn, a[href*='/accounts/signin']").first
    if await locator_visible(sign_in):
        await sign_in.click()

    username = page.locator("#username, input[placeholder='Email or Username']").first
    password = page.locator("input[type='password'], input[placeholder='Password']").first
    if await locator_visible(username):
        user = os.environ.get("FANTASYPROS_USERNAME")
        pwd = os.environ.get("FANTASYPROS_PASSWORD")
        if user and pwd and await locator_visible(password):
            await username.fill(user)
            await password.fill(pwd)
            await page.locator("button[type='submit'], button:has-text('Sign In')").first.click()
        else:
            print("FantasyPros sign-in is required. Complete the login in the opened browser.")

    waited = 0
    export_button = page.locator("button[aria-label='Export CSV'], button.reports__action-btn").first
    while waited < max(0, login_wait_seconds):
        if await locator_visible(export_button):
            return
        await page.wait_for_timeout(2_000)
        waited += 2
    if not await locator_visible(export_button):
        raise RuntimeError("FantasyPros Export CSV button was not available after login wait.")


async def download_year_scoring(page, year: int, scoring: str, login_wait_seconds: int, min_rows: int) -> pd.DataFrame:
    url = add_query_params(ADP_URLS[scoring], year=year)
    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    await ensure_signed_in(page, login_wait_seconds)
    if f"year={year}" not in page.url:
        await page.goto(url, wait_until="domcontentloaded", timeout=60_000)

    button = page.locator("button[aria-label='Export CSV'], button.reports__action-btn").first
    await button.wait_for(state="visible", timeout=30_000)
    async with page.expect_download(timeout=60_000) as download_info:
        await button.click()
    download = await download_info.value
    suggested = download.suggested_filename or f"fantasypros_adp_{year}_{scoring}.csv"
    destination = DOWNLOAD_DIR / f"{year}_{scoring}_{suggested}"
    await download.save_as(str(destination))
    frame = read_downloaded_table(destination, scoring, year)
    if len(frame) < min_rows:
        raise RuntimeError(f"Downloaded only {len(frame):,} rows for {year} {scoring}.")
    return frame


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
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[pd.DataFrame] = []
    mode_current = args.current
    start_year = args.season_year if mode_current else args.start_year
    end_year = args.season_year if mode_current else args.end_year

    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            accept_downloads=True,
            headless=False,
            viewport={"width": 1440, "height": 950},
        )
        page = context.pages[0] if context.pages else await context.new_page()
        for year in range(start_year, end_year + 1):
            for scoring in args.scoring:
                try:
                    frame = await download_year_scoring(page, year, scoring, args.login_wait_seconds, args.min_rows)
                except Exception as exc:
                    print(f"skipped {year} {scoring}: {exc}")
                    continue
                rows.append(frame)
                print(f"downloaded {year} {scoring}: {len(frame):,} rows")
        await context.close()

    output = args.current_output if mode_current else args.historical_output
    combined = save_adp(rows, output, append_existing=args.append_existing and not mode_current)
    if combined.empty:
        raise SystemExit("No ADP rows were downloaded.")
    print(f"wrote {len(combined):,} rows to {output}")

    if mode_current:
        write_scrape_manifest(
            current_adp=manifest_path(output),
            current_adp_stale=False,
            season_year=args.season_year,
            adp_scoring=list(args.scoring),
        )
        if args.export_json:
            export_current_json()
            print("exported data/war/current_adp.json.gz and updated data/war/manifest.json")
    else:
        write_scrape_manifest(
            historical_adp=manifest_path(output),
            historical_adp_rows=int(len(combined)),
            historical_adp_start_year=start_year,
            historical_adp_end_year=end_year,
            historical_adp_scoring=list(args.scoring),
        )
        if args.export_json:
            export_historical_json()
            print("exported data/war/historical_adp.json.gz and updated data/war/manifest.json")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download FantasyPros ADP CSVs through a local logged-in browser.")
    parser.add_argument("--current", action="store_true", help="Download current-season ADP to data/current_adp.csv.")
    parser.add_argument("--season-year", type=int, default=2026)
    parser.add_argument("--start-year", type=int, default=2020)
    parser.add_argument("--end-year", type=int, default=2025)
    parser.add_argument("--scoring", nargs="+", choices=sorted(ADP_URLS), default=["ppr", "half", "standard"])
    parser.add_argument("--current-output", type=Path, default=DATA_DIR / "current_adp.csv")
    parser.add_argument("--historical-output", type=Path, default=DATA_DIR / "historical_adp.csv")
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
