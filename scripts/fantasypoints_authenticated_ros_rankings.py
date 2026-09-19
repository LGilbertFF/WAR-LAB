#!/usr/bin/env python3
"""Download authenticated Fantasy Points rest-of-season rankings locally.

The script uses the same persistent browser profile as the season projection
sync. Complete login in the opened browser when needed; credentials are never
stored in this repository.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import csv
import json
import os
import re
import shutil
import sys
import time
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from fantasypoints_authenticated_projections import (
    DATA_DIR,
    PROFILE_DIR,
    clean_key,
    default_browser_executable,
    embedded_json_frames,
    normalize_number,
    rendered_grids,
    rendered_tables,
    split_player_team,
)


ROOT = Path(__file__).resolve().parents[1]
ROS_URL = "https://www.fantasypoints.com/nfl/rankings/rest-of-season"
POSITIONS = {"QB", "RB", "WR", "TE"}
LEGACY_PROFILE_DIR = Path.home() / "fantasyfootball" / "selenium_chrome_profile"


def default_profile_dir() -> Path:
    return LEGACY_PROFILE_DIR if LEGACY_PROFILE_DIR.exists() else PROFILE_DIR


async def save_storage_state_secret(context: object) -> None:
    state_path = ROOT / ".local" / "fantasypoints-storage-state.json"
    secret_path = ROOT / ".local" / "FANTASYPOINTS_STORAGE_STATE_B64.txt"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    await context.storage_state(path=str(state_path))
    secret_path.write_text(base64.b64encode(state_path.read_bytes()).decode("ascii"), encoding="utf-8")
    print(f"GitHub secret value written to {secret_path}")


def unique_columns(columns: Iterable[object]) -> list[str]:
    seen: dict[str, int] = {}
    output = []
    for value in columns:
        name = str(value or "").strip()
        if not name or name.lower() == "nan":
            name = "Unnamed"
        count = seen.get(name, 0)
        output.append(name if count == 0 else f"{name}.{count}")
        seen[name] = count + 1
    return output


def read_export(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, low_memory=False)
    keys = {clean_key(column) for column in frame.columns}
    if not {"player", "name", "player name"}.intersection(keys) and not frame.empty:
        frame.columns = unique_columns(frame.iloc[0].tolist())
        frame = frame.iloc[1:].reset_index(drop=True)
    else:
        frame.columns = unique_columns(frame.columns)
    return frame


def source_column(frame: pd.DataFrame, aliases: Iterable[str]) -> object | None:
    keyed = {clean_key(column): column for column in frame.columns}
    for alias in aliases:
        if clean_key(alias) in keyed:
            return keyed[clean_key(alias)]
    return None


def normalize_rankings(frame: pd.DataFrame, season_year: int) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame()
    player_col = source_column(frame, ["Player", "Name", "Player Name", "PLAYER"])
    pos_col = source_column(frame, ["Pos", "Position", "POS"])
    pos_rank_col = source_column(frame, ["Pos Rank", "POS RK", "Position Rank", "Positional Rank"])
    if player_col is None or (pos_col is None and pos_rank_col is None):
        return pd.DataFrame()

    team_col = source_column(frame, ["Team", "Tm", "TEAM"])
    rank_col = source_column(frame, ["Rank", "RK", "#", "Overall Rank", "Overall"])
    player_team = frame[player_col].apply(split_player_team)
    raw_pos_source = frame[pos_col] if pos_col is not None else frame[pos_rank_col]
    raw_pos = raw_pos_source.fillna("").astype(str).str.upper().str.strip()
    out = pd.DataFrame({
        "Year": season_year,
        "Rank": frame[rank_col].apply(normalize_number) if rank_col is not None else range(1, len(frame) + 1),
        "Player": player_team.apply(lambda item: item[0]),
        "Team": player_team.apply(lambda item: item[1]),
        "Pos": raw_pos.str.extract(r"(QB|RB|WR|TE)", expand=False),
    })
    if team_col is not None:
        supplied_team = frame[team_col].fillna("").astype(str).str.strip()
        out["Team"] = supplied_team.where(supplied_team.ne(""), out["Team"])
    if pos_rank_col is not None:
        out["PosRank"] = frame[pos_rank_col].apply(normalize_number)
    else:
        out["PosRank"] = raw_pos.str.extract(r"(\d+)", expand=False).apply(normalize_number)

    out = out[out["Player"].astype(str).str.strip().ne("") & out["Pos"].isin(POSITIONS)].copy()
    out["Rank"] = pd.to_numeric(out["Rank"], errors="coerce")
    fallback_rank = pd.Series(range(1, len(out) + 1), index=out.index, dtype=float)
    out["Rank"] = out["Rank"].fillna(fallback_rank)
    out = out.sort_values("Rank", kind="stable").drop_duplicates(["Player", "Pos"], keep="first")
    derived = out.groupby("Pos").cumcount() + 1
    out["PosRank"] = pd.to_numeric(out["PosRank"], errors="coerce").fillna(derived)
    out["Rank"] = out["Rank"].round().astype(int)
    out["PosRank"] = out["PosRank"].round().astype(int)
    return out[["Year", "Rank", "Player", "Team", "Pos", "PosRank"]].reset_index(drop=True)


async def scrape_rankings(args: argparse.Namespace) -> pd.DataFrame:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise SystemExit(
            "Install Playwright first:\n"
            "  python -m pip install playwright\n"
            "  python -m playwright install chromium"
        ) from exc

    args.profile_dir.mkdir(parents=True, exist_ok=True)
    download_dir = ROOT / ".local" / "fantasypoints-ros-downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    storage_state_b64 = os.getenv("FANTASYPOINTS_STORAGE_STATE_B64", "").strip()
    async with async_playwright() as playwright:
        if storage_state_b64:
            storage_state_path = download_dir / "storage-state.json"
            try:
                storage_state_path.write_bytes(base64.b64decode(storage_state_b64))
                json.loads(storage_state_path.read_text(encoding="utf-8"))
            except (ValueError, json.JSONDecodeError) as exc:
                raise SystemExit("FANTASYPOINTS_STORAGE_STATE_B64 is not valid base64 browser state JSON.") from exc
            browser = await playwright.chromium.launch(
                headless=True,
                downloads_path=str(download_dir),
            )
            context = await browser.new_context(
                storage_state=str(storage_state_path),
                viewport={"width": 1500, "height": 1000},
                accept_downloads=True,
            )
        else:
            context = await playwright.chromium.launch_persistent_context(
                str(args.profile_dir),
                headless=False,
                viewport={"width": 1500, "height": 1000},
                executable_path=str(args.browser_executable) if args.browser_executable else None,
                accept_downloads=True,
                downloads_path=str(download_dir),
            )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(args.url, wait_until="domcontentloaded", timeout=60_000)
        await page.wait_for_timeout(3_000)

        if args.capture_auth_only:
            print("Complete Fantasy Points login in the browser window. This helper will save the session automatically.")
            elapsed = 0
            while elapsed <= args.login_wait_seconds:
                if page.is_closed():
                    raise SystemExit("The browser was closed before the authenticated session could be saved.")
                sign_in = page.locator("a[href*='/accounts/signin'], a.cta-sign-in-btn").first
                sign_in_visible = await sign_in.count() and await sign_in.is_visible()
                if not sign_in_visible and elapsed >= 4:
                    await save_storage_state_secret(context)
                    await context.close()
                    print("Authenticated Fantasy Points session saved. You may close this window.")
                    return pd.DataFrame()
                await page.wait_for_timeout(2_000)
                elapsed += 2
            await context.close()
            raise SystemExit("Login was not detected before the setup timeout expired.")

        elapsed = 0
        best = pd.DataFrame()
        selectors = [
            "button.data-grid-download[aria-label='Download CSV']",
            "button[title='Download CSV']",
            "button[aria-label='Download CSV']",
        ]
        while elapsed <= args.login_wait_seconds:
            frames = []
            frames.extend(await rendered_tables(page))
            frames.extend(await rendered_grids(page))
            frames.extend(await embedded_json_frames(page))
            normalized = [normalize_rankings(frame, args.season_year) for frame in frames]
            normalized = [frame for frame in normalized if not frame.empty]
            if normalized:
                combined = pd.concat(normalized, ignore_index=True).drop_duplicates(["Player", "Pos"])
                if len(combined) > len(best):
                    best = combined
                if len(best) >= args.min_rows:
                    if not storage_state_b64:
                        await save_storage_state_secret(context)
                    await context.close()
                    return best.sort_values("Rank", kind="stable")

            for selector in selectors:
                button = page.locator(selector).first
                if await button.count() and await button.is_visible():
                    download_started = time.time()
                    async with page.expect_download(timeout=90_000) as download_info:
                        await button.click()
                    download = await download_info.value
                    temp_path = ROOT / ".local" / "fantasypoints-ros-rankings.csv"
                    temp_path.parent.mkdir(parents=True, exist_ok=True)
                    suggested_name = download.suggested_filename or "fantasypoints-ros-rankings.csv"
                    persistent_path = download_dir / suggested_name
                    try:
                        await download.save_as(temp_path)
                    except Exception as exc:
                        # Fantasy Points can close or replace the page after export.
                        # Chrome still completes the file in the persistent directory.
                        candidates = sorted(
                            (path for path in download_dir.glob("*.csv") if path.stat().st_mtime >= download_started - 2),
                            key=lambda path: path.stat().st_mtime,
                            reverse=True,
                        )
                        source = persistent_path if persistent_path.exists() else (candidates[0] if candidates else None)
                        if source is None:
                            raise RuntimeError(
                                "The browser closed during the CSV download and no completed CSV was found. "
                                "Leave the opened browser window running until the script finishes."
                            ) from exc
                        shutil.copy2(source, temp_path)
                    result = normalize_rankings(read_export(temp_path), args.season_year)
                    if len(result) >= args.min_rows:
                        if not storage_state_b64:
                            await save_storage_state_secret(context)
                        try:
                            await context.close()
                        except Exception:
                            pass
                        return result
                    print(
                        f"The CSV contained only {len(result):,} usable rows. "
                        "This is usually the public preview; complete login in the browser window."
                    )
                    await page.wait_for_timeout(10_000)
                    await page.reload(wait_until="domcontentloaded", timeout=60_000)
                    elapsed += 10
                    continue

            if elapsed == 0:
                print("Complete Fantasy Points login in the browser window if prompted.")
            await page.wait_for_timeout(5_000)
            elapsed += 5
        await context.close()

    if len(best) < args.min_rows:
        raise SystemExit(f"Only found {len(best):,} ROS ranking rows; expected at least {args.min_rows:,}.")
    return best.sort_values("Rank", kind="stable")


def update_manifests(args: argparse.Namespace, rows: int) -> None:
    scrape_path = DATA_DIR / "scrape_manifest.json"
    manifest = json.loads(scrape_path.read_text(encoding="utf-8")) if scrape_path.exists() else {}
    manifest.update({
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "season_year": args.season_year,
        "current_ros_rankings": "data/current_ros_rankings.csv",
        "current_ros_rankings_source": "Fantasy Points rest-of-season rankings",
        "current_ros_rankings_rows": rows,
    })
    scrape_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    sys.path.insert(0, str(ROOT / "scripts"))
    from export_war_data import MANIFEST_PATH, export_current

    war_manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.exists() else {}
    export_current(war_manifest)
    war_manifest["version"] = 1
    war_manifest["updated_at"] = pd.Timestamp.utcnow().isoformat()
    MANIFEST_PATH.write_text(json.dumps(war_manifest, indent=2), encoding="utf-8")


async def async_main(args: argparse.Namespace) -> None:
    rows = await scrape_rankings(args)
    if args.capture_auth_only:
        return
    if len(rows) < args.min_rows:
        raise SystemExit(f"Only found {len(rows):,} ROS ranking rows; expected at least {args.min_rows:,}.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    rows.to_csv(args.output, index=False, quoting=csv.QUOTE_MINIMAL)
    update_manifests(args, len(rows))
    print(f"wrote {len(rows):,} ROS ranking rows to {args.output}")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download Fantasy Points rest-of-season rankings.")
    parser.add_argument("--season-year", type=int, default=2026)
    parser.add_argument("--url", default=ROS_URL)
    parser.add_argument("--output", type=Path, default=DATA_DIR / "current_ros_rankings.csv")
    parser.add_argument("--browser-executable", type=Path, default=default_browser_executable())
    parser.add_argument("--profile-dir", type=Path, default=default_profile_dir())
    parser.add_argument("--login-wait-seconds", type=int, default=600)
    parser.add_argument("--min-rows", type=int, default=150)
    parser.add_argument("--capture-auth-only", action="store_true")
    return parser.parse_args(argv)


def main() -> None:
    asyncio.run(async_main(parse_args()))


if __name__ == "__main__":
    main()
