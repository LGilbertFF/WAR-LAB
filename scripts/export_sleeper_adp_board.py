import argparse
import gzip
import json
from pathlib import Path

import pandas as pd


ROOT = Path(
    r"C:\Users\lgilb\fantasyfootball\sleeper_dynasty_adp\scripts_or_notebooks"
    r"\sleeper_dynasty_adp\data"
)
DEFAULT_RAW = ROOT / "raw"
DEFAULT_PLAYERS = ROOT / "cache" / "players_nfl.parquet"
DEFAULT_OUT = Path("data/custom_adp_board.csv")
DEFAULT_SHARD_DIR = Path("data/adp")
DEFAULT_SHARD_MANIFEST = DEFAULT_SHARD_DIR / "manifest.json"

PLAYER_POSITIONS = ["QB", "RB", "WR", "TE"]
KEEP_DRAFT_TYPES = ["snake", "linear"]
KEEP_TEAMS = list(range(4, 33))


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


def first_existing_column(df: pd.DataFrame, cols: list[str], default=None) -> pd.Series:
    for col in cols:
        if col in df.columns:
            return df[col]
    return pd.Series(default, index=df.index)


def ensure_column(df: pd.DataFrame, target: str, sources: list[str], default=None) -> None:
    if target in df.columns:
        return
    df[target] = first_existing_column(df, sources, default)


def normalize_draft_columns(drafts: pd.DataFrame, season: int) -> pd.DataFrame:
    drafts = drafts.copy()
    ensure_column(drafts, "draft_status", ["status"], "unknown")
    ensure_column(drafts, "type", ["draft_type"], "")
    ensure_column(drafts, "st_teams", ["settings.teams", "metadata.teams"], 0)
    ensure_column(drafts, "st_rounds", ["settings.rounds", "metadata.rounds"], 0)
    ensure_column(drafts, "st_slots_qb", ["settings.slots_qb"], 0)
    ensure_column(drafts, "st_slots_rb", ["settings.slots_rb"], 0)
    ensure_column(drafts, "st_slots_wr", ["settings.slots_wr"], 0)
    ensure_column(drafts, "st_slots_te", ["settings.slots_te"], 0)
    ensure_column(drafts, "st_slots_flex", ["settings.slots_flex"], 0)
    ensure_column(drafts, "st_slots_super_flex", ["settings.slots_super_flex"], 0)
    ensure_column(drafts, "md_scoring_type", ["metadata.scoring_type", "metadata.scoring"], "")
    ensure_column(drafts, "bestball", ["metadata.best_ball", "settings.best_ball", "metadata.bestball", "settings.bestball"], False)
    ensure_column(drafts, "start_time", ["created", "last_picked"], pd.NA)
    ensure_column(drafts, "season", ["season"], season)

    drafts["st_teams"] = numeric_column(drafts, "st_teams", 0).astype(int)
    drafts["st_rounds"] = numeric_column(drafts, "st_rounds", 0).astype(int)
    for col in ["st_slots_qb", "st_slots_rb", "st_slots_wr", "st_slots_te", "st_slots_flex", "st_slots_super_flex"]:
        drafts[col] = numeric_column(drafts, col, 0).astype(int)
    return drafts


def draft_class(row: pd.Series) -> str:
    league_format = row.get("league_format")
    rounds = row.get("st_rounds")
    if league_format == "dynasty" and pd.notna(rounds) and rounds <= 8:
        return "rookie"
    if league_format == "dynasty":
        return "startup"
    return "redraft"


