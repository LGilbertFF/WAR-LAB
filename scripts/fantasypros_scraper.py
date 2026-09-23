#!/usr/bin/env python3
"""Scrape FantasyPros data for the WAR Projection Lab.

This script is meant to run outside the browser, either locally or in GitHub
Actions. It writes static CSV files into data/ so GitHub Pages can serve them.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd
import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MIN_CURRENT_PROJECTION_ROWS = 250

POSITIONS = ("qb", "rb", "wr", "te")
ADP_URLS = {
    "ppr": "https://www.fantasypros.com/nfl/adp/ppr-overall.php",
    "half": "https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php",
    "standard": "https://www.fantasypros.com/nfl/adp/overall.php",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def infer_completed_week(season_year: int, today: date | None = None) -> int:
    today = today or datetime.now(timezone.utc).date()
    first_rollover = date(season_year, 9, 15)
    while first_rollover.weekday() != 1:
        first_rollover += timedelta(days=1)
    if today < first_rollover:
        return 1
    return max(1, min(18, ((today - first_rollover).days // 7) + 1))


def fetch(url: str, *, delay: float = 0.35) -> str:
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    time.sleep(delay)
    return response.text


def unique_headers(headers: Iterable[str]) -> list[str]:
    seen: dict[str, int] = {}
    result: list[str] = []
    for header in headers:
        clean = header.strip() or "Column"
        if clean in seen:
            seen[clean] += 1
            result.append(f"{clean}_{seen[clean]}")
        else:
            seen[clean] = 0
            result.append(clean)
    return result


def table_to_df(html: str) -> pd.DataFrame:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", {"id": "data"})
    if table is None:
        for candidate in soup.find_all("table"):
            header_text = " ".join(th.get_text(" ", strip=True).lower() for th in candidate.find_all("th"))
            if "player" in header_text:
                table = candidate
                break
    if table is None:
        title = soup.find("title")
        title_text = f": {title.get_text(strip=True)}" if title else ""
        raise RuntimeError(f"Could not find FantasyPros data table{title_text}")
    thead = table.find("thead")
    tbody = table.find("tbody")
    if thead is None or tbody is None:
        raise RuntimeError("FantasyPros data table is missing thead/tbody")
    headers = unique_headers(th.get_text(strip=True) for th in thead.find_all("th"))
    rows = []
    for tr in tbody.find_all("tr"):
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if cells:
            if len(cells) < len(headers):
                cells.extend([""] * (len(headers) - len(cells)))
            rows.append(cells[: len(headers)])
    return pd.DataFrame(rows, columns=headers)


def split_player_team(value: str) -> tuple[str, str]:
    text = str(value).strip()
    projection_match = re.match(r"(.+?)([A-Z]{2,3})highlow$", text)
    if projection_match:
        return projection_match.group(1).strip(), projection_match.group(2).strip()
    compact_bye_match = re.match(r"^(.*?)([A-Z]{2,3})\(\d+\)$", text)
    if compact_bye_match:
        return compact_bye_match.group(1).strip(), compact_bye_match.group(2).strip()
    paren_match = re.match(r"^(.*?)\s+\(([A-Z]{2,3})\)$", text)
    if paren_match:
        return paren_match.group(1).strip(), paren_match.group(2).strip()
    bye_match = re.match(r"^(.*?)\s+([A-Z]{2,3})\s+\(\d+\)$", text)
    if bye_match:
        return bye_match.group(1).strip(), bye_match.group(2).strip()
    return re.sub(r"\s*\(.*?\)", "", text).strip(), ""


def clean_adp_player_name(value: str) -> str:
    """Remove FantasyPros export's duplicated short name from player cells."""
    text = str(value or "").strip()
    return re.sub(r"\s+[A-Z]\.\s+.+$", "", text).strip()


