import argparse
from pathlib import Path

import requests

from sleeper_ingest_current import (
    DEFAULT_SEED_USERS,
    discover_leagues,
    eligible_drafts,
    fetch_drafts,
    fetch_picks,
    fetch_players,
    log,
    write_parquet,
)


def bounded_years(start_season: int, end_season: int) -> list[int]:
    if start_season > end_season:
        start_season, end_season = end_season, start_season
    return list(range(start_season, end_season + 1))


def ingest_season(session, args, season: int, seed_users: list[str]) -> None:
    log(f"season {season}: discovering leagues")
    leagues, league_users = discover_leagues(
        session,
        seed_users,
        season,
        args.workers,
        args.expansion_steps,
        args.max_users_per_step,
        args.max_leagues_per_season,
    )
    if leagues.empty:
        log(f"season {season}: no leagues discovered")
        return

    log(f"season {season}: fetching drafts from {len(leagues):,} leagues")
    drafts = fetch_drafts(session, leagues["league_id"].astype(str).tolist(), season, args.workers)
    if drafts.empty:
        log(f"season {season}: no drafts discovered")
        return
    eligible = eligible_drafts(drafts, args.max_drafts_per_season)
    log(f"season {season}: eligible completed snake/linear drafts={len(eligible):,}/{len(drafts):,}")
    if eligible.empty:
        log(f"season {season}: no eligible drafts discovered")
        return

    log(f"season {season}: fetching picks from {len(eligible):,} eligible drafts")
    picks = fetch_picks(session, eligible["draft_id"].astype(str).tolist(), args.workers)
    if picks.empty:
        log(f"season {season}: no draft picks discovered")
        return

    raw = args.out_dir / "raw"
    write_parquet(leagues, raw / "leagues" / f"leagues_{season}.parquet")
    write_parquet(league_users, raw / "league_users" / f"league_users_{season}.parquet")
    write_parquet(eligible, raw / "drafts" / f"drafts_{season}.parquet")
    write_parquet(picks, raw / "picks" / f"picks_{season}.parquet")
    log(f"season {season}: wrote leagues={len(leagues):,} drafts={len(drafts):,} picks={len(picks):,}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill historical Sleeper draft data for WAR Lab ADP.")
    parser.add_argument("--start-season", type=int, default=2018)
    parser.add_argument("--end-season", type=int, default=2025)
    parser.add_argument("--out-dir", type=Path, default=Path("sleeper_work"))
    parser.add_argument("--workers", type=int, default=20)
    parser.add_argument("--expansion-steps", type=int, default=2)
    parser.add_argument("--max-users-per-step", type=int, default=2500)
    parser.add_argument("--max-leagues-per-season", type=int, default=60000)
    parser.add_argument("--max-drafts-per-season", type=int, default=25000)
    parser.add_argument("--seed-user", action="append", default=[])
    args = parser.parse_args()

    seed_users = args.seed_user or DEFAULT_SEED_USERS
    session = requests.Session()
    session.headers.update({"User-Agent": "WAR-LAB-Sleeper-Historical-ADP/1.0"})

    cache = args.out_dir / "cache"
    log(f"starting historical Sleeper ADP ingest for seasons {args.start_season}-{args.end_season}")
    write_parquet(fetch_players(session), cache / "players_nfl.parquet")

    for season in bounded_years(args.start_season, args.end_season):
        ingest_season(session, args, season, seed_users)


if __name__ == "__main__":
    main()
