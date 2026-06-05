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
        if len(seen_leagues) >= max_leagues:
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
            draft["league_id"] = draft.get("league_id") or league_id
            draft["season"] = draft.get("season") or str(season)
            rows.append(draft)
    if not rows:
        return pd.DataFrame()
    return pd.json_normalize(rows).drop_duplicates(subset=["draft_id"])


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
    parser.add_argument("--expansion-steps", type=int, default=2)
    parser.add_argument("--max-users-per-step", type=int, default=2500)
    parser.add_argument("--max-leagues", type=int, default=60000)
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

    log(f"season {args.season}: fetching picks from {len(drafts):,} drafts")
    picks = fetch_picks(session, drafts["draft_id"].astype(str).tolist(), args.workers)
    if picks.empty:
        raise RuntimeError("No Sleeper draft picks discovered.")

    raw = args.out_dir / "raw"
    cache = args.out_dir / "cache"
    write_parquet(leagues, raw / "leagues" / f"leagues_{args.season}.parquet")
    write_parquet(league_users, raw / "league_users" / f"league_users_{args.season}.parquet")
    write_parquet(drafts, raw / "drafts" / f"drafts_{args.season}.parquet")
    write_parquet(picks, raw / "picks" / f"picks_{args.season}.parquet")
    write_parquet(players, cache / "players_nfl.parquet")
    log(f"wrote leagues={len(leagues):,} drafts={len(drafts):,} picks={len(picks):,} players={len(players):,}")


if __name__ == "__main__":
    main()
