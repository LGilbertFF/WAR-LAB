const CURRENT_PROJECTIONS_PATH = "data/current_projections.csv";
const CURRENT_ADP_PATH = "data/current_adp.csv";
const FALLBACK_PROJECTIONS_PATH = "data/WARProjections2024_PPR2WR.csv";
const HISTORICAL_WEEKLY_PATH = "data/fantasypros_weekly_2015_2025.csv";

const state = {
  rawProjections: [],
  adpRows: [],
  historicalRows: [],
  historicalWeeklyRows: [],
  historicalModel: null,
  historicalModelKey: "",
  historicalScoredRows: [],
  historicalScoredRowsKey: "",
  manifest: null,
  results: [],
  selectedId: null,
  selectedHistoryYear: null,
  sortKey: "Overall Rank",
  sortDir: "asc",
  renderTimer: null,
  projectionSource: CURRENT_PROJECTIONS_PATH,
  adpSource: CURRENT_ADP_PATH,
  baselines: {}
};

const posColors = {
  QB: "#f0f0f0",
  RB: "#cc3333",
  WR: "#8a8a8a",
  TE: "#f2b3b3"
};

const posSymbols = {
  QB: "triangle-up",
  RB: "square",
  WR: "circle",
  TE: "diamond"
};

const posDashes = {
  QB: "solid",
  RB: "dash",
  WR: "dot",
  TE: "dashdot"
};

const el = (id) => document.querySelector(`#${id}`);

function number(value, fallback = null) {
  if (value === undefined || value === null || value === "" || value === "-") return fallback;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstValue(row, names, fallback = null) {
  const lowerMap = new Map(Object.keys(row).map((key) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), key]));
  for (const name of names) {
    const direct = row[name];
    if (direct !== undefined && direct !== "") return direct;
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const actual = lowerMap.get(normalized);
    if (actual && row[actual] !== "") return row[actual];
  }
  return fallback;
}

function fmt(value, digits = 2) {
  const parsed = number(value);
  return parsed === null ? "-" : parsed.toFixed(digits);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function erf(x) {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x, mean, std) {
  if (!Number.isFinite(std) || std <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (std * Math.sqrt(2))));
}

function settings() {
  return {
    year: number(el("projectionYear").value, 2026),
    teams: number(el("teamsInput").value, 12),
    weeks: number(el("weeksInput").value, 17),
    slots: {
      QB: number(el("qbSlots").value, 1),
      RB: number(el("rbSlots").value, 2),
      WR: number(el("wrSlots").value, 2),
      TE: number(el("teSlots").value, 1),
      FLEX: number(el("flexSlots").value, 1),
      SUPERFLEX: number(el("superflexSlots").value, 0)
    },
    scoring: {
      rec: number(el("receptions").value, 1),
      tePremium: number(el("tePremium").value, 0),
      recYds: number(el("receivingYds").value, 0.1),
      recTd: number(el("receivingTd").value, 6),
      rushYds: number(el("rushingYds").value, 0.1),
      rushTd: number(el("rushingTd").value, 6),
      passYds: number(el("passingYds").value, 0.04),
      passTd: number(el("passingTd").value, 4),
      int: number(el("interception").value, -2),
      fl: number(el("fumbleLost").value, -2)
    }
  };
}

function weekLimit() {
  return Math.max(1, Math.min(18, number(el("weeksInput").value, 17)));
}

function playerKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z]/g, "");
}

function normalizeProjection(row, index, adpMap) {
  const player = firstValue(row, ["Player", "player", "Name", "PLAYER"]);
  const posRaw = firstValue(row, ["Pos", "position", "POS"]);
  const pos = String(posRaw || "").toUpperCase().replace(/[0-9]/g, "");
  const team = firstValue(row, ["Team", "team", "TEAM"], "");
  if (!player || !["QB", "RB", "WR", "TE"].includes(pos)) return null;

  const adpMatch = adpMap.get(playerKey(player));
  const adp = number(firstValue(row, ["ADP", "ADP AVG", "Average Draft Position"]), null) ??
    number(firstValue(row, ["ADP Rank"], null), null) ??
    adpMatch?.ADP ?? null;
  const adpRank = number(firstValue(row, ["ADP Rank"], null), null) ?? adpMatch?.["ADP Rank"] ?? adp;

  const avg = number(firstValue(row, ["AVG", "Avg", "FPTS/G", "Fantasy Points Per Game"]), null);
  const fpts = number(firstValue(row, ["FPTS", "Fantasy Points", "fantasy_points"]), null);
  const existingWar = number(firstValue(row, ["WAR"], null), null);
  const high = number(firstValue(row, ["AVG High", "FPTS High", "High"], null), null);
  const low = number(firstValue(row, ["AVG Low", "FPTS Low", "Low"], null), null);
  const scoring = settings().scoring;

  const scoredFromStats = calculateFantasyPoints(row, pos, scoring);
  const projectedPoints = scoredFromStats ?? fpts;
  const projectedAvg = avg ?? (projectedPoints !== null ? projectedPoints / settings().weeks : null);

  return {
    id: `${playerKey(player)}-${pos}-${index}`,
    Source: "projection",
    Player: player,
    Team: team,
    Pos: pos,
    Year: number(firstValue(row, ["Year", "year"], null), settings().year),
    FPTS: projectedPoints,
    AVG: projectedAvg,
    "AVG High": high !== null && fpts !== null ? high / settings().weeks : high,
    "AVG Low": low !== null && fpts !== null ? low / settings().weeks : low,
    "Existing WAR": existingWar,
    ADP: adp,
    "ADP Rank": adpRank,
    Raw: row
  };
}

