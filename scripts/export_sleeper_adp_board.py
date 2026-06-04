import argparse
from pathlib import Path

import pandas as pd


ROOT = Path(
    r"C:\Users\lgilb\fantasyfootball\sleeper_dynasty_adp\scripts_or_notebooks"
    r"\sleeper_dynasty_adp\data"
)
DEFAULT_RAW = ROOT / "raw"
DEFAULT_PLAYERS = ROOT / "cache" / "players_nfl.parquet"
DEFAULT_OUT = Path("data/custom_adp_board.csv")

PLAYER_POSITIONS = ["QB", "RB", "WR", "TE", "K"]
KEEP_DRAFT_TYPES = ["snake", "linear"]
KEEP_TEAMS = [8, 10, 12, 14, 16]


def safe_ms_datetime(ms: pd.Series) -> pd.Series:
    values = pd.to_numeric(ms, errors="coerce")
    lower = pd.Timestamp("2010-01-01", tz="UTC").value // 1_000_000
    upper = pd.Timestamp("2036-12-31", tz="UTC").value // 1_000_000
    values = values.mask((values < lower) | (values > upper))
    return pd.to_datetime(values, unit="ms", utc=True, errors="coerce")


def scoring_bucket(scoring_type: str) -> str:
    scoring_type = str(scoring_type or "").lower()
    if "half" in scoring_type:
        return "half_ppr"
    if "std" in scoring_type:
        return "standard"
    if "ppr" in scoring_type or "2qb" in scoring_type or "idp" in scoring_type:
        return "ppr"
    return "custom"


def numeric_column(df: pd.DataFrame, col: str, default=0) -> pd.Series:
    if col not in df.columns:
        return pd.Series(default, index=df.index)
    return pd.to_numeric(df[col], errors="coerce").fillna(default)


def draft_class(row: pd.Series) -> str:
    league_format = row.get("league_format")
    rounds = row.get("st_rounds")
    if league_format == "dynasty" and pd.notna(rounds) and rounds <= 8:
        return "rookie"
    if league_format == "dynasty":
        return "startup"
    return "redraft"


def read_season(raw_dir: Path, players_path: Path, season: int) -> pd.DataFrame:
    drafts_path = raw_dir / "drafts" / f"drafts_{season}.parquet"
    picks_path = raw_dir / "picks" / f"picks_{season}.parquet"
    leagues_path = raw_dir / "leagues" / f"leagues_{season}.parquet"

    drafts = pd.read_parquet(drafts_path)
    picks = pd.read_parquet(picks_path)
    players = pd.read_parquet(players_path)
    leagues = pd.read_parquet(leagues_path) if leagues_path.exists() else pd.DataFrame()

    drafts = drafts[drafts["draft_status"].astype(str).str.lower().eq("complete")].copy()
    drafts = drafts[drafts["type"].isin(KEEP_DRAFT_TYPES)].copy()
    drafts = drafts[drafts["st_teams"].isin(KEEP_TEAMS)].copy()
    drafts = drafts[drafts["st_rounds"].between(4, 35)].copy()

    drafts["start_dt"] = safe_ms_datetime(drafts["start_time"])
    drafts = drafts[drafts["start_dt"].notna()].copy()
    drafts["start_date"] = drafts["start_dt"].dt.strftime("%Y-%m-%d")
    drafts["league_format"] = drafts["md_scoring_type"].astype(str).str.startswith("dynasty").map(
        {True: "dynasty", False: "redraft"}
    )
    drafts["board_class"] = drafts.apply(draft_class, axis=1)
    drafts["scoring_bucket"] = drafts["md_scoring_type"].map(scoring_bucket)
    drafts["is_superflex"] = (
        numeric_column(drafts, "st_slots_super_flex", 0).gt(0)
        | drafts["md_scoring_type"].astype(str).str.contains("2qb|superflex", case=False, na=False)
    )

    for col in ["league_id", "draft_id"]:
        if col in drafts.columns:
            drafts[col] = drafts[col].astype(str)
    picks["draft_id"] = picks["draft_id"].astype(str)
    picks["player_id"] = picks["player_id"].astype(str)

    scoring_cols = [
        "league_id",
        "scoring_settings.rec",
        "scoring_settings.bonus_rec_te",
        "scoring_settings.rec_yd",
        "scoring_settings.rec_td",
        "scoring_settings.rush_yd",
        "scoring_settings.rush_td",
        "scoring_settings.pass_yd",
        "scoring_settings.pass_td",
        "scoring_settings.pass_int",
        "scoring_settings.fum_lost",
    ]
    scoring_cols = [col for col in scoring_cols if col in leagues.columns]
    if scoring_cols and "league_id" in drafts.columns:
        league_scoring = leagues[scoring_cols].copy()
        league_scoring["league_id"] = league_scoring["league_id"].astype(str)
        drafts = drafts.merge(league_scoring, on="league_id", how="left")

    defaults = {
        "scoring_settings.rec": 1,
        "scoring_settings.bonus_rec_te": 0,
        "scoring_settings.rec_yd": 0.1,
        "scoring_settings.rec_td": 6,
        "scoring_settings.rush_yd": 0.1,
        "scoring_settings.rush_td": 6,
        "scoring_settings.pass_yd": 0.04,
        "scoring_settings.pass_td": 4,
        "scoring_settings.pass_int": -2,
        "scoring_settings.fum_lost": -2,
    }
    for col, default in defaults.items():
        drafts[col] = numeric_column(drafts, col, default).round(3)

    player_cols = [col for col in ["player_id", "full_name", "position", "team", "age", "years_exp"] if col in players.columns]
    players = players[player_cols].copy()
    players["player_id"] = players["player_id"].astype(str)

    draft_cols = [
        "draft_id",
        "season",
        "start_date",
        "type",
        "md_scoring_type",
        "scoring_bucket",
        "league_format",
        "board_class",
        "st_teams",
        "st_rounds",
        "st_slots_qb",
        "st_slots_rb",
        "st_slots_wr",
        "st_slots_te",
        "st_slots_flex",
        "st_slots_super_flex",
        "is_superflex",
        *defaults.keys(),
    ]
    merged = picks.merge(drafts[draft_cols], on="draft_id", how="inner")
    merged = merged[merged["md_pos"].isin(PLAYER_POSITIONS)].copy()
    merged = merged.merge(players, on="player_id", how="left")
    merged["full_name"] = merged["full_name"].fillna(
        (merged["md_first_name"].fillna("") + " " + merged["md_last_name"].fillna("")).str.strip()
    )
    merged["position"] = merged["position"].fillna(merged["md_pos"])
    merged["team"] = merged["team"].fillna(merged["md_team"])
    merged["headshot_url"] = "https://sleepercdn.com/content/nfl/players/" + merged["player_id"].astype(str) + ".jpg"

    group_cols = [
        "season",
        "start_date",
        "player_id",
        "full_name",
        "position",
        "team",
        "headshot_url",
        "league_format",
        "board_class",
        "type",
        "md_scoring_type",
        "scoring_bucket",
        "st_teams",
        "st_rounds",
        "st_slots_qb",
        "st_slots_rb",
        "st_slots_wr",
        "st_slots_te",
        "st_slots_flex",
        "st_slots_super_flex",
        "is_superflex",
        *defaults.keys(),
    ]
    out = (
        merged.groupby(group_cols, dropna=False)
        .agg(drafts=("draft_id", "nunique"), picks=("pick_no", "size"), adp=("pick_no", "mean"), min_pick=("pick_no", "min"), max_pick=("pick_no", "max"))
        .reset_index()
    )
    out = out[out["drafts"] >= 2].copy()
    return out


