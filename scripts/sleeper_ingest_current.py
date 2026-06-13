import argparse
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import requests


BASE = "https://api.sleeper.app/v1"
DEFAULT_SEED_USERS = [
    "567994319854673920",
    "332066581859282944",
    "568256222760906752",
    "387839476958965760",
    "386648007942254592",
]


def log(message: str) -> None:
    print(message, flush=True)


def chunks(items, size: int):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def read_seen_ids(path: Path, id_column: str = "draft_id") -> set[str]:
    if not path or not path.exists():
        return set()
    try:
        df = pd.read_csv(path, dtype=str)
    except Exception:
        return set()
    if id_column not in df.columns:
        return set()
    return set(df[id_column].dropna().astype(str))


def write_seen_ids(path: Path, ids, id_column: str = "draft_id") -> None:
    if not path:
        return
    existing = read_seen_ids(path, id_column)
    combined = sorted(existing | set(pd.Series(ids, dtype="object").dropna().astype(str)))
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame({id_column: combined}).to_csv(path, index=False)


def first_existing_column(df: pd.DataFrame, cols: list[str], default=None) -> pd.Series:
    for col in cols:
        if col in df.columns:
            return df[col]
    return pd.Series(default, index=df.index)


def numeric_column(df: pd.DataFrame, cols: list[str], default=0) -> pd.Series:
    return pd.to_numeric(first_existing_column(df, cols, default), errors="coerce").fillna(default)


def draft_datetime(drafts: pd.DataFrame) -> pd.Series:
    values = numeric_column(drafts, ["start_time", "created", "last_picked"], pd.NA)
    lower = pd.Timestamp("2010-01-01", tz="UTC").value // 1_000_000
    upper = pd.Timestamp("2036-12-31", tz="UTC").value // 1_000_000
    values = values.mask((values < lower) | (values > upper))
    return pd.to_datetime(values, unit="ms", utc=True, errors="coerce")


