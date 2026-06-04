import argparse
from pathlib import Path

import pandas as pd


DEFAULT_ADP = Path(
    r"C:\Users\lgilb\fantasyfootball\sleeper_dynasty_adp\scripts_or_notebooks"
    r"\sleeper_dynasty_adp\data\snapshots\adp_time_series\adp_time_series_ALL.parquet"
)
DEFAULT_PLAYERS = Path(
    r"C:\Users\lgilb\fantasyfootball\sleeper_dynasty_adp\scripts_or_notebooks"
    r"\sleeper_dynasty_adp\data\cache\players_nfl.parquet"
)
DEFAULT_OUT = Path("data/custom_adp_board.csv")


def export_adp_board(adp_path: Path, players_path: Path, out_path: Path) -> pd.DataFrame:
    adp = pd.read_parquet(adp_path)
    players = pd.read_parquet(players_path)

    player_cols = [col for col in ["player_id", "full_name", "position", "team"] if col in players.columns]
    players = players[player_cols].copy()
    players["player_id"] = players["player_id"].astype(str)
    adp["player_id"] = adp["player_id"].astype(str)

    out = adp.merge(players, on="player_id", how="left")
    out = out[out["position"].isin(["QB", "RB", "WR", "TE", "K"])].copy()
    out = out[out["dynasty_class"].isin(["startup", "rookie"])].copy()
    out = out[out["type"].isin(["snake", "linear"])].copy()
    out = out[out["st_teams"].isin([10, 12, 14, 16])].copy()
    out = out[
        ((out["dynasty_class"] == "startup") & out["st_rounds"].between(14, 35))
        | ((out["dynasty_class"] == "rookie") & out["st_rounds"].between(1, 8))
    ].copy()
    out = out[out["drafts"] >= 2].copy()

    for col in ["season", "st_teams", "st_rounds", "drafts", "picks", "min_pick", "max_pick"]:
        out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0).astype(int)

    out["adp"] = pd.to_numeric(out["adp"], errors="coerce").round(2)
    out["is_superflex"] = out["is_superflex"].astype(str).str.lower()

    cols = [
        "season",
        "start_month",
        "player_id",
        "full_name",
        "position",
        "team",
        "dynasty_class",
        "type",
        "md_scoring_type",
        "st_teams",
        "st_rounds",
        "is_superflex",
        "drafts",
        "picks",
        "adp",
        "min_pick",
        "max_pick",
    ]
    out = out[[col for col in cols if col in out.columns]].sort_values(
        ["season", "start_month", "dynasty_class", "type", "md_scoring_type", "st_teams", "st_rounds", "adp"]
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Export compact Sleeper ADP data for the WAR Lab ADP tab.")
    parser.add_argument("--adp", type=Path, default=DEFAULT_ADP)
    parser.add_argument("--players", type=Path, default=DEFAULT_PLAYERS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    out = export_adp_board(args.adp, args.players, args.out)
    print(f"wrote {args.out} rows={len(out):,} cols={len(out.columns)}")


if __name__ == "__main__":
    main()
