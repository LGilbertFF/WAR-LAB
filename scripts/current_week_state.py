import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read or update the saved current NFL week.")
    parser.add_argument("--state", type=Path, default=Path("data/current_week.json"))
    parser.add_argument("--season-year", type=int, required=True)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--set-week", type=int)
    action.add_argument("--advance", action="store_true")
    return parser.parse_args()


def load_state(path: Path) -> dict[str, object]:
    if not path.exists():
        raise RuntimeError(f"Missing saved week state: {path}")
    state = json.loads(path.read_text(encoding="utf-8"))
    state["season_year"] = int(state["season_year"])
    state["week_last"] = int(state["week_last"])
    return state


def main() -> None:
    args = parse_args()
    state = load_state(args.state)
    if state["season_year"] != args.season_year:
        if args.set_week is None:
            raise RuntimeError(
                f"Saved week belongs to {state['season_year']}; manually set the first week for {args.season_year}."
            )
        state["season_year"] = args.season_year

    if args.set_week is not None:
        state["week_last"] = args.set_week
    elif args.advance:
        eastern_date = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
        if state.get("last_advanced_date") != eastern_date:
            if state["week_last"] < 18:
                state["week_last"] += 1
                state["last_advanced_date"] = eastern_date
            else:
                print("Week 18 is final; keeping the saved week unchanged")
        else:
            print(f"Week already advanced on {eastern_date}; keeping Week {state['week_last']}")

    state["week_last"] = max(1, min(18, state["week_last"]))
    args.state.parent.mkdir(parents=True, exist_ok=True)
    args.state.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as output:
            output.write(f"week_last={state['week_last']}\n")
    print(f"Current weekly WAR state: season {state['season_year']}, Week {state['week_last']}")


if __name__ == "__main__":
    main()
