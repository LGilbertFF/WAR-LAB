from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team}/roster"
SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE"}
NFL_TEAMS = [
    "ari", "atl", "bal", "buf", "car", "chi", "cin", "cle",
    "dal", "den", "det", "gb", "hou", "ind", "jax", "kc",
    "lac", "lar", "lv", "mia", "min", "ne", "no", "nyg",
    "nyj", "phi", "pit", "sea", "sf", "tb", "ten", "wsh",
]


def clean_key(value: str) -> str:
    value = value.lower()
    value = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", value)
    value = re.sub(r"[^a-z0-9]+", "", value)
    return value.strip()


def fetch_json(url: str) -> dict:
    response = requests.get(url, timeout=30)
    if response.status_code == 403:
        response = requests.get(
            url,
            timeout=30,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json,text/plain,*/*",
            },
        )
    response.raise_for_status()
    return response.json()


def iter_roster_players(team: str):
    try:
        data = fetch_json(ROSTER_URL.format(team=team))
    except requests.HTTPError as exc:
        print(f"skipping {team}: {exc}")
        return
    team_abbr = data.get("team", {}).get("abbreviation") or team.upper()
    for group in data.get("athletes", []):
        for player in group.get("items", []):
            position = player.get("position", {}).get("abbreviation") or player.get("position", {}).get("name")
            if position not in FANTASY_POSITIONS:
                continue
            headshot = player.get("headshot", {})
            href = headshot.get("href") if isinstance(headshot, dict) else ""
            if not href:
                continue
            full_name = player.get("fullName") or player.get("displayName")
            if not full_name:
                continue
            yield {
                "name": full_name,
                "key": clean_key(full_name),
                "position": position,
                "team": team_abbr,
                "espn_id": str(player.get("id") or ""),
                "source": "espn",
                "headshot_url": href,
            }


def iter_sleeper_players():
    data = fetch_json(SLEEPER_PLAYERS_URL)
    for player_id, player in data.items():
        position = player.get("position")
        if position not in FANTASY_POSITIONS:
            continue
        full_name = player.get("full_name") or " ".join(
            part for part in [player.get("first_name"), player.get("last_name")] if part
        )
        if not full_name:
            continue
        yield {
            "name": full_name,
            "key": clean_key(full_name),
            "position": position,
            "team": player.get("team") or "",
            "sleeper_id": str(player_id),
            "source": "sleeper",
            "headshot_url": f"https://sleepercdn.com/content/nfl/players/{player_id}.jpg",
        }


def add_player(players: list[dict], by_key: dict[str, dict], player: dict, prefer_existing: bool) -> bool:
    key = player["key"]
    pos_key = f"{key}|{player['position']}"
    if not key:
        return False
    if prefer_existing and pos_key in by_key:
        return False
    players.append(player)
    if prefer_existing:
        by_key.setdefault(pos_key, player)
        by_key.setdefault(key, player)
    else:
        by_key[pos_key] = player
        by_key.setdefault(key, player)
    return True


def build_map() -> dict:
    by_key: dict[str, dict] = {}
    players = []
    espn_count = 0
    sleeper_count = 0
    for team in NFL_TEAMS:
        for player in iter_roster_players(team):
            if add_player(players, by_key, player, prefer_existing=False):
                espn_count += 1
    for player in iter_sleeper_players():
        if add_player(players, by_key, player, prefer_existing=True):
            sleeper_count += 1
    return {
        "source": "ESPN team roster API with Sleeper fallback",
        "counts": {"espn": espn_count, "sleeper_fallback": sleeper_count},
        "players": sorted(players, key=lambda row: (row["position"], row["name"])),
        "by_key": by_key,
    }


def cache_active_sleeper_headshots(data: dict, cache_dir: Path) -> int:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = 0
    for player in data.get("players", []):
        if player.get("source") != "sleeper" or not player.get("team") or not player.get("sleeper_id"):
            continue
        destination = cache_dir / f"{player['sleeper_id']}.jpg"
        if not destination.exists():
            try:
                response = requests.get(
                    player["headshot_url"],
                    timeout=30,
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                response.raise_for_status()
                if not response.headers.get("content-type", "").lower().startswith("image/"):
                    continue
                destination.write_bytes(response.content)
            except requests.RequestException as exc:
                print(f"could not cache {player['name']} headshot: {exc}")
                continue
        player["headshot_url"] = destination.relative_to(ROOT).as_posix()
        cached += 1
    return cached


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch ESPN NFL player headshots for WAR Lab.")
    parser.add_argument("--out", type=Path, default=Path("data/player_headshots.json"))
    parser.add_argument("--cache-dir", type=Path, default=Path("assets/player-headshots"))
    args = parser.parse_args()
    data = build_map()
    cache_dir = args.cache_dir if args.cache_dir.is_absolute() else ROOT / args.cache_dir
    cached_count = cache_active_sleeper_headshots(data, cache_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    counts = data.get("counts", {})
    print(
        f"wrote {len(data['players'])} headshots to {args.out} "
        f"({counts.get('espn', 0)} ESPN, {counts.get('sleeper_fallback', 0)} Sleeper fallback, "
        f"{cached_count} active fallback images cached locally)"
    )


if __name__ == "__main__":
    main()