function calculateFantasyPoints(row, pos, scoring) {
  const statNames = [
    "REC", "Receptions", "ReceivingREC", "Receiving REC",
    "ReceivingYDS", "Receiving YDS", "Rec YDS", "Receiving Yards",
    "ReceivingTD", "Receiving TD", "Rec TD", "ReceivingTDS",
    "RushingYDS", "Rushing YDS", "Rush YDS", "Rushing Yards",
    "RushingTD", "Rushing TD", "Rush TD", "RushingTDS",
    "PassingYDS", "Passing YDS", "Pass YDS", "Passing Yards",
    "PassingTD", "Passing TD", "Pass TD", "PassingTDS", "Pass YDS",
    "Pass TD", "Rush YDS", "Rush TD", "Rec YDS", "Rec TD",
    "INT", "INTS", "Interceptions", "FL", "Fumbles Lost", "Fumble Lost"
  ];
  const hasStats = statNames.some((name) => firstValue(row, [name], null) !== null);
  if (!hasStats) return null;

  const rec = number(firstValue(row, ["REC", "Receptions", "ReceivingREC", "Receiving REC"], null), 0);
  const recYds = number(firstValue(row, ["ReceivingYDS", "Receiving YDS", "Rec YDS", "YDS", "Receiving Yards"], null), 0);
  const recTd = number(firstValue(row, ["ReceivingTD", "Receiving TD", "Rec TD", "TD", "ReceivingTDS"], null), 0);
  const rushYds = number(firstValue(row, ["RushingYDS", "Rushing YDS", "Rush YDS", "YDS_2", "Rushing Yards"], null), 0);
  const rushTd = number(firstValue(row, ["RushingTD", "Rushing TD", "Rush TD", "TD_2", "RushingTDS"], null), 0);
  const passYds = number(firstValue(row, ["PassingYDS", "Passing YDS", "Pass YDS", "YDS", "Passing Yards"], null), 0);
  const passTd = number(firstValue(row, ["PassingTD", "Passing TD", "Pass TD", "PassingTDS"], null), 0);
  const ints = number(firstValue(row, ["INT", "INTS", "Interceptions"], null), 0);
  const fl = number(firstValue(row, ["FL", "Fumbles Lost", "Fumble Lost"], null), 0);
  const teReception = scoring.rec + (pos === "TE" ? scoring.tePremium : 0);

  const points =
    rec * teReception +
    recYds * scoring.recYds +
    recTd * scoring.recTd +
    rushYds * scoring.rushYds +
    rushTd * scoring.rushTd +
    passYds * scoring.passYds +
    passTd * scoring.passTd +
    ints * scoring.int +
    fl * scoring.fl;

  return points;
}

function normalizeAdp(rows) {
  const cleaned = rows
    .filter((row) => firstValue(row, ["Player", "player", "Player Team (Bye)", "Name"]))
    .map((row) => {
      const combined = firstValue(row, ["Player Team (Bye)"], "");
      const extracted = String(combined).match(/^(.*?)\s+[A-Z]{2,3}\s+\(\d+\)$/);
      const player = firstValue(row, ["Player", "player", "Name"], extracted?.[1] || combined);
      return {
        Player: String(player || "").trim(),
        ADP: number(firstValue(row, ["ADP", "AVG", "Average"], null), null),
        "ADP Rank": number(firstValue(row, ["ADP Rank", "Rank"], null), null)
      };
    });
  return new Map(cleaned.map((row) => [playerKey(row.Player), row]));
}

function startersByPosition(players, pos, count) {
  return players
    .filter((player) => player.Pos === pos && player.AVG !== null)
    .sort((a, b) => b.AVG - a.AVG)
    .slice(0, Math.max(0, count));
}

function replacementPool(players, candidatePlayers, count) {
  const starterIds = new Set(candidatePlayers.slice(0, Math.max(0, count)).map((player) => player.id));
  return candidatePlayers
    .filter((player) => !starterIds.has(player.id))
    .slice(0, Math.max(1, count));
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function std(values) {
  const avg = average(values);
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length <= 1) return Math.max(avg * 0.2, 1);
  return Math.sqrt(average(clean.map((value) => (value - avg) ** 2)));
}

function buildBaselines(players) {
  const cfg = settings();
  const baselines = {};
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const count = cfg.slots[pos] * cfg.teams;
    const ranked = players.filter((player) => player.Pos === pos && player.AVG !== null).sort((a, b) => b.AVG - a.AVG);
    const top = ranked.slice(0, Math.max(1, count));
    const replacement = ranked.slice(Math.max(0, count), Math.max(1, count * 2));
    baselines[pos] = {
      avg: average(top.map((player) => player.AVG)),
      replacement: average(replacement.map((player) => player.AVG)),
      std: std(top.map((player) => player.AVG)),
      count
    };
  }

  const flexCandidates = players
    .filter((player) => ["RB", "WR", "TE"].includes(player.Pos) && player.AVG !== null)
    .sort((a, b) => b.AVG - a.AVG);
  const usedFlexStarters = [
    ...startersByPosition(players, "RB", cfg.slots.RB * cfg.teams),
    ...startersByPosition(players, "WR", cfg.slots.WR * cfg.teams),
    ...startersByPosition(players, "TE", cfg.slots.TE * cfg.teams)
  ];
  const usedStarterIds = new Set([
    ...startersByPosition(players, "QB", cfg.slots.QB * cfg.teams),
    ...usedFlexStarters
  ].map((player) => player.id));
  const flexAvailable = flexCandidates.filter((player) => !usedStarterIds.has(player.id));
  const flexCount = cfg.slots.FLEX * cfg.teams;
  const flexStarters = flexAvailable.slice(0, flexCount);
  flexStarters.forEach((player) => usedStarterIds.add(player.id));
  baselines.FLEX = {
    avg: average(flexAvailable.slice(0, Math.max(1, flexCount)).map((player) => player.AVG)),
    replacement: average(flexAvailable.slice(Math.max(0, flexCount), Math.max(1, flexCount * 2)).map((player) => player.AVG)),
    std: std(flexAvailable.slice(0, Math.max(1, flexCount)).map((player) => player.AVG)),
    count: flexCount
  };

  const superflexCandidates = players
    .filter((player) => player.AVG !== null && !usedStarterIds.has(player.id))
    .sort((a, b) => b.AVG - a.AVG);
  const superflexCount = cfg.slots.SUPERFLEX * cfg.teams;
  baselines.SUPERFLEX = {
    avg: superflexCount ? average(superflexCandidates.slice(0, Math.max(1, superflexCount)).map((player) => player.AVG)) : 0,
    replacement: superflexCount ? average(superflexCandidates.slice(Math.max(0, superflexCount), Math.max(1, superflexCount * 2)).map((player) => player.AVG)) : 0,
    std: superflexCount ? std(superflexCandidates.slice(0, Math.max(1, superflexCount)).map((player) => player.AVG)) : 0,
    count: superflexCount
  };

  const weightedAvg =
    baselines.QB.avg * cfg.slots.QB +
    baselines.RB.avg * cfg.slots.RB +
    baselines.WR.avg * cfg.slots.WR +
    baselines.TE.avg * cfg.slots.TE +
    baselines.FLEX.avg * cfg.slots.FLEX +
    baselines.SUPERFLEX.avg * cfg.slots.SUPERFLEX;
  const teamStd = Math.sqrt(
    baselines.QB.std ** 2 * cfg.slots.QB +
    baselines.RB.std ** 2 * cfg.slots.RB +
    baselines.WR.std ** 2 * cfg.slots.WR +
    baselines.TE.std ** 2 * cfg.slots.TE +
    baselines.FLEX.std ** 2 * cfg.slots.FLEX +
    baselines.SUPERFLEX.std ** 2 * cfg.slots.SUPERFLEX
  );
  const historicalTeam = state.historicalModel?.projectionTeam;
  baselines.TEAM = {
    avg: historicalTeam?.avg ?? weightedAvg,
    std: Math.max(historicalTeam?.std ?? teamStd, 1),
    source: historicalTeam ? "historical" : "projection"
  };
  return baselines;
}

