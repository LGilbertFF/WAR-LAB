#!/usr/bin/env python3
"""Import a downloaded Fantasy Points season projections CSV.

The Fantasy Points export repeats generic stat headers across passing, rushing,
and receiving sections. This importer normalizes those columns into the WAR Lab
projection schema so the browser app can continue applying custom scoring.
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

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_INPUT = Path(r"C:\Users\lgilb\Downloads\2026 NFL Fantasy Football Season Rankings  Projections  Fantasy Points.csv")
OUTPUT_COLUMNS = [
    "Year", "Player", "Team", "Pos", "FPTS", "AVG", "G",
    "PassingATT", "PassingCMP", "PassingYDS", "PassingTD", "INTS",
    "RushingATT", "RushingYDS", "RushingTD",
    "TGT", "REC", "ReceivingYDS", "ReceivingTD",
]


def number(value: object, default: float | None = None) -> float | None:
    if value is None:
        return default
    text = str(value).replace(",", "").strip()
    if not text or text in {"-", "--", "nan", "NaN"}:
        return default
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else default


def series_number(df: pd.DataFrame, column: str, default: float | None = None) -> pd.Series:
    if column not in df.columns:
        return pd.Series([default] * len(df))
    return df[column].apply(lambda value: number(value, default))


def normalize_position(value: object) -> str:
    return re.sub(r"[^A-Z]", "", str(value or "").upper())


def read_fantasypoints_export(input_path: Path) -> pd.DataFrame:
    preview = pd.read_csv(input_path, header=None, nrows=5, low_memory=False)
    header_row = 0
    for index, row in preview.iterrows():
        cells = {str(value).strip().upper() for value in row.tolist()}
        if {"NAME", "FPTS"}.issubset(cells) and ("POSITION" in cells or "POS" in cells):
            header_row = int(index)
            break
    df = pd.read_csv(input_path, header=header_row, low_memory=False)
    df = df.loc[:, ~df.columns.astype(str).str.startswith("Unnamed")]
    return df


def first_existing(df: pd.DataFrame, columns: list[str]) -> str | None:
    for column in columns:
        if column in df.columns:
            return column
    return None


def import_fantasypoints_csv(input_path: Path, output_path: Path, season_year: int) -> pd.DataFrame:
    df = read_fantasypoints_export(input_path)
    player_col = first_existing(df, ["Name", "NAME"])
    team_col = first_existing(df, ["Team", "TEAM"])
    pos_col = first_existing(df, ["Position", "POSITION", "POS"])
    games_col = first_existing(df, ["G", "GP", "Games"])
    out = pd.DataFrame({
        "Year": season_year,
        "Player": df.get(player_col, pd.Series(dtype=str)).astype(str).str.strip(),
        "Team": df.get(team_col, pd.Series(dtype=str)).astype(str).str.strip(),
        "Pos": df.get(pos_col, pd.Series(dtype=str)).apply(normalize_position),
        "FPTS": series_number(df, "FPTS", None),
        "AVG": series_number(df, "FPTS/G", None),
        "G": series_number(df, games_col or "G", None),
        "PassingATT": series_number(df, "ATT", 0),
        "PassingCMP": series_number(df, "CMP", 0),
        "PassingYDS": series_number(df, "YDS", 0),
        "PassingTD": series_number(df, "TD", 0),
        "INTS": series_number(df, "INT", 0),
        "RushingATT": series_number(df, "ATT.1", 0),
        "RushingYDS": series_number(df, "YDS.1", 0),
        "RushingTD": series_number(df, "TD.1", 0),
        "TGT": series_number(df, "TGT", 0),
        "REC": series_number(df, "REC", 0),
        "ReceivingYDS": series_number(df, "YDS.2", 0),
        "ReceivingTD": series_number(df, "TD.2", 0),
    })
    out = out[out["Player"].str.len().gt(0) & out["Pos"].isin(["QB", "RB", "WR", "TE"])].copy()
    if out["AVG"].isna().any() and out["FPTS"].notna().any():
        out.loc[out["AVG"].isna(), "AVG"] = out.loc[out["AVG"].isna(), "FPTS"] / 17
    if out["FPTS"].isna().any() and out["AVG"].notna().any():
        out.loc[out["FPTS"].isna(), "FPTS"] = out.loc[out["FPTS"].isna(), "AVG"] * 17
    out = out.drop_duplicates(subset=["Year", "Player", "Pos"], keep="last")
    out = out.sort_values(["Pos", "FPTS"], ascending=[True, False], kind="stable")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    out[OUTPUT_COLUMNS].to_csv(output_path, index=False, quoting=csv.QUOTE_MINIMAL)
    return out[OUTPUT_COLUMNS]


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
        "current_projections_source": "Fantasy Points CSV",
        "current_projections_rows": rows,
        "current_projections_stale": False,
    })
    manifest.pop("current_projections_error", None)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import downloaded Fantasy Points projections into WAR Lab.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DATA_DIR / "current_projections.csv")
    parser.add_argument("--season-year", type=int, default=2026)
    parser.add_argument("--export-json", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    rows = import_fantasypoints_csv(args.input, args.output, args.season_year)
    print(f"wrote {len(rows):,} Fantasy Points projection rows to {args.output}")
    update_scrape_manifest(args, len(rows))
    if args.export_json:
        export_browser_json()
        print("exported data/war/current_projections.json.gz and updated manifests")


if __name__ == "__main__":
    main()