def eligible_drafts(
    drafts: pd.DataFrame,
    max_drafts: int = 0,
    draft_start_date: str = "",
    draft_end_date: str = "",
    league_format: str = "all",
) -> pd.DataFrame:
    if drafts.empty:
        return drafts
    out = drafts.copy()
    status = first_existing_column(out, ["draft_status", "status"], "").astype(str).str.lower()
    draft_type = first_existing_column(out, ["type", "draft_type"], "").astype(str).str.lower()
    teams = numeric_column(out, ["st_teams", "settings.teams", "metadata.teams"], 0)
    rounds = numeric_column(out, ["st_rounds", "settings.rounds", "metadata.rounds"], 0)
    dates = draft_datetime(out)
    scoring_type = first_existing_column(out, ["md_scoring_type", "metadata.scoring_type", "metadata.scoring"], "").astype(str)
    formats = scoring_type.str.startswith("dynasty").map({True: "dynasty", False: "redraft"})

    mask = (
        status.eq("complete")
        & draft_type.isin(["snake", "linear"])
        & teams.between(4, 32)
        & rounds.between(1, 60)
    )
    if league_format != "all":
        mask &= formats.eq(league_format)
    if draft_start_date:
        mask &= dates.ge(pd.Timestamp(draft_start_date, tz="UTC"))
    if draft_end_date:
        mask &= dates.lt(pd.Timestamp(draft_end_date, tz="UTC") + pd.Timedelta(days=1))
    out = out[mask].copy()
    if max_drafts > 0 and len(out) > max_drafts:
        scoring_type = first_existing_column(out, ["md_scoring_type", "metadata.scoring_type", "metadata.scoring"], "").astype(str)
        out["_league_format"] = scoring_type.str.startswith("dynasty").map({True: "dynasty", False: "redraft"})
        sort_col = "start_time" if "start_time" in out.columns else "created" if "created" in out.columns else None
        if sort_col:
            out = out.sort_values(sort_col, ascending=False)
        capped = []
        groups = list(out["_league_format"].dropna().unique())
        quota = max(1, max_drafts // max(1, len(groups)))
        for _format, group in out.groupby("_league_format", sort=False):
            capped.append(group.head(quota))
        selected = pd.concat(capped, ignore_index=True) if capped else out.head(0)
        if len(selected) < max_drafts:
            remaining_ids = set(selected["draft_id"].astype(str))
            extra = out[~out["draft_id"].astype(str).isin(remaining_ids)].head(max_drafts - len(selected))
            selected = pd.concat([selected, extra], ignore_index=True)
        out = selected.drop(columns=["_league_format"], errors="ignore").copy()
    scoring_type = first_existing_column(out, ["md_scoring_type", "metadata.scoring_type", "metadata.scoring"], "").astype(str)
    format_counts = scoring_type.str.startswith("dynasty").map({True: "dynasty", False: "redraft"}).value_counts().to_dict()
    log(f"eligible draft format mix after cap: {format_counts}")
    return out


def get_json(session: requests.Session, url: str, retries: int = 4):
    last_error = None
    for attempt in range(retries):
        try:
            response = session.get(url, timeout=30)
            if response.status_code == 429:
                time.sleep(min(30, 2 ** attempt))
                continue
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
            time.sleep(min(30, 1 + 2 ** attempt))
    raise RuntimeError(f"GET failed: {url}: {last_error}")


def fetch_many(session: requests.Session, urls, workers: int, label: str = "requests"):
    urls = list(urls)
    rows = []
    if not urls:
        return rows
    done = 0
    batch_size = max(250, workers * 25)
    log(f"{label}: fetching {len(urls):,} urls with {workers} workers")
    for batch_index, batch in enumerate(chunks(urls, batch_size), start=1):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(get_json, session, url): url for url in batch}
            for future in as_completed(futures):
                url = futures[future]
                try:
                    rows.append((url, future.result(), None))
                except Exception as exc:
                    rows.append((url, None, str(exc)))
                done += 1
                if done % max(100, workers * 10) == 0 or done == len(urls):
                    log(f"{label}: {done:,}/{len(urls):,} urls complete")
        if batch_index % 4 == 0:
            log(f"{label}: finished batch {batch_index:,}")
    return rows


def user_leagues_url(user_id: str, season: int) -> str:
    return f"{BASE}/user/{user_id}/leagues/nfl/{season}"


def league_users_url(league_id: str) -> str:
    return f"{BASE}/league/{league_id}/users"


def league_drafts_url(league_id: str) -> str:
    return f"{BASE}/league/{league_id}/drafts"


def draft_picks_url(draft_id: str) -> str:
    return f"{BASE}/draft/{draft_id}/picks"


def fetch_leagues_for_users(session, user_ids, season, workers):
    urls = [user_leagues_url(user_id, season) for user_id in user_ids]
    rows = []
    for url, data, err in fetch_many(session, urls, workers, f"season {season} user leagues"):
        if err or not data:
            continue
        for league in data:
            league["_season"] = season
            rows.append(league)
    if not rows:
        return pd.DataFrame()
    return pd.json_normalize(rows).drop_duplicates(subset=["league_id"])


def fetch_users_for_leagues(session, league_ids, workers):
    urls = [league_users_url(league_id) for league_id in league_ids]
    rows = []
    for url, data, err in fetch_many(session, urls, workers, "league users"):
        if err or not data:
            continue
        league_id = url.split("/league/")[1].split("/users")[0]
        for user in data:
            user["_league_id"] = league_id
            rows.append(user)
    if not rows:
        return pd.DataFrame()
    return pd.json_normalize(rows)


