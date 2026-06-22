# WAR Projection Lab

Static GitHub Pages app for generating fantasy football WAR projections from scraped projections, ADP, league settings, scoring settings, and historical weekly scoring averages.

## Run Locally

```powershell
C:\Users\lgilb\anaconda3\python.exe -m http.server 8765 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8765
```

Opening `index.html` directly with `file://` may block bundled CSV loading in some browsers. GitHub Pages and the local server both work.

## Scraping Data

Current projections and ADP are scraped from the same FantasyPros pages used by the original Tkinter app. The season year is explicit, so the 2026 app data is built with `--season-year 2026`:

```powershell
C:\Users\lgilb\anaconda3\python.exe scripts\fantasypros_scraper.py --current --season-year 2026 --adp-scoring ppr
```

This writes:

```text
data/war/current_projections.json.gz
data/war/current_adp.json.gz
data/war/manifest.json
data/scrape_manifest.json
```

The scraper still creates local CSV intermediates, but the site prefers the compressed JSON files in `data/war/`.

One-time historical weekly stat scrape back to 2015:

```powershell
C:\Users\lgilb\anaconda3\python.exe scripts\fantasypros_scraper.py --historical --start-year 2015 --end-year 2025
```

To backfill one position without re-scraping everything:

```powershell
C:\Users\lgilb\anaconda3\python.exe scripts\fantasypros_scraper.py --historical --start-year 2015 --end-year 2025 --positions te
```

That writes a raw weekly stat export and browser-ready compressed year shards:

```text
data/fantasypros_weekly_2015_2025.csv
data/war/historical_weekly_2015.json.gz
data/war/historical_weekly_2016.json.gz
...
data/war/manifest.json
```

The repository includes three GitHub Actions workflows:

```text
.github/workflows/deploy-pages.yml
.github/workflows/update-current-data.yml
.github/workflows/build-historical-data.yml
.github/workflows/update-sleeper-adp.yml
.github/workflows/update-sleeper-redraft-adp.yml
.github/workflows/backfill-sleeper-adp.yml
.github/workflows/backfill-sleeper-redraft-adp.yml
.github/workflows/backfill-sleeper-dynasty-adp.yml
```

`deploy-pages.yml` publishes the static app to GitHub Pages whenever `main` changes. `update-current-data.yml` refreshes 2026 FantasyPros projections and ADP hourly, exports browser-ready WAR JSON shards, and commits those generated files. `build-historical-data.yml` is a manual one-time historical weekly scoring scrape that commits the historical WAR JSON shards.

`update-sleeper-adp.yml` refreshes current-season Sleeper dynasty ADP once per day. It tracks harvested draft IDs in `data/sleeper_seen_dynasty_leagues.csv`, skips only drafts already included, and merges new rows into browser-ready ADP shards under `data/adp/`. This lets a dynasty league contribute multiple drafts in the same year, such as a startup and later rookie draft. Manual current-season rebuild mode ignores the seen-draft cache and replaces the current dynasty shard.

`update-sleeper-redraft-adp.yml` runs a separate redraft-only expansion. It uses a tracked `data/sleeper_seen_redraft_leagues.csv` cache of harvested draft IDs so repeat runs can skip completed drafts already included without permanently skipping leagues that had not drafted yet. It also merges new redraft rows into the ADP shards instead of replacing unrelated seasons or formats.

Sleeper ADP pulls now default to aggressive discovery: 10 expansion steps, up to 10,000 users per discovery wave, and uncapped discovered leagues. In the cap inputs, `0` means uncapped; use it for intentional stress runs, but the default user-frontier and redraft draft caps keep runs more likely to reach export/commit before GitHub shuts down the runner. GitHub Actions runtime, Sleeper API responsiveness, runner memory, and the 90 MB per-shard safety cap are the practical stops.

Redraft pulls default to a 10,000-draft cap because each draft can expand into many pick rows, and very large redraft fetches can exceed practical runner memory or runner communication limits before export. Seen draft IDs are filtered before this cap, so rerunning the redraft workflow continues with the next unharvested draft slice.

`backfill-sleeper-adp.yml` is a manual historical Sleeper ADP pull with a league-format selector. Blank date inputs use January 1 through December 31 of each season, so early-year drafts are included by default. `backfill-sleeper-redraft-adp.yml` and `backfill-sleeper-dynasty-adp.yml` are separate fixed-format historical searches for when you want to build those pools independently. Historical rebuild mode ignores the seen-draft cache while fetching and replaces the selected season/format shards, which is useful after exporter logic changes.

Historical backfills track already-included draft IDs by year and format in `data/historical_seen_leagues/`, so rerunning a backfill can still pick up later drafts from the same league while avoiding draft IDs already harvested.

## Generated Inputs

The app does not require user uploads. It reads generated files from `data/`.

WAR projection inputs are stored as gzip-compressed JSON files listed in `data/war/manifest.json`, including current projections, current ADP, and historical weekly year shards. Sleeper ADP is stored as gzip-compressed JSON shards listed in `data/adp/manifest.json`, such as `data/adp/2026-redraft.json.gz` and `data/adp/2026-dynasty.json.gz`. Legacy CSV files may remain as scraper intermediates or browser fallbacks, but the site no longer depends on them for normal loading.

Generated projection CSVs can use either existing projection fields or scored fantasy-point fields.

Useful projection columns:

```text
Player, Team, Pos, FPTS, AVG, FPTS High, FPTS Low, ADP, ADP Rank
```

Useful stat columns:

```text
PassingYDS, PassingTD, INTS, RushingYDS, RushingTD, REC, ReceivingYDS, ReceivingTD, FL
```

Generated ADP columns:

```text
Player, ADP, Rank
```

Generated historical weekly stat columns:

```text
Year, Week, Player, Team, Pos, PassingYDS, PassingTD, RushingYDS, RushingTD, REC, ReceivingYDS, ReceivingTD, FL
```

## GitHub Pages

Create a new GitHub repository, push this folder to the `main` branch, then enable Pages:

1. Go to repository `Settings` -> `Pages`.
2. Under `Build and deployment`, choose `GitHub Actions` as the source.
3. The `Deploy GitHub Pages` workflow will publish the site.

The public link will be:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY-NAME/
```

The browser app does not scrape live data directly because GitHub Pages is static. The scraper runs locally or in GitHub Actions, commits the generated files, and the page loads those files automatically.
