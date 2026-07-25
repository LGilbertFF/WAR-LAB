#!/usr/bin/env python3
"""Local authenticated Fantasy Points projection sync.

This opens a real browser with a persistent local profile. Sign in manually when
prompted; the script then reads the rendered season projections page and writes
cleaned rows to data/current_projections.csv.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PROFILE_DIR = ROOT / ".local" / "fantasypoints-profile"
PROJECTIONS_URL = "https://www.fantasypoints.com/nfl/projections/season/qb-rb-wr-te"
POSITIONS = {"QB", "RB", "WR", "TE"}
LOCAL_BROWSER_PATHS = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
]

COLUMN_ALIASES = {
    "Player": ["player", "name", "full name", "full_name", "player name", "player_name"],
    "Team": ["team", "tm", "club"],
    "Pos": ["pos", "position"],
    "PassingYDS": ["pass yds", "passing yds", "passing yards", "pass_yds", "passing_yds"],
    "PassingTD": ["pass td", "passing td", "passing tds", "pass_tds", "passing_td"],
    "INTS": ["int", "ints", "interceptions", "pass int", "passing int"],
    "RushingYDS": ["rush yds", "rushing yds", "rushing yards", "rush_yds", "rushing_yds"],
    "RushingTD": ["rush td", "rush tds", "rushing td", "rushing tds", "rush_td", "rushing_td"],
    "REC": ["rec", "receptions", "reception"],
    "ReceivingYDS": ["rec yds", "receiving yds", "receiving yards", "rec_yds", "receiving_yds"],
    "ReceivingTD": ["rec td", "rec tds", "receiving td", "receiving tds", "rec_td", "receiving_td"],
    "FL": ["fl", "fum lost", "fumbles lost", "fumble lost", "lost fumbles"],
    "FPTS": ["fpts", "fantasy points", "fantasy pts", "points", "pts", "fantasy_points"],
    "AVG": ["avg", "fpts/g", "fantasy points per game", "points per game"],
}


def clean_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def normalize_number(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text or text in {"-", "--"}:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def split_player_team(value: object) -> tuple[str, str]:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    text = re.sub(r"\s*\([^)]*\)", "", text).strip()
    parts = text.split()
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{2,3}", parts[-1]):
        return " ".join(parts[:-1]).strip(), parts[-1]
    return text, ""


def default_browser_executable() -> Path | None:
    for path in LOCAL_BROWSER_PATHS:
        if path.exists():
            return path
    return None


def alias_lookup(columns: Iterable[object]) -> dict[str, object]:
    keyed = {clean_key(column): column for column in columns}
    lookup: dict[str, object] = {}
    for target, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            key = clean_key(alias)
            if key in keyed:
                lookup[target] = keyed[key]
                break
    return lookup


def normalize_frame(df: pd.DataFrame, season_year: int) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    lookup = alias_lookup(df.columns)
    if "Player" not in lookup:
        return pd.DataFrame()

    player_team = df[lookup["Player"]].apply(split_player_team)
    out = pd.DataFrame({
        "Year": season_year,
        "Player": player_team.apply(lambda item: item[0]),
        "Team": player_team.apply(lambda item: item[1]),
    })
    if "Team" in lookup:
        out["Team"] = df[lookup["Team"]].fillna(out["Team"]).astype(str).str.strip()
    if "Pos" in lookup:
        out["Pos"] = df[lookup["Pos"]].astype(str).str.upper().str.replace(r"[^A-Z]", "", regex=True)
    else:
        out["Pos"] = ""

    for target in ["PassingYDS", "PassingTD", "INTS", "RushingYDS", "RushingTD", "REC", "ReceivingYDS", "ReceivingTD", "FL", "FPTS", "AVG"]:
        if target in lookup:
            out[target] = df[lookup[target]].apply(normalize_number)

    out = out[out["Player"].astype(str).str.len().gt(0)].copy()
    out = out[out["Pos"].isin(POSITIONS)].copy()
    if "FPTS" not in out.columns and "AVG" not in out.columns:
        stat_cols = {"PassingYDS", "PassingTD", "INTS", "RushingYDS", "RushingTD", "REC", "ReceivingYDS", "ReceivingTD", "FL"}
        if not stat_cols.intersection(out.columns):
            return pd.DataFrame()
    if "AVG" not in out.columns and "FPTS" in out.columns:
        out["AVG"] = out["FPTS"] / 17
    if "FPTS" not in out.columns and "AVG" in out.columns:
        out["FPTS"] = out["AVG"] * 17
    return out.drop_duplicates(subset=["Year", "Player", "Pos"], keep="last")


async def rendered_tables(page) -> list[pd.DataFrame]:
    tables = await page.evaluate(
        """
        () => Array.from(document.querySelectorAll('table')).map((table) => ({
          headers: Array.from(table.querySelectorAll('thead th')).map((th) => th.innerText.trim()),
          rows: Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
            Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim())
          )
        }))
        """
    )
    frames: list[pd.DataFrame] = []
    for table in tables:
        headers = table.get("headers") or []
        rows = [row[: len(headers)] for row in table.get("rows") or [] if row and len(row) >= len(headers)]
        header_text = " ".join(headers).lower()
        if headers and rows and "player" in header_text:
            frames.append(pd.DataFrame(rows, columns=headers))
    return frames


async def rendered_grids(page) -> list[pd.DataFrame]:
    grids = await page.evaluate(
        """
        () => Array.from(document.querySelectorAll('[role="grid"], [role="table"]')).map((grid) => {
          const headers = Array.from(grid.querySelectorAll('[role="columnheader"]')).map((cell) => cell.innerText.trim());
          const rows = Array.from(grid.querySelectorAll('[role="row"]')).map((row) =>
            Array.from(row.querySelectorAll('[role="gridcell"], [role="cell"]')).map((cell) => cell.innerText.trim())
          ).filter((row) => row.length);
          return { headers, rows };
        })
        """
    )
    frames: list[pd.DataFrame] = []
    for grid in grids:
        headers = grid.get("headers") or []
        rows = [row[: len(headers)] for row in grid.get("rows") or [] if headers and len(row) >= len(headers)]
        header_text = " ".join(headers).lower()
        if headers and rows and "player" in header_text:
            frames.append(pd.DataFrame(rows, columns=headers))
    return frames


def walk_json(value: Any) -> Iterable[list[dict[str, Any]]]:
    if isinstance(value, list):
        dict_rows = [item for item in value if isinstance(item, dict)]
        if len(dict_rows) >= 10:
            keys = {clean_key(key) for row in dict_rows[:10] for key in row}
            if {"player", "name", "full name", "player name"}.intersection(keys) and {"pos", "position"}.intersection(keys):
                yield dict_rows
        for item in value:
            yield from walk_json(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_json(item)


async def embedded_json_frames(page) -> list[pd.DataFrame]:
    scripts = await page.evaluate("() => Array.from(document.scripts).map((script) => script.textContent || '')")
    frames: list[pd.DataFrame] = []
    for text in scripts:
        stripped = text.strip()
        if not stripped:
            continue
        candidates = [stripped]
        next_match = re.search(r"<script[^>]*id=[\"']__NEXT_DATA__[\"'][^>]*>(.*?)</script>", stripped, re.S)
        if next_match:
            candidates.append(next_match.group(1))
        for candidate in candidates:
            try:
                payload = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            for rows in walk_json(payload):
                frames.append(pd.DataFrame(rows))
    return frames


async def scrape_projections(args: argparse.Namespace) -> pd.DataFrame:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise SystemExit(
            "Install Playwright first:\n"
            "  python -m pip install playwright\n"
            "  python -m playwright install chromium"
        ) from exc

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1500, "height": 1000},
            executable_path=str(args.browser_executable) if args.browser_executable else None,
        )
        page = context.pages[0] if context.pages else await context.new_page()
        try:
            await page.goto(args.url, wait_until="domcontentloaded", timeout=60_000)
        except Exception as exc:
            if "ERR_NETWORK_ACCESS_DENIED" in str(exc):
                raise SystemExit(
                    "The browser launched, but this environment blocked network access to Fantasy Points. "
                    "Run the same command from a normal PowerShell terminal."
                ) from exc
            raise
        await page.wait_for_timeout(3_000)

        best = pd.DataFrame()
        elapsed = 0
        while elapsed <= args.login_wait_seconds:
            frames = []
            frames.extend(await rendered_tables(page))
            frames.extend(await rendered_grids(page))
            frames.extend(await embedded_json_frames(page))
            normalized = [normalize_frame(frame, args.season_year) for frame in frames]
            normalized = [frame for frame in normalized if not frame.empty]
            if normalized:
                combined = pd.concat(normalized, ignore_index=True)
                combined = combined.drop_duplicates(subset=["Year", "Player", "Pos"], keep="last")
                if len(combined) > len(best):
                    best = combined
                if len(best) >= args.min_rows:
                    break
            if elapsed == 0:
                print("If Fantasy Points is asking you to sign in, complete the login in the browser window.")
            await page.wait_for_timeout(5_000)
            elapsed += 5
        await context.close()

    if len(best) < args.min_rows:
        raise SystemExit(f"Only found {len(best):,} projection rows; expected at least {args.min_rows:,}.")
    sort_col = "FPTS" if "FPTS" in best.columns else "AVG" if "AVG" in best.columns else "Player"
    return best.sort_values(["Pos", sort_col], ascending=[True, sort_col == "Player"], kind="stable")


def export_browser_json() -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from export_war_data import MANIFEST_PATH, export_current

    manifest = {}
    if MANIFEST_PATH.exists():
        try:
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}
    export_current(manifest)
    manifest["version"] = 1
    manifest["updated_at"] = pd.Timestamp.utcnow().isoformat()
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def update_scrape_manifest(args: argparse.Namespace, rows: int) -> None:
    manifest_path = DATA_DIR / "scrape_manifest.json"
    manifest = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}
    manifest.update({
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "season_year": args.season_year,
        "current_projections": "data/current_projections.csv",
        "current_projections_source": "Fantasy Points",
        "current_projections_rows": rows,
        "current_projections_stale": False,
    })
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


async def async_main(args: argparse.Namespace) -> None:
    rows = await scrape_projections(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    rows.to_csv(args.output, index=False, quoting=csv.QUOTE_MINIMAL)
    print(f"wrote {len(rows):,} Fantasy Points projection rows to {args.output}")
    update_scrape_manifest(args, len(rows))
    if args.export_json:
        export_browser_json()
        print("exported data/war/current_projections.json.gz and updated manifests")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Fantasy Points projections through a local logged-in browser session.")
    parser.add_argument("--season-year", type=int, default=2026)
    parser.add_argument("--url", default=PROJECTIONS_URL)
    parser.add_argument("--output", type=Path, default=DATA_DIR / "current_projections.csv")
    parser.add_argument(
        "--browser-executable",
        type=Path,
        default=default_browser_executable(),
        help="Optional local Chrome/Edge executable to launch instead of bundled Chromium.",
    )
    parser.add_argument("--login-wait-seconds", type=int, default=600)
    parser.add_argument("--min-rows", type=int, default=250)
    parser.add_argument("--export-json", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args(argv)


def main() -> None:
    import asyncio

    asyncio.run(async_main(parse_args()))


if __name__ == "__main__":
    main()