def discover_leagues(session, seed_users, season, workers, expansion_steps, max_users_per_step, max_leagues):
    seen_users = set(seed_users)
    frontier = list(seed_users)
    all_leagues = []
    all_users = []
    seen_leagues = set()

    for _step in range(expansion_steps + 1):
        if not frontier:
            break
        log(f"season {season}: discovery step {_step + 1}/{expansion_steps + 1}, frontier={len(frontier):,}, seen_leagues={len(seen_leagues):,}")
        leagues = fetch_leagues_for_users(session, frontier[:max_users_per_step], season, workers)
        if leagues.empty:
            break
        new_leagues = leagues[~leagues["league_id"].astype(str).isin(seen_leagues)].copy()
        if new_leagues.empty:
            break
        all_leagues.append(new_leagues)
        seen_leagues.update(new_leagues["league_id"].astype(str).tolist())
        log(f"season {season}: found {len(new_leagues):,} new leagues, total={len(seen_leagues):,}")
        if len(seen_leagues) >= max_leagues or _step >= expansion_steps:
            break

        users = fetch_users_for_leagues(session, new_leagues["league_id"].astype(str).tolist(), workers)
        if users.empty:
            break
        all_users.append(users)
        candidate_users = users.get("user_id", pd.Series(dtype="object")).dropna().astype(str).tolist()
        frontier = [user_id for user_id in candidate_users if user_id not in seen_users]
        seen_users.update(frontier)
        frontier = frontier[:max_users_per_step]

    leagues_out = pd.concat(all_leagues, ignore_index=True).drop_duplicates(subset=["league_id"]) if all_leagues else pd.DataFrame()
    users_out = pd.concat(all_users, ignore_index=True).drop_duplicates() if all_users else pd.DataFrame()
    return leagues_out, users_out


def fetch_drafts(session, league_ids, season, workers):
    urls = [league_drafts_url(league_id) for league_id in league_ids]
    rows = []
    for url, data, err in fetch_many(session, urls, workers, f"season {season} league drafts"):
        if err or not data:
            continue
        league_id = url.split("/league/")[1].split("/drafts")[0]
        for draft in data:
            settings = draft.get("settings") or {}
            metadata = draft.get("metadata") or {}
            rows.append({
                "draft_id": draft.get("draft_id"),
                "league_id": draft.get("league_id") or league_id,
                "season": draft.get("season") or str(season),
                "status": draft.get("status"),
                "type": draft.get("type"),
                "start_time": draft.get("start_time"),
                "created": draft.get("created"),
                "last_picked": draft.get("last_picked"),
                "settings.teams": settings.get("teams"),
                "settings.rounds": settings.get("rounds"),
                "settings.slots_qb": settings.get("slots_qb"),
                "settings.slots_rb": settings.get("slots_rb"),
                "settings.slots_wr": settings.get("slots_wr"),
                "settings.slots_te": settings.get("slots_te"),
                "settings.slots_flex": settings.get("slots_flex"),
                "settings.slots_super_flex": settings.get("slots_super_flex"),
                "metadata.scoring_type": metadata.get("scoring_type"),
                "metadata.best_ball": metadata.get("best_ball"),
                "settings.best_ball": settings.get("best_ball"),
            })
    if not rows:
        return pd.DataFrame()
    out = pd.DataFrame(rows)
    log(f"season {season}: normalized {len(out):,} draft rows")
    return out.drop_duplicates(subset=["draft_id"])


def fetch_picks(session, draft_ids, workers):
    urls = [draft_picks_url(draft_id) for draft_id in draft_ids]
    rows = []
    for url, data, err in fetch_many(session, urls, workers, "draft picks"):
        if err or not data:
            continue
        draft_id = url.split("/draft/")[1].split("/picks")[0]
        for pick in data:
            metadata = pick.get("metadata") or {}
            rows.append({
                "draft_id": draft_id,
                "player_id": pick.get("player_id"),
                "pick_no": pick.get("pick_no"),
                "round": pick.get("round"),
                "draft_slot": pick.get("draft_slot"),
                "is_keeper": pick.get("is_keeper"),
                "md_first_name": metadata.get("first_name"),
                "md_last_name": metadata.get("last_name"),
                "md_team": metadata.get("team"),
                "md_pos": metadata.get("position"),
                "md_amount": metadata.get("amount"),
            })
    return pd.DataFrame(rows)


