from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import requests


ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team}/roster"
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
                "headshot_url": href,
            }


def build_map() -> dict:
    by_key: dict[str, dict] = {}
    players = []
    for team in NFL_TEAMS:
        for player in iter_roster_players(team):
            players.append(player)
            by_key[f"{player['key']}|{player['position']}"] = player
            by_key.setdefault(player["key"], player)
    return {
        "source": "ESPN team roster API",
        "players": sorted(players, key=lambda row: (row["position"], row["name"])),
        "by_key": by_key,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch ESPN NFL player headshots for WAR Lab.")
    parser.add_argument("--out", type=Path, default=Path("data/player_headshots.json"))
    args = parser.parse_args()
    data = build_map()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    print(f"wrote {len(data['players'])} ESPN headshots to {args.out}")


if __name__ == "__main__":
    main()
