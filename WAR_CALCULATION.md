# What Is Fantasy Football WAR?

WAR stands for **Wins Above Replacement**.

In this app, WAR is a way to answer a simple fantasy football question:

> How much does this player help my team win compared with a player I could reasonably replace him with?

Fantasy points tell you how many points a player scored. WAR tries to tell you how valuable those points are in the context of your league.

For example, 18 fantasy points from a tight end may be more valuable than 18 fantasy points from a running back if good tight end scores are harder to find. WAR is built to capture that difference.

## The Big Idea

Fantasy football is not just about scoring points. It is about scoring more points than the teams you play against.

WAR compares three things:

1. How many fantasy points the player scored or is projected to score.
2. How many fantasy points a normal starter at that position scores.
3. How many fantasy points a replacement-level player scores.

The app then asks:

> If this player is in my lineup instead of a replacement-level option, how much does that improve my chance of winning?

That improvement is the player's WAR.

## What Replacement Level Means

Replacement level is not the same as zero points.

A replacement player is the kind of player you could usually find after the clear starters are already accounted for. This could mean a bench player, a waiver-wire player, or the next player available in the draft.

The replacement level changes depending on league settings.

In a 12-team league with:

- 1 QB
- 2 RB
- 2 WR
- 1 TE

There are 12 starting quarterbacks, 24 starting running backs, 24 starting wide receivers, and 12 starting tight ends.

The app treats the next same-sized group as the replacement pool.

Example for running backs:

- Starting RB pool: RB1 through RB24
- Replacement RB pool: RB25 through RB48

If the league starts more players, replacement level gets lower because more players are already being used. If the league starts fewer players, replacement level gets higher because fewer players are needed.

That is why WAR must be based on the user's league settings.

## Why League Settings Matter

WAR is league-specific.

A player can be more valuable in one league than another because the lineup requirements change what is scarce.

Examples:

- In a SuperFlex league, quarterbacks become much more valuable because many teams can start a second QB.
- In a TE premium league, tight ends become more valuable because their receptions are worth more.
- In a 3 WR league, wide receivers become more important because more of them must be started.
- In a small bench league, replacement options may be easier to find.

The app uses the league settings selected by the user to rebuild the WAR environment.

## How Fantasy Points Are Calculated

The app first calculates fantasy points from the scoring settings.

Common scoring inputs include:

- Passing yards
- Passing touchdowns
- Interceptions
- Rushing yards
- Rushing touchdowns
- Receptions
- Receiving yards
- Receiving touchdowns
- Fumbles lost

If a projection source already provides fantasy points, the app can use those. When detailed stat columns are available, the app recalculates fantasy points from the selected scoring settings so the result matches the user's league.

## How Historical WAR Is Calculated

Historical WAR uses past weekly player results.

For each historical season and week, the app:

1. Scores every player using the selected scoring settings.
2. Keeps only weeks where the player actually played.
3. Sorts players by fantasy points at each position.
4. Finds the starting pool for each position based on the league settings.
5. Finds the replacement pool for each position.
6. Builds a weekly team-scoring environment.
7. Calculates each player's weekly WAR.
8. Adds the weekly WAR values together for the season.

## Played Weeks vs. Missed Weeks

The app does **not** count bye weeks, missed injury weeks, or other non-played weeks as negative WAR in the historical weekly calculations.

This is important.

If a player missed Week 8 because he was injured or on bye, that week should not make his per-game performance look worse. The app focuses on the weeks where the player actually recorded a played result.

That means historical summaries such as FPTS/G and WAR/G are based on played games, not all possible NFL weeks.

## How the Weekly WAR Formula Works

The app estimates how likely a fantasy team is to win using a normal scoring curve.

You do not need to know advanced statistics to understand the idea. The app is basically asking:

> If my team gets this player's score instead of a replacement player's score, how much better is my chance of winning this week?

The simplified version is:

```text
Weekly WAR =
  win chance with player score
  -
  win chance with replacement score
```

The app estimates win chance by comparing the team score to the historical team scoring environment for that league setup.

The more a player separates from replacement level, the more WAR he earns.

## Team Scoring Environment

For every historical season, the app estimates what an average fantasy starting lineup looks like under the selected settings.

It calculates:

```text
Team average score =
  QB average * QB starters
  + RB average * RB starters
  + WR average * WR starters
  + TE average * TE starters
  + Flex average * Flex starters
  + SuperFlex average * SuperFlex starters
```

It also estimates how spread out team scores usually are. A player is more valuable when his points move a team meaningfully above the normal weekly scoring range.

## Position WAR

Position WAR compares a player against his own position.

Examples:

- QB WAR compares a quarterback to the QB replacement level.
- RB WAR compares a running back to the RB replacement level.
- WR WAR compares a wide receiver to the WR replacement level.
- TE WAR compares a tight end to the TE replacement level.

This is the main WAR number shown for players.

## Flex WAR

Flex WAR answers a different question:

> How valuable is this RB, WR, or TE if I am using him in a Flex spot?