def player_name_key(value: object) -> str:
    """Build a stable cross-source player key without changing display names."""
    text = str(value or "").lower().replace("’", "'")
    text = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def enrich_weekly_teams(df: pd.DataFrame) -> pd.DataFrame:
    """Fill teams that the weekly stats table omits using current player feeds."""
    if df.empty or "Player" not in df.columns:
        return df
    result = df.copy()
    if "Team" not in result.columns:
        result["Team"] = ""
    result["Team"] = result["Team"].fillna("").astype(str)

    by_player_pos: dict[tuple[str, str], str] = {}
    by_player: dict[str, str] = {}
    for source_name in ("current_ros_rankings.csv", "current_projections.csv", "current_adp.csv"):
        source_path = DATA_DIR / source_name
        if not source_path.exists():
            continue
        try:
            source = pd.read_csv(source_path, dtype=str).fillna("")
        except (OSError, pd.errors.ParserError):
            continue
        player_col = next((col for col in ("Player", "Name", "player") if col in source.columns), None)
        team_col = next((col for col in ("Team", "Tm", "team") if col in source.columns), None)
        pos_col = next((col for col in ("Pos", "POS", "Position", "position") if col in source.columns), None)
        if not player_col or not team_col:
            continue
        for _, row in source.iterrows():
            key = player_name_key(row[player_col])
            team = str(row[team_col]).strip().upper()
            pos = re.sub(r"\d+$", "", str(row[pos_col]).strip().upper()) if pos_col else ""
            if not key or not team:
                continue
            by_player.setdefault(key, team)
            if pos:
                by_player_pos.setdefault((key, pos), team)

    headshots_path = DATA_DIR / "player_headshots.json"
    if headshots_path.exists():
        try:
            headshots = json.loads(headshots_path.read_text(encoding="utf-8")).get("by_key", {})
        except (OSError, json.JSONDecodeError, AttributeError):
            headshots = {}
        for entry in headshots.values():
            if not isinstance(entry, dict):
                continue
            key = player_name_key(entry.get("name", ""))
            team = str(entry.get("team", "") or "").strip().upper()
            pos = str(entry.get("position", "") or "").strip().upper()
            if not key or not team:
                continue
            by_player.setdefault(key, team)
            if pos:
                by_player_pos.setdefault((key, pos), team)

    current_teams = result["Team"].fillna("").astype(str).str.strip()
    missing = current_teams.eq("") | current_teams.str.lower().isin({"nan", "none"})
    if missing.any():
        def resolve_team(row: pd.Series) -> str:
            key = player_name_key(row.get("Player", ""))
            pos = str(row.get("Pos", "")).strip().upper()
            return by_player_pos.get((key, pos), by_player.get(key, ""))

        result.loc[missing, "Team"] = result.loc[missing].apply(resolve_team, axis=1)
    return result


def add_query_params(url: str, **params: object) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({key: str(value) for key, value in params.items() if value is not None})
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def split_high_low(value: object) -> tuple[float | None, float | None, float | None]:
    text = str(value).replace(",", "").strip()
    nums = re.findall(r"-?\d+\.\d", text)
    if not nums:
        nums = re.findall(r"-?\d+(?:\.\d+)?", text)
    if not nums:
        return None, None, None
    parsed = [float(num) for num in nums[:3]]
    while len(parsed) < 3:
        parsed.append(None)
    return parsed[0], parsed[1], parsed[2]