function historicalForRank(pos, rank) {
  const rounded = Math.max(1, Math.round(number(rank, 1)));
  const curve = state.historicalModel?.curve || [];
  const row = curve.find((item) => Math.round(number(item.Rank, 0)) === rounded);
  return number(row?.[`${pos} WAR`], null);
}

function computeHistoricalModel() {
  const cfg = settings();
  const scoringKey = JSON.stringify({
    rows: state.historicalWeeklyRows.length,
    scoring: cfg.scoring
  });
  const modelKey = JSON.stringify({
    rows: state.historicalWeeklyRows.length,
    start: el("historyStart").value,
    weeks: weekLimit(),
    teams: cfg.teams,
    slots: cfg.slots,
    scoring: cfg.scoring
  });
  if (state.historicalModelKey === modelKey) return;
  state.historicalModelKey = modelKey;

  if (!state.historicalWeeklyRows.length) {
    state.historicalModel = null;
    return;
  }

  const startYear = number(el("historyStart").value, 2015);
  const maxWeek = weekLimit();
  if (state.historicalScoredRowsKey !== scoringKey) {
    state.historicalScoredRowsKey = scoringKey;
    state.historicalScoredRows = state.historicalWeeklyRows.map((row) => {
      const pos = String(firstValue(row, ["Pos", "position"], "")).toUpperCase();
      const year = number(firstValue(row, ["Year", "year"], null), null);
      const week = number(firstValue(row, ["Week", "week"], null), null);
      const points = calculateFantasyPoints(row, pos, cfg.scoring);
      return {
        id: `${playerKey(firstValue(row, ["Player", "player"], ""))}-${pos}`,
        Player: firstValue(row, ["Player", "player"], ""),
        Team: firstValue(row, ["Team", "team"], ""),
        Pos: pos,
        Year: year,
        Week: week,
        FPTS: points
      };
    });
  }
  const rows = state.historicalScoredRows
    .filter((row) => row.Player && ["QB", "RB", "WR", "TE"].includes(row.Pos) && row.Year >= startYear && row.Week >= 1 && row.Week <= maxWeek && row.FPTS !== null);

  const years = [...new Set(rows.map((row) => row.Year))].sort((a, b) => a - b);
  const byYear = new Map();
  const byYearWeek = new Map();
  for (const row of rows) {
    if (!byYear.has(row.Year)) byYear.set(row.Year, []);
    byYear.get(row.Year).push(row);
    const yw = `${row.Year}-${row.Week}`;
    if (!byYearWeek.has(yw)) byYearWeek.set(yw, []);
    byYearWeek.get(yw).push(row);
  }
  const yearModels = {};
  const historicalPlayerRows = [];

  for (const year of years) {
    const yearRows = byYear.get(year) || [];
    const posModel = {};
    const weeklyMaps = new Map();
    for (const row of yearRows) {
      const key = `${row.Player}|${row.Team}|${row.Pos}`;
      if (!weeklyMaps.has(key)) weeklyMaps.set(key, { Player: row.Player, Team: row.Team, Pos: row.Pos, weeks: new Map() });
      weeklyMaps.get(key).weeks.set(row.Week, row.FPTS);
    }

    const weeklyTop = { QB: [], RB: [], WR: [], TE: [], FLEX: [], SUPERFLEX: [] };
    const weeklyReplace = { QB: [], RB: [], WR: [], TE: [], FLEX: [], SUPERFLEX: [] };

    for (let week = 1; week <= maxWeek; week += 1) {
      const weekRows = byYearWeek.get(`${year}-${week}`) || [];
      const starterIds = new Set();
      for (const pos of ["QB", "RB", "WR", "TE"]) {
        const count = cfg.slots[pos] * cfg.teams;
        const ranked = weekRows.filter((row) => row.Pos === pos).sort((a, b) => b.FPTS - a.FPTS);
        const top = ranked.slice(0, count);
        const replacement = ranked.slice(count, count * 2);
        top.forEach((row) => starterIds.add(row.id));
        weeklyTop[pos].push(...top.map((row) => row.FPTS));
        weeklyReplace[pos].push(...replacement.map((row) => row.FPTS));
      }

      const flexCount = cfg.slots.FLEX * cfg.teams;
      const flexRanked = weekRows.filter((row) => ["RB", "WR", "TE"].includes(row.Pos) && !starterIds.has(row.id)).sort((a, b) => b.FPTS - a.FPTS);
      const flexTop = flexRanked.slice(0, flexCount);
      const flexReplacement = flexRanked.slice(flexCount, flexCount * 2);
      flexTop.forEach((row) => starterIds.add(row.id));
      weeklyTop.FLEX.push(...flexTop.map((row) => row.FPTS));
      weeklyReplace.FLEX.push(...flexReplacement.map((row) => row.FPTS));

      const superflexCount = cfg.slots.SUPERFLEX * cfg.teams;
      const superflexRanked = weekRows.filter((row) => !starterIds.has(row.id)).sort((a, b) => b.FPTS - a.FPTS);
      weeklyTop.SUPERFLEX.push(...superflexRanked.slice(0, superflexCount).map((row) => row.FPTS));
      weeklyReplace.SUPERFLEX.push(...superflexRanked.slice(superflexCount, superflexCount * 2).map((row) => row.FPTS));
    }

    for (const pos of ["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX"]) {
      posModel[pos] = {
        avg: average(weeklyTop[pos]),
        std: std(weeklyTop[pos]),
        replacement: average(weeklyReplace[pos]),
        count: weeklyTop[pos].length
      };
    }

    const teamAvg =
      posModel.QB.avg * cfg.slots.QB +
      posModel.RB.avg * cfg.slots.RB +
      posModel.WR.avg * cfg.slots.WR +
      posModel.TE.avg * cfg.slots.TE +
      posModel.FLEX.avg * cfg.slots.FLEX +
      posModel.SUPERFLEX.avg * cfg.slots.SUPERFLEX;
    const teamStd = Math.sqrt(
      posModel.QB.std ** 2 * cfg.slots.QB +
      posModel.RB.std ** 2 * cfg.slots.RB +
      posModel.WR.std ** 2 * cfg.slots.WR +
      posModel.TE.std ** 2 * cfg.slots.TE +
      posModel.FLEX.std ** 2 * cfg.slots.FLEX +
      posModel.SUPERFLEX.std ** 2 * cfg.slots.SUPERFLEX
    );

    yearModels[year] = { positions: posModel, team: { avg: teamAvg, std: Math.max(teamStd, 1) } };

    for (const player of weeklyMaps.values()) {
      const base = posModel[player.Pos];
      let war = 0;
      let flexWar = 0;
      let superflexWar = 0;
      let games = 0;
      const weeks = [];
      for (let week = 1; week <= maxWeek; week += 1) {
        const actual = player.weeks.get(week);
        const score = actual ?? base.replacement;
        if (actual !== undefined) games += 1;
        const weeklyWar = normalCdf(teamAvg - base.avg + score, teamAvg, Math.max(teamStd, 1)) -
          normalCdf(teamAvg - base.avg + base.replacement, teamAvg, Math.max(teamStd, 1));
        const weeklyFlexWar = ["RB", "WR", "TE"].includes(player.Pos)
          ? normalCdf(teamAvg - posModel.FLEX.avg + score, teamAvg, Math.max(teamStd, 1)) -
            normalCdf(teamAvg - posModel.FLEX.avg + posModel.FLEX.replacement, teamAvg, Math.max(teamStd, 1))
          : null;
        const weeklySuperflexWar = posModel.SUPERFLEX.count
          ? normalCdf(teamAvg - posModel.SUPERFLEX.avg + score, teamAvg, Math.max(teamStd, 1)) -
            normalCdf(teamAvg - posModel.SUPERFLEX.avg + posModel.SUPERFLEX.replacement, teamAvg, Math.max(teamStd, 1))
          : null;
        war += weeklyWar;
        if (weeklyFlexWar !== null) flexWar += weeklyFlexWar;
        if (weeklySuperflexWar !== null) superflexWar += weeklySuperflexWar;
        if (actual !== undefined) weeks.push({ Week: week, FPTS: actual, WAR: weeklyWar });
      }
      historicalPlayerRows.push({
        ...player,
        PlayerKey: playerKey(player.Player),
        Year: year,
        WAR: war,
        "Flex WAR": ["RB", "WR", "TE"].includes(player.Pos) ? flexWar : null,
        "SuperFlex WAR": posModel.SUPERFLEX.count ? superflexWar : null,
        Games: games,
        FPTS: weeks.reduce((sum, week) => sum + week.FPTS, 0),
        AVG: games ? weeks.reduce((sum, week) => sum + week.FPTS, 0) / games : 0,
        Weeks: weeks
      });
    }
  }

  const rankBuckets = new Map();
  for (const row of historicalPlayerRows) {
    const key = `${row.Year}-${row.Pos}`;
    if (!rankBuckets.has(key)) rankBuckets.set(key, []);
    rankBuckets.get(key).push(row);
  }
  for (const bucket of rankBuckets.values()) {
    bucket.sort((a, b) => b.WAR - a.WAR).forEach((row, index) => {
      row.Rank = index + 1;
    });
  }

  const maxRank = 250;
  const curveValues = new Map();
  for (const row of historicalPlayerRows) {
    if (!row.Rank || row.Rank > maxRank) continue;
    const key = `${row.Pos}-${row.Rank}`;
    if (!curveValues.has(key)) curveValues.set(key, []);
    curveValues.get(key).push(row.WAR);
  }
  const curve = Array.from({ length: maxRank }, (_, index) => {
    const rank = index + 1;
    const item = { Rank: rank };
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const values = curveValues.get(`${pos}-${rank}`) || [];
      item[`${pos} WAR`] = values.length ? average(values) : null;
    }
    return item;
  });

  state.historicalModel = {
    years,
    yearModels,
    curve,
    playerRows: historicalPlayerRows,
    projectionTeam: {
      avg: average(years.map((year) => yearModels[year].team.avg)),
      std: average(years.map((year) => yearModels[year].team.std))
    }
  };
}