def fetch_players(session):
    log("fetching Sleeper NFL players")
    data = get_json(session, f"{BASE}/players/nfl", retries=5)
    rows = []
    for player_id, player in data.items():
        rows.append({
            "player_id": str(player_id),
            "full_name": player.get("full_name") or " ".join(part for part in [player.get("first_name"), player.get("last_name")] if part),
            "first_name": player.get("first_name"),
            "last_name": player.get("last_name"),
            "position": player.get("position"),
            "team": player.get("team"),
            "years_exp": player.get("years_exp"),
            "status": player.get("status"),
            "age": player.get("age"),
        })
    return pd.DataFrame(rows)


def write_parquet(df, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)


def main():
    parser = argparse.ArgumentParser(description="Fetch current Sleeper draft data used by WAR Lab ADP export.")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--out-dir", type=Path, default=Path("sleeper_raw"))
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--expansion-steps", type=int, default=3)
    parser.add_argument("--max-users-per-step", type=int, default=2500)
    parser.add_argument("--max-leagues", type=int, default=300000)
    parser.add_argument("--max-drafts", type=int, default=500000)
    parser.add_argument("--draft-start-date", default="")
    parser.add_argument("--draft-end-date", default="")
    parser.add_argument("--league-format", choices=["all", "redraft", "dynasty"], default="all")
    parser.add_argument("--seen-leagues", type=Path)
    parser.add_argument("--seed-user", action="append", default=[])
    args = parser.parse_args()

    seed_users = args.seed_user or DEFAULT_SEED_USERS
    session = requests.Session()
    session.headers.update({"User-Agent": "WAR-LAB-Sleeper-ADP/1.0"})

    log(f"starting Sleeper ADP ingest for season {args.season}")
    players = fetch_players(session)
    leagues, league_users = discover_leagues(
        session,
        seed_users,
        args.season,
        args.workers,
        args.expansion_steps,
        args.max_users_per_step,
        args.max_leagues,
    )
    if leagues.empty:
        raise RuntimeError("No Sleeper leagues discovered.")
    log(f"season {args.season}: fetching drafts from {len(leagues):,} leagues")
    drafts = fetch_drafts(session, leagues["league_id"].astype(str).tolist(), args.season, args.workers)
    if drafts.empty:
        raise RuntimeError("No Sleeper drafts discovered.")
    eligible = eligible_drafts(drafts, args.max_drafts, args.draft_start_date, args.draft_end_date, args.league_format)
    seen_ids = read_seen_ids(args.seen_leagues) if args.seen_leagues else set()
    if seen_ids and "draft_id" in eligible.columns:
        before = len(eligible)
        eligible = eligible[~eligible["draft_id"].astype(str).isin(seen_ids)].copy()
        log(f"season {args.season}: skipped {before - len(eligible):,} previously harvested drafts, remaining={len(eligible):,}")
    log(f"season {args.season}: eligible completed snake/linear drafts={len(eligible):,}/{len(drafts):,}")
    if eligible.empty:
        raise RuntimeError("No new eligible Sleeper drafts discovered.")

    log(f"season {args.season}: fetching picks from {len(eligible):,} eligible drafts")
    picks = fetch_picks(session, eligible["draft_id"].astype(str).tolist(), args.workers)
    if picks.empty:
        raise RuntimeError("No Sleeper draft picks discovered.")

    raw = args.out_dir / "raw"
    cache = args.out_dir / "cache"
    write_parquet(leagues, raw / "leagues" / f"leagues_{args.season}.parquet")
    write_parquet(league_users, raw / "league_users" / f"league_users_{args.season}.parquet")
    write_parquet(eligible, raw / "drafts" / f"drafts_{args.season}.parquet")
    write_parquet(picks, raw / "picks" / f"picks_{args.season}.parquet")
    write_parquet(players, cache / "players_nfl.parquet")
    if args.seen_leagues and "draft_id" in eligible.columns:
        write_seen_ids(args.seen_leagues, eligible["draft_id"])
    log(f"wrote leagues={len(leagues):,} eligible_drafts={len(eligible):,} picks={len(picks):,} players={len(players):,}")


if __name__ == "__main__":
    main()