def projection_rename_map(position: str, columns: Iterable[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    yds_count = 0
    td_count = 0
    att_count = 0
    for col in columns:
        upper = col.upper()
        if col in {"Player", "Team"}:
            continue
        if position == "qb":
            if "ATT" in upper:
                att_count += 1
                mapping[col] = "PassingATT" if att_count == 1 else "RushingATT"
            elif "CMP" in upper:
                mapping[col] = "PassingCMP"
            elif "YDS" in upper:
                yds_count += 1
                mapping[col] = "PassingYDS" if yds_count == 1 else "RushingYDS"
            elif "TDS" in upper or upper == "TD":
                td_count += 1
                mapping[col] = "PassingTD" if td_count == 1 else "RushingTD"
            elif "INT" in upper:
                mapping[col] = "INTS"
            elif "FL" in upper:
                mapping[col] = "FL"
        elif position == "rb":
            if "ATT" in upper:
                mapping[col] = "RushingATT"
            elif "REC" in upper:
                mapping[col] = "REC"
            elif "YDS" in upper:
                yds_count += 1
                mapping[col] = "RushingYDS" if yds_count == 1 else "ReceivingYDS"
            elif "TDS" in upper or upper == "TD":
                td_count += 1
                mapping[col] = "RushingTD" if td_count == 1 else "ReceivingTD"
            elif "FL" in upper:
                mapping[col] = "FL"
        elif position == "wr":
            if "REC" in upper:
                mapping[col] = "REC"
            elif "ATT" in upper:
                mapping[col] = "RushingATT"
            elif "YDS" in upper:
                yds_count += 1
                mapping[col] = "ReceivingYDS" if yds_count == 1 else "RushingYDS"
            elif "TDS" in upper or upper == "TD":
                td_count += 1
                mapping[col] = "ReceivingTD" if td_count == 1 else "RushingTD"
            elif "FL" in upper:
                mapping[col] = "FL"
        elif position == "te":
            if "REC" in upper:
                mapping[col] = "REC"
            elif "ATT" in upper:
                mapping[col] = "RushingATT"
            elif "YDS" in upper:
                yds_count += 1
                mapping[col] = "ReceivingYDS" if yds_count == 1 else "RushingYDS"
            elif "TDS" in upper or upper == "TD":
                td_count += 1
                mapping[col] = "ReceivingTD" if td_count == 1 else "RushingTD"
            elif "FL" in upper:
                mapping[col] = "FL"
    return mapping


def scrape_projection(position: str, season_year: int) -> pd.DataFrame:
    url = (
        f"https://www.fantasypros.com/nfl/projections/{position}.php"
        f"?year={season_year}&max-yes=true&min-yes=true&week=draft"
    )
    df = table_to_df(fetch(url))
    player_team = df["Player"].apply(split_player_team)
    df["Player"] = player_team.apply(lambda item: item[0])
    df.insert(1, "Team", player_team.apply(lambda item: item[1]))
    df.rename(columns=projection_rename_map(position, df.columns), inplace=True)

    base = pd.DataFrame({"Player": df["Player"], "Team": df["Team"], "Pos": position.upper()})
    for col in [c for c in df.columns if c not in {"Player", "Team"}]:
        main, high, low = zip(*df[col].apply(split_high_low))
        base[col] = main
        base[f"{col} High"] = high
        base[f"{col} Low"] = low
    return base


def scrape_current_projections(output: Path, season_year: int, positions: Iterable[str] = POSITIONS) -> pd.DataFrame:
    frames = [scrape_projection(position, season_year) for position in positions]
    result = pd.concat(frames, ignore_index=True)
    result = result[result["Player"].ne("Taysom Hill")]
    result.insert(0, "Year", season_year)
    result.to_csv(output, index=False)
    return result


def scrape_adp(scoring: str, output: Path, season_year: int) -> pd.DataFrame:
    url = add_query_params(ADP_URLS[scoring], export="xls", year=season_year)
    df = table_to_df(fetch(url))
    source_col = next(
        (col for col in df.columns if "player" in col.lower().replace(" ", "")),
        df.columns[1] if len(df.columns) > 1 else df.columns[0],
    )
    rank_col = next((col for col in df.columns if col.lower() == "rank"), None)
    avg_col = next((col for col in df.columns if col.lower() in {"avg", "adp"}), None)
    extracted = df[source_col].apply(split_player_team)
    players = extracted.apply(lambda item: clean_adp_player_name(item[0]))
    result = pd.DataFrame(
        {
            "Year": season_year,
            "Scoring": scoring,
            "Player": players,
            "Team": extracted.apply(lambda item: item[1]),
            "ADP Rank": pd.to_numeric(df.get(rank_col), errors="coerce") if rank_col else None,
            "POS": df.get("POS", ""),
            "ADP": pd.to_numeric(df.get(avg_col), errors="coerce") if avg_col else None,
        }
    )
    result.to_csv(output, index=False)
    return result


def scrape_historical_adp(
    start_year: int,
    end_year: int,
    output: Path,
    scoring_types: Iterable[str],
) -> pd.DataFrame:
    existing = pd.read_csv(output, low_memory=False) if output.exists() else pd.DataFrame()
    frames = [existing] if not existing.empty else []
    done: set[tuple[int, str]] = set()
    if not existing.empty and {"Year", "Scoring"}.issubset(existing.columns):
        for _, row in existing[["Year", "Scoring"]].drop_duplicates().iterrows():
            year = pd.to_numeric(row["Year"], errors="coerce")
            if pd.notna(year):
                done.add((int(year), str(row["Scoring"]).lower()))

    for year in range(start_year, end_year + 1):
        for scoring in scoring_types:
            if (year, scoring) in done:
                continue
            scratch = DATA_DIR / f".historical_adp_{year}_{scoring}.csv"
            try:
                frame = scrape_adp(scoring, scratch, year)
                frames.append(frame)
                if scratch.exists():
                    scratch.unlink()
                result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
                result = result.drop_duplicates(subset=["Year", "Scoring", "Player", "POS"], keep="last")
                result.to_csv(output, index=False, quoting=csv.QUOTE_MINIMAL)
                print(f"scraped {year} {scoring} ADP ({len(frame):,} rows)")
            except Exception as exc:
                print(f"skipped {year} {scoring} ADP: {exc}")
    result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not result.empty:
        result = result.drop_duplicates(subset=["Year", "Scoring", "Player", "POS"], keep="last")
        result.to_csv(output, index=False, quoting=csv.QUOTE_MINIMAL)
    return result


def normalize_weekly(position: str, year: int, week: int, df: pd.DataFrame) -> pd.DataFrame:
    player_team = df["Player"].apply(split_player_team)
    df["Player"] = player_team.apply(lambda item: item[0])
    df["Team"] = player_team.apply(lambda item: item[1])
    df["Pos"] = position.upper()
    df["Year"] = year
    df["Week"] = week
    df.rename(columns=projection_rename_map(position, df.columns), inplace=True)
    for col in df.columns:
        if col not in {"Player", "Team", "Pos"}:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def scrape_historical_weekly(
    start_year: int,
    end_year: int,
    output: Path,
    positions: Iterable[str] = POSITIONS,
) -> pd.DataFrame:
    existing = pd.read_csv(output) if output.exists() else pd.DataFrame()
    frames = [existing] if not existing.empty else []
    done: set[tuple[int, int, str]] = set()
    if not existing.empty:
        for _, row in existing[["Year", "Week", "Pos"]].drop_duplicates().iterrows():
            done.add((int(row["Year"]), int(row["Week"]), str(row["Pos"]).lower()))

    for year in range(start_year, end_year + 1):
        for week in range(1, 18):
            for position in positions:
                if (year, week, position) in done:
                    continue
                url = f"https://www.fantasypros.com/nfl/stats/{position}.php?year={year}&week={week}&range=week"
                try:
                    frames.append(normalize_weekly(position, year, week, table_to_df(fetch(url))))
                    result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
                    result.to_csv(output, index=False, quoting=csv.QUOTE_MINIMAL)
                    print(f"scraped {position.upper()} {year} week {week}")
                except Exception as exc:
                    print(f"skipped {position.upper()} {year} week {week}: {exc}")
    result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    result.to_csv(output, index=False, quoting=csv.QUOTE_MINIMAL)
    return result


def scrape_current_weekly(
    season_year: int,
    week_last: int,
    output: Path,
    positions: Iterable[str] = POSITIONS,
) -> pd.DataFrame:
    existing = pd.read_csv(output) if output.exists() else pd.DataFrame()
    frames = [existing] if not existing.empty else []
    done: set[tuple[int, int, str]] = set()
    if not existing.empty and {"Year", "Week", "Pos"}.issubset(existing.columns):
        for _, row in existing[["Year", "Week", "Pos"]].drop_duplicates().iterrows():
            year = pd.to_numeric(row["Year"], errors="coerce")
            week = pd.to_numeric(row["Week"], errors="coerce")
            if pd.notna(year) and pd.notna(week):
                done.add((int(year), int(week), str(row["Pos"]).lower()))

    week_last = max(1, min(18, int(week_last)))
    for week in range(1, week_last + 1):
        for position in positions:
            if (season_year, week, position) in done:
                continue
            url = f"https://www.fantasypros.com/nfl/stats/{position}.php?year={season_year}&week={week}&range=week"
            frames.append(normalize_weekly(position, season_year, week, table_to_df(fetch(url))))
            result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
            result = result.drop_duplicates(subset=["Year", "Week", "Pos", "Player"], keep="last")
            result = enrich_weekly_teams(result)
            result.to_csv(output, index=False, quoting=csv.QUOTE_MINIMAL)
            print(f"scraped current {position.upper()} {season_year} week {week}")
    result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not result.empty:
        result = result.drop_duplicates(subset=["Year", "Week", "Pos", "Player"], keep="last")
        result = enrich_weekly_teams(result)
        result.to_csv(output, index=False, quoting=csv.QUOTE_MINIMAL)
    return result


def write_manifest(**values: object) -> None:
    manifest_path = DATA_DIR / "scrape_manifest.json"
    existing: dict[str, object] = {}
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}
    manifest = {
        **existing,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **values,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", action="store_true", help="Scrape current projections and ADP")
    parser.add_argument("--current-weekly", action="store_true", help="Scrape current-season weekly stat rows through --week-last")
    parser.add_argument("--historical", action="store_true", help="Scrape historical weekly stat rows")
    parser.add_argument("--historical-adp", action="store_true", help="Scrape historical FantasyPros ADP rows")
    parser.add_argument("--season-year", type=int, default=datetime.now().year)
    parser.add_argument("--start-year", type=int, default=2015)
    parser.add_argument("--end-year", type=int, default=datetime.now().year - 1)
    parser.add_argument("--adp-scoring", choices=sorted(ADP_URLS), default="ppr")
    parser.add_argument("--week-last", type=int, help="Most recent completed NFL week for current weekly stats. Defaults to an automatic season calendar estimate.")
    parser.add_argument(
        "--skip-current-adp",
        action="store_true",
        help="Only scrape current projections. Current ADP is login-gated and should use fantasypros_authenticated_adp.py.",
    )
    parser.add_argument("--historical-adp-scoring", nargs="+", choices=sorted(ADP_URLS), default=sorted(ADP_URLS))
    parser.add_argument(
        "--positions",
        nargs="+",
        choices=POSITIONS,
        default=list(POSITIONS),
        help="Positions to scrape. Defaults to all positions.",
    )
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    outputs: dict[str, object] = {}

    if args.current:
        current_projections_path = DATA_DIR / "current_projections.csv"
        existing_projection_bytes = current_projections_path.read_bytes() if current_projections_path.exists() else None
        projections = scrape_current_projections(current_projections_path, args.season_year, args.positions)
        if len(projections) < MIN_CURRENT_PROJECTION_ROWS:
            if existing_projection_bytes:
                current_projections_path.write_bytes(existing_projection_bytes)
                print(
                    f"WARNING: FantasyPros projections returned only {len(projections):,} rows; "
                    f"keeping existing {current_projections_path}"
                )
                outputs["current_projections_stale"] = True
                outputs["current_projections_error"] = f"Only {len(projections):,} rows returned"
            else:
                raise RuntimeError(f"FantasyPros projections returned only {len(projections):,} rows")
        else:
            outputs["current_projections_stale"] = False
        outputs["current_projections"] = "data/current_projections.csv"
        outputs["season_year"] = args.season_year
        if not args.skip_current_adp:
            current_adp_path = DATA_DIR / "current_adp.csv"
            try:
                scrape_adp(args.adp_scoring, current_adp_path, args.season_year)
                outputs["current_adp"] = "data/current_adp.csv"
                outputs["current_adp_stale"] = False
                outputs["adp_scoring"] = args.adp_scoring
            except Exception as exc:
                if current_adp_path.exists():
                    print(f"WARNING: FantasyPros ADP scrape failed; keeping existing {current_adp_path}: {exc}")
                    outputs["current_adp"] = "data/current_adp.csv"
                    outputs["current_adp_stale"] = True
                    outputs["current_adp_error"] = str(exc)
                    outputs["adp_scoring"] = args.adp_scoring
                else:
                    raise

    if args.current_weekly:
        output = DATA_DIR / "current_weekly_stats.csv"
        week_last = args.week_last if args.week_last is not None else infer_completed_week(args.season_year)
        current_weekly = scrape_current_weekly(args.season_year, week_last, output, args.positions)
        outputs["current_weekly_stats"] = f"data/{output.name}"
        outputs["current_weekly_stats_rows"] = int(len(current_weekly))
        outputs["current_weekly_week_last"] = int(week_last)
        outputs["season_year"] = args.season_year

    if args.historical:
        output = DATA_DIR / f"fantasypros_weekly_{args.start_year}_{args.end_year}.csv"
        scrape_historical_weekly(args.start_year, args.end_year, output, args.positions)
        outputs["historical_weekly"] = f"data/{output.name}"
        outputs["historical_start_year"] = args.start_year
        outputs["historical_end_year"] = args.end_year

    if args.historical_adp:
        output = DATA_DIR / "historical_adp.csv"
        historical_adp = scrape_historical_adp(args.start_year, args.end_year, output, args.historical_adp_scoring)
        if not historical_adp.empty:
            outputs["historical_adp"] = f"data/{output.name}"
            outputs["historical_adp_rows"] = int(len(historical_adp))
            outputs["historical_adp_start_year"] = args.start_year
            outputs["historical_adp_end_year"] = args.end_year
            outputs["historical_adp_scoring"] = list(args.historical_adp_scoring)

    if outputs:
        write_manifest(**outputs)


if __name__ == "__main__":
    main()
