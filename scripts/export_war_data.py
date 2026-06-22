import argparse
import gzip
import json
from pathlib import Path

import pandas as pd


DATA_DIR = Path("data")
WAR_DIR = DATA_DIR / "war"
MANIFEST_PATH = WAR_DIR / "manifest.json"


def read_csv_if_exists(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, low_memory=False)


def write_json_gz(path: Path, df: pd.DataFrame) -> int:
    records = json.loads(df.to_json(orient="records", date_format="iso"))
    payload = json.dumps(records, separators=(",", ":")).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=9) as handle:
        handle.write(payload)
    return path.stat().st_size


def latest_historical_csv() -> Path | None:
    candidates = sorted(
        DATA_DIR.glob("fantasypros_weekly_*.csv"),
        key=lambda path: (path.stat().st_mtime, path.name),
        reverse=True,
    )
    return candidates[0] if candidates else None


def export_current(manifest: dict) -> None:
    for key, source_name, output_name in [
        ("current_projections", "current_projections.csv", "current_projections.json.gz"),
        ("current_adp", "current_adp.csv", "current_adp.json.gz"),
    ]:
        source = DATA_DIR / source_name
        df = read_csv_if_exists(source)
        if df.empty:
            continue
        path = WAR_DIR / output_name
        size = write_json_gz(path, df)
        manifest[key] = {
            "path": path.as_posix(),
            "source": source.as_posix(),
            "rows": int(len(df)),
            "bytes": int(size),
        }


def export_historical(manifest: dict, source: Path | None = None) -> None:
    source = source or latest_historical_csv()
    if not source or not source.exists():
        return
    df = pd.read_csv(source, low_memory=False)
    if df.empty or "Year" not in df.columns:
        return
    df["Year"] = pd.to_numeric(df["Year"], errors="coerce").astype("Int64")
    shards = []
    for year, shard in df[df["Year"].notna()].groupby("Year", sort=True):
        year_int = int(year)
        path = WAR_DIR / f"historical_weekly_{year_int}.json.gz"
        size = write_json_gz(path, shard)
        shards.append({
            "year": year_int,
            "path": path.as_posix(),
            "rows": int(len(shard)),
            "bytes": int(size),
        })
    manifest["historical_weekly"] = {
        "source": source.as_posix(),
        "rows": int(len(df)),
        "shards": shards,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export WAR Lab CSV inputs to browser-ready compressed JSON.")
    parser.add_argument("--current", action="store_true", help="Export current projections and ADP")
    parser.add_argument("--historical", action="store_true", help="Export historical weekly rows")
    parser.add_argument("--historical-source", type=Path, help="Historical weekly CSV to export")
    args = parser.parse_args()

    if not args.current and not args.historical:
        args.current = True
        args.historical = True

    manifest = {}
    if MANIFEST_PATH.exists():
        try:
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}

    if args.current:
        export_current(manifest)
    if args.historical:
        export_historical(manifest, args.historical_source)

    manifest["version"] = 1
    manifest["updated_at"] = pd.Timestamp.utcnow().isoformat()
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
