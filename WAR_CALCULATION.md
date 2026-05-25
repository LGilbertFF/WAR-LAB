# WAR Calculation

The app follows the calculation pattern from `FPTS Weekly WAR 2024.ipynb`.

## Historical Seasons

For each historical season and user-selected scoring/league setting:

1. Re-score every weekly player row from raw stats.
2. For each week, identify starters by position:
   - `QB starters = teams * QB slots`
   - `RB starters = teams * RB slots`
   - `WR starters = teams * WR slots`
   - `TE starters = teams * TE slots`
3. Replacement level for a position is the next same-sized group after starters.
4. Flex pool is RB/WR/TE after required RB/WR/TE starters are removed.
5. SuperFlex pool is QB/RB/WR/TE after required starters and flex starters are removed.
6. For each year, calculate:

```text
position_avg = average weekly starter score
position_replace = average weekly replacement score
position_std = standard deviation of weekly starter scores
```

7. Calculate that year's team scoring distribution:

```text
team_avg =
  QB_avg * QB_slots +
  RB_avg * RB_slots +
  WR_avg * WR_slots +
  TE_avg * TE_slots +
  Flex_avg * Flex_slots +
  SuperFlex_avg * SuperFlex_slots

team_std = sqrt(
  QB_std^2 * QB_slots +
  RB_std^2 * RB_slots +
  WR_std^2 * WR_slots +
  TE_std^2 * TE_slots +
  Flex_std^2 * Flex_slots +
  SuperFlex_std^2 * SuperFlex_slots
)
```

8. Historical player WAR is summed over the selected weeks:

```text
weekly_WAR =
  normal_cdf(team_avg - position_avg + player_week_score, team_avg, team_std)
  -
  normal_cdf(team_avg - position_avg + position_replace, team_avg, team_std)
```

Missing weeks are treated as replacement-level weeks, matching the notebook's replacement fill.

## Current Projections

Current projected fantasy points are recalculated from stat projections whenever stat columns exist. Scraped `FPTS` is only used as a fallback.

The current projection pool supplies current positional averages and replacement levels. The whole-team scoring environment comes from historical seasons:

```text
historical_team_avg = average(yearly team_avg)
historical_team_std = average(yearly team_std)
```

Projected WAR:

```text
projected_WAR =
  (
    normal_cdf(historical_team_avg - projected_position_avg + player_projected_avg,
               historical_team_avg,
               historical_team_std)
    -
    normal_cdf(historical_team_avg - projected_position_avg + projected_position_replace,
               historical_team_avg,
               historical_team_std)
  )
  * selected_weeks
```

Historical rank curves are recalculated from the same historical player WAR output under the current settings. They are used only for comparison columns and charts, not as a scaling input.