function calculateWar(players) {
  const cfg = settings();
  const adpMap = normalizeAdp(state.adpRows);
  const normalized = state.rawProjections
    .map((row, index) => normalizeProjection(row, index, adpMap))
    .filter(Boolean)
    .filter((player) => player.AVG !== null || player["Existing WAR"] !== null);

  const baselines = buildBaselines(normalized);
  state.baselines = baselines;

  const results = normalized.map((player) => {
    const posBase = baselines[player.Pos];
    const avg = player.AVG ?? player["Existing WAR"];
    const rawWar = player.AVG === null && player["Existing WAR"] !== null ? player["Existing WAR"] :
      (normalCdf(baselines.TEAM.avg - posBase.avg + avg, baselines.TEAM.avg, baselines.TEAM.std) -
        normalCdf(baselines.TEAM.avg - posBase.avg + posBase.replacement, baselines.TEAM.avg, baselines.TEAM.std)) * cfg.weeks;
    const flexWar = ["RB", "WR", "TE"].includes(player.Pos)
      ? (normalCdf(baselines.TEAM.avg - baselines.FLEX.avg + avg, baselines.TEAM.avg, baselines.TEAM.std) -
        normalCdf(baselines.TEAM.avg - baselines.FLEX.avg + baselines.FLEX.replacement, baselines.TEAM.avg, baselines.TEAM.std)) * cfg.weeks
      : null;
    const superflexWar = baselines.SUPERFLEX.count
      ? (normalCdf(baselines.TEAM.avg - baselines.SUPERFLEX.avg + avg, baselines.TEAM.avg, baselines.TEAM.std) -
        normalCdf(baselines.TEAM.avg - baselines.SUPERFLEX.avg + baselines.SUPERFLEX.replacement, baselines.TEAM.avg, baselines.TEAM.std)) * cfg.weeks
      : null;
    return { ...player, "Raw WAR": rawWar, WAR: rawWar, "Flex WAR": flexWar, "SuperFlex WAR": superflexWar };
  });

  const byPos = {};
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    byPos[pos] = results.filter((player) => player.Pos === pos).sort((a, b) => b.WAR - a.WAR);
    byPos[pos].forEach((player, index) => {
      player.Rank = index + 1;
      player["Pos Rank"] = `${index + 1}${pos}`;
      player["Historical WAR"] = historicalForRank(pos, index + 1);
      player["Delta vs Historical"] = player["Historical WAR"] === null ? null : player.WAR - player["Historical WAR"];
    });
  }

  results.sort((a, b) => b.WAR - a.WAR);
  const topWar = Math.max(...results.map((player) => Math.max(0, number(player.WAR, 0))), 1);
  results.forEach((player, index) => {
    player["Overall Rank"] = index + 1;
    const adpDiscount = player.ADP === null ? null : player.ADP - (index + 1);
    const warWeight = Math.max(0, number(player.WAR, 0)) / topWar;
    player["ADP Discount"] = adpDiscount;
    player.Value = adpDiscount === null ? null : adpDiscount * warWeight;
  });
  assignTiers(results);
  state.results = results;
}