Flex WAR uses the Flex replacement pool instead of the player's strict position replacement pool.

The Flex pool includes RB, WR, and TE players after the required RB, WR, and TE starters have already been removed.

Flex WAR is only shown for:

- RB
- WR
- TE

Quarterbacks are not part of normal Flex.

## SuperFlex WAR

SuperFlex WAR answers:

> How valuable is this player if he can be used in a SuperFlex spot?

The SuperFlex pool can include:

- QB
- RB
- WR
- TE

Because quarterbacks usually score more fantasy points than other positions, SuperFlex settings can greatly change player values.

If the league has no SuperFlex or 2QB setting, SuperFlex WAR may be hidden or blank.

## How Current Projection WAR Is Calculated

For current projections, the app uses projected fantasy points per game.

The app:

1. Loads current player projections.
2. Scores them using the selected scoring settings.
3. Finds current projected starter and replacement levels.
4. Uses historical team scoring averages to understand what winning scores usually look like.
5. Converts the player's projected points into projected WAR.

The key idea is:

```text
Projected WAR =
  projected weekly WAR
  * number of games used for the projection
```

The app does not blindly project every player to a full season.

If a player is projected for at least 10 games, the app treats his points per game as a real role and scales to the selected season length. If a player is projected for fewer than 10 games, the app only gives WAR credit for the projected number of games.

This helps avoid overrating backup players who have strong points per game in a tiny projected role.

## Why WAR Can Be Negative

A player can have negative WAR.

That means the player is expected to hurt a starting lineup compared with a replacement-level option.

Example:

If a starting tight end scores 4 points in a week, but the replacement-level tight end score is usually 7 points, that week can produce negative WAR.

Negative WAR does not mean the player is bad at football. It means that fantasy managers would usually have been better off with a replacement-level fantasy option for that scoring format.

## Historical Rank WAR

Historical rank WAR is used for comparison.

The app looks at historical seasons and asks:

> What has the QB1, QB2, QB3, and so on usually been worth in this league format?

The same idea is calculated for RB, WR, and TE.

This creates a rank curve. The curve helps show whether a current projection is high or low compared with what that positional rank has usually produced.

Example:

If the projected WR12 has 2.1 WAR, and the historical WR12 usually scores 1.7 WAR, then that player is projecting above the normal WR12 expectation.

Historical rank WAR is a comparison tool. It is not used as a fallback curve to force current players into historical values.

## Tiers

Tiers group players with similar WAR values.

The app uses clustering to find natural groups in the WAR results. The purpose is to show where the player pool has meaningful value gaps.

If several players are close together in WAR, they may belong in the same tier. If there is a large drop after a player, that may create a new tier.

Tiers are useful because fantasy drafts are about decisions. If two players have similar WAR, it may be better to consider ADP, roster construction, risk, or positional scarcity instead of treating one as clearly better.

## ADP Is Not WAR

ADP stands for Average Draft Position.

ADP tells you what the market usually costs. WAR tells you what the player is worth in the model.

The app uses both because the best draft targets are often players who combine:

- Strong WAR
- Reasonable or cheap ADP
- A good fit for league settings

Example:

A player with 2.0 WAR and an ADP of 80 may be a better value than a player with 2.2 WAR and an ADP of 20.

WAR measures expected usefulness. ADP measures cost.

## A Simple Example

Imagine a 12-team league where the RB replacement level is 10 fantasy points per game.

Player A is projected for 15 points per game.

Player B is projected for 11 points per game.

Both players are above replacement, but Player A is much more likely to swing matchups. Player A will have more WAR because the gap between 15 and 10 is more meaningful than the gap between 11 and 10.

Now imagine a tight end scores 15 points per game in a league where replacement tight ends score only 6 points per game. That tight end may be more valuable than the running back because his advantage over replacement is larger.

That is the reason WAR is more useful than fantasy points alone.

## How To Read WAR Values

WAR values are easiest to understand by comparison.

General guide:

- Higher WAR is better.
- Around 0 WAR means replacement-level value.
- Negative WAR means below replacement-level value.
- Large positive WAR means the player is meaningfully helping win matchups.

The exact number depends on the scoring settings, roster settings, and selected weeks.

Do not compare WAR from two different league setups unless the settings are the same.

## Important Limitations

WAR is a model, not a guarantee.

It depends on:

- The quality of projection inputs.
- The accuracy of historical scoring data.
- The selected league settings.
- How well replacement level represents the real player pool.
- Injury risk, role changes, coaching changes, and other football uncertainty.

WAR should help make better decisions, but it should not be the only input.

## Short Version

Fantasy football WAR measures how much a player helps your team compared with a realistic replacement option.

The app:

1. Scores players using your league settings.
2. Finds starters and replacement players.
3. Uses historical team scoring to estimate win impact.
4. Converts player fantasy points into WAR.
5. Shows position WAR, Flex WAR, and SuperFlex WAR when relevant.

In plain English:

> WAR tells you how much a player is expected to help you win, not just how many fantasy points he scores.