def export_adp_board(raw_dir: Path, players_path: Path, out_path: Path, season: int) -> pd.DataFrame:
    out = read_season(raw_dir, players_path, season)

    rename = {
        "st_slots_qb": "slots_qb",
        "st_slots_rb": "slots_rb",
        "st_slots_wr": "slots_wr",
        "st_slots_te": "slots_te",
        "st_slots_flex": "slots_flex",
        "st_slots_super_flex": "slots_superflex",
        "scoring_settings.rec": "score_rec",
        "scoring_settings.bonus_rec_te": "score_te_premium",
        "scoring_settings.rec_yd": "score_rec_yd",
        "scoring_settings.rec_td": "score_rec_td",
        "scoring_settings.rush_yd": "score_rush_yd",
        "scoring_settings.rush_td": "score_rush_td",
        "scoring_settings.pass_yd": "score_pass_yd",
        "scoring_settings.pass_td": "score_pass_td",
        "scoring_settings.pass_int": "score_pass_int",
        "scoring_settings.fum_lost": "score_fum_lost",
    }
    out = out.rename(columns=rename)

    int_cols = ["season", "st_teams", "st_rounds", "drafts", "picks", "min_pick", "max_pick"]
    slot_cols = ["slots_qb", "slots_rb", "slots_wr", "slots_te", "slots_flex", "slots_superflex"]
    for col in int_cols + slot_cols:
        out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0).astype(int)
    out["adp"] = pd.to_numeric(out["adp"], errors="coerce").round(2)
    out["is_superflex"] = out["is_superflex"].astype(str).str.lower()

    cols = [
        "season",
        "start_date",
        "player_id",
        "full_name",
        "position",
        "team",
        "headshot_url",
        "league_format",
        "board_class",
        "type",
        "md_scoring_type",
        "scoring_bucket",
        "st_teams",
        "st_rounds",
        "slots_qb",
        "slots_rb",
        "slots_wr",
        "slots_te",
        "slots_flex",
        "slots_superflex",
        "is_superflex",
        "score_rec",
        "score_te_premium",
        "score_rec_yd",
        "score_rec_td",
        "score_rush_yd",
        "score_rush_td",
        "score_pass_yd",
        "score_pass_td",
        "score_pass_int",
        "score_fum_lost",
        "drafts",
        "picks",
        "adp",
        "min_pick",
        "max_pick",
    ]
    out = out[[col for col in cols if col in out.columns]].sort_values(
        ["season", "start_date", "league_format", "board_class", "type", "md_scoring_type", "st_teams", "st_rounds", "adp"]
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Export compact current-season Sleeper ADP data for the WAR Lab ADP tab.")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--players", type=Path, default=DEFAULT_PLAYERS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()

    out = export_adp_board(args.raw_dir, args.players, args.out, args.season)
    print(f"wrote {args.out} rows={len(out):,} cols={len(out.columns)}")


if __name__ == "__main__":
    main()