function assignTiers(results) {
  const values = results.map((player) => player.WAR).filter((value) => Number.isFinite(value));
  if (values.length < 4) {
    results.forEach((player) => { player.Tier = 1; });
    return;
  }

  const minK = Math.min(30, values.length);
  const maxK = Math.min(48, Math.max(minK, Math.ceil(Math.sqrt(values.length) * 2.5)), values.length);
  let best = null;
  for (let k = minK; k <= maxK; k += 1) {
    const model = kmeans1d(values, k);
    if (!best || model.score > best.score) best = model;
  }
  if (!best) {
    results.forEach((player) => { player.Tier = 1; });
    return;
  }

  const orderedClusters = best.centroids
    .map((centroid, cluster) => ({ centroid, cluster }))
    .sort((a, b) => b.centroid - a.centroid);
  const tierByCluster = new Map(orderedClusters.map((item, index) => [item.cluster, index + 1]));
  results.forEach((player) => {
    player.Tier = tierByCluster.get(nearestCentroid(player.WAR, best.centroids)) || orderedClusters.length;
  });
  if (new Set(results.map((player) => player.Tier)).size < minK) {
    assignRankBalancedTiers(results, minK);
  }
}

function assignRankBalancedTiers(results, tierCount) {
  const sorted = [...results].sort((a, b) => b.WAR - a.WAR);
  sorted.forEach((player, index) => {
    player.Tier = Math.min(tierCount, Math.floor((index / sorted.length) * tierCount) + 1);
  });
}

function nearestCentroid(value, centroids) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  centroids.forEach((centroid, index) => {
    const distance = Math.abs(value - centroid);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function kmeans1d(values, k) {
  const sorted = [...values].sort((a, b) => a - b);
  let centroids = Array.from({ length: k }, (_, index) => {
    const pick = Math.floor(((index + 0.5) / k) * sorted.length);
    return sorted[Math.min(sorted.length - 1, pick)];
  });

  let assignments = values.map((value) => nearestCentroid(value, centroids));
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const nextCentroids = centroids.map((centroid, cluster) => {
      const clusterValues = values.filter((_, index) => assignments[index] === cluster);
      return clusterValues.length ? average(clusterValues) : centroid;
    });
    const nextAssignments = values.map((value) => nearestCentroid(value, nextCentroids));
    if (nextAssignments.every((cluster, index) => cluster === assignments[index])) {
      centroids = nextCentroids;
      break;
    }
    centroids = nextCentroids;
    assignments = nextAssignments;
  }

  return { centroids, assignments, score: silhouetteScore(values, assignments, k) };
}

function silhouetteScore(values, assignments, k) {
  const clusters = Array.from({ length: k }, () => []);
  values.forEach((value, index) => clusters[assignments[index]].push({ value, index }));
  const nonEmpty = clusters.filter((cluster) => cluster.length);
  if (nonEmpty.length < 2 || nonEmpty.some((cluster) => cluster.length < 2)) return -1;

  const scores = values.map((value, index) => {
    const cluster = assignments[index];
    const own = clusters[cluster];
    const a = own.length > 1
      ? average(own.filter((other) => other.index !== index).map((other) => Math.abs(value - other.value)))
      : 0;
    const b = Math.min(...clusters
      .filter((_, otherCluster) => otherCluster !== cluster && clusters[otherCluster].length)
      .map((other) => average(other.map((otherValue) => Math.abs(value - otherValue.value)))));
    return (b - a) / Math.max(a, b, 0.000001);
  });
  return average(scores);
}

function visibleResults() {
  const activePositions = new Set([...document.querySelectorAll("input[name='posFilter']:checked")].map((input) => input.value));
  const query = el("searchInput").value.trim().toLowerCase();
  return state.results.filter((player) => {
    if (!activePositions.has(player.Pos)) return false;
    if (!query) return true;
    return `${player.Player} ${player.Team}`.toLowerCase().includes(query);
  });
}

function sortedResults(rows) {
  const dir = state.sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[state.sortKey];
    const bv = b[state.sortKey];
    if (typeof av === "string" || typeof bv === "string") return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    return ((av ?? Number.POSITIVE_INFINITY) - (bv ?? Number.POSITIVE_INFINITY)) * dir;
  });
}

function updateSummary(rows) {
  const topWar = [...rows].sort((a, b) => b.WAR - a.WAR)[0];
  const valueRows = rows.filter((row) => row.Value !== null);
  const topValue = [...valueRows].sort((a, b) => b.Value - a.Value)[0];
  const reps = ["QB", "RB", "WR", "TE"]
    .map((pos) => `${pos} ${fmt(state.baselines[pos]?.replacement, 1)} FPTS/G`)
    .join(" · ");
  el("playerCount").textContent = rows.length;
  el("topWar").textContent = topWar ? `${topWar.Player} ${fmt(topWar.WAR)}` : "-";
  el("topValue").textContent = topValue ? `${topValue.Player} ${fmt(topValue.Value, 1)}` : "N/A";
  const teamSource = state.baselines.TEAM?.source === "historical" ? "hist team" : "proj team";
  el("replacementSummary").textContent = reps ? `${reps} · ${teamSource}` : "-";
}

