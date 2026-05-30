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
data/current_projections.csv
data/current_adp.csv
data/scrape_manifest.json
```

One-time historical weekly stat scrape back to 2015:

```powershell
C:\Users\lgilb\anaconda3\python.exe scripts\fantasypros_scraper.py --historical --start-year 2015 --end-year 2025
```

To backfill one position without re-scraping everything:

```powershell
C:\Users\lgilb\anaconda3\python.exe scripts\fantasypros_scraper.py --historical --start-year 2015 --end-year 2025 --positions te
```

That writes a raw weekly stat export such as:

```text
data/fantasypros_weekly_2015_2025.csv
```

The repository includes three GitHub Actions workflows:

```text
.github/workflows/deploy-pages.yml
.github/workflows/update-current-data.yml
.github/workflows/build-historical-data.yml
```

`deploy-pages.yml` publishes the static app to GitHub Pages whenever `main` changes. `update-current-data.yml` refreshes 2026 projections and ADP hourly and commits the generated CSVs. `build-historical-data.yml` is a manual one-time historical scrape that commits the historical export.

## Generated Inputs

The app does not require user uploads. It reads generated files from `data/`.

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