def rookie_pick_label(pick_no: pd.Series, teams: pd.Series) -> pd.Series:
    pick_no = pd.to_numeric(pick_no, errors="coerce").fillna(0).astype(int)
    teams = pd.to_numeric(teams, errors="coerce").fillna(12).astype(int).clip(lower=1)
    rookie_round = ((pick_no - 1) // teams) + 1
    rookie_slot = ((pick_no - 1) % teams) + 1
    return rookie_round.astype(str) + "." + rookie_slot.astype(str).str.zfill(2)


def rookie_for_season_mask(years_exp: pd.Series, season: pd.Series | int) -> pd.Series:
    current_year = pd.Timestamp.utcnow().year
    exp = pd.to_numeric(years_exp, errors="coerce").fillna(99)
    season_values = pd.to_numeric(season, errors="coerce").fillna(current_year)
    return exp.le((current_year - season_values).clip(lower=0))


def age_for_season_mask(age: pd.Series, season: pd.Series | int, max_rookie_age: int = 26) -> pd.Series:
    current_year = pd.Timestamp.utcnow().year
    current_age = pd.to_numeric(age, errors="coerce")
    season_values = pd.to_numeric(season, errors="coerce").fillna(current_year)
    season_age = current_age - (current_year - season_values)
    return season_age.le(max_rookie_age) | current_age.isna()


def drop_repeat_rookie_board_players(df: pd.DataFrame, initial_seen_player_ids: set[str] | None = None) -> pd.DataFrame:
    if df.empty or not {"season", "player_id", "board_class", "position"}.issubset(df.columns):
        return df
    out = df.copy()
    seen_player_ids: set[str] = set(initial_seen_player_ids or set())
    drop_indexes = []
    for season in sorted(pd.to_numeric(out["season"], errors="coerce").dropna().astype(int).unique()):
        season_mask = pd.to_numeric(out["season"], errors="coerce").eq(season)
        rookie_mask = (
            season_mask
            & out["board_class"].astype(str).eq("rookie")
            & out["position"].astype(str).isin(PLAYER_POSITIONS)
        )
        repeat_mask = rookie_mask & out["player_id"].astype(str).isin(seen_player_ids)
        drop_indexes.extend(out.index[repeat_mask].tolist())
        season_players = out.loc[
            season_mask & out["position"].astype(str).isin(PLAYER_POSITIONS),
            "player_id",
        ].dropna().astype(str)
        seen_player_ids.update(season_players)
    if drop_indexes:
        print(f"dropped {len(drop_indexes):,} repeat-player rows from later dynasty rookie boards")
        out = out.drop(index=drop_indexes)
    return out


def read_shard_records(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return []


def prior_shard_player_ids(manifest_path: Path | None, seasons: list[int]) -> set[str]:
    if not manifest_path or not manifest_path.exists() or not seasons:
        return set()
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    first_season = min(seasons)
    player_ids: set[str] = set()
    for entry in manifest.get("shards", []):
        if int(entry.get("season") or 0) >= first_season:
            continue
        path = Path(entry.get("path", ""))
        if not path.is_absolute() and len(path.parts) == 1:
            path = manifest_path.parent / path
        for row in read_shard_records(path):
            if str(row.get("position") or "") in PLAYER_POSITIONS and row.get("player_id"):
                player_ids.add(str(row["player_id"]))
    return player_ids


def read_season(raw_dir: Path, players_path: Path, season: int) -> pd.DataFrame:
    drafts_path = raw_dir / "drafts" / f"drafts_{season}.parquet"
    picks_path = raw_dir / "picks" / f"picks_{season}.parquet"
    leagues_path = raw_dir / "leagues" / f"leagues_{season}.parquet"

    drafts = normalize_draft_columns(pd.read_parquet(drafts_path), season)
    picks = pd.read_parquet(picks_path)
    players = pd.read_parquet(players_path)
    leagues = pd.read_parquet(leagues_path) if leagues_path.exists() else pd.DataFrame()

    drafts = drafts[drafts["draft_status"].astype(str).str.lower().eq("complete")].copy()
    drafts = drafts[drafts["type"].isin(KEEP_DRAFT_TYPES)].copy()
    drafts = drafts[drafts["st_teams"].isin(KEEP_TEAMS)].copy()
    drafts = drafts[drafts["st_rounds"].between(1, 60)].copy()

    drafts["start_dt"] = safe_ms_datetime(drafts["start_time"])
    drafts = drafts[drafts["start_dt"].notna()].copy()
    drafts["start_date"] = drafts["start_dt"].dt.strftime("%Y-%m-%d")
    drafts["league_format"] = drafts["md_scoring_type"].astype(str).str.startswith("dynasty").map(
        {True: "dynasty", False: "redraft"}
    )
    drafts["board_class"] = drafts.apply(draft_class, axis=1)
    drafts["scoring_bucket"] = drafts["md_scoring_type"].map(scoring_bucket)
    drafts["bestball"] = drafts["bestball"].astype(str).str.lower().isin(["true", "1", "yes"])
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

    player_cols = [col for col in ["player_id", "full_name", "position", "team", "age", "years_exp", "status", "active"] if col in players.columns]
    players = players[player_cols].copy()
    players["player_id"] = players["player_id"].astype(str)
    for col in ["status", "active"]:
        if col not in players.columns:
            players[col] = pd.NA
    if "team" in players.columns:
        players["team"] = players["team"].replace("", pd.NA)

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
        "bestball",
        *defaults.keys(),
    ]
    merged = picks.merge(drafts[draft_cols], on="draft_id", how="inner")
    is_early_kicker_placeholder = (
        (merged["league_format"] == "dynasty")
        & (merged["board_class"] == "startup")
        & (merged["md_pos"] == "K")
        & (pd.to_numeric(merged["round"], errors="coerce") < 4)
    )
    placeholder_rows = merged.loc[is_early_kicker_placeholder].copy().sort_values(["draft_id", "pick_no"])
    placeholder_rank = placeholder_rows.groupby("draft_id").cumcount() + 1
    labels = rookie_pick_label(placeholder_rank, placeholder_rows["st_teams"])
    merged.loc[placeholder_rows.index, "player_id"] = "ROOKIE_PICK_" + labels.to_numpy()
    merged.loc[placeholder_rows.index, "md_first_name"] = "Rookie Pick"
    merged.loc[placeholder_rows.index, "md_last_name"] = labels.to_numpy()
    merged.loc[placeholder_rows.index, "md_team"] = "PICK"
    merged.loc[placeholder_rows.index, "md_pos"] = "RDP"

    merged = merged[merged["md_pos"].isin(PLAYER_POSITIONS + ["RDP"])].copy()
    merged["md_team"] = merged["md_team"].replace("", pd.NA)
    merged = merged.merge(players, on="player_id", how="left")
    merged["full_name"] = merged["full_name"].fillna(
        (merged["md_first_name"].fillna("") + " " + merged["md_last_name"].fillna("")).str.strip()
    )
    merged["position"] = merged["position"].fillna(merged["md_pos"])
    merged["team"] = merged["team"].fillna(merged["md_team"])
    rdp_mask = merged["md_pos"] == "RDP"
    rdp_labels = merged.loc[rdp_mask, "player_id"].str.replace("ROOKIE_PICK_", "", regex=False)
    merged.loc[rdp_mask, "full_name"] = "Rookie Pick " + rdp_labels
    merged.loc[rdp_mask, "position"] = "RDP"
    merged.loc[rdp_mask, "team"] = "PICK"
    merged.loc[rdp_mask, "status"] = ""
    merged.loc[rdp_mask, "active"] = ""
    player_team = (
        merged[merged["team"].notna()]
        .groupby("player_id")["team"]
        .agg(lambda teams: teams.mode().iloc[0] if not teams.mode().empty else teams.iloc[0])
    )
    merged["team"] = merged["team"].fillna(merged["player_id"].map(player_team)).fillna("FA")
    merged["headshot_url"] = "https://sleepercdn.com/content/nfl/players/" + merged["player_id"].astype(str) + ".jpg"
    merged.loc[rdp_mask, "headshot_url"] = ""

    years_exp = pd.to_numeric(merged.get("years_exp", 99), errors="coerce").fillna(99)
    rookie_for_draft_season = (
        rookie_for_season_mask(years_exp, merged["season"])
        & age_for_season_mask(merged.get("age", pd.Series(pd.NA, index=merged.index)), merged["season"])
    )
    rookie_board_mask = (merged["league_format"] == "dynasty") & (merged["board_class"] == "rookie")
    rookie_veteran_rows = int((rookie_board_mask & ~rookie_for_draft_season).sum())
    if rookie_veteran_rows:
        print(f"season {season}: dropped {rookie_veteran_rows:,} veteran/player rows from dynasty rookie boards")
    merged = merged[~rookie_board_mask | rookie_for_draft_season].copy()

    rookie_player_mask = (
        (merged["league_format"] == "dynasty")
        & (merged["board_class"] == "startup")
        & (merged["position"] != "RDP")
        & rookie_for_draft_season
    )
    rookie_pick_mask = (merged["league_format"] == "dynasty") & (merged["board_class"] == "startup") & (merged["position"] == "RDP")
    draft_flags = (
        pd.DataFrame({
            "draft_id": merged["draft_id"],
            "has_rookie_players": rookie_player_mask,
            "has_rookie_picks": rookie_pick_mask,
        })
        .groupby("draft_id", dropna=False)
        .agg(has_rookie_players=("has_rookie_players", "max"), has_rookie_picks=("has_rookie_picks", "max"))
        .reset_index()
    )
    for col in ["has_rookie_players", "has_rookie_picks"]:
        draft_flags[col] = draft_flags[col].fillna(False).astype(bool)
    draft_flags["rookie_inclusion"] = "neither"
    draft_flags.loc[draft_flags["has_rookie_players"] & ~draft_flags["has_rookie_picks"], "rookie_inclusion"] = "rookie players"
    draft_flags.loc[~draft_flags["has_rookie_players"] & draft_flags["has_rookie_picks"], "rookie_inclusion"] = "rookie picks"
    draft_flags.loc[draft_flags["has_rookie_players"] & draft_flags["has_rookie_picks"], "rookie_inclusion"] = "rookies + picks"
    merged = merged.merge(draft_flags[["draft_id", "rookie_inclusion"]], on="draft_id", how="left")
    merged["rookie_inclusion"] = merged["rookie_inclusion"].fillna("n/a")
    merged.loc[merged["league_format"] != "dynasty", "rookie_inclusion"] = "n/a"
    merged.loc[(merged["league_format"] == "dynasty") & (merged["board_class"] == "rookie"), "rookie_inclusion"] = "rookie draft"

    group_cols = [
        "season",
        "start_date",
        "player_id",
        "full_name",
        "position",
        "team",
        "headshot_url",
        "status",
        "active",
        "league_format",
        "board_class",
        "rookie_inclusion",
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
        "bestball",
        *defaults.keys(),
    ]
    draft_group_cols = [col for col in group_cols if col != "player_id"]
    draft_counts = (
        merged.groupby(draft_group_cols, dropna=False)
        .agg(sample_drafts=("draft_id", "nunique"))
        .reset_index()
    )

    out = (
        merged.groupby(group_cols, dropna=False)
        .agg(drafts=("draft_id", "nunique"), picks=("pick_no", "size"), adp=("pick_no", "mean"), min_pick=("pick_no", "min"), max_pick=("pick_no", "max"))
        .reset_index()
    )
    out = out.merge(draft_counts, on=draft_group_cols, how="left")
    out = out[out["drafts"] >= 2].copy()
    return out


def season_range(season: int | None, start_season: int | None, end_season: int | None) -> list[int]:
    if start_season is None and end_season is None:
        return [season or 2026]
    start = start_season if start_season is not None else end_season
    end = end_season if end_season is not None else start_season
    if start is None or end is None:
        return [season or 2026]
    if start > end:
        start, end = end, start
    return list(range(start, end + 1))


def fair_limit_rows(df: pd.DataFrame, max_rows: int) -> pd.DataFrame:
    if max_rows <= 0 or len(df) <= max_rows:
        return df

    group_cols = [col for col in ["season", "league_format", "board_class", "type"] if col in df.columns]
    if not group_cols:
        return df.sort_values(["drafts", "picks"], ascending=False).head(max_rows)

    keys = df[group_cols].fillna("unknown").astype(str).agg("|".join, axis=1)
    groups = list(keys.drop_duplicates())
    quota = max(1, max_rows // max(1, len(groups)))
    parts = []
    remainder = []
    for key in groups:
        group = df.loc[keys == key].sort_values(["drafts", "picks", "adp"], ascending=[False, False, True])
        parts.append(group.head(quota))
        if len(group) > quota:
            remainder.append(group.iloc[quota:])

    limited = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=df.columns)
    remaining_slots = max_rows - len(limited)
    if remaining_slots > 0 and remainder:
        extra = (
            pd.concat(remainder, ignore_index=True)
            .sort_values(["drafts", "picks", "adp"], ascending=[False, False, True])
            .head(remaining_slots)
        )
        limited = pd.concat([limited, extra], ignore_index=True)
    return limited


def sort_output(df: pd.DataFrame) -> pd.DataFrame:
    sort_cols = [
        "season",
        "start_date",
        "league_format",
        "board_class",
        "type",
        "md_scoring_type",
        "st_teams",
        "st_rounds",
        "adp",
    ]
    return df.sort_values([col for col in sort_cols if col in df.columns])


def dedupe_rows(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in ["player_id", "league_format", "board_class", "rookie_inclusion", "type", "md_scoring_type", "is_superflex", "bestball"]:
        if col in df.columns:
            df[col] = df[col].astype(str)
    dedupe_cols = [col for col in [
        "season", "start_date", "player_id", "league_format", "board_class", "rookie_inclusion",
        "type", "md_scoring_type", "st_teams", "st_rounds", "slots_qb", "slots_rb",
        "slots_wr", "slots_te", "slots_flex", "slots_superflex", "is_superflex", "bestball"
    ] if col in df.columns]
    return df.drop_duplicates(subset=dedupe_cols, keep="last") if dedupe_cols else df


def fit_csv_size(df: pd.DataFrame, max_output_mb: float) -> tuple[pd.DataFrame, str]:
    if max_output_mb <= 0:
        return df, df.to_csv(index=False)

    max_bytes = int(max_output_mb * 1024 * 1024)
    current = df
    while True:
        csv_text = current.to_csv(index=False)
        size = len(csv_text.encode("utf-8"))
        if size <= max_bytes or len(current) <= 1:
            return current, csv_text

        ratio = max_bytes / max(1, size)
        target_rows = max(1, int(len(current) * ratio * 0.97))
        if target_rows >= len(current):
            target_rows = len(current) - 1
        print(
            f"CSV is {size / 1024 / 1024:.2f} MB; trimming from {len(current):,} to {target_rows:,} rows "
            f"to stay under {max_output_mb:.1f} MB"
        )
        current = sort_output(fair_limit_rows(current, target_rows))


def shard_name(season, league_format: str) -> str:
    safe_format = str(league_format or "unknown").replace("/", "-").replace("\\", "-")
    return f"{int(season)}-{safe_format}.json.gz"


def read_json_gz(path: Path) -> pd.DataFrame:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        data = json.load(handle)
    return pd.DataFrame(data)


def write_json_gz(path: Path, df: pd.DataFrame) -> int:
    records = json.loads(df.to_json(orient="records", date_format="iso"))
    payload = json.dumps(records, separators=(",", ":")).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=9) as handle:
        handle.write(payload)
    return path.stat().st_size


def write_shards(out: pd.DataFrame, shard_dir: Path, manifest_path: Path, max_output_mb: float, merge_existing: bool) -> dict:
    shard_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for (season, league_format), shard in out.groupby(["season", "league_format"], dropna=False):
        rel_path = shard_name(season, league_format)
        path = shard_dir / rel_path
        shard = sort_output(shard.copy())
        if merge_existing and path.exists():
            existing = read_json_gz(path)
            shard = dedupe_rows(pd.concat([existing, shard], ignore_index=True))
            shard = sort_output(shard)
        shard, _ = fit_csv_size(shard, max_output_mb)
        size = write_json_gz(path, shard)
        draft_group_cols = [
            col for col in [
                "season", "start_date", "league_format", "board_class", "rookie_inclusion", "type",
                "md_scoring_type", "st_teams", "st_rounds", "slots_qb", "slots_rb", "slots_wr",
                "slots_te", "slots_flex", "slots_superflex", "is_superflex", "bestball"
            ] if col in shard.columns
        ]
        if draft_group_cols and "sample_drafts" in shard.columns:
            draft_groups = shard.groupby(draft_group_cols, dropna=False).agg(
                sample_drafts=("sample_drafts", "max"),
                player_drafts=("drafts", "max"),
            )
            draft_values = draft_groups["sample_drafts"].where(
                draft_groups["sample_drafts"].gt(0),
                draft_groups["player_drafts"],
            )
            draft_total = int(draft_values.sum())
        else:
            draft_total = int(shard.get("drafts", pd.Series(dtype=int)).sum())
        entries.append({
            "season": int(season),
            "league_format": str(league_format),
            "path": f"{shard_dir.as_posix().rstrip('/')}/{rel_path}",
            "rows": int(len(shard)),
            "players": int(shard["player_id"].nunique()) if "player_id" in shard.columns else 0,
            "drafts": draft_total,
            "start_date": str(shard["start_date"].min()) if "start_date" in shard.columns and len(shard) else "",
            "end_date": str(shard["start_date"].max()) if "start_date" in shard.columns and len(shard) else "",
            "bytes": int(size),
        })

    existing_entries = []
    if manifest_path.exists():
        try:
            existing_entries = json.loads(manifest_path.read_text(encoding="utf-8")).get("shards", [])
        except Exception:
            existing_entries = []
    replaced = {(entry["season"], entry["league_format"]) for entry in entries}
    kept = [entry for entry in existing_entries if (entry.get("season"), entry.get("league_format")) not in replaced]
    manifest = {
        "version": 1,
        "updated_at": pd.Timestamp.utcnow().isoformat(),
        "shards": sorted(kept + entries, key=lambda item: (item["season"], item["league_format"])),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def export_adp_board(
    raw_dir: Path,
    players_path: Path,
    out_path: Path,
    seasons: list[int],
    append_existing: bool = False,
    max_output_rows: int = 0,
    replace_start_date: str = "",
    replace_end_date: str = "",
    merge_existing: bool = False,
    max_output_mb: float = 0,
    shard_dir: Path | None = None,
    shard_manifest: Path | None = None,
    skip_csv: bool = False,
) -> pd.DataFrame:
    frames = []
    for season in seasons:
        try:
            frames.append(read_season(raw_dir, players_path, season))
        except FileNotFoundError as exc:
            print(f"skipping season {season}: {exc}")
    if not frames:
        raise RuntimeError(f"No raw Sleeper ADP data found for seasons: {', '.join(map(str, seasons))}")

    out = pd.concat(frames, ignore_index=True)

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

    int_cols = ["season", "st_teams", "st_rounds", "drafts", "sample_drafts", "picks", "min_pick", "max_pick"]
    slot_cols = ["slots_qb", "slots_rb", "slots_wr", "slots_te", "slots_flex", "slots_superflex"]
    for col in int_cols + slot_cols:
        out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0).astype(int)
    out["adp"] = pd.to_numeric(out["adp"], errors="coerce").round(2)
    out["is_superflex"] = out["is_superflex"].astype(str).str.lower()
    if "bestball" in out.columns:
        out["bestball"] = out["bestball"].astype(str).str.lower()
    out = drop_repeat_rookie_board_players(out, prior_shard_player_ids(shard_manifest, seasons))

    cols = [
        "season",
        "start_date",
        "player_id",
        "full_name",
        "position",
        "team",
        "headshot_url",
        "status",
        "active",
        "league_format",
        "board_class",
        "rookie_inclusion",
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
        "bestball",
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
        "sample_drafts",
        "picks",
        "adp",
        "min_pick",
        "max_pick",
    ]
    out = out[[col for col in cols if col in out.columns]]

    if append_existing and out_path.exists():
        existing = pd.read_csv(out_path)
        if "season" in existing.columns:
            if not merge_existing:
                refresh_seasons = set(pd.to_numeric(out["season"], errors="coerce").dropna().astype(int).tolist())
                existing_season = pd.to_numeric(existing["season"], errors="coerce").isin(refresh_seasons)
                replace_mask = existing_season
                if replace_start_date or replace_end_date:
                    existing_dates = pd.to_datetime(existing.get("start_date"), errors="coerce")
                    replace_mask = existing_season
                    if replace_start_date:
                        replace_mask &= existing_dates.ge(pd.Timestamp(replace_start_date))
                    if replace_end_date:
                        replace_mask &= existing_dates.le(pd.Timestamp(replace_end_date))
                existing = existing[~replace_mask].copy()
            out = pd.concat([existing, out], ignore_index=True)
            out = dedupe_rows(out)

    out = fair_limit_rows(out, max_output_rows)

    out = sort_output(out)
    if shard_dir:
        write_shards(out, shard_dir, shard_manifest or shard_dir / "manifest.json", max_output_mb, merge_existing)
    if not skip_csv:
        out, csv_text = fit_csv_size(out, max_output_mb)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(csv_text, encoding="utf-8")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Export compact current-season Sleeper ADP data for the WAR Lab ADP tab.")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--players", type=Path, default=DEFAULT_PLAYERS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--start-season", type=int)
    parser.add_argument("--end-season", type=int)
    parser.add_argument("--append-existing", action="store_true", help="Keep other seasons already in the output CSV.")
    parser.add_argument("--max-output-rows", type=int, default=0, help="Fairly cap rows across season and league-type groups.")
    parser.add_argument("--replace-start-date", default="", help="When appending, replace only existing rows on/after this draft date.")
    parser.add_argument("--replace-end-date", default="", help="When appending, replace only existing rows on/before this draft date.")
    parser.add_argument("--merge-existing", action="store_true", help="Append/merge new rows without replacing existing season rows.")
    parser.add_argument("--max-output-mb", type=float, default=0, help="Trim rows fairly until the output CSV stays below this many MB; 0 disables.")
    parser.add_argument("--shard-dir", type=Path, help="Write browser-ready gzip JSON shards into this directory.")
    parser.add_argument("--shard-manifest", type=Path, help="Path to the shard manifest JSON.")
    parser.add_argument("--skip-csv", action="store_true", help="Write shards only and leave the legacy CSV untouched.")
    args = parser.parse_args()

    seasons = season_range(args.season, args.start_season, args.end_season)
    out = export_adp_board(
        args.raw_dir,
        args.players,
        args.out,
        seasons,
        append_existing=args.append_existing,
        max_output_rows=args.max_output_rows,
        replace_start_date=args.replace_start_date,
        replace_end_date=args.replace_end_date,
        merge_existing=args.merge_existing,
        max_output_mb=args.max_output_mb,
        shard_dir=args.shard_dir,
        shard_manifest=args.shard_manifest,
        skip_csv=args.skip_csv,
    )
    print(f"wrote {args.out} rows={len(out):,} cols={len(out.columns)}")


if __name__ == "__main__":
    main()