function projectionChartCopy(metric) {
  const cfg = settings();
  const scoringBits = [];
  if (cfg.scoring.rec === 1) scoringBits.push("PPR");
  else if (cfg.scoring.rec === 0.5) scoringBits.push("Half PPR");
  else if (cfg.scoring.rec === 0) scoringBits.push("Standard");
  else scoringBits.push(`${fmt(cfg.scoring.rec, 1)} PPR`);
  if (cfg.scoring.tePremium) scoringBits.push(`TE+${fmt(cfg.scoring.tePremium, 1)}`);

  const rosterBits = [`${cfg.teams} teams`, `${cfg.slots.QB}QB`, `${cfg.slots.RB}RB`, `${cfg.slots.WR}WR`, `${cfg.slots.TE}TE`];
  if (cfg.slots.FLEX) rosterBits.push(`${cfg.slots.FLEX} Flex`);
  if (cfg.slots.SUPERFLEX) rosterBits.push(`${cfg.slots.SUPERFLEX} SuperFlex`);

  const labels = {
    WAR: "Projected WAR",
    Value: "Weighted ADP Value",
    "Historical WAR": "Historical Positional-Rank WAR",
    "Delta vs Historical": "Projection Delta vs Historical Rank"
  };
  const teamSource = state.baselines.TEAM?.source === "historical" ? "historical team scoring" : "projection-only team scoring";
  const start = el("historyStart")?.value || "2015";
  return {
    title: `${cfg.year} ${labels[metric] || metric} vs ADP by Position`,
    subtitle: `${rosterBits.join(" / ")} - ${scoringBits.join(" / ")} - ${cfg.weeks} weeks - ${teamSource} from ${start}+ seasons`
  };
}

function renderProjectionChart(rows) {
  const metric = el("chartMetric").value;
  const xKey = rows.some((row) => row[metric] !== null) ? metric : "WAR";
  const copy = projectionChartCopy(xKey);
  if (el("projectionChartTitle")) el("projectionChartTitle").textContent = copy.title;
  if (el("projectionChartSubtitle")) el("projectionChartSubtitle").textContent = copy.subtitle;
  const traces = ["QB", "RB", "WR", "TE"].map((pos) => {
    const group = rows.filter((player) => player.Pos === pos);
    return {
      type: "scatter",
      mode: "markers",
      name: pos,
      x: group.map((player) => player[xKey]),
      y: group.map((player) => player.ADP ?? player["Overall Rank"]),
      ids: group.map((player) => player.id),
      text: group.map((player) => `${player.Player} (${player.Team || "-"})`),
    customdata: group.map((player) => [player.WAR, player["Historical WAR"], player["Delta vs Historical"], player.Tier, player.Value]),
      hovertemplate:
        "<b>%{text}</b><br>" +
        `${xKey}: %{x:.2f}<br>` +
        "ADP/rank: %{y:.1f}<br>" +
        "WAR: %{customdata[0]:.2f}<br>" +
        "Hist: %{customdata[1]:.2f}<br>" +
        "Tier: %{customdata[3]}<extra></extra>",
      marker: {
        color: posColors[pos],
        size: 10,
        symbol: posSymbols[pos],
        opacity: 0.86,
        line: { color: pos === "QB" || pos === "TE" ? "#111111" : "#f0f0f0", width: 1.5 }
      }
    };
  });

  Plotly.react("projectionChart", traces, {
    title: { text: copy.title, font: { size: 18 }, x: 0.02, xanchor: "left" },
    margin: { l: 56, r: 18, t: 58, b: 48 },
    xaxis: { title: xKey, zeroline: false, gridcolor: "rgba(240,240,240,0.18)", color: "#f0f0f0" },
    yaxis: { title: "ADP / overall rank", autorange: "reversed", gridcolor: "rgba(240,240,240,0.18)", color: "#f0f0f0" },
    legend: { orientation: "h", y: 1.08 },
    font: { family: "Mulish, sans-serif", color: "#f0f0f0" },
    plot_bgcolor: "#111111",
    paper_bgcolor: "#111111",
    hovermode: "closest",
    hoverlabel: { bgcolor: "#111111", bordercolor: "#cc3333", font: { color: "#f0f0f0" } }
  }, { responsive: true });

  document.querySelector("#projectionChart").on("plotly_click", (event) => {
    const id = event.points?.[0]?.id;
    if (id) selectPlayer(id);
  });
}

function renderRankCurve() {
  const selected = el("rankCurvePosition").value;
  const positions = selected === "ALL" ? ["QB", "RB", "WR", "TE"] : [selected];
  const curve = state.historicalModel?.curve || [];
  const traces = positions.map((pos) => ({
    type: "scatter",
    mode: "lines+markers",
    name: pos,
    x: curve.map((row) => number(row.Rank)),
    y: curve.map((row) => number(row[`${pos} WAR`])),
    line: { color: posColors[pos], width: 2, dash: posDashes[pos] },
    marker: { size: 5, symbol: posSymbols[pos], color: posColors[pos], line: { color: "#111111", width: 1 } }
  }));
  Plotly.react("rankCurveChart", traces, {
    margin: { l: 42, r: 10, t: 8, b: 36 },
    xaxis: { title: "Pos rank", gridcolor: "rgba(240,240,240,0.18)", color: "#f0f0f0" },
    yaxis: { title: "WAR", gridcolor: "rgba(240,240,240,0.18)", color: "#f0f0f0" },
    font: { family: "Mulish, sans-serif", color: "#f0f0f0" },
    plot_bgcolor: "#111111",
    paper_bgcolor: "#111111",
    showlegend: selected === "ALL"
  }, { responsive: true, displayModeBar: false });
}

function valueClass(value) {
  const parsed = number(value);
  if (parsed === null) return "";
  return parsed >= 0 ? "value-pos" : "value-neg";
}

function playerHistory(player) {
  if (!player || !state.historicalModel?.playerRows) return [];
  const key = playerKey(player.Player);
  return state.historicalModel.playerRows
    .filter((row) => row.PlayerKey === key && row.Pos === player.Pos)
    .sort((a, b) => b.Year - a.Year);
}

function renderHistoryTable(player, historyRows) {
  if (!historyRows.length) {
    return `<p class="muted history-empty">No historical weekly rows found for ${escapeHtml(player.Player)}.</p>`;
  }
  const selectedYear = state.selectedHistoryYear ?? historyRows[0].Year;
  const selected = historyRows.find((row) => row.Year === selectedYear) || historyRows[0];
  state.selectedHistoryYear = selected.Year;
  const selectedWeekMap = new Map(selected.Weeks.map((week) => [week.Week, week]));
  const weekNumbers = Array.from({ length: weekLimit() }, (_, index) => index + 1);
  const weekHeaders = weekNumbers.map((week) => `<th>${week}</th>`).join("");
  const warCells = weekNumbers.map((week) => `<td>${fmt(selectedWeekMap.get(week)?.WAR, 3)}</td>`).join("");
  const fptsCells = weekNumbers.map((week) => `<td>${fmt(selectedWeekMap.get(week)?.FPTS, 2)}</td>`).join("");
  const yearlyRows = historyRows.map((row) => `
    <tr class="${row.Year === selected.Year ? "selected-history-year" : ""}" data-history-year="${row.Year}">
      <td>${row.Year}</td>
      <td>${fmt(row.FPTS, 1)}</td>
      <td>${fmt(row.AVG, 2)}</td>
      <td>${fmt(row.WAR)}</td>
      <td>${fmt(row["Flex WAR"])}</td>
      <td>${fmt(row["SuperFlex WAR"])}</td>
      <td>${fmt(row.Games, 0)}</td>
    </tr>
  `).join("");
  return `
    <div class="history-panel">
      <div class="history-header">
        <h3>Historical Performance</h3>
        <span>${selected.Year} - ${fmt(selected.FPTS, 1)} FPTS - ${fmt(selected.AVG, 2)} / game - ${fmt(selected.WAR)} WAR</span>
      </div>
      <div class="history-season-table">
        <table>
          <thead><tr><th>Year</th><th>FPTS</th><th>AVG</th><th>WAR</th><th>Flex</th><th>SF</th><th>Games</th></tr></thead>
          <tbody>${yearlyRows}</tbody>
        </table>
      </div>
      <div class="history-weeks">
        <table>
          <thead><tr><th>Metric</th>${weekHeaders}</tr></thead>
          <tbody>
            <tr><th>WAR</th>${warCells}</tr>
            <tr><th>FPTS</th>${fptsCells}</tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTable(rows) {
  const limited = sortedResults(rows).slice(0, 400);
  el("playersBody").innerHTML = limited.map((player) => {
    const selected = player.id === state.selectedId;
    return `
      <tr data-id="${player.id}" class="${selected ? "selected-row" : ""}">
        <td>${fmt(player["Overall Rank"], 0)}</td>
        <td><strong>${escapeHtml(player.Player)}</strong></td>
        <td><span class="pos-pill pos-${player.Pos}">${player.Pos}</span></td>
        <td>${escapeHtml(player.Team || "-")}</td>
        <td>${fmt(player.WAR)}</td>
        <td>${fmt(player["Flex WAR"])}</td>
        <td>${fmt(player["SuperFlex WAR"])}</td>
        <td>${fmt(player["Historical WAR"])}</td>
        <td class="${valueClass(player["Delta vs Historical"])}">${fmt(player["Delta vs Historical"])}</td>
        <td>${fmt(player.ADP, 1)}</td>
        <td class="${valueClass(player.Value)}">${fmt(player.Value, 1)}</td>
        <td>${fmt(player.Tier, 0)}</td>
      </tr>
      ${selected ? renderPlayerDetailRow(player) : ""}
    `;
  }).join("");
}

function renderPlayerDetailRow(player) {
  return `
    <tr class="player-detail-row">
      <td colspan="12">
        ${renderPlayerDetail(player)}
      </td>
    </tr>
  `;
}

function oldRenderPlayerCard(player) {
  if (!player) {
    el("playerCard").innerHTML = `
      <p class="eyebrow">Selected player</p>
      <h2>Select a player</h2>
      <p class="muted">Click a point or row to inspect scoring, WAR, tier, ADP, and positional-rank comparison.</p>
    `;
    return;
  }
  el("playerCard").innerHTML = `
    <p class="eyebrow">Selected player</p>
    <h2>${player.Player}</h2>
    <p class="muted">${player.Team || "-"} · <span class="pos-pill pos-${player.Pos}">${player.Pos}</span> · ${player["Pos Rank"]}</p>
    <div class="player-stats">
      <div><span>WAR</span><strong>${fmt(player.WAR)}</strong></div>
      <div><span>Historical rank WAR</span><strong>${fmt(player["Historical WAR"])}</strong></div>
      <div><span>Delta</span><strong class="${valueClass(player["Delta vs Historical"])}">${fmt(player["Delta vs Historical"])}</strong></div>
      <div><span>Tier</span><strong>${fmt(player.Tier, 0)}</strong></div>
      <div><span>Projected AVG</span><strong>${fmt(player.AVG)}</strong></div>
      <div><span>Weighted ADP value</span><strong class="${valueClass(player.Value)}">${fmt(player.Value, 1)}</strong></div>
      <div><span>ADP discount</span><strong class="${valueClass(player["ADP Discount"])}">${fmt(player["ADP Discount"], 1)}</strong></div>
      <div><span>Flex WAR</span><strong>${fmt(player["Flex WAR"])}</strong></div>
      <div><span>SuperFlex WAR</span><strong>${fmt(player["SuperFlex WAR"])}</strong></div>
    </div>
  `;
}

function renderPlayerDetail(player) {
  if (!player) {
    return `
      <p class="eyebrow">Selected player</p>
      <h2>Select a player</h2>
      <p class="muted">Click a point or row to inspect scoring, WAR, tier, ADP, and positional-rank comparison.</p>
    `;
  }
  const historyRows = playerHistory(player);
  return `
    <div class="inline-player-detail">
    <p class="eyebrow">Selected player</p>
    <h2>${escapeHtml(player.Player)}</h2>
    <p class="muted">${escapeHtml(player.Team || "-")} - <span class="pos-pill pos-${player.Pos}">${player.Pos}</span> - ${escapeHtml(player["Pos Rank"])}</p>
    <div class="player-stats">
      <div><span>WAR</span><strong>${fmt(player.WAR)}</strong></div>
      <div><span>Historical rank WAR</span><strong>${fmt(player["Historical WAR"])}</strong></div>
      <div><span>Delta</span><strong class="${valueClass(player["Delta vs Historical"])}">${fmt(player["Delta vs Historical"])}</strong></div>
      <div><span>Tier</span><strong>${fmt(player.Tier, 0)}</strong></div>
      <div><span>Projected FPTS</span><strong>${fmt(player.FPTS, 1)}</strong></div>
      <div><span>Projected AVG</span><strong>${fmt(player.AVG)}</strong></div>
      <div><span>Weighted ADP value</span><strong class="${valueClass(player.Value)}">${fmt(player.Value, 1)}</strong></div>
      <div><span>ADP discount</span><strong class="${valueClass(player["ADP Discount"])}">${fmt(player["ADP Discount"], 1)}</strong></div>
      <div><span>Flex WAR</span><strong>${fmt(player["Flex WAR"])}</strong></div>
      <div><span>SuperFlex WAR</span><strong>${fmt(player["SuperFlex WAR"])}</strong></div>
    </div>
    ${renderHistoryTable(player, historyRows)}
    </div>
  `;
}

function renderPlayerCard(player) {
  const card = el("playerCard");
  if (card) card.innerHTML = renderPlayerDetail(player);
}

function render() {
  if (state.renderTimer) {
    clearTimeout(state.renderTimer);
    state.renderTimer = null;
  }
  computeHistoricalModel();
  calculateWar(state.rawProjections);
  const rows = visibleResults();
  updateSummary(rows);
  renderProjectionChart(rows);
  renderRankCurve();
  renderTable(rows);
}

function scheduleRender(delay = 90) {
  if (state.renderTimer) clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    render();
  }, delay);
}

function selectPlayer(id) {
  if (state.selectedId !== id) state.selectedHistoryYear = null;
  state.selectedId = state.selectedId === id ? null : id;
  scheduleRender(0);
}

async function parseCsvFile(file) {
  const text = await file.text();
  return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
}

async function loadCsv(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return Papa.parse(await response.text(), { header: true, skipEmptyLines: true }).data;
}

async function setProjectionRows(rows) {
  state.rawProjections = rows;
  state.selectedId = null;
  scheduleRender(0);
}

async function initData() {
  try {
    state.manifest = await loadJson("data/scrape_manifest.json");
  } catch {
    state.manifest = null;
  }
  try {
    state.rawProjections = await loadCsv(CURRENT_PROJECTIONS_PATH);
    state.adpRows = await loadCsv(CURRENT_ADP_PATH);
    state.projectionSource = CURRENT_PROJECTIONS_PATH;
    state.adpSource = CURRENT_ADP_PATH;
    setDataStatus(state.projectionSource, state.adpSource, state.manifest);
  } catch {
    state.rawProjections = await loadCsv(FALLBACK_PROJECTIONS_PATH);
    state.adpRows = [];
    state.projectionSource = FALLBACK_PROJECTIONS_PATH;
    state.adpSource = "Unavailable";
    setDataStatus(state.projectionSource, state.adpSource, state.manifest);
  }
  render();
  loadHistoricalData();
}

async function loadHistoricalData() {
  try {
    state.historicalWeeklyRows = await loadCsv(HISTORICAL_WEEKLY_PATH);
  } catch {
    state.historicalWeeklyRows = [];
  }
  state.historicalModelKey = "";
  state.historicalScoredRowsKey = "";
  setDataStatus(state.projectionSource, state.adpSource, state.manifest);
  scheduleRender(0);
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

function setDataStatus(projectionSource, adpSource, manifest) {
  const updatedAt = manifest?.updated_at ? new Date(manifest.updated_at) : null;
  const updatedText = updatedAt && !Number.isNaN(updatedAt.valueOf()) ? updatedAt.toLocaleString() : "Not recorded";
  if (el("projectionSource")) el("projectionSource").textContent = projectionSource === FALLBACK_PROJECTIONS_PATH ? "Fallback data" : updatedText;
  if (el("adpSource")) el("adpSource").textContent = adpSource === "Unavailable" ? "Unavailable" : updatedText;
  if (el("lastRefresh")) {
    const year = manifest?.season_year ? ` · ${manifest.season_year}` : "";
    const historical = state.historicalWeeklyRows.length ? " · historical loaded" : " · historical missing";
    el("lastRefresh").textContent = updatedAt && !Number.isNaN(updatedAt.valueOf())
      ? `${updatedAt.toLocaleString()}${year}${historical}`
      : `Not recorded${historical}`;
  }
}

function exportResults() {
  if (!state.results.length) return;
  const cols = ["Year", "Overall Rank", "Player", "Team", "Pos", "Pos Rank", "WAR", "Historical WAR", "Delta vs Historical", "ADP", "ADP Discount", "Value", "Tier", "AVG", "FPTS", "Flex WAR", "SuperFlex WAR"];
  const csv = [
    cols.join(","),
    ...state.results.map((row) => cols.map((col) => JSON.stringify(row[col] ?? "")).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `war-projections-${settings().year}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", () => scheduleRender());
    input.addEventListener("change", () => scheduleRender(0));
  });
  document.querySelectorAll("input[name='posFilter']").forEach((input) => input.addEventListener("change", () => scheduleRender(0)));
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDir = key === "Player" || key === "Pos" ? "asc" : "desc";
      }
      scheduleRender(0);
    });
  });
  el("playersBody").addEventListener("click", (event) => {
    const yearRow = event.target.closest("[data-history-year]");
    if (yearRow) {
      state.selectedHistoryYear = number(yearRow.dataset.historyYear, null);
      renderTable(visibleResults());
      return;
    }
    if (event.target.closest(".player-detail-row")) return;
    const row = event.target.closest("tr[data-id]");
    if (row) selectPlayer(row.dataset.id);
  });
  el("exportResults").addEventListener("click", exportResults);
}

function initControls() {
  el("historyStart").innerHTML = Array.from({ length: 12 }, (_, i) => 2026 - i)
    .filter((year) => year >= 2015)
    .map((year) => `<option value="${year}" ${year === 2015 ? "selected" : ""}>${year}</option>`)
    .join("");
}

initControls();
bindEvents();
initData().catch((error) => {
  const body = el("playersBody");
  if (body) body.innerHTML = `<tr><td colspan="12"><p class="eyebrow">Load error</p><h2>Data could not load</h2><p class="muted">${error.message}</p></td></tr>`;
});
