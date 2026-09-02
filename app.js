const CURRENT_PROJECTIONS_PATH = "data/current_projections.csv";
const CURRENT_ADP_PATH = "data/current_adp.csv";
const CUSTOM_ADP_PATH = "data/custom_adp_board.csv";
const CUSTOM_ADP_MANIFEST_PATH = "data/adp/manifest.json";
const WAR_DATA_MANIFEST_PATH = "data/war/manifest.json";
const HISTORICAL_ADP_PATH = "data/historical_adp.csv";
const HISTORICAL_ADP_PLAYER_CAP = 200;
const DRAFT_METADATA_PATH = "data/nfl_skill_players_2000_2026.csv";
const TRUSTED_WAR_CURVE_PATH = "data/historical_WAR_PPR2WR.csv";
const FALLBACK_PROJECTIONS_PATH = "data/WARProjections2024_PPR2WR.csv";
const HISTORICAL_WEEKLY_PATH = "data/fantasypros_weekly_2015_2025.csv";
const HISTORICAL_PLAYED_WEEK_VERSION = 2;

const state = {
  rawProjections: [],
  adpRows: [],
  customAdpRows: [],
  dynastyAdpRows: [],
  customAdpLoaded: false,
  customAdpManifest: null,
  customAdpLoadedKey: "",
  draftMetadataRows: [],
  trustedWarCurveRows: [],
  dynastySortKey: "dynastyWar",
  dynastySortDir: "desc",
  selectedDynastyKey: null,
  dynastyExcludedSummary: { retired: 0, inactive: 0, stale: 0, total: 0 },
  projectionFocus: "projection",
  adpSortKey: "rank",
  adpSortDir: "asc",
  selectedAdpPlayer: null,
  historicalRows: [],
  historicalWeeklyRows: [],
  historicalAdpRows: [],
  historicalModel: null,
  historicalModelKey: "",
  historicalScoredRows: [],
  historicalScoredRowsKey: "",
  manifest: null,
  warManifest: null,
  results: [],
  selectedId: null,
  selectedHistoryYear: null,
  activeView: "projectionsView",
  sortKey: "Overall Rank",
  sortDir: "asc",
  renderTimer: null,
  projectionSource: CURRENT_PROJECTIONS_PATH,
  adpSource: CURRENT_ADP_PATH,
  baselines: {}
};

const posColors = {
  QB: "#7aa6c2",
  RB: "#c46f6f",
  WR: "#8fba7a",
  TE: "#b08ac7"
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

const playerTraceColors = [
  "#7aa6c2",
  "#c46f6f",
  "#8fba7a",
  "#b08ac7",
  "#d0a85b",
  "#6fb7aa",
  "#c08da3",
  "#9ca3cf",
  "#b7b06f",
  "#d08a68"
];

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

function historicalWeekPlayed(row, points = null) {
  const games = number(firstValue(row, ["G", "Games", "game"], null), null);
  if (games !== null) return games > 0;
  const fpts = number(points, null);
  if (fpts !== null && fpts !== 0) return true;
  const usageFields = [
    "PassingATT",
    "PassingCMP",
    "PassingYDS",
    "PassingTD",
    "INTS",
    "RushingATT",
    "RushingYDS",
    "RushingTD",
    "TGT",
    "REC",
    "ReceivingYDS",
    "ReceivingTD",
    "FL"
  ];
  return usageFields.some((field) => number(firstValue(row, [field], null), 0) !== 0);
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
  return String(name || "")
    .toLowerCase()
    .replace(/\b(jr|sr|i|ii|iii|iv|v)\.?\b/g, "")
    .replace(/[^a-z]/g, "");
}

function truthyString(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return null;
}

function playerAdpKey(name) {
  return playerKey(name);
}

const firstNameAliases = {
  matthew: ["matt"],
  matt: ["matthew"],
  michael: ["mike"],
  mike: ["michael"],
  christopher: ["chris"],
  chris: ["christopher"],
  joshua: ["josh"],
  josh: ["joshua"],
  joseph: ["joe"],
  joe: ["joseph"],
  kenneth: ["kenny"],
  kenny: ["kenneth"],
  daniel: ["dan"],
  dan: ["daniel"],
  nicholas: ["nick"],
  nick: ["nicholas"],
  anthony: ["tony"],
  tony: ["anthony"],
  william: ["will", "billy"],
  will: ["william"],
  robert: ["rob", "bob"],
  rob: ["robert"],
  patrick: ["pat"],
  pat: ["patrick"]
};

function playerKeyVariants(name) {
  const base = playerKey(name);
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/\b(jr|sr|i|ii|iii|iv|v)\.?\b/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = normalized.split(/[\s-]+/).filter(Boolean);
  const variants = new Set([base]);
  if (parts.length >= 2) {
    const rest = parts.slice(1).join("");
    for (const alias of firstNameAliases[parts[0]] || []) {
      variants.add(playerKey(`${alias} ${parts.slice(1).join(" ")}`));
      variants.add(`${alias}${rest}`);
    }
  }
  return [...variants].filter(Boolean);
}

function setPlayerMapVariants(map, player, pos, value) {
  for (const key of playerKeyVariants(player)) map.set(`${key}|${pos}`, value);
}

function setPlayerMapStrict(map, player, pos, value) {
  const key = playerKey(player);
  if (key) map.set(`${key}|${pos}`, value);
}

function getPlayerMapValue(map, player, pos) {
  for (const key of playerKeyVariants(player)) {
    const value = map.get(`${key}|${pos}`);
    if (value !== undefined) return value;
  }
  return undefined;
}

function getPlayerMapStrict(map, player, pos) {
  return map.get(`${playerKey(player)}|${pos}`);
}

function normalizeProjection(row, index, adpMap) {
  const player = firstValue(row, ["Player", "player", "Name", "PLAYER"]);
  const posRaw = firstValue(row, ["Pos", "position", "POS"]);
  const pos = String(posRaw || "").toUpperCase().replace(/[0-9]/g, "");
  const team = firstValue(row, ["Team", "team", "TEAM"], "");
  if (!player || !["QB", "RB", "WR", "TE"].includes(pos)) return null;

  const adpMatch = adpMap.get(playerKey(player));
  const projectionAdp = number(firstValue(row, ["ADP", "ADP AVG", "Average Draft Position"]), null);
  const projectionAdpRank = number(firstValue(row, ["ADP Rank"], null), null);
  const adp = adpMatch?.ADP ?? projectionAdp ?? projectionAdpRank ?? null;
  const adpRank = adpMatch?.["ADP Rank"] ?? projectionAdpRank ?? adp;

  const avg = number(firstValue(row, ["AVG", "Avg", "FPTS/G", "Fantasy Points Per Game"]), null);
  const fpts = number(firstValue(row, ["FPTS", "Fantasy Points", "fantasy_points"]), null);
  const games = number(firstValue(row, ["G", "Games", "GP", "Projected Games"], null), null);
  const existingWar = number(firstValue(row, ["WAR"], null), null);
  const high = number(firstValue(row, ["AVG High", "FPTS High", "High"], null), null);
  const low = number(firstValue(row, ["AVG Low", "FPTS Low", "Low"], null), null);
  const scoring = settings().scoring;

  const scoredFromStats = calculateFantasyPoints(row, pos, scoring);
  const projectedPoints = scoredFromStats ?? fpts;
  const gameDenominator = games !== null && games > 0 ? games : settings().weeks;
  const projectedPerGameAvg = scoredFromStats !== null
    ? scoredFromStats / gameDenominator
    : avg ?? (projectedPoints !== null ? projectedPoints / gameDenominator : null);
  const projectedAvg = games !== null && games > 0 && games < 10 && projectedPoints !== null
    ? projectedPoints / settings().weeks
    : projectedPerGameAvg;

  return {
    id: `${playerKey(player)}-${pos}-${index}`,
    Source: "projection",
    Player: player,
    Team: team,
    Pos: pos,
    Year: number(firstValue(row, ["Year", "year"], null), settings().year),
    FPTS: projectedPoints,
    AVG: projectedAvg,
    "Projected FPTS/G": projectedPerGameAvg,
    G: games,
    "AVG High": high !== null && fpts !== null ? high / gameDenominator : high,
    "AVG Low": low !== null && fpts !== null ? low / gameDenominator : low,
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
  const map = new Map();
  cleaned.forEach((row) => {
    playerKeyVariants(row.Player).forEach((key) => {
      if (key && !map.has(key)) map.set(key, row);
    });
  });
  return map;
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

function percentile(values, pct) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const index = (clean.length - 1) * Math.max(0, Math.min(1, pct));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return clean[lower];
  return clean[lower] + ((clean[upper] - clean[lower]) * (index - lower));
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
    version: HISTORICAL_PLAYED_WEEK_VERSION,
    rows: state.historicalWeeklyRows.length,
    scoring: cfg.scoring
  });
  const modelKey = JSON.stringify({
    version: HISTORICAL_PLAYED_WEEK_VERSION,
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
      const played = historicalWeekPlayed(row, points);
      return {
        id: `${playerKey(firstValue(row, ["Player", "player"], ""))}-${pos}`,
        Player: firstValue(row, ["Player", "player"], ""),
        Team: firstValue(row, ["Team", "team"], ""),
        Pos: pos,
        Year: year,
        Week: week,
        FPTS: points,
        Played: played
      };
    });
  }
  const rows = state.historicalScoredRows
    .filter((row) => row.Player && ["QB", "RB", "WR", "TE"].includes(row.Pos) && row.Year >= startYear && row.Week >= 1 && row.Week <= maxWeek && row.FPTS !== null && row.Played);

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
      let playedWar = 0;
      let playedFlexWar = 0;
      let playedSuperflexWar = 0;
      let games = 0;
      const weeks = [];
      for (let week = 1; week <= maxWeek; week += 1) {
        const actual = player.weeks.get(week);
        if (actual === undefined) continue;
        const score = actual;
        games += 1;
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
        playedWar += weeklyWar;
        if (weeklyFlexWar !== null) playedFlexWar += weeklyFlexWar;
        if (weeklySuperflexWar !== null) playedSuperflexWar += weeklySuperflexWar;
        weeks.push({
          Week: week,
          FPTS: actual,
          WAR: weeklyWar,
          "Flex WAR": weeklyFlexWar,
          "SuperFlex WAR": weeklySuperflexWar
        });
      }
      historicalPlayerRows.push({
        ...player,
        PlayerKey: playerKey(player.Player),
        Year: year,
        WAR: war,
        "Flex WAR": ["RB", "WR", "TE"].includes(player.Pos) ? flexWar : null,
        "SuperFlex WAR": posModel.SUPERFLEX.count ? superflexWar : null,
        "Played WAR": playedWar,
        "Played Flex WAR": ["RB", "WR", "TE"].includes(player.Pos) ? playedFlexWar : null,
        "Played SuperFlex WAR": posModel.SUPERFLEX.count ? playedSuperflexWar : null,
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
    const warGames = projectionWarGames(player);
    const rawWar = player.AVG === null && player["Existing WAR"] !== null ? player["Existing WAR"] :
      (normalCdf(baselines.TEAM.avg - posBase.avg + avg, baselines.TEAM.avg, baselines.TEAM.std) -
        normalCdf(baselines.TEAM.avg - posBase.avg + posBase.replacement, baselines.TEAM.avg, baselines.TEAM.std)) * warGames;
    const flexWar = ["RB", "WR", "TE"].includes(player.Pos)
      ? (normalCdf(baselines.TEAM.avg - baselines.FLEX.avg + avg, baselines.TEAM.avg, baselines.TEAM.std) -
        normalCdf(baselines.TEAM.avg - baselines.FLEX.avg + baselines.FLEX.replacement, baselines.TEAM.avg, baselines.TEAM.std)) * warGames
      : null;
    const superflexWar = baselines.SUPERFLEX.count
      ? (normalCdf(baselines.TEAM.avg - baselines.SUPERFLEX.avg + avg, baselines.TEAM.avg, baselines.TEAM.std) -
        normalCdf(baselines.TEAM.avg - baselines.SUPERFLEX.avg + baselines.SUPERFLEX.replacement, baselines.TEAM.avg, baselines.TEAM.std)) * warGames
      : null;
    return { ...player, "WAR Games": warGames, "Raw WAR": rawWar, WAR: rawWar, "Flex WAR": flexWar, "SuperFlex WAR": superflexWar };
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

function projectionWarGames(player) {
  const cfg = settings();
  return cfg.weeks;
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

function adpSettings() {
  const cfg = settings();
  const isTwoQb = cfg.slots.SUPERFLEX > 0 || cfg.slots.QB > 1;
  return {
    season: number(el("adpSeason")?.value, cfg.year),
    leagueFormat: el("adpLeagueFormat")?.value || "redraft",
    boardType: el("adpBoardType")?.value || "all",
    rookieInclusion: el("adpRookieInclusion")?.value || "all",
    draftType: el("adpDraftType")?.value || "snake",
    bestball: el("adpBestball")?.value || "all",
    scoring: el("adpScoring")?.value || "ppr",
    superflex: isTwoQb ? "true" : "false",
    teams: String(cfg.teams),
    rounds: "all",
    startDate: el("adpStartDate")?.value || "",
    endDate: el("adpEndDate")?.value || "",
    minDrafts: number(el("adpMinDrafts")?.value, 5),
    query: String(el("adpSearch")?.value || "").trim().toLowerCase(),
    slots: cfg.slots,
    scoringValues: cfg.scoring
  };
}

function dynastySettings() {
  return {
    horizon: Math.max(1, Math.min(10, number(el("dynastyHorizon")?.value, 3))),
    position: el("dynastyPosition")?.value || "ALL",
    query: String(el("dynastySearch")?.value || "").trim().toLowerCase(),
    projectedOnly: el("dynastyProjectedOnly")?.checked !== false
  };
}

function dynastyShowsSuperflex() {
  return number(el("superflexSlots")?.value, 0) > 0;
}

function draftMetadataMap() {
  const map = new Map();
  const variantBuckets = new Map();
  for (const row of state.draftMetadataRows) {
    const pos = String(row.pos || "").toUpperCase();
    if (!["QB", "RB", "WR", "TE"].includes(pos)) continue;
    const value = {
      player: row.player,
      draftYear: number(row.draft_year, null),
      draftRound: number(row.round, null),
      draftPick: number(row.pick, null),
      draftAge: number(row.age, null)
    };
    setPlayerMapStrict(map, row.player, pos, value);
    for (const key of playerKeyVariants(row.player)) {
      const mapKey = `${key}|${pos}`;
      if (!variantBuckets.has(mapKey)) variantBuckets.set(mapKey, []);
      variantBuckets.get(mapKey).push({ strictKey: playerKey(row.player), value });
    }
  }
  for (const [mapKey, matches] of variantBuckets.entries()) {
    const distinctPlayers = new Set(matches.map((match) => match.strictKey));
    if (distinctPlayers.size === 1 && !map.has(mapKey)) {
      map.set(mapKey, matches[matches.length - 1].value);
    }
  }
  return map;
}

function trustedCurveWar(pos, rank) {
  const rounded = Math.max(1, Math.round(number(rank, 1)));
  const row = state.trustedWarCurveRows.find((item) => Math.round(number(item.Rank, 0)) === rounded);
  return number(row?.[`${pos} WAR`], null);
}

function ageForProjection(meta, season) {
  if (!meta || meta.draftAge === null || meta.draftYear === null) return null;
  return meta.draftAge + (season - meta.draftYear);
}

function defaultRookieAge(pos) {
  return { QB: 23, RB: 22, WR: 22, TE: 23 }[pos] || 22;
}

const dynastyAgeCurves = {
  QB: { peakStart: 27, peakEnd: 32, youngSlope: 0.105, oldSlope: 0.055, floor: 0.36, retention: 0.985 },
  RB: { peakStart: 23, peakEnd: 25, youngSlope: 0.16, oldSlope: 0.145, floor: 0.18, retention: 0.93 },
  WR: { peakStart: 25, peakEnd: 28, youngSlope: 0.125, oldSlope: 0.095, floor: 0.24, retention: 0.96 },
  TE: { peakStart: 26, peakEnd: 29, youngSlope: 0.115, oldSlope: 0.085, floor: 0.26, retention: 0.955 }
};

const dynastyDraftClassCurveCache = new Map();

function dynastyAgeFactor(pos, age) {
  const curve = dynastyAgeCurves[pos] || dynastyAgeCurves.WR;
  if (age === null || age === undefined) return null;
  const parsedAge = number(age, null);
  if (parsedAge === null) return null;
  if (parsedAge >= curve.peakStart && parsedAge <= curve.peakEnd) return 1;
  const distance = parsedAge < curve.peakStart ? curve.peakStart - parsedAge : parsedAge - curve.peakEnd;
  const slope = parsedAge < curve.peakStart ? curve.youngSlope : curve.oldSlope;
  return Math.max(curve.floor, 1 - (distance * slope));
}

function dynastyFallbackRetention(pos, yearOffset) {
  const curve = dynastyAgeCurves[pos] || dynastyAgeCurves.WR;
  return curve.retention ** yearOffset;
}

function dynastyVeteranDecline(pos, currentAge, futureAge) {
  const curve = dynastyAgeCurves[pos] || dynastyAgeCurves.WR;
  if (currentAge === null || futureAge <= currentAge || currentAge <= curve.peakEnd) return 1;
  const decline = { QB: 0.965, RB: 0.78, WR: 0.87, TE: 0.88 }[pos] || 0.86;
  return decline ** (futureAge - currentAge);
}

function inferredDynastyAge(player, pos) {
  const key = playerKey(player);
  const seasons = (state.historicalModel?.playerRows || [])
    .filter((row) => row.PlayerKey === key && row.Pos === pos)
    .map((row) => row.Year);
  if (!seasons.length) return null;
  const firstYear = Math.min(...seasons);
  return defaultRookieAge(pos) + Math.max(0, settings().year - firstYear);
}

function playerHistoricalWarProfile(player, pos, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const playedMetric = `Played ${yMetric}`;
  const key = playerKey(player);
  const seasons = (state.historicalModel?.playerRows || [])
    .filter((row) => row.PlayerKey === key && row.Pos === pos)
    .sort((a, b) => b.Year - a.Year)
    .slice(0, 3);
  if (!seasons.length) return null;
  const seasonWars = seasons.map((row) => number(row[playedMetric], number(row[yMetric], null))).filter((value) => value !== null);
  const warPerGame = seasons
    .map((row) => {
      const war = number(row[playedMetric], number(row[yMetric], null));
      const games = number(row.Games, null);
      return war !== null && games ? war / games : null;
    })
    .filter((value) => value !== null);
  if (!seasonWars.length && !warPerGame.length) return null;
  return {
    seasonWar: seasonWars.length ? weightedAverageRecent(seasonWars) : null,
    warPerGame: warPerGame.length ? weightedAverageRecent(warPerGame) : null
  };
}

function historicalFptsPerGame(row) {
  if (!row) return null;
  const games = number(firstValue(row, ["Games", "G"], null), null);
  const fpts = number(firstValue(row, ["FPTS", "Fantasy Points", "TTL", "Points"], null), null);
  return games && fpts !== null ? fpts / games : null;
}

function playerHistoricalFptsProfile(player, pos) {
  const key = playerKey(player);
  const seasons = (state.historicalModel?.playerRows || [])
    .filter((row) => row.PlayerKey === key && row.Pos === pos)
    .sort((a, b) => b.Year - a.Year)
    .slice(0, 3)
    .map((row) => ({
      Year: number(row.Year, null),
      Games: number(firstValue(row, ["Games", "G"], null), null),
      FPTS: number(firstValue(row, ["FPTS", "Fantasy Points", "TTL", "Points"], null), null),
      FptsPerGame: historicalFptsPerGame(row)
    }))
    .filter((row) => row.FptsPerGame !== null);
  if (!seasons.length) return null;
  return {
    previousFptsPerGame: seasons[0].FptsPerGame,
    weightedFptsPerGame: weightedAverageRecent(seasons.map((row) => row.FptsPerGame)),
    seasons
  };
}

function playerHasRecentPlayedSeason(player, pos, season = settings().year) {
  const key = playerKey(player);
  const minYear = season - 2;
  const playerRows = state.historicalModel?.playerRows || [];
  if (!playerRows.length) return null;
  return playerRows.some((row) => {
    if (row.PlayerKey !== key || row.Pos !== pos) return false;
    const year = number(row.Year, null);
    if (year === null || year < minYear || year >= season) return false;
    const games = number(firstValue(row, ["Games", "G"], null), null);
    const fpts = number(firstValue(row, ["Fantasy Points", "FPTS", "TTL", "Points"], null), null);
    const war = number(firstValue(row, ["WAR", "Flex WAR", "SuperFlex WAR"], null), null);
    return (games !== null && games > 0) || (fpts !== null && fpts > 0) || (war !== null && war !== 0);
  });
}

function sleeperPlayerStatus(row) {
  return String(firstValue(row, ["status", "player_status", "sleeper_status", "fantasy_status"], "") || "").trim();
}

function sleeperPlayerActive(row) {
  return truthyString(firstValue(row, ["active", "is_active", "player_active"], null));
}

function combineSleeperStatus(item, row) {
  const status = sleeperPlayerStatus(row);
  if (status && !item.status) item.status = status;
  const active = sleeperPlayerActive(row);
  if (active === true) item.active = true;
  if (active === false && item.active === null) item.active = false;
}

function dynastyIsCurrentRookie(item, meta) {
  return meta?.draftYear !== null && meta?.draftYear >= settings().year;
}

function dynastyExclusionReason(item, current, meta) {
  if (item.Pos === "RDP") return "";
  const status = String(item.status || "").toLowerCase();
  if (status.includes("retired") || status.includes("deceased")) return "retired";
  const hasProjection = Boolean(current);
  if (dynastyIsCurrentRookie(item, meta)) return "";
  if (item.active === false && !hasProjection) return "inactive";
  if (!hasProjection && playerHasRecentPlayedSeason(item.Player, item.Pos, settings().year) === false) return "stale";
  return "";
}

function weightedAverageRecent(values) {
  const weights = [0.5, 0.3, 0.2];
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  const totalWeight = clean.reduce((sum, _, index) => sum + (weights[index] || 0.1), 0);
  return clean.reduce((sum, value, index) => sum + (value * (weights[index] || 0.1)), 0) / Math.max(0.001, totalWeight);
}

function dynastyPlayerBaseWar(player, pos, currentWar, metric = "WAR", isRookie = false) {
  const projectedWar = Math.max(0, number(currentWar, 0));
  if (isRookie) return projectedWar;
  const profile = playerHistoricalWarProfile(player, pos, metric);
  if (!profile) return projectedWar;
  const games = settings().weeks;
  const warPerGameSeason = profile.warPerGame === null ? null : profile.warPerGame * games;
  const pieces = [
    { value: projectedWar, weight: 0.58 },
    { value: profile.seasonWar, weight: 0.24 },
    { value: warPerGameSeason, weight: 0.18 }
  ].filter((piece) => piece.value !== null && Number.isFinite(piece.value));
  const totalWeight = pieces.reduce((sum, piece) => sum + piece.weight, 0);
  return Math.max(0, pieces.reduce((sum, piece) => sum + (piece.value * piece.weight), 0) / Math.max(0.001, totalWeight));
}

function warFromAverage(pos, avg, metric = "WAR") {
  const fptsPerGame = number(avg, null);
  if (fptsPerGame === null || !state.baselines?.TEAM) return null;
  const cfg = settings();
  const team = state.baselines.TEAM;
  let base = state.baselines[pos];
  if (metric === "Flex WAR") {
    if (!["RB", "WR", "TE"].includes(pos)) return null;
    base = state.baselines.FLEX;
  }
  if (metric === "SuperFlex WAR") {
    base = state.baselines.SUPERFLEX;
    if (!base?.count) return null;
  }
  if (!base) return null;
  return (normalCdf(team.avg - base.avg + fptsPerGame, team.avg, team.std) -
    normalCdf(team.avg - base.avg + base.replacement, team.avg, team.std)) * cfg.weeks;
}

function dynastyPlayerBaseFptsPerGame(player, pos, projectedFptsPerGame, isRookie = false) {
  const projected = number(projectedFptsPerGame, null);
  if (isRookie) return projected ?? 0;
  const profile = playerHistoricalFptsProfile(player, pos);
  if (!profile) return projected ?? 0;
  const pieces = [
    { value: projected, weight: 0.6 },
    { value: profile.previousFptsPerGame, weight: 0.24 },
    { value: profile.weightedFptsPerGame, weight: 0.16 }
  ].filter((piece) => piece.value !== null && Number.isFinite(piece.value));
  if (!pieces.length) return 0;
  const totalWeight = pieces.reduce((sum, piece) => sum + piece.weight, 0);
  return Math.max(0, pieces.reduce((sum, piece) => sum + (piece.value * piece.weight), 0) / Math.max(0.001, totalWeight));
}

function dynastyPlayerYearlyFptsPerGame(pos, baseFptsPerGame, age, horizon) {
  const base = Math.max(0, number(baseFptsPerGame, 0));
  if (!horizon) return [];
  if (age === null || age === undefined) {
    return Array.from({ length: horizon }, (_, index) => base * dynastyFallbackRetention(pos, index));
  }
  const currentAgeFactor = Math.max(dynastyAgeFactor(pos, age) ?? 1, 0.2);
  return Array.from({ length: horizon }, (_, index) => {
    const futureAge = number(age, 0) + index;
    const ageFactor = dynastyAgeFactor(pos, futureAge) ?? dynastyFallbackRetention(pos, index);
    const relativeAgeFactor = ageFactor / currentAgeFactor;
    const veteranDecline = dynastyVeteranDecline(pos, number(age, 0), futureAge);
    return Math.max(0, base * relativeAgeFactor * veteranDecline);
  });
}

function dynastyPlayerYearlyWar(pos, currentWar, age, horizon) {
  const baseWar = Math.max(0, number(currentWar, 0));
  if (!horizon) return [];
  if (age === null || age === undefined) {
    return Array.from({ length: horizon }, (_, index) => baseWar * dynastyFallbackRetention(pos, index));
  }
  const currentAgeFactor = Math.max(dynastyAgeFactor(pos, age) ?? 1, 0.2);
  return Array.from({ length: horizon }, (_, index) => {
    const futureAge = number(age, 0) + index;
    const ageFactor = dynastyAgeFactor(pos, futureAge) ?? dynastyFallbackRetention(pos, index);
    const relativeAgeFactor = ageFactor / currentAgeFactor;
    const veteranDecline = dynastyVeteranDecline(pos, number(age, 0), futureAge);
    return Math.max(0, baseWar * relativeAgeFactor * veteranDecline);
  });
}

function dynastyAnchorCurrentYear(yearly, currentWar) {
  const anchored = [...(yearly || [])];
  if (anchored.length) anchored[0] = number(currentWar, 0);
  return anchored;
}

function dynastyAgeCurveRows(row, extraYears = 4) {
  const horizon = Math.max(dynastySettings().horizon, 5);
  const pos = row.Pos === "RDP" ? row.bestCasePos || "WR" : row.Pos;
  const yMetric = dynastyShowsSuperflex() ? "SuperFlex WAR" : "WAR";
  if (row.Pos === "RDP") {
    const values = yMetric === "SuperFlex WAR" && row.yearlySuperflexWar?.length ? row.yearlySuperflexWar : row.yearlyWar;
    return (values || []).map((war, index) => ({
      Year: settings().year + index,
      Age: null,
      WAR: war,
      Label: `Y${index + 1}`
    }));
  }
  const age = number(row.age, null);
  if (age === null) return [];
  const baseFptsPerGame = Math.max(0, number(row.blendedFptsPerGame ?? row.projectedFptsPerGame, 0));
  const currentAgeFactor = Math.max(dynastyAgeFactor(pos, age) ?? 1, 0.2);
  const startAge = Math.max(18, Math.floor(age) - 2);
  const endAge = Math.ceil(age) + horizon + extraYears;
  const curveAges = Array.from(new Set([
    ...Array.from({ length: Math.max(1, endAge - startAge + 1) }, (_, index) => startAge + index),
    Number(age.toFixed(2))
  ])).sort((a, b) => a - b);
  return curveAges.map((curveAge) => {
    const ageFactor = dynastyAgeFactor(pos, curveAge) ?? 0;
    const veteranDecline = curveAge >= age ? dynastyVeteranDecline(pos, age, curveAge) : 1;
    const fptsPerGame = baseFptsPerGame * (ageFactor / currentAgeFactor) * veteranDecline;
    const war = warFromAverage(pos, fptsPerGame, yMetric) ?? 0;
    return {
      Year: settings().year + (curveAge - age),
      Age: curveAge,
      WAR: Math.abs(curveAge - age) < 0.001
        ? number(yMetric === "SuperFlex WAR" ? row.currentSuperflexWar : row.currentWar, war)
        : war,
      Label: `Age ${curveAge}`
    };
  });
}

function dynastyHistoricalWarPoints(row) {
  if (row.Pos === "RDP") return [];
  const yMetric = dynastyShowsSuperflex() ? "SuperFlex WAR" : "WAR";
  const playedMetric = `Played ${yMetric}`;
  const meta = getPlayerMapStrict(draftMetadataMap(), row.Player, row.Pos);
  if (dynastyIsCurrentRookie(row, meta)) return [];
  const key = playerKey(row.Player);
  const currentAge = number(row.age, null);
  return (state.historicalModel?.playerRows || [])
    .filter((hist) => hist.PlayerKey === key && hist.Pos === row.Pos)
    .map((hist) => {
      const year = number(hist.Year, null);
      const war = number(hist[playedMetric], number(hist[yMetric], null));
      if (year === null || war === null) return null;
      const age = ageForProjection(meta, year) ?? (currentAge === null ? null : currentAge - (settings().year - year));
      if (age === null) return null;
      return {
        Year: year,
        Age: age,
        WAR: war,
        Label: `${year} played-week ${yMetric}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.Age - b.Age);
}

function rookiePickNumber(label, teams = 12) {
  const match = String(label || "").match(/(\d+)\.(\d+)/);
  if (!match) return null;
  return (number(match[1], 1) - 1) * teams + number(match[2], 1);
}

function rookiePickLabelFromPick(pickNo, teams = 12) {
  const pick = number(pickNo, null);
  if (pick === null) return "";
  const roundNo = Math.floor((pick - 1) / teams) + 1;
  const slot = Math.floor((pick - 1) % teams) + 1;
  return `${roundNo}.${String(slot).padStart(2, "0")}`;
}

function rookiePickLabelFromName(name, fallbackPick, teams) {
  const match = String(name || "").match(/(\d+\.\d+)/);
  if (match?.[1]) {
    const pickNo = rookiePickNumber(match[1], teams);
    return rookiePickLabelFromPick(pickNo, teams);
  }
  return rookiePickLabelFromPick(fallbackPick, teams);
}

function rookiePickYear(name, fallbackYear) {
  return number(String(name || "").match(/\b(20\d{2})\b/)?.[1], fallbackYear);
}

function historicalDraftClassRankCurves(horizon, metric = "WAR") {
  const playerRows = state.historicalModel?.playerRows || [];
  if (!playerRows.length || !state.draftMetadataRows.length) return [];
  const cacheKey = `${horizon}|FPTS/G|${state.historicalModelKey}|${playerRows.length}|${state.draftMetadataRows.length}`;
  if (dynastyDraftClassCurveCache.has(cacheKey)) return dynastyDraftClassCurveCache.get(cacheKey);
  const maxHistoricalYear = Math.max(...playerRows.map((row) => number(row.Year, 0)));
  const metaMap = new Map();
  for (const row of state.draftMetadataRows) {
    const pos = String(row.pos || "").toUpperCase();
    if (!["QB", "RB", "WR", "TE"].includes(pos)) continue;
    setPlayerMapStrict(metaMap, row.player, pos, {
      player: row.player,
      pos,
      draftYear: number(row.draft_year, null),
      draftPick: number(row.pick, null),
      draftAge: number(row.age, null)
    });
  }
  const playerSeasonMap = new Map();
  for (const row of playerRows) {
    const key = `${row.PlayerKey}|${row.Pos}`;
    if (!playerSeasonMap.has(key)) playerSeasonMap.set(key, []);
    playerSeasonMap.get(key).push(row);
  }

  const classYearRows = new Map();
  for (const [key, meta] of metaMap.entries()) {
    const seasons = playerSeasonMap.get(key) || [];
    if (!meta || meta.draftYear === null) continue;
    for (let yearOffset = 0; yearOffset < horizon; yearOffset += 1) {
      if (meta.draftYear + yearOffset > maxHistoricalYear) continue;
      const season = seasons.find((row) => row.Year === meta.draftYear + yearOffset);
      const fptsPerGame = Math.max(0, number(season?.AVG, 0));
      const classKey = `${meta.draftYear}|${yearOffset}`;
      if (!classYearRows.has(classKey)) classYearRows.set(classKey, []);
      classYearRows.get(classKey).push({
        Player: seasons[0]?.Player || meta.player,
        Pos: meta.pos,
        DraftYear: meta.draftYear,
        YearOffset: yearOffset,
        FptsPerGame: fptsPerGame
      });
    }
  }

  const rankBuckets = new Map();
  for (const classRows of classYearRows.values()) {
    [...classRows]
      .sort((a, b) => b.FptsPerGame - a.FptsPerGame)
      .forEach((row, index) => {
        const rank = index + 1;
        const bucketKey = `${rank}|${row.YearOffset}`;
        if (!rankBuckets.has(bucketKey)) rankBuckets.set(bucketKey, []);
        rankBuckets.get(bucketKey).push(row);
      });
  }

  const curves = [];
  for (const [bucketKey, rowsForRank] of rankBuckets.entries()) {
    const [rankText, yearOffsetText] = bucketKey.split("|");
    const fptsPerGames = rowsForRank.map((row) => row.FptsPerGame).filter((value) => Number.isFinite(value));
    if (!fptsPerGames.length) continue;
    const posCounts = rowsForRank.reduce((map, row) => map.set(row.Pos, (map.get(row.Pos) || 0) + 1), new Map());
    curves.push({
      Rank: number(rankText, 0),
      YearOffset: number(yearOffsetText, 0),
      FptsPerGame: percentile(fptsPerGames, 0.85),
      P75: percentile(fptsPerGames, 0.75),
      P85: percentile(fptsPerGames, 0.85),
      Count: fptsPerGames.length,
      Archetype: [...posCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "WR",
      Examples: rowsForRank
        .filter((row) => row.FptsPerGame > 0)
        .sort((a, b) => b.FptsPerGame - a.FptsPerGame)
        .slice(0, 4)
        .map((row) => `${row.Player} (${row.Pos}, ${row.DraftYear} Y${row.YearOffset + 1})`)
    });
  }
  dynastyDraftClassCurveCache.set(cacheKey, curves);
  return curves;
}

function fallbackRookiePickRankCurve(pickNo, horizon) {
  const pick = Math.max(1, number(pickNo, 1));
  const bestCasePos = pick <= 4 ? "RB/WR" : pick <= 12 ? "WR/RB" : pick <= 24 ? "WR" : "Flex";
  const conversionPos = rookiePickConversionPos(bestCasePos);
  const base = Math.max(1.5, 15.5 * Math.exp(-(pick - 1) / 28));
  const development = [0.56, 0.86, 1, 0.95, 0.84, 0.72, 0.6, 0.5, 0.42, 0.36];
  const yearlyFptsPerGame = Array.from({ length: horizon }, (_, index) => base * (development[index] ?? (0.36 * (0.9 ** (index - 9)))));
  return {
    yearlyFptsPerGame,
    yearlyWar: rookiePickWarFromFptsCurve(yearlyFptsPerGame, conversionPos, "WAR"),
    bestCasePos,
    comps: [],
    model: "fallback draft-rank FPTS/G curve"
  };
}

function rookiePickConversionPos(bestCasePos) {
  const pos = String(bestCasePos || "").toUpperCase();
  if (pos.includes("RB")) return "RB";
  if (pos.includes("WR")) return "WR";
  if (pos.includes("TE")) return "TE";
  if (pos.includes("QB")) return "QB";
  return "WR";
}

function rookiePickWarFromFptsCurve(yearlyFptsPerGame, conversionPos, metric = "WAR") {
  return (yearlyFptsPerGame || []).map((avg, index) => {
    const baselinePos = metric === "SuperFlex WAR" ? conversionPos : "TE";
    const war = warFromAverage(baselinePos, avg, metric) ?? 0;
    return index === 0 ? Math.max(0, war) : war;
  });
}

function averageRookiePickPath(rows, field, horizon) {
  return Array.from({ length: horizon }, (_, index) => {
    const values = rows.map((row) => number(row[field]?.[index], null)).filter((value) => value !== null);
    return values.length ? average(values) : null;
  });
}

function addAggregateRookiePickRows(rows, horizon) {
  const teams = settings().teams;
  const yearGroups = new Map();
  rows.filter((row) => row.Pos === "RDP" && row.pickYear && row.pickLabel && !row.aggregatePick)
    .forEach((row) => {
      if (!yearGroups.has(row.pickYear)) yearGroups.set(row.pickYear, []);
      yearGroups.get(row.pickYear).push({ ...row, pickNo: rookiePickNumber(row.pickLabel, teams) });
    });
  const roundRanges = [
    { label: "Base 1st", start: 1, end: teams },
    { label: "Early 1st", start: 1, end: Math.ceil(teams / 3) },
    { label: "Mid 1st", start: Math.ceil(teams / 3) + 1, end: Math.ceil((teams * 2) / 3) },
    { label: "Late 1st", start: Math.ceil((teams * 2) / 3) + 1, end: teams },
    { label: "Base 2nd", start: teams + 1, end: teams * 2 },
    { label: "Early 2nd", start: teams + 1, end: teams + Math.ceil(teams / 3) },
    { label: "Mid 2nd", start: teams + Math.ceil(teams / 3) + 1, end: teams + Math.ceil((teams * 2) / 3) },
    { label: "Late 2nd", start: teams + Math.ceil((teams * 2) / 3) + 1, end: teams * 2 },
    { label: "Base 3rd", start: (teams * 2) + 1, end: teams * 3 },
    { label: "Early 3rd", start: (teams * 2) + 1, end: (teams * 2) + Math.ceil(teams / 3) },
    { label: "Mid 3rd", start: (teams * 2) + Math.ceil(teams / 3) + 1, end: (teams * 2) + Math.ceil((teams * 2) / 3) },
    { label: "Late 3rd", start: (teams * 2) + Math.ceil((teams * 2) / 3) + 1, end: teams * 3 }
  ];
  for (const [pickYear, picks] of yearGroups.entries()) {
    for (const range of roundRanges) {
      const rangePicks = picks.filter((row) => row.pickNo >= range.start && row.pickNo <= range.end);
      if (!rangePicks.length) continue;
      const yearlyWar = averageRookiePickPath(rangePicks, "yearlyWar", horizon);
      const yearlySuperflexWar = averageRookiePickPath(rangePicks, "yearlySuperflexWar", horizon);
      const yearlyFptsPerGame = averageRookiePickPath(rangePicks, "yearlyFptsPerGame", horizon);
      rows.push({
        Player: `${pickYear} ${range.label}`,
        Pos: "RDP",
        Team: "PICK",
        headshot_url: "",
        dynastyKey: `${pickYear}|${range.label}|RDP_AGG`,
        ADP: average(rangePicks.map((row) => number(row.ADP, null)).filter((value) => value !== null)),
        currentWar: null,
        dynastyWar: yearlyWar.reduce((sum, value) => sum + number(value, 0), 0),
        dynastySuperflexWar: yearlySuperflexWar.reduce((sum, value) => sum + number(value, 0), 0),
        yearlyWar,
        yearlySuperflexWar,
        yearlyFptsPerGame,
        age: null,
        pickYear,
        pickLabel: range.label,
        aggregatePick: true,
        bestCasePos: "Pick avg",
        comps: rangePicks.slice(0, 6).map((row) => row.pickLabel),
        model: `Average of ${rangePicks.length} ${pickYear} rookie picks (${range.label})`
      });
    }
  }
}

function currentRookieClassRankFptsPerGame(pickNo) {
  const metaMap = draftMetadataMap();
  const rookieRows = state.results
    .map((row) => {
      const meta = getPlayerMapStrict(metaMap, row.Player, row.Pos);
      if (!meta || meta.draftYear !== settings().year) return null;
      const value = number(row.AVG, null);
      return value === null ? null : { ...row, MetricFptsPerGame: Math.max(0, value) };
    })
    .filter(Boolean)
    .sort((a, b) => b.MetricFptsPerGame - a.MetricFptsPerGame);
  if (!rookieRows.length) return null;
  const pick = Math.max(1, number(pickNo, 1));
  let matched = [];
  for (const window of [0, 1, 2, 4, 8, 14]) {
    matched = rookieRows
      .map((row, index) => ({ ...row, RookieRank: index + 1 }))
      .filter((row) => Math.abs(row.RookieRank - pick) <= window);
    if ((window === 0 && matched.length) || matched.length >= 2 || window === 14) break;
  }
  if (!matched.length) return null;
  const weighted = matched.reduce((sum, row) => sum + (row.MetricFptsPerGame / Math.max(1, Math.abs(row.RookieRank - pick) + 1)), 0);
  const totalWeight = matched.reduce((sum, row) => sum + (1 / Math.max(1, Math.abs(row.RookieRank - pick) + 1)), 0);
  return weighted / Math.max(0.001, totalWeight);
}

function smoothRookiePickFptsCurve(values) {
  const smoothed = [...(values || [])].map((value) => Math.max(0, number(value, 0)));
  if (smoothed.length >= 2 && smoothed[0] > 0) {
    smoothed[1] = Math.max(smoothed[1], smoothed[0] * 1.08);
  }
  if (smoothed.length >= 3 && smoothed[1] > 0) {
    smoothed[2] = Math.max(smoothed[2], smoothed[1] * 1.03);
  }
  for (let index = 3; index < smoothed.length; index += 1) {
    if (smoothed[index - 1] <= 0) continue;
    const retentionFloor = index === 3 ? 1 : index === 4 ? 0.98 : 0.92;
    smoothed[index] = Math.max(smoothed[index], smoothed[index - 1] * retentionFloor);
  }
  return smoothed;
}

function currentRookieProjectionFallback(item, meta, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const targetPick = number(meta?.draftPick, null);
  const targetAdp = number(item?.ADP, null);
  const metaMap = draftMetadataMap();
  const candidates = state.results
    .map((row) => {
      const rowMeta = getPlayerMapStrict(metaMap, row.Player, row.Pos);
      if (!rowMeta || rowMeta.draftYear !== settings().year || row.Pos !== item.Pos) return null;
      const value = Math.max(0, number(row[yMetric], 0));
      if (value <= 0) return null;
      const draftPick = number(rowMeta.draftPick, null);
      const adp = number(row.ADP, null);
      return {
        Player: row.Player,
        value,
        draftDistance: targetPick === null || draftPick === null ? 18 : Math.abs(draftPick - targetPick),
        adpDistance: targetAdp === null || adp === null ? 45 : Math.abs(adp - targetAdp)
      };
    })
    .filter(Boolean);
  if (!candidates.length) return null;
  let matched = [];
  for (const limits of [
    { pick: 16, adp: 35 },
    { pick: 32, adp: 55 },
    { pick: 72, adp: 90 },
    { pick: 999, adp: 999 }
  ]) {
    matched = candidates.filter((row) => row.draftDistance <= limits.pick && row.adpDistance <= limits.adp);
    if (matched.length >= 3 || limits.pick === 999) break;
  }
  if (!matched.length) return null;
  const weighted = matched.reduce((sum, row) => {
    const weight = 1 / Math.max(1, row.draftDistance + (row.adpDistance * 0.35) + 1);
    return sum + (row.value * weight);
  }, 0);
  const totalWeight = matched.reduce((sum, row) => sum + (1 / Math.max(1, row.draftDistance + (row.adpDistance * 0.35) + 1)), 0);
  return weighted / Math.max(0.001, totalWeight);
}

function historicalRookieAdp(player, pos, year, adpMap = historicalAdpMap()) {
  return adpMap.get(`${year}|${playerAdpKey(player)}|${pos}`)?.adp ??
    adpMap.get(`${year}|${playerAdpKey(player)}`)?.adp ??
    null;
}

function dynastyRookieDevelopmentProfile(item, meta, currentWar, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const playedMetric = `Played ${yMetric}`;
  const targetPick = number(meta?.draftPick, null);
  const targetAdp = number(item?.ADP, null);
  const playerRows = state.historicalModel?.playerRows || [];
  if (!playerRows.length) return null;
  const adpMap = historicalAdpMap();

  const seasonMap = new Map();
  for (const row of playerRows) {
    const mapKey = `${row.PlayerKey || playerKey(row.Player)}|${row.Pos}`;
    if (!seasonMap.has(mapKey)) seasonMap.set(mapKey, new Map());
    seasonMap.get(mapKey).set(number(row.Year, null), row);
  }

  const candidates = [];
  for (const draftRow of state.draftMetadataRows || []) {
    const pos = String(draftRow.pos || "").toUpperCase();
    if (pos !== item.Pos) continue;
    const draftYear = number(draftRow.draft_year, null);
    const draftPick = number(draftRow.pick, null);
    if (draftYear === null || draftYear >= settings().year || draftPick === null) continue;
    const seasons = getPlayerMapStrict(seasonMap, draftRow.player, pos);
    if (!seasons) continue;
    const y1 = seasons.get(draftYear);
    const y2 = seasons.get(draftYear + 1);
    const y3 = seasons.get(draftYear + 2);
    const y1War = Math.max(0, number(y1?.[playedMetric], number(y1?.[yMetric], 0)));
    const y2War = y2 ? Math.max(0, number(y2?.[playedMetric], number(y2?.[yMetric], 0))) : null;
    const y3War = y3 ? Math.max(0, number(y3?.[playedMetric], number(y3?.[yMetric], 0))) : null;
    if (y1War <= 0 && y2War === null && y3War === null) continue;
    const adp = historicalRookieAdp(draftRow.player, pos, draftYear, adpMap);
    const draftDistance = targetPick === null ? 12 : Math.abs(draftPick - targetPick);
    const adpDistance = targetAdp === null || adp === null ? 35 : Math.abs(adp - targetAdp);
    candidates.push({
      Player: draftRow.player,
      Pos: pos,
      DraftYear: draftYear,
      DraftPick: draftPick,
      ADP: adp,
      Y1: y1War,
      Y2: y2War,
      Y3: y3War,
      draftDistance,
      adpDistance,
      score: draftDistance + (adpDistance * 0.35)
    });
  }

  let matched = [];
  for (const limits of [
    { pick: 8, adp: 28 },
    { pick: 16, adp: 45 },
    { pick: 32, adp: 70 },
    { pick: 64, adp: 110 },
    { pick: 999, adp: 999 }
  ]) {
    matched = candidates.filter((row) => row.draftDistance <= limits.pick && row.adpDistance <= limits.adp);
    if (matched.length >= 4 || limits.pick === 999) break;
  }
  if (!matched.length) return null;

  const weightedAverageComp = (yearKey) => {
    const rows = matched
      .map((row) => {
        const value = row[yearKey];
        if (value === null || !Number.isFinite(value)) return null;
        const weight = 1 / Math.max(1, row.score + 1);
        return { value, weight };
      })
      .filter(Boolean);
    if (!rows.length) return null;
    return rows.reduce((sum, row) => sum + (row.value * row.weight), 0) / Math.max(0.001, rows.reduce((sum, row) => sum + row.weight, 0));
  };
  const ratio = (row, value) => value === null ? null : (value + 0.08) / Math.max(0.08, row.Y1 + 0.08);
  const weightedRatio = (yearKey, minValue, maxValue) => {
    const rows = matched
      .map((row) => {
        const raw = ratio(row, row[yearKey]);
        if (raw === null || !Number.isFinite(raw)) return null;
        const weight = 1 / Math.max(1, row.score + 1);
        return { raw, weight };
      })
      .filter(Boolean);
    if (!rows.length) return null;
    const avg = rows.reduce((sum, row) => sum + (row.raw * row.weight), 0) / Math.max(0.001, rows.reduce((sum, row) => sum + row.weight, 0));
    return Math.max(minValue, Math.min(maxValue, avg));
  };
  const y2Multiplier = weightedRatio("Y2", 1.04, 1.85) ?? 1.08;
  const y3Multiplier = weightedRatio("Y3", 1.0, 2.05) ?? Math.max(1, y2Multiplier * 0.98);
  const y2TargetWar = weightedAverageComp("Y2");
  const y3TargetWar = weightedAverageComp("Y3");
  const examples = matched
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((row) => `${row.Player} (${row.DraftYear}, pick ${fmt(row.DraftPick, 0)}${row.ADP ? `, ADP ${fmt(row.ADP, 1)}` : ""})`);

  return {
    y2Multiplier,
    y3Multiplier,
    y2TargetWar,
    y3TargetWar,
    examples,
    count: matched.length,
    model: `rookie development comps: ${matched.length} same-position players by NFL draft capital${targetAdp !== null ? " and rookie ADP" : ""}`
  };
}

function applyRookieDevelopment(yearly, item, meta, currentWar, metric = "WAR") {
  const adjusted = [...(yearly || [])];
  const profile = dynastyRookieDevelopmentProfile(item, meta, currentWar, metric);
  if (!profile || adjusted.length < 2) return { yearlyWar: adjusted, profile: null };
  const current = number(currentWar, 0);
  adjusted[0] = current;
  const developmentBase = Math.max(0, current);
  const y2Target = Math.max(
    developmentBase * profile.y2Multiplier,
    number(profile.y2TargetWar, 0) ?? 0
  );
  adjusted[1] = Math.max(adjusted[1] ?? 0, ((adjusted[1] ?? 0) * 0.45) + (y2Target * 0.55));
  if (adjusted.length >= 3) {
    const y3Target = Math.max(
      developmentBase * profile.y3Multiplier,
      number(profile.y3TargetWar, 0) ?? 0
    );
    adjusted[2] = Math.max(adjusted[2] ?? 0, ((adjusted[2] ?? 0) * 0.45) + (y3Target * 0.55));
  }
  adjusted[0] = current;
  return { yearlyWar: adjusted, profile };
}

function dynastyRookieFptsDevelopmentProfile(item, meta) {
  const targetPick = number(meta?.draftPick, null);
  const targetAdp = number(item?.ADP, null);
  const playerRows = state.historicalModel?.playerRows || [];
  if (!playerRows.length) return null;
  const adpMap = historicalAdpMap();

  const seasonMap = new Map();
  for (const row of playerRows) {
    const mapKey = `${row.PlayerKey || playerKey(row.Player)}|${row.Pos}`;
    if (!seasonMap.has(mapKey)) seasonMap.set(mapKey, new Map());
    seasonMap.get(mapKey).set(number(row.Year, null), row);
  }

  const candidates = [];
  for (const draftRow of state.draftMetadataRows || []) {
    const pos = String(draftRow.pos || "").toUpperCase();
    if (pos !== item.Pos) continue;
    const draftYear = number(draftRow.draft_year, null);
    const draftPick = number(draftRow.pick, null);
    if (draftYear === null || draftYear >= settings().year || draftPick === null) continue;
    const seasons = getPlayerMapStrict(seasonMap, draftRow.player, pos);
    if (!seasons) continue;
    const y1 = historicalFptsPerGame(seasons.get(draftYear));
    const y2 = historicalFptsPerGame(seasons.get(draftYear + 1));
    const y3 = historicalFptsPerGame(seasons.get(draftYear + 2));
    if (y1 === null && y2 === null && y3 === null) continue;
    const adp = historicalRookieAdp(draftRow.player, pos, draftYear, adpMap);
    const draftDistance = targetPick === null ? 12 : Math.abs(draftPick - targetPick);
    const adpDistance = targetAdp === null || adp === null ? 35 : Math.abs(adp - targetAdp);
    candidates.push({
      Player: draftRow.player,
      Pos: pos,
      DraftYear: draftYear,
      DraftPick: draftPick,
      ADP: adp,
      Y1: y1,
      Y2: y2,
      Y3: y3,
      draftDistance,
      adpDistance,
      score: draftDistance + (adpDistance * 0.35)
    });
  }

  let matched = [];
  for (const limits of [
    { pick: 8, adp: 28 },
    { pick: 16, adp: 45 },
    { pick: 32, adp: 70 },
    { pick: 64, adp: 110 },
    { pick: 999, adp: 999 }
  ]) {
    matched = candidates.filter((row) => row.draftDistance <= limits.pick && row.adpDistance <= limits.adp);
    if (matched.length >= 4 || limits.pick === 999) break;
  }
  if (!matched.length) return null;

  const weightedAverageComp = (yearKey) => {
    const rows = matched
      .map((row) => {
        const value = row[yearKey];
        if (value === null || !Number.isFinite(value)) return null;
        const weight = 1 / Math.max(1, row.score + 1);
        return { value, weight };
      })
      .filter(Boolean);
    if (!rows.length) return null;
    return rows.reduce((sum, row) => sum + (row.value * row.weight), 0) / Math.max(0.001, rows.reduce((sum, row) => sum + row.weight, 0));
  };
  const ratio = (row, value) => value === null || row.Y1 === null ? null : (value + 1.5) / Math.max(1.5, row.Y1 + 1.5);
  const weightedRatio = (yearKey, minValue, maxValue) => {
    const rows = matched
      .map((row) => {
        const raw = ratio(row, row[yearKey]);
        if (raw === null || !Number.isFinite(raw)) return null;
        const weight = 1 / Math.max(1, row.score + 1);
        return { raw, weight };
      })
      .filter(Boolean);
    if (!rows.length) return null;
    const avg = rows.reduce((sum, row) => sum + (row.raw * row.weight), 0) / Math.max(0.001, rows.reduce((sum, row) => sum + row.weight, 0));
    return Math.max(minValue, Math.min(maxValue, avg));
  };
  const y2Multiplier = weightedRatio("Y2", 1.04, 1.9) ?? 1.12;
  const y3Multiplier = weightedRatio("Y3", 1.0, 2.1) ?? Math.max(1, y2Multiplier * 0.98);
  const y2TargetFptsPerGame = weightedAverageComp("Y2");
  const y3TargetFptsPerGame = weightedAverageComp("Y3");
  const examples = matched
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((row) => `${row.Player} (${row.DraftYear}, pick ${fmt(row.DraftPick, 0)}${row.ADP ? `, ADP ${fmt(row.ADP, 1)}` : ""})`);

  return {
    y2Multiplier,
    y3Multiplier,
    y2TargetFptsPerGame,
    y3TargetFptsPerGame,
    examples,
    count: matched.length,
    model: `rookie FPTS/G development comps: ${matched.length} same-position players by NFL draft capital${targetAdp !== null ? " and rookie ADP" : ""}`
  };
}

function applyRookieFptsDevelopment(yearly, item, meta, currentFptsPerGame) {
  const adjusted = [...(yearly || [])];
  const profile = dynastyRookieFptsDevelopmentProfile(item, meta);
  if (!profile || adjusted.length < 2) return { yearlyFptsPerGame: adjusted, profile: null };
  const current = Math.max(0, number(currentFptsPerGame, 0));
  adjusted[0] = current;
  const y2Target = Math.max(
    current * profile.y2Multiplier,
    number(profile.y2TargetFptsPerGame, 0) ?? 0
  );
  adjusted[1] = Math.max(adjusted[1] ?? 0, ((adjusted[1] ?? 0) * 0.4) + (y2Target * 0.6));
  if (adjusted.length >= 3) {
    const y3Target = Math.max(
      current * profile.y3Multiplier,
      number(profile.y3TargetFptsPerGame, 0) ?? 0
    );
    adjusted[2] = Math.max(adjusted[2] ?? 0, ((adjusted[2] ?? 0) * 0.4) + (y3Target * 0.6));
  }
  adjusted[0] = current;
  return { yearlyFptsPerGame: adjusted, profile };
}

function rookiePickRankProfile(pickNo, horizon, pickYear, metric = "WAR") {
  const pick = Math.max(1, number(pickNo, 1));
  const yearsOut = Math.max(0, number(pickYear, settings().year) - settings().year);
  const futureAdjustedPick = pick + (yearsOut * settings().teams * 0.65);
  const rawHorizon = Math.max(horizon, 6);
  const curves = historicalDraftClassRankCurves(rawHorizon, metric);
  const discount = 0.97 ** yearsOut;
  if (!curves.length) {
    const fallback = fallbackRookiePickRankCurve(futureAdjustedPick, rawHorizon);
    const rawFallbackFpts = smoothRookiePickFptsCurve(fallback.yearlyFptsPerGame || []);
    const yearlyFptsPerGame = Array.from({ length: horizon }, (_, index) => (rawFallbackFpts[index] || 0) * discount);
    const conversionPos = rookiePickConversionPos(fallback.bestCasePos);
    const yMetric = metric === "SuperFlex WAR" ? "SuperFlex WAR" : "WAR";
    return {
      ...fallback,
      yearlyFptsPerGame,
      yearlyWar: rookiePickWarFromFptsCurve(yearlyFptsPerGame, conversionPos, yMetric)
    };
  }
  const rawYearlyFptsPerGame = [];
  const examples = [];
  const archetypeCounts = new Map();
  const sampleCounts = [];
  for (let yearOffset = 0; yearOffset < rawHorizon; yearOffset += 1) {
    let matched = [];
    for (const window of [0, 1, 2, 4, 8, 14, 24]) {
      matched = curves.filter((row) => row.YearOffset === yearOffset && Math.abs(row.Rank - futureAdjustedPick) <= window);
      if (matched.length >= 3 || window === 24) break;
    }
    if (!matched.length) {
      rawYearlyFptsPerGame.push(0);
      sampleCounts.push(0);
      continue;
    }
    const weighted = matched.reduce((sum, row) => {
      const distance = Math.abs(row.Rank - futureAdjustedPick);
      const weight = row.Count / Math.max(1, distance + 1);
      return sum + (row.FptsPerGame * weight);
    }, 0);
    const totalWeight = matched.reduce((sum, row) => sum + (row.Count / Math.max(1, Math.abs(row.Rank - futureAdjustedPick) + 1)), 0);
    rawYearlyFptsPerGame.push(Math.max(0, weighted / Math.max(1, totalWeight)));
    sampleCounts.push(matched.reduce((sum, row) => sum + row.Count, 0));
    for (const row of matched) {
      archetypeCounts.set(row.Archetype, (archetypeCounts.get(row.Archetype) || 0) + row.Count);
      for (const example of row.Examples || []) {
        if (examples.length < 4 && !examples.includes(example)) examples.push(example);
      }
    }
  }
  const currentClassY1 = currentRookieClassRankFptsPerGame(pick);
  if (currentClassY1 !== null && rawYearlyFptsPerGame.some((value) => value > 0)) {
    const historicalY1 = rawYearlyFptsPerGame[0] || currentClassY1;
    const blendedY1 = (historicalY1 * 0.42) + (currentClassY1 * 0.58);
    const scale = blendedY1 / Math.max(0.001, historicalY1);
    for (let index = 0; index < rawYearlyFptsPerGame.length; index += 1) {
      rawYearlyFptsPerGame[index] *= scale;
    }
  }
  const bestCasePos = [...archetypeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Flex";
  const conversionPos = rookiePickConversionPos(bestCasePos);
  const yMetric = metric === "SuperFlex WAR" ? "SuperFlex WAR" : "WAR";
  const smoothedFptsPerGame = smoothRookiePickFptsCurve(rawYearlyFptsPerGame);
  const yearlyFptsPerGame = Array.from({ length: horizon }, (_, index) => (smoothedFptsPerGame[index] || 0) * discount);
  const yearlyWar = rookiePickWarFromFptsCurve(yearlyFptsPerGame, conversionPos, yMetric);
  return {
    yearlyFptsPerGame,
    yearlyWar,
    bestCasePos,
    comps: examples,
    sampleCounts,
    model: `P85 draft-class FPTS/G rank curve for pick ${rookiePickLabelFromPick(pick, settings().teams)}`
  };
}

function dynastyAdpSourceRows() {
  return state.dynastyAdpRows.filter((row) => {
    if (number(row.season, null) !== settings().year) return false;
    if (row.league_format !== "dynasty") return false;
    if (!["QB", "RB", "WR", "TE", "RDP"].includes(String(row.position || "").toUpperCase())) return false;
    return number(row.adp, null) !== null;
  });
}

function dynastyBoardRows() {
  const cfg = dynastySettings();
  const appCfg = settings();
  const metaMap = draftMetadataMap();
  const strictWarMap = new Map();
  const variantWarMap = new Map();
  for (const row of state.results) {
    setPlayerMapStrict(strictWarMap, row.Player, row.Pos, row);
    setPlayerMapVariants(variantWarMap, row.Player, row.Pos, row);
  }
  const grouped = new Map();

  for (const row of dynastyAdpSourceRows()) {
    const pos = String(row.position || "").toUpperCase();
    const name = String(row.full_name || "").trim();
    const drafts = Math.max(1, number(row.drafts, 0));
    const adp = number(row.adp, null);
    if (adp === null) continue;
    const pickLabel = pos === "RDP" ? rookiePickLabelFromName(name, adp, appCfg.teams) : "";
    const pickYear = pos === "RDP" ? rookiePickYear(name, appCfg.year + 1) : null;
    const key = pos === "RDP" ? `${pickYear}|${pickLabel}|RDP` : `${playerKey(name)}|${pos}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        Player: pos === "RDP" ? `${pickYear} Rookie Pick ${pickLabel}` : name,
        Pos: pos,
        Team: row.team || "",
        headshot_url: row.headshot_url || "",
        status: "",
        active: null,
        isRookie: false,
        rookieBoardDrafts: 0,
        weightedAdp: 0,
        adpWeight: 0,
        drafts: 0,
        pickYear,
        pickLabel
      });
    }
    const item = grouped.get(key);
    combineSleeperStatus(item, row);
    if (String(row.board_class || "").toLowerCase() === "rookie") item.rookieBoardDrafts += drafts;
    item.weightedAdp += adp * drafts;
    item.adpWeight += drafts;
    item.drafts += drafts;
  }

  for (const yearsOut of [1, 2]) {
    for (let pickNo = 1; pickNo <= appCfg.teams * 3; pickNo += 1) {
      const label = rookiePickLabelFromPick(pickNo, appCfg.teams);
      const pickYear = appCfg.year + yearsOut;
      const name = `${pickYear} Rookie Pick ${label}`;
      const key = `${pickYear}|${label}|RDP`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          Player: name,
          Pos: "RDP",
          Team: "PICK",
          headshot_url: "",
          status: "",
          active: null,
          weightedAdp: pickNo + ((yearsOut - 1) * appCfg.teams * 3),
          adpWeight: 1,
          drafts: 0,
          pickYear,
          pickLabel: label,
          synthesized: true
        });
      }
    }
  }

  const rows = [];
  const excluded = { retired: 0, inactive: 0, stale: 0, noProjection: 0, total: 0 };
  for (const item of grouped.values()) {
    const adp = item.weightedAdp / Math.max(1, item.adpWeight);
    if (item.Pos === "RDP") {
      const pickLabel = item.pickLabel || rookiePickLabelFromName(item.Player, adp, appCfg.teams);
      const pickYear = item.pickYear || rookiePickYear(item.Player, appCfg.year + 1);
      const pickNo = rookiePickNumber(pickLabel, appCfg.teams) ?? adp;
      const profile = rookiePickRankProfile(pickNo, cfg.horizon, pickYear);
      const sfProfile = dynastyShowsSuperflex() ? rookiePickRankProfile(pickNo, cfg.horizon, pickYear, "SuperFlex WAR") : null;
      const yearlyWar = profile.yearlyWar;
      const yearlySuperflexWar = sfProfile?.yearlyWar || [];
      const yearlyFptsPerGame = profile.yearlyFptsPerGame || [];
      const dynastyWar = yearlyWar.reduce((sum, value) => sum + value, 0);
      const dynastySuperflexWar = yearlySuperflexWar.reduce((sum, value) => sum + value, 0);
      rows.push({
        ...item,
        Player: `${pickYear} Rookie Pick ${pickLabel}`,
        dynastyKey: `${pickYear}|${pickLabel}|RDP`,
        ADP: adp,
        currentWar: null,
        dynastyWar,
        dynastySuperflexWar,
        yearlyWar,
        yearlySuperflexWar,
        yearlyFptsPerGame,
        age: null,
        pickYear,
        pickLabel,
        bestCasePos: profile.bestCasePos,
        comps: profile.comps,
        model: profile.model
      });
      continue;
    }
    const current = getPlayerMapStrict(strictWarMap, item.Player, item.Pos) || getPlayerMapValue(variantWarMap, item.Player, item.Pos);
    const meta = getPlayerMapStrict(metaMap, item.Player, item.Pos);
    const isRookie = dynastyIsCurrentRookie(item, meta);
    if (cfg.projectedOnly && !current) {
      excluded.noProjection += 1;
      excluded.total += 1;
      continue;
    }
    const exclusionReason = dynastyExclusionReason(item, current, meta);
    if (exclusionReason) {
      excluded[exclusionReason] += 1;
      excluded.total += 1;
      continue;
    }
    const actualAge = ageForProjection(meta, settings().year);
    const age = actualAge ?? (isRookie ? defaultRookieAge(item.Pos) : inferredDynastyAge(item.Player, item.Pos));
    const projectedFptsPerGame = number(current?.AVG, null);
    const fptsProfile = playerHistoricalFptsProfile(item.Player, item.Pos);
    const previousFptsPerGame = fptsProfile?.previousFptsPerGame ?? null;
    const blendedFptsPerGame = dynastyPlayerBaseFptsPerGame(
      item.Player,
      item.Pos,
      projectedFptsPerGame ?? fptsProfile?.weightedFptsPerGame ?? null,
      isRookie
    );
    const currentFptsPerGame = projectedFptsPerGame ?? blendedFptsPerGame;
    const projectedWar = number(current?.WAR, null);
    const currentWar = projectedWar !== null ? projectedWar : (warFromAverage(item.Pos, currentFptsPerGame, "WAR") ?? 0);
    const projectedSuperflexWar = number(current?.["SuperFlex WAR"], null);
    const currentSuperflexWar = projectedSuperflexWar !== null
      ? projectedSuperflexWar
      : (warFromAverage(item.Pos, currentFptsPerGame, "SuperFlex WAR") ?? currentWar);
    const currentWarEstimated = projectedWar === null && projectedFptsPerGame !== null;
    const baseYearlyFpts = dynastyAnchorCurrentYear(
      dynastyPlayerYearlyFptsPerGame(item.Pos, blendedFptsPerGame, age, cfg.horizon),
      currentFptsPerGame
    );
    const rookieDevelopment = isRookie
      ? applyRookieFptsDevelopment(baseYearlyFpts, item, meta, currentFptsPerGame)
      : { yearlyFptsPerGame: baseYearlyFpts, profile: null };
    const yearlyFptsPerGame = rookieDevelopment.yearlyFptsPerGame;
    const yearly = yearlyFptsPerGame.map((avg) => warFromAverage(item.Pos, avg, "WAR") ?? 0);
    const yearlySuperflexWar = dynastyShowsSuperflex()
      ? yearlyFptsPerGame.map((avg) => warFromAverage(item.Pos, avg, "SuperFlex WAR") ?? 0)
      : [];
    const dynastyWar = yearly.reduce((sum, value) => sum + value, 0);
    const dynastySuperflexWar = yearlySuperflexWar.reduce((sum, value) => sum + value, 0);
    rows.push({
      ...item,
      dynastyKey: `${playerKey(item.Player)}|${item.Pos}`,
      ADP: adp,
      currentWar,
      currentSuperflexWar,
      currentWarEstimated,
      previousFptsPerGame,
      projectedFptsPerGame,
      blendedFptsPerGame,
      blendedWarBase: warFromAverage(item.Pos, blendedFptsPerGame, "WAR") ?? currentWar,
      dynastyWar,
      dynastySuperflexWar,
      yearlyWar: yearly,
      yearlySuperflexWar,
      yearlyFptsPerGame,
      age,
      isRookie,
      rookieDevelopment: rookieDevelopment.profile,
      rookieSuperflexDevelopment: null,
      pickYear: null,
      pickLabel: "",
      bestCasePos: item.Pos,
      comps: rookieDevelopment.profile?.examples || [],
      model: isRookie
        ? rookieDevelopment.profile?.model || "projection anchored rookie FPTS/G curve"
        : actualAge === null && age !== null
        ? "projection/history FPTS/G blend + inferred position age curve"
        : age === null
          ? "projection/history FPTS/G blend + position trend decline"
          : "projection/history FPTS/G blend + position age curve"
    });
  }

  state.dynastyExcludedSummary = excluded;
  addAggregateRookiePickRows(rows, cfg.horizon);

  return rows
    .filter((row) => cfg.position === "ALL" || row.Pos === cfg.position)
    .filter((row) => !cfg.query || `${row.Player} ${row.Team} ${row.pickLabel || ""}`.toLowerCase().includes(cfg.query))
    .sort((a, b) => b.dynastyWar - a.dynastyWar)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function adpScoringOptions(format) {
  const redraft = [
    ["ppr", "PPR"],
    ["half_ppr", "Half PPR"],
    ["std", "Standard"],
    ["2qb", "2QB"],
    ["idp", "IDP"],
    ["idp_1qb", "IDP 1QB"]
  ];
  const dynasty = [
    ["dynasty_2qb", "Dynasty 2QB"],
    ["dynasty_ppr", "Dynasty PPR"],
    ["dynasty_half_ppr", "Dynasty half PPR"],
    ["dynasty_std", "Dynasty standard"]
  ];
  const options = format === "dynasty" ? dynasty : format === "redraft" ? redraft : [...redraft, ...dynasty];
  return [...options, ["all", "All scoring"]];
}

function updateAdpScoringOptions() {
  const select = el("adpScoring");
  if (!select) return;
  const format = el("adpLeagueFormat")?.value || "redraft";
  const previous = select.value;
  const options = adpScoringOptions(format);
  select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  const values = new Set(options.map(([value]) => value));
  if (values.has(previous)) select.value = previous;
  else select.value = format === "dynasty" ? "dynasty_2qb" : "ppr";
}

function updateAdpDateControlsForSeason(force = false) {
  const season = number(el("adpSeason")?.value, settings().year);
  const dates = uniqueSorted(state.customAdpRows
    .filter((row) => number(row.season) === season)
    .map((row) => row.start_date));
  const start = el("adpStartDate");
  const end = el("adpEndDate");
  if (!dates.length) {
    if (start) start.value = "";
    if (end) end.value = "";
    return;
  }
  const defaultStart = dates[0];
  const defaultEnd = dates[dates.length - 1];
  if (start) {
    start.min = dates[0];
    start.max = defaultEnd;
    if (force || !start.value || start.value < dates[0] || start.value > defaultEnd) start.value = defaultStart;
  }
  if (end) {
    end.min = dates[0];
    end.max = defaultEnd;
    if (force || !end.value || end.value < dates[0] || end.value > defaultEnd) end.value = defaultEnd;
  }
}

function syncAdpFromWarSettings() {
  const cfg = settings();
  const isTwoQb = cfg.slots.SUPERFLEX > 0 || cfg.slots.QB > 1;
  const format = el("adpLeagueFormat")?.value || "redraft";
  const scoringSelect = el("adpScoring");
  if (scoringSelect) {
    if (format === "dynasty") {
      scoringSelect.value = isTwoQb ? "dynasty_2qb" : cfg.scoring.rec >= 1 ? "dynasty_ppr" : cfg.scoring.rec >= 0.5 ? "dynasty_half_ppr" : "dynasty_std";
    } else {
      scoringSelect.value = isTwoQb ? "2qb" : cfg.scoring.rec >= 1 ? "ppr" : cfg.scoring.rec >= 0.5 ? "half_ppr" : "std";
    }
  }
}

function applyAdpFormatDefaults() {
  const format = el("adpLeagueFormat")?.value || "redraft";
  if (el("adpBoardType")) {
    const current = el("adpBoardType").value;
    if (format === "redraft") el("adpBoardType").value = "redraft";
    if (format === "dynasty" && current === "redraft") el("adpBoardType").value = "all";
  }
  if (el("adpRookieInclusion") && format !== "dynasty") el("adpRookieInclusion").value = "all";
  updateAdpScoringOptions();
}

function applyAdpTwoQbHint() {
  const scoring = el("adpScoring")?.value || "";
  if (scoring.includes("2qb") && number(el("superflexSlots")?.value, 0) === 0 && number(el("qbSlots")?.value, 1) < 2) {
    if (el("superflexSlots")) el("superflexSlots").value = 1;
  }
}

function uniqueSorted(values, numeric = false) {
  const clean = [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
  return clean.sort((a, b) => numeric ? number(a, 0) - number(b, 0) : String(a).localeCompare(String(b)));
}

function dateInWindow(date, startDate, endDate) {
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function closeEnough(actual, expected, tolerance = 0.001) {
  return Math.abs(number(actual, 999999) - expected) <= tolerance;
}

function adpSlotDistance(row, slots) {
  return Math.abs(number(row.slots_qb, 0) - slots.QB) +
    Math.abs(number(row.slots_rb, 0) - slots.RB) +
    Math.abs(number(row.slots_wr, 0) - slots.WR) +
    Math.abs(number(row.slots_te, 0) - slots.TE) +
    Math.abs(number(row.slots_flex, 0) - slots.FLEX) +
    Math.abs(number(row.slots_superflex, 0) - slots.SUPERFLEX);
}

function adpScoringDistance(row, scoring) {
  const pairs = [
    ["score_rec", scoring.rec, 1],
    ["score_te_premium", scoring.tePremium, 1],
    ["score_rec_yd", scoring.recYds, 10],
    ["score_rec_td", scoring.recTd, 0.25],
    ["score_rush_yd", scoring.rushYds, 10],
    ["score_rush_td", scoring.rushTd, 0.25],
    ["score_pass_yd", scoring.passYds, 20],
    ["score_pass_td", scoring.passTd, 0.25],
    ["score_pass_int", scoring.int, 0.5],
    ["score_fum_lost", scoring.fl, 0.5]
  ];
  return pairs.reduce((sum, [key, expected, weight]) => sum + Math.abs(number(row[key], expected) - expected) * weight, 0);
}

function adpLeaguePresetKey(row) {
  const rookieKey = row.league_format === "dynasty" ? effectiveRookieInclusion(row) : "n/a";
  return [
    row.season,
    row.league_format,
    row.board_class,
    rookieKey,
    row.type,
    row.md_scoring_type,
    row.st_teams,
    row.st_rounds,
    row.slots_qb,
    row.slots_rb,
    row.slots_wr,
    row.slots_te,
    row.slots_flex,
    row.slots_superflex,
    row.is_superflex,
    row.bestball,
    row.score_rec,
    row.score_te_premium,
    row.score_rec_yd,
    row.score_rec_td,
    row.score_rush_yd,
    row.score_rush_td,
    row.score_pass_yd,
    row.score_pass_td,
    row.score_pass_int,
    row.score_fum_lost
  ].join("|");
}

function adpGroupKey(row, includeDate = true) {
  const parts = [
    row.season,
    includeDate ? row.start_date : "",
    row.league_format,
    row.board_class,
    effectiveRookieInclusion(row),
    row.type,
    row.md_scoring_type,
    row.st_teams,
    row.st_rounds,
    row.slots_qb,
    row.slots_rb,
    row.slots_wr,
    row.slots_te,
    row.slots_flex,
    row.slots_superflex,
    row.is_superflex,
    row.bestball,
    row.score_rec,
    row.score_te_premium,
    row.score_rec_yd,
    row.score_rec_td,
    row.score_rush_yd,
    row.score_rush_td,
    row.score_pass_yd,
    row.score_pass_td,
    row.score_pass_int,
    row.score_fum_lost
  ];
  return parts.join("|");
}

function normalizedPlayerName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function adpPlayerKey(row) {
  const nameKey = normalizedPlayerName(row.full_name);
  const pos = String(row.position || "").toUpperCase();
  return nameKey ? `${nameKey}|${pos}` : String(row.player_id || "");
}

function adpRowIdentity(row) {
  return [
    adpPlayerKey(row),
    adpGroupKey(row, true),
    row.adp,
    row.min_pick,
    row.max_pick,
    row.drafts,
    row.picks
  ].join("|");
}

function dedupeAdpRows(rows) {
  return [...new Map(rows.map((row) => [adpRowIdentity(row), row])).values()];
}

function addDraftGroup(groups, row) {
  const key = adpGroupKey(row, true);
  const sampleDrafts = number(row.sample_drafts, null);
  const playerDrafts = number(row.drafts, 0);
  const current = groups.get(key);
  const item = typeof current === "object" && current !== null
    ? current
    : { sample: number(current, 0), player: 0 };
  item.sample = Math.max(item.sample || 0, sampleDrafts || 0);
  item.player = Math.max(item.player || 0, playerDrafts || 0);
  groups.set(key, item);
}

function draftGroupTotal(groups) {
  return [...groups.values()].reduce((sum, value) => {
    if (typeof value === "object" && value !== null) {
      return sum + (number(value.sample, 0) > 0 ? number(value.sample, 0) : number(value.player, 0));
    }
    return sum + number(value, 0);
  }, 0);
}

function adpLeaguePresets(limit = 10) {
  const config = adpSettings();
  const groups = new Map();
  for (const row of state.customAdpRows) {
    if (number(row.season) !== config.season) continue;
    if (config.leagueFormat !== "all" && row.league_format !== config.leagueFormat) continue;
    const key = adpLeaguePresetKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        draftGroups: new Map(),
        playerIds: new Set(),
        dates: new Set()
      });
    }
    const item = groups.get(key);
    addDraftGroup(item.draftGroups, row);
    item.playerIds.add(row.player_id);
    item.dates.add(row.start_date);
  }
  return [...groups.values()]
    .filter((item) => item.playerIds.size >= 24)
    .sort((a, b) => draftGroupTotal(b.draftGroups) - draftGroupTotal(a.draftGroups))
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      presetId: `preset-${index}`,
      drafts: draftGroupTotal(item.draftGroups),
      players: item.playerIds.size,
      dateCount: item.dates.size
    }));
}

function renderAdpSeasonSummary() {
  const box = el("adpSeasonSummary");
  if (!box) return;
  const season = number(el("adpSeason")?.value, settings().year);
  const rows = state.customAdpRows.filter((row) => number(row.season) === season);
  if (!rows.length) {
    box.textContent = `No Sleeper ADP rows loaded for ${season}.`;
    return;
  }
  const dates = uniqueSorted(rows.map((row) => row.start_date));
  const formats = rows.reduce((acc, row) => {
    const key = row.league_format || "unknown";
    if (!acc[key]) acc[key] = { rows: 0, draftGroups: new Map(), players: new Set() };
    acc[key].rows += 1;
    addDraftGroup(acc[key].draftGroups, row);
    acc[key].players.add(row.player_id);
    return acc;
  }, {});
  const formatText = Object.entries(formats)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([format, item]) => `${format}: ${fmt(draftGroupTotal(item.draftGroups), 0)} drafts, ${fmt(item.players.size, 0)} players`)
    .join(" | ");
  box.textContent = `${season} dataset: ${dates[0] || "unknown"} to ${dates[dates.length - 1] || "unknown"} | ${formatText}`;
}

function scoringLabelFromType(type) {
  const labels = {
    ppr: "PPR",
    half_ppr: "Half PPR",
    std: "Standard",
    "2qb": "2QB",
    idp: "IDP",
    idp_1qb: "IDP 1QB",
    dynasty_2qb: "Dynasty 2QB",
    dynasty_ppr: "Dynasty PPR",
    dynasty_half_ppr: "Dynasty half PPR",
    dynasty_std: "Dynasty standard"
  };
  return labels[type] || String(type || "Custom").replace(/_/g, " ");
}

function presetLineupText(preset) {
  const bestball = String(preset.bestball).toLowerCase() === "true" ? " - Bestball" : "";
  return `${fmt(preset.st_teams, 0)} teams - ${fmt(preset.slots_qb, 0)}QB/${fmt(preset.slots_rb, 0)}RB/${fmt(preset.slots_wr, 0)}WR/${fmt(preset.slots_te, 0)}TE/${fmt(preset.slots_flex, 0)}Flex/${fmt(preset.slots_superflex, 0)}SF${bestball}`;
}

function rookieInclusionLabel(value) {
  const label = String(value || "n/a");
  return label === "n/a" ? "" : label;
}

function effectiveRookieInclusion(row) {
  if (row.league_format !== "dynasty") return "n/a";
  if (row.board_class === "rookie") return "rookie draft";
  return row.rookie_inclusion || "neither";
}

function presetScoringText(preset) {
  return `Rec ${fmt(preset.score_rec, 1)}, TE+ ${fmt(preset.score_te_premium, 1)}, RecYd ${fmt(preset.score_rec_yd, 2)}, RushYd ${fmt(preset.score_rush_yd, 2)}, PassYd ${fmt(preset.score_pass_yd, 2)}, PassTD ${fmt(preset.score_pass_td, 1)}, INT ${fmt(preset.score_pass_int, 1)}, FL ${fmt(preset.score_fum_lost, 1)}`;
}

function renderAdpLeaguePresets() {
  const box = el("adpLeaguePresets");
  if (!box) return;
  const presets = adpLeaguePresets(10);
  if (!presets.length) {
    box.innerHTML = `<p class="muted">No league presets found for the selected season and league type.</p>`;
    return;
  }
  box.innerHTML = presets.map((preset) => `
    <button class="league-preset" type="button" data-preset-key="${escapeHtml(adpLeaguePresetKey(preset))}">
      <strong>${escapeHtml(scoringLabelFromType(preset.md_scoring_type))} ${String(preset.is_superflex).toLowerCase() === "true" ? "SF/2QB" : "1QB"}</strong>
      <span>${escapeHtml(presetLineupText(preset))}</span>
      <span>${escapeHtml(preset.league_format === "dynasty" && rookieInclusionLabel(effectiveRookieInclusion(preset)) ? `${preset.board_class} - ${rookieInclusionLabel(effectiveRookieInclusion(preset))}` : preset.board_class)}</span>
      <span>${escapeHtml(presetScoringText(preset))}</span>
      <em>${fmt(preset.drafts, 0)} drafts - ${fmt(preset.players, 0)} players</em>
    </button>
  `).join("");
}

function applyAdpLeaguePreset(key) {
  const preset = adpLeaguePresets(80).find((item) => adpLeaguePresetKey(item) === key);
  if (!preset) return;
  if (el("adpLeagueFormat")) el("adpLeagueFormat").value = preset.league_format;
  applyAdpFormatDefaults();
  if (el("adpBoardType")) el("adpBoardType").value = preset.board_class;
  if (el("adpRookieInclusion")) el("adpRookieInclusion").value = preset.league_format === "dynasty" ? effectiveRookieInclusion(preset) : "all";
  if (el("adpDraftType")) el("adpDraftType").value = preset.type;
  if (el("adpBestball")) el("adpBestball").value = String(preset.bestball).toLowerCase() === "true" ? "true" : "false";
  if (el("adpScoring")) el("adpScoring").value = preset.md_scoring_type;

  const assignments = {
    teamsInput: preset.st_teams,
    qbSlots: preset.slots_qb,
    rbSlots: preset.slots_rb,
    wrSlots: preset.slots_wr,
    teSlots: preset.slots_te,
    flexSlots: preset.slots_flex,
    superflexSlots: preset.slots_superflex,
    receptions: preset.score_rec,
    tePremium: preset.score_te_premium,
    receivingYds: preset.score_rec_yd,
    receivingTd: preset.score_rec_td,
    rushingYds: preset.score_rush_yd,
    rushingTd: preset.score_rush_td,
    passingYds: preset.score_pass_yd,
    passingTd: preset.score_pass_td,
    interception: preset.score_pass_int,
    fumbleLost: preset.score_fum_lost
  };
  for (const [id, value] of Object.entries(assignments)) {
    if (el(id)) el(id).value = value;
  }
  scheduleRender(0);
}

function adpCompatibility(row, config) {
  const slotPenalty = adpSlotDistance(row, config.slots) * 0.16;
  const scoringPenalty = adpScoringDistance(row, config.scoringValues) * 0.08;
  return Math.max(0.25, 1 - slotPenalty - scoringPenalty);
}

function filteredAdpRows(options = {}) {
  const config = adpSettings();
  const ignoreDate = Boolean(options.ignoreDate);
  return dedupeAdpRows(state.customAdpRows.filter((row) => {
    if (number(row.season) !== config.season) return false;
    if (String(row.position || row.md_pos || "").toUpperCase() === "K") return false;
    if (config.leagueFormat !== "all" && row.league_format !== config.leagueFormat) return false;
    if (config.boardType !== "all" && row.board_class !== config.boardType) return false;
    if (row.league_format === "dynasty" && config.rookieInclusion !== "all" && effectiveRookieInclusion(row) !== config.rookieInclusion) return false;
    if (String(row.position || "").toUpperCase() === "RDP" && !(row.board_class === "startup" && ["rookie picks", "rookies + picks"].includes(config.rookieInclusion))) return false;
    if (config.draftType !== "all" && row.type !== config.draftType) return false;
    if (config.bestball !== "all" && String(row.bestball).toLowerCase() !== config.bestball) return false;
    if (config.scoring !== "all" && row.md_scoring_type !== config.scoring) return false;
    if (config.superflex !== "all" && String(row.is_superflex).toLowerCase() !== config.superflex) return false;
    if (config.teams !== "all" && String(row.st_teams) !== config.teams) return false;
    if (config.rounds !== "all" && String(row.st_rounds) !== config.rounds) return false;
    if (!ignoreDate && !dateInWindow(row.start_date, config.startDate, config.endDate)) return false;
    return true;
  }));
}

function customAdpBoard() {
  const config = adpSettings();
  const filtered = filteredAdpRows();
  const grouped = new Map();
  const trendRows = new Map();
  const draftGroups = new Map();
  for (const row of filtered) {
    const key = adpPlayerKey(row);
    if (!key) continue;
    if (!trendRows.has(key)) trendRows.set(key, []);
    trendRows.get(key).push(row);
    addDraftGroup(draftGroups, row);
    if (!grouped.has(key)) {
      grouped.set(key, {
        player_id: key,
        full_name: row.full_name || row.player_id,
        position: row.position || "UNK",
        team: row.team || "",
        headshot_url: row.headshot_url || "",
        league_format: row.league_format || "",
        board_class: row.board_class || "",
        bestball: String(row.bestball).toLowerCase() === "true" ? "true" : "false",
        sourcePlayerIds: new Set(),
        playerDraftGroups: new Map(),
        rookieInclusions: new Set(),
        drafts: 0,
        picks: 0,
        weightedPickTotal: 0,
        compatibilityTotal: 0,
        weight: 0,
        min_pick: Number.POSITIVE_INFINITY,
        max_pick: 0,
        dates: new Set()
      });
    }
    const item = grouped.get(key);
    const drafts = number(row.drafts, 0);
    const picks = number(row.picks, 0);
    const adp = number(row.adp, null);
    const fit = adpCompatibility(row, config);
    const weight = Math.max(picks, drafts, 1) * fit;
    item.sourcePlayerIds.add(String(row.player_id || ""));
    item.playerDraftGroups.set(adpGroupKey(row, true), Math.max(item.playerDraftGroups.get(adpGroupKey(row, true)) || 0, drafts));
    item.picks += picks;
    item.weight += weight;
    item.compatibilityTotal += fit * Math.max(picks, drafts, 1);
    if (adp !== null) item.weightedPickTotal += adp * weight;
    item.min_pick = Math.min(item.min_pick, number(row.min_pick, item.min_pick));
    item.max_pick = Math.max(item.max_pick, number(row.max_pick, item.max_pick));
    item.dates.add(row.start_date);
    if (row.league_format === "dynasty") item.rookieInclusions.add(rookieInclusionLabel(effectiveRookieInclusion(row)));
  }

  const rows = [...grouped.values()]
    .map((item) => ({
      ...item,
      drafts: draftGroupTotal(item.playerDraftGroups),
      adp: item.weightedPickTotal / Math.max(item.weight, 1),
      compatibility: item.compatibilityTotal / Math.max(item.picks || item.drafts, 1),
      min_pick: item.min_pick === Number.POSITIVE_INFINITY ? null : item.min_pick,
      max_pick: item.max_pick || null,
      rookie_inclusion: [...item.rookieInclusions].filter(Boolean).sort().join(", "),
      dates: item.dates.size
    }))
    .filter((item) => item.drafts >= config.minDrafts)
    .filter((item) => !config.query || `${item.full_name} ${item.team} ${item.position}`.toLowerCase().includes(config.query))
    .sort((a, b) => a.adp - b.adp);

  const posCounts = {};
  rows.forEach((item, index) => {
    item.rank = index + 1;
    posCounts[item.position] = (posCounts[item.position] || 0) + 1;
    item.pos_rank = posCounts[item.position];
    item.trend = adpTrendValue(trendRows.get(item.player_id) || []);
  });
  rows.sampleDrafts = draftGroupTotal(draftGroups);
  return rows;
}

function adpTrendValue(rows) {
  rows = [...rows].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  if (rows.length < 2) return null;
  return number(rows[rows.length - 1].adp, null) - number(rows[0].adp, null);
}

function sortedAdpRows(rows) {
  const dir = state.adpSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[state.adpSortKey];
    const bv = b[state.adpSortKey];
    if (typeof av === "string" || typeof bv === "string") return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    return ((av ?? Number.POSITIVE_INFINITY) - (bv ?? Number.POSITIVE_INFINITY)) * dir;
  });
}

function adpTitle(rows) {
  const config = adpSettings();
  const scoring = config.scoring === "all" ? "all scoring" : config.scoring.replace(/_/g, " ");
  const qb = config.superflex === "all" ? "all QB formats" : config.superflex === "true" ? "SuperFlex/2QB" : "1QB";
  const format = config.leagueFormat === "all" ? "All Leagues" : config.leagueFormat === "dynasty" ? "Dynasty" : "Redraft";
  const board = config.boardType === "all" ? "ADP" : config.boardType === "rookie" ? "Rookie ADP" : config.boardType === "startup" ? "Startup ADP" : "Redraft ADP";
  const draftType = config.draftType === "all" ? "all draft types" : `${config.draftType} drafts`;
  const bestball = config.bestball === "all" ? "managed and bestball" : config.bestball === "true" ? "bestball" : "managed";
  const rookieSetup = config.leagueFormat === "dynasty" && config.rookieInclusion !== "all" ? ` - ${config.rookieInclusion}` : "";
  const dateText = `${config.startDate || "first available"} to ${config.endDate || "latest available"}`;
  const lineup = `${config.slots.QB}QB/${config.slots.RB}RB/${config.slots.WR}WR/${config.slots.TE}TE/${config.slots.FLEX}Flex/${config.slots.SUPERFLEX}SF`;
  return {
    title: `${config.season} Sleeper ${format} ${board}: ${qb}, ${scoring}`,
    subtitle: `${draftType}${rookieSetup} - ${bestball} - ${config.teams === "all" ? "all league sizes" : `${config.teams} teams`} - ${lineup} - ${config.rounds === "all" ? "all round counts" : `${config.rounds} rounds`} - ${dateText} - min ${config.minDrafts} drafts - ${rows.length} players`
  };
}

function renderAdpLab() {
  if (!state.customAdpLoaded) {
    loadCustomAdpData();
    return;
  }
  applyAdpTwoQbHint();
  const rows = customAdpBoard();
  const copy = adpTitle(rows);
  if (el("adpChartTitle")) el("adpChartTitle").textContent = copy.title;
  if (el("adpChartSubtitle")) el("adpChartSubtitle").textContent = copy.subtitle;
  updateAdpFilterChrome(rows);
  renderAdpSeasonSummary();
  renderAdpLeaguePresets();
  renderAdpSummary(rows);
  renderAdpDraftDistributionChart();
  renderAdpTrendChart(rows, copy);
  renderAdpTable(rows);
}

function renderAdpSummary(rows) {
  const drafts = rows.sampleDrafts ?? rows.reduce((sum, row) => sum + number(row.drafts, 0), 0);
  const config = adpSettings();
  const top = rows[0];
  el("adpPlayerCount").textContent = rows.length;
  el("adpDraftSample").textContent = drafts.toLocaleString();
  el("adpMonthWindow").textContent = `${config.startDate || "First"} to ${config.endDate || "latest"}`;
  el("adpTopPlayer").textContent = top ? `${top.full_name} ${fmt(top.adp, 1)}` : "-";
}

function adpFilterSummaryText(rows = null) {
  const config = adpSettings();
  const bits = [
    `${config.season}`,
    config.leagueFormat === "all" ? "all leagues" : config.leagueFormat,
    config.boardType === "all" ? "all boards" : config.boardType,
    config.scoring === "all" ? "all scoring" : scoringLabelFromType(config.scoring),
    config.draftType === "all" ? "all draft types" : config.draftType,
    config.bestball === "all" ? "managed + bestball" : config.bestball === "true" ? "bestball" : "managed",
    `${config.teams} teams`,
    config.superflex === "true" ? "SF/2QB" : "1QB",
    `${config.startDate || "first"} to ${config.endDate || "latest"}`
  ];
  if (config.query) bits.push(`search: ${config.query}`);
  if (rows) bits.push(`${rows.length} players`);
  return bits.join(" | ");
}

function updateAdpFilterChrome(rows = null) {
  const summary = el("adpFilterSummary");
  if (summary) summary.textContent = adpFilterSummaryText(rows);
  const sample = el("adpFilterSample");
  if (sample) {
    const drafts = rows?.sampleDrafts ?? rows?.reduce?.((sum, row) => sum + number(row.drafts, 0), 0) ?? "-";
    sample.textContent = `Sample: ${typeof drafts === "number" ? drafts.toLocaleString() : drafts}`;
  }
}

function openAdpFilters() {
  const overlay = el("adpFilterOverlay");
  const toggle = el("adpFilterToggle");
  if (!overlay) return;
  overlay.hidden = false;
  toggle?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => el("adpStartDate")?.focus());
}

function closeAdpFilters() {
  const overlay = el("adpFilterOverlay");
  const toggle = el("adpFilterToggle");
  if (!overlay) return;
  overlay.hidden = true;
  toggle?.setAttribute("aria-expanded", "false");
}

function resetAdpFilters() {
  const cfg = settings();
  if (el("adpLeagueFormat")) el("adpLeagueFormat").value = "redraft";
  applyAdpFormatDefaults();
  if (el("adpBoardType")) el("adpBoardType").value = "redraft";
  if (el("adpRookieInclusion")) el("adpRookieInclusion").value = "all";
  if (el("adpDraftType")) el("adpDraftType").value = "snake";
  if (el("adpBestball")) el("adpBestball").value = "all";
  if (el("adpScoring")) el("adpScoring").value = cfg.slots.SUPERFLEX > 0 || cfg.slots.QB > 1 ? "2qb" : cfg.scoring.rec >= 1 ? "ppr" : cfg.scoring.rec >= 0.5 ? "half_ppr" : "std";
  if (el("adpMinDrafts")) el("adpMinDrafts").value = 5;
  if (el("adpSearch")) el("adpSearch").value = "";
  updateAdpDateControlsForSeason(true);
  state.customAdpLoaded = false;
  scheduleRender(0);
}

function renderAdpTrendChart(rows, copy) {
  const chart = el("adpTrendChart");
  if (!chart) return;
  const filtered = filteredAdpRows();
  const topRows = rows.slice(0, 18);
  const traces = topRows.map((player, index) => {
    const byDate = new Map();
    for (const row of filtered.filter((candidate) => adpPlayerKey(candidate) === player.player_id)) {
      const date = row.start_date;
      const weight = Math.max(number(row.picks, 0), number(row.drafts, 0), 1);
      if (!byDate.has(date)) byDate.set(date, { adpTotal: 0, weight: 0 });
      const item = byDate.get(date);
      item.adpTotal += number(row.adp, 0) * weight;
      item.weight += weight;
    }
    const playerRows = [...byDate.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([date, item]) => ({ start_date: date, adp: item.adpTotal / Math.max(item.weight, 1) }));
    return {
      type: "scatter",
      mode: "lines+markers",
      name: `${player.full_name} (${player.position})`,
      x: playerRows.map((row) => row.start_date),
      y: playerRows.map((row) => number(row.adp, null)),
      line: { color: playerTraceColors[index % playerTraceColors.length], width: 2 },
      marker: { size: 6 },
      hovertemplate: `${escapeHtml(player.full_name)}<br>%{x}<br>ADP %{y:.1f}<extra></extra>`
    };
  });
  Plotly.react(chart, traces, {
    title: { text: copy.title, font: { color: "#f0f0f0", size: 18 } },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0.18)",
    font: { color: "#f0f0f0", family: "Mulish, sans-serif" },
    margin: { t: 64, r: 18, b: 92, l: 58 },
    xaxis: { title: "Draft month", gridcolor: "rgba(240,240,240,0.14)", color: "#f0f0f0" },
    yaxis: { title: "ADP", autorange: "reversed", gridcolor: "rgba(240,240,240,0.14)", color: "#f0f0f0" },
    legend: { orientation: "h", x: 0, y: -0.22, font: { size: 10 } }
  }, { responsive: true });
}

function renderAdpDraftDistributionChart() {
  const chart = el("adpDraftDistributionChart");
  if (!chart) return;
  const config = adpSettings();
  const rows = filteredAdpRows({ ignoreDate: true });
  const byMonth = new Map();
  for (const row of rows) {
    const date = String(row.start_date || "");
    if (date.length < 7) continue;
    const month = date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { draftGroups: new Map(), players: new Set() });
    const item = byMonth.get(month);
    addDraftGroup(item.draftGroups, row);
    if (row.player_id) item.players.add(row.player_id);
  }
  const months = [...byMonth.keys()].sort();
  Plotly.react(chart, [{
    type: "bar",
    name: "Drafts",
    x: months,
    y: months.map((month) => draftGroupTotal(byMonth.get(month).draftGroups)),
    customdata: months.map((month) => byMonth.get(month).players.size),
    marker: { color: "#cc3333" },
    hovertemplate: "%{x}<br>%{y:,} drafts<br>%{customdata:,} players<extra></extra>"
  }], {
    title: { text: `${config.season} Draft Timing Distribution`, font: { color: "#f0f0f0", size: 16 } },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0.18)",
    font: { color: "#f0f0f0", family: "Mulish, sans-serif" },
    margin: { t: 54, r: 18, b: 56, l: 62 },
    xaxis: { title: "Draft month", gridcolor: "rgba(240,240,240,0.14)", color: "#f0f0f0" },
    yaxis: { title: "Drafts", gridcolor: "rgba(240,240,240,0.14)", color: "#f0f0f0" },
    showlegend: false
  }, { responsive: true });
}

function renderAdpTable(rows) {
  const body = el("adpBody");
  if (!body) return;
  const limited = sortedAdpRows(rows).slice(0, 500);
  body.innerHTML = limited.map((row) => `
    <tr data-adp-player="${escapeHtml(row.player_id)}" class="${row.player_id === state.selectedAdpPlayer ? "selected-row" : ""}">
      <td>${fmt(row.rank, 0)}</td>
      <td>
        <div class="adp-player-cell">
          <img class="adp-row-headshot" src="${escapeHtml(row.headshot_url)}" alt="" loading="lazy" onerror="this.style.display='none'">
          <strong>${escapeHtml(row.full_name)}</strong>
        </div>
      </td>
      <td><span class="pos-pill pos-${row.position}">${escapeHtml(row.position)}</span></td>
      <td>${escapeHtml(row.team || "-")}</td>
      <td>${fmt(row.adp, 1)}</td>
      <td>${fmt(row.drafts, 0)}</td>
      <td>${fmt(row.picks, 0)}</td>
      <td>${fmt(row.min_pick, 0)}</td>
      <td>${fmt(row.max_pick, 0)}</td>
      <td class="${row.trend === null ? "" : row.trend <= 0 ? "value-pos" : "value-neg"}">${row.trend === null ? "-" : `${row.trend > 0 ? "+" : ""}${fmt(row.trend, 1)}`}</td>
    </tr>
    ${row.player_id === state.selectedAdpPlayer ? `<tr class="player-detail-row"><td colspan="10">${renderAdpPlayerDetail(row)}</td></tr>` : ""}
  `).join("");
}

function renderAdpPlayerDetail(selected) {
  return `
    <div class="inline-player-detail adp-inline-detail">
      <div class="adp-card-layout">
        <img class="adp-headshot" src="${escapeHtml(selected.headshot_url)}" alt="${escapeHtml(selected.full_name)} headshot" onerror="this.style.display='none'">
        <div>
          <p class="eyebrow">ADP profile</p>
          <h2>${escapeHtml(selected.full_name)}</h2>
          <p class="muted">${escapeHtml(selected.team || "-")} - <span class="pos-pill pos-${selected.position}">${escapeHtml(selected.position)}</span> - ${escapeHtml(selected.league_format)} ${escapeHtml(selected.board_class)}</p>
        </div>
      </div>
      <div class="player-stats adp-card-stats">
        <div><span>Rank</span><strong>${fmt(selected.rank, 0)}</strong></div>
        <div><span>ADP</span><strong>${fmt(selected.adp, 1)}</strong></div>
        <div><span>Drafts</span><strong>${fmt(selected.drafts, 0)}</strong></div>
        <div><span>Picks</span><strong>${fmt(selected.picks, 0)}</strong></div>
        <div><span>Min pick</span><strong>${fmt(selected.min_pick, 0)}</strong></div>
        <div><span>Max pick</span><strong>${fmt(selected.max_pick, 0)}</strong></div>
        <div><span>Trend</span><strong class="${selected.trend === null ? "" : selected.trend <= 0 ? "value-pos" : "value-neg"}">${selected.trend === null ? "-" : `${selected.trend > 0 ? "+" : ""}${fmt(selected.trend, 1)}`}</strong></div>
        <div><span>Position rank</span><strong>${selected.position}${fmt(selected.pos_rank, 0)}</strong></div>
        <div><span>Settings fit</span><strong>${fmt(selected.compatibility * 100, 0)}%</strong></div>
      </div>
    </div>
  `;
}

function exportAdpBoard() {
  const rows = customAdpBoard();
  if (!rows.length) return;
  const cols = ["rank", "full_name", "position", "team", "bestball", "adp", "drafts", "picks", "min_pick", "max_pick", "trend", "league_format", "board_class", "rookie_inclusion", "player_id"];
  const csv = [
    cols.join(","),
    ...rows.map((row) => cols.map((col) => JSON.stringify(row[col] ?? "")).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `custom-sleeper-adp-${adpSettings().season}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function renderDynastyWar() {
  const rows = dynastyBoardRows();
  if (state.selectedDynastyKey && !rows.some((row) => row.dynastyKey === state.selectedDynastyKey)) state.selectedDynastyKey = null;
  const top = rows[0];
  const picks = rows.filter((row) => row.Pos === "RDP");
  const missingPickNote = missingRookiePickLabels(rows);
  if (el("dynastyPlayerCount")) el("dynastyPlayerCount").textContent = rows.length;
  if (el("dynastyTopPlayer")) el("dynastyTopPlayer").textContent = top ? `${top.Player} ${fmt(top.dynastyWar)}` : "-";
  if (el("dynastyRookiePickCount")) el("dynastyRookiePickCount").textContent = picks.length;
  const excluded = state.dynastyExcludedSummary || {};
  const exclusionParts = [
    excluded.retired ? `${excluded.retired} retired` : "",
    excluded.inactive ? `${excluded.inactive} inactive/no projection` : "",
    excluded.stale ? `${excluded.stale} no projection or recent stats` : "",
    excluded.noProjection ? `${excluded.noProjection} no current projection` : ""
  ].filter(Boolean);
  const exclusionNote = exclusionParts.length ? ` - excluded ${exclusionParts.join(", ")}` : "";
  if (el("dynastySource")) el("dynastySource").textContent = `${settings().year} Sleeper dynasty ADP - ${dynastySettings().horizon} years - ${state.rawProjections.length} current projection rows${exclusionNote}${missingPickNote ? ` - missing ${missingPickNote}` : ""}`;
  renderDynastyChart(rows);
  renderDynastyTable(rows);
}

function missingRookiePickLabels(rows) {
  const posFilter = dynastySettings().position;
  if (!["ALL", "RDP"].includes(posFilter)) return "";
  const teams = settings().teams;
  const currentYear = settings().year;
  const seen = new Set(rows.filter((row) => row.Pos === "RDP").map((row) => `${row.pickYear}|${row.pickLabel}`));
  return [currentYear + 1, currentYear + 2]
    .map((pickYear) => {
      const missing = Array.from({ length: teams * 3 }, (_, index) => rookiePickLabelFromPick(index + 1, teams))
        .filter((label) => !seen.has(`${pickYear}|${label}`));
      return missing.length ? `${pickYear}: ${missing.join(", ")}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

function sortedDynastyRows(rows) {
  const dir = state.dynastySortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const yearMatch = String(state.dynastySortKey || "").match(/^year_(\d+)$/);
    const av = yearMatch ? a.yearlyWar?.[number(yearMatch[1], 1) - 1] : a[state.dynastySortKey];
    const bv = yearMatch ? b.yearlyWar?.[number(yearMatch[1], 1) - 1] : b[state.dynastySortKey];
    if (typeof av === "string" || typeof bv === "string") return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    return ((av ?? Number.POSITIVE_INFINITY) - (bv ?? Number.POSITIVE_INFINITY)) * dir;
  });
}

function renderDynastyChart(rows) {
  const chart = el("dynastyWarChart");
  if (!chart || !window.Plotly) return;
  const limited = rows.slice(0, 120);
  const traces = ["QB", "RB", "WR", "TE", "RDP"].map((pos) => {
    const posRows = limited.filter((row) => row.Pos === pos);
    return {
      type: "scatter",
      mode: "markers",
      name: pos,
      x: posRows.map((row) => row.ADP),
      y: posRows.map((row) => row.dynastyWar),
      ids: posRows.map((row) => row.dynastyKey),
      text: posRows.map((row) => `${row.Player}<br>${pos} - ADP ${fmt(row.ADP, 1)}<br>Current WAR ${fmt(row.currentWar)}<br>Dynasty WAR ${fmt(row.dynastyWar)}<br>${row.model}`),
      hoverinfo: "text",
      marker: {
        color: posColors[pos] || "#d0a85b",
        symbol: pos === "RDP" ? "x" : posSymbols[pos] || "circle",
        size: pos === "RDP" ? 11 : 9,
        line: { color: "#111111", width: 1 }
      }
    };
  });
  Plotly.react(chart, traces, {
    title: { text: `${dynastySettings().horizon} Year Dynasty Value vs ADP`, font: { color: "#f0f0f0", size: 18 } },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0.18)",
    font: { color: "#f0f0f0", family: "Mulish, sans-serif" },
    margin: { t: 54, r: 18, b: 56, l: 62 },
    xaxis: { title: "Dynasty ADP", autorange: "reversed", gridcolor: "rgba(240,240,240,0.14)", color: "#f0f0f0" },
    yaxis: { title: "Projected Dynasty WAR", gridcolor: "rgba(240,240,240,0.14)", color: "#f0f0f0" },
    legend: { orientation: "h", x: 0, y: 1.12 }
  }, { responsive: true });
  if (typeof chart.removeAllListeners === "function") chart.removeAllListeners("plotly_click");
  if (typeof chart.on === "function") {
    chart.on("plotly_click", (event) => {
      const key = event.points?.[0]?.id;
      if (!key) return;
      state.selectedDynastyKey = state.selectedDynastyKey === key ? null : key;
      renderDynastyTable(rows);
    });
  }
}

function renderDynastyTable(rows) {
  const body = el("dynastyWarBody");
  if (!body) return;
  const limited = sortedDynastyRows(rows).slice(0, 500);
  renderDynastyHeaders();
  body.innerHTML = limited.map((row) => `
    <tr data-dynasty-key="${escapeHtml(row.dynastyKey)}" class="${row.dynastyKey === state.selectedDynastyKey ? "selected-row" : ""}">
      <td>${fmt(row.rank, 0)}</td>
      <td>
        <div class="adp-player-cell">
          <img class="adp-row-headshot" src="${escapeHtml(row.headshot_url || "")}" alt="" loading="lazy" onerror="this.style.display='none'">
          <strong>${escapeHtml(row.Player)}</strong>
        </div>
      </td>
      <td><span class="pos-pill pos-${row.Pos}">${escapeHtml(row.Pos)}</span></td>
      <td>${escapeHtml(row.Team || "-")}</td>
      <td>${fmt(row.ADP, 1)}</td>
      <td>${fmt(row.currentWar)}</td>
      <td>${fmt(row.previousFptsPerGame, 1)}</td>
      <td>${fmt(row.projectedFptsPerGame, 1)}</td>
      <td>${fmt(row.dynastyWar)}</td>
      ${dynastyShowsSuperflex() ? `<td>${fmt(row.dynastySuperflexWar)}</td>` : ""}
      ${dynastyYearCells(row)}
      <td>${escapeHtml(row.Pos === "RDP" ? row.bestCasePos || "-" : ageCurvePeakText(row.Pos))}</td>
      <td>${fmt(row.age, 1)}</td>
    </tr>
    ${row.dynastyKey === state.selectedDynastyKey ? renderDynastyDetailRow(row) : ""}
  `).join("");
}

function renderDynastyHeaders() {
  const row = el("dynastyWarHead");
  if (!row) return;
  const yearHeaders = Array.from({ length: dynastySettings().horizon }, (_, index) => {
    const year = settings().year + index;
    return `<th data-dynasty-sort="year_${index + 1}">${year} WAR</th>`;
  }).join("");
  const superflexHeader = dynastyShowsSuperflex() ? `<th data-dynasty-sort="dynastySuperflexWar">SuperFlex WAR</th>` : "";
  row.innerHTML = `
    <th data-dynasty-sort="rank">Rank</th>
    <th data-dynasty-sort="Player">Player</th>
    <th data-dynasty-sort="Pos">Pos</th>
    <th data-dynasty-sort="Team">Team</th>
    <th data-dynasty-sort="ADP">ADP</th>
    <th data-dynasty-sort="currentWar">Current WAR</th>
    <th data-dynasty-sort="previousFptsPerGame">Prev FPTS/G</th>
    <th data-dynasty-sort="projectedFptsPerGame">Proj FPTS/G</th>
    <th data-dynasty-sort="dynastyWar">Total WAR</th>
    ${superflexHeader}
    ${yearHeaders}
    <th data-dynasty-sort="bestCasePos">Curve</th>
    <th data-dynasty-sort="age">Age</th>
  `;
}

function dynastyYearCells(row) {
  return Array.from({ length: dynastySettings().horizon }, (_, index) => (
    `<td>${fmt(row.yearlyWar?.[index])}</td>`
  )).join("");
}

function ageCurvePeakText(pos) {
  const curve = dynastyAgeCurves[pos] || dynastyAgeCurves.WR;
  return `Peak ${curve.peakStart}-${curve.peakEnd}`;
}

function renderDynastyDetailRow(row) {
  const colspan = dynastySettings().horizon + 11 + (dynastyShowsSuperflex() ? 1 : 0);
  return `
    <tr class="player-detail-row dynasty-detail-row">
      <td colspan="${colspan}">
        ${renderDynastyDetail(row)}
      </td>
    </tr>
  `;
}

function renderDynastyDetail(row) {
  const isPick = row.Pos === "RDP";
  const curveRows = dynastyAgeCurveRows(row);
  const comps = row.comps?.length
    ? `<p class="muted"><strong>${isPick ? "Historical rank examples" : "Rookie development comps"}:</strong> ${row.comps.map((comp) => escapeHtml(comp)).join(", ")}</p>`
    : "";
  const rookieGrowth = !isPick && row.rookieDevelopment
    ? `<div><span>Rookie Y2/Y3 FPTS/G comps</span><strong>${fmt(row.rookieDevelopment.y2Multiplier, 2)}x / ${fmt(row.rookieDevelopment.y3Multiplier, 2)}x</strong></div>
       <div><span>Comp Y2/Y3 FPTS/G</span><strong>${fmt(row.rookieDevelopment.y2TargetFptsPerGame, 1)} / ${fmt(row.rookieDevelopment.y3TargetFptsPerGame, 1)}</strong></div>`
    : "";
  const currentSource = !isPick && row.currentWarEstimated
    ? `<div><span>${settings().year} WAR source</span><strong>Estimated</strong></div>`
    : "";
  const yearlyFptsPath = row.yearlyFptsPerGame?.length
    ? `<p class="muted"><strong>FPTS/G path:</strong> ${row.yearlyFptsPerGame.map((value, index) => `${settings().year + index}: ${fmt(value, 1)}`).join(" | ")}</p>`
    : "";
  return `
    <div class="dynasty-detail">
      <div class="dynasty-detail-copy">
        <p class="eyebrow">${isPick ? "Rookie pick draft-rank curve" : "Player FPTS/G age curve converted to WAR"}</p>
        <h2>${escapeHtml(row.Player)}</h2>
        <p class="muted">${escapeHtml(row.Team || "-")} - <span class="pos-pill pos-${row.Pos}">${escapeHtml(row.Pos)}</span> - ${escapeHtml(row.model || "")}</p>
        <div class="player-stats dynasty-detail-stats">
          <div><span>Dynasty WAR</span><strong>${fmt(row.dynastyWar)}</strong></div>
          ${dynastyShowsSuperflex() ? `<div><span>SuperFlex WAR</span><strong>${fmt(row.dynastySuperflexWar)}</strong></div>` : ""}
          <div><span>${isPick ? "Common archetype" : "Current age"}</span><strong>${isPick ? escapeHtml(row.bestCasePos || "-") : fmt(row.age, 1)}</strong></div>
          ${!isPick ? `<div><span>Previous FPTS/G</span><strong>${fmt(row.previousFptsPerGame, 1)}</strong></div>` : ""}
          ${!isPick ? `<div><span>Projected FPTS/G</span><strong>${fmt(row.projectedFptsPerGame, 1)}</strong></div>` : ""}
          ${!isPick ? `<div><span>Blended base FPTS/G</span><strong>${fmt(row.blendedFptsPerGame, 1)}</strong></div>` : ""}
          <div><span>ADP</span><strong>${fmt(row.ADP, 1)}</strong></div>
          <div><span>Curve basis</span><strong>${isPick ? "Class rank" : escapeHtml(ageCurvePeakText(row.Pos))}</strong></div>
          ${currentSource}
          ${rookieGrowth}
        </div>
        ${yearlyFptsPath}
        ${comps}
      </div>
      ${dynastyCurveSvg(row, curveRows)}
    </div>
  `;
}

function dynastyCurveSvg(row, curveRows) {
  if (!curveRows.length) {
    return `<p class="muted">No age curve available for this row yet.</p>`;
  }
  const width = 760;
  const height = 250;
  const pad = { l: 48, r: 18, t: 18, b: 42 };
  const historicalPoints = dynastyHistoricalWarPoints(row);
  const yMetric = dynastyShowsSuperflex() ? "SuperFlex WAR" : "WAR";
  const projectedValues = yMetric === "SuperFlex WAR" && row.yearlySuperflexWar?.length ? row.yearlySuperflexWar : row.yearlyWar;
  const projectedPoints = (projectedValues || [])
    .map((war, index) => {
      const fptsPerGame = row.yearlyFptsPerGame?.[index] ?? null;
      return {
        Year: settings().year + index,
        Age: row.Pos === "RDP" ? null : number(row.age, null) === null ? null : number(row.age, 0) + index,
        WAR: number(war, null),
        FptsPerGame: fptsPerGame,
        Index: index,
        Label: `${settings().year + index}`
      };
    })
    .filter((point) => point.WAR !== null && (row.Pos === "RDP" || point.Age !== null));
  const values = [...curveRows, ...historicalPoints, ...projectedPoints].map((point) => number(point.WAR, 0));
  const maxY = Math.max(0.5, Math.max(...values) * 1.18);
  const minY = Math.min(0, Math.min(...values) * 1.18);
  const ySpan = Math.max(0.1, maxY - minY);
  const xDomain = row.Pos === "RDP"
    ? { min: 0, max: Math.max(1, curveRows.length - 1) }
    : {
        min: Math.min(...curveRows.map((point) => number(point.Age, 0)), ...historicalPoints.map((point) => number(point.Age, 0))),
        max: Math.max(...curveRows.map((point) => number(point.Age, 0)), ...historicalPoints.map((point) => number(point.Age, 0)))
      };
  const xFromDomain = (value) => pad.l + (((value - xDomain.min) / Math.max(1, xDomain.max - xDomain.min)) * (width - pad.l - pad.r));
  const x = (index) => row.Pos === "RDP" ? xFromDomain(index) : xFromDomain(number(curveRows[index].Age, 0));
  const xAge = (age) => xFromDomain(number(age, xDomain.min));
  const y = (value) => height - pad.b - (((value - minY) / ySpan) * (height - pad.t - pad.b));
  const zeroY = y(0);
  const linePoints = curveRows.map((point, index) => `${x(index).toFixed(1)},${y(point.WAR).toFixed(1)}`).join(" ");
  const areaPoints = `${x(0).toFixed(1)},${zeroY.toFixed(1)} ${linePoints} ${x(curveRows.length - 1).toFixed(1)},${zeroY.toFixed(1)}`;
  const currentIndex = row.Pos === "RDP" ? 0 : curveRows.reduce((best, point, index) => (
    Math.abs(number(point.Age, 0) - number(row.age, 0)) < Math.abs(number(curveRows[best].Age, 0) - number(row.age, 0)) ? index : best
  ), 0);
  const ticks = curveRows.filter((_, index) => index === 0 || index === curveRows.length - 1 || index % Math.max(1, Math.ceil(curveRows.length / 5)) === 0);
  const tickMarkup = ticks.map((point) => {
    const index = curveRows.indexOf(point);
    return `<text x="${x(index).toFixed(1)}" y="${height - 14}" text-anchor="middle">${escapeHtml(row.Pos === "RDP" ? point.Label : fmt(point.Age, Number.isInteger(point.Age) ? 0 : 1))}</text>`;
  }).join("");
  const yTicks = Array.from(new Set([minY, 0, maxY].map((value) => Number(value.toFixed(3))))).map((value) => `
    <g>
      <line x1="${pad.l}" x2="${width - pad.r}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"></line>
      <text x="8" y="${(y(value) + 4).toFixed(1)}">${fmt(value)}</text>
    </g>
  `).join("");
  const historicalMarkup = historicalPoints.map((point, index) => {
    const cx = xAge(point.Age);
    const cy = y(point.WAR);
    const labelY = Math.max(16, cy - 9 - ((index % 2) * 10));
    return `
      <g class="dynasty-history-point">
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5"></circle>
        <text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${escapeHtml(String(point.Year))}</text>
        <title>${escapeHtml(`${point.Label}: ${fmt(point.WAR)} WAR at age ${fmt(point.Age, 1)}`)}</title>
      </g>
    `;
  }).join("");
  const projectedMarkup = projectedPoints.map((point, index) => {
    const cx = row.Pos === "RDP" ? xFromDomain(point.Index) : xAge(point.Age);
    const cy = y(point.WAR);
    const labelY = Math.max(16, cy - 12 - ((index % 2) * 10));
    const fptsCopy = point.FptsPerGame === null || point.FptsPerGame === undefined ? "" : `, ${fmt(point.FptsPerGame, 1)} FPTS/G`;
    return `
      <g class="dynasty-projected-point">
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.8"></circle>
        <text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${escapeHtml(String(point.Year))}</text>
        <title>${escapeHtml(`${point.Year} projected ${yMetric}: ${fmt(point.WAR)}${fptsCopy}`)}</title>
      </g>
    `;
  }).join("");
  const legend = row.Pos === "RDP" ? "" : `
    <g class="dynasty-curve-legend">
      <line x1="${pad.l}" x2="${pad.l + 18}" y1="16" y2="16"></line>
      <text x="${pad.l + 24}" y="20">Projected curve</text>
      <circle class="projected-legend-dot" cx="${pad.l + 130}" cy="16" r="4.5"></circle>
      <text x="${pad.l + 140}" y="20">Projected years</text>
      <circle cx="${pad.l + 250}" cy="16" r="4.5"></circle>
      <text x="${pad.l + 260}" y="20">Previous seasons</text>
    </g>
  `;
  return `
    <svg class="dynasty-curve-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(row.Player)} projected WAR curve">
      <g class="dynasty-grid">${yTicks}</g>
      <line class="dynasty-zero-line" x1="${pad.l}" x2="${width - pad.r}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"></line>
      <polygon class="dynasty-curve-area" points="${areaPoints}"></polygon>
      <polyline class="dynasty-curve-line" points="${linePoints}"></polyline>
      ${projectedMarkup}
      ${historicalMarkup}
      <circle class="dynasty-current-dot" cx="${x(currentIndex).toFixed(1)}" cy="${y(curveRows[currentIndex].WAR).toFixed(1)}" r="6"></circle>
      <g class="dynasty-axis-labels">${tickMarkup}</g>
      ${legend}
      <text class="dynasty-axis-title" x="${width / 2}" y="${height - 1}" text-anchor="middle">${row.Pos === "RDP" ? "Projected rookie season" : "Age"}</text>
      <text class="dynasty-chart-label" x="${x(currentIndex).toFixed(1)}" y="${Math.max(18, y(curveRows[currentIndex].WAR) - 12).toFixed(1)}" text-anchor="middle">${row.Pos === "RDP" ? "Year 1" : `Age ${fmt(row.age, 1)}`}</text>
    </svg>
  `;
}

function exportDynastyWar() {
  const rows = dynastyBoardRows();
  if (!rows.length) return;
  const yearCols = Array.from({ length: dynastySettings().horizon }, (_, index) => `${settings().year + index} WAR`);
  const fptsCols = Array.from({ length: dynastySettings().horizon }, (_, index) => `${settings().year + index} FPTS/G`);
  const sfCols = dynastyShowsSuperflex() ? ["dynastySuperflexWar"] : [];
  const cols = ["rank", "Player", "Pos", "Team", "currentWar", "previousFptsPerGame", "projectedFptsPerGame", "dynastyWar", ...sfCols, ...yearCols, ...fptsCols, "age"];
  const csv = [
    cols.join(","),
    ...rows.map((row) => {
      const values = [
        row.rank,
        row.Player,
        row.Pos,
        row.Team,
        row.currentWar,
        row.previousFptsPerGame,
        row.projectedFptsPerGame,
        row.dynastyWar,
        ...sfCols.map((col) => row[col]),
        ...Array.from({ length: dynastySettings().horizon }, (_, index) => row.yearlyWar?.[index]),
        ...Array.from({ length: dynastySettings().horizon }, (_, index) => row.yearlyFptsPerGame?.[index]),
        row.age
      ];
      return values.map((value) => JSON.stringify(value ?? "")).join(",");
    })
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dynasty-war-${settings().year}-${dynastySettings().horizon}yr.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function projectionChartCopy(metric) {
  const context = chartContextCopy();
  const labels = {
    WAR: "Projected WAR",
    Value: "Weighted ADP Value",
    "Historical WAR": "Historical Positional-Rank WAR",
    "Delta vs Historical": "Projection Delta vs Historical Rank"
  };
  return {
    title: `${context.year} ${labels[metric] || metric} vs ADP by Position`,
    subtitle: `${context.roster} - ${context.scoring} - ${context.weeks} weeks - ${context.teamSource} from ${context.historyStart}+ seasons`
  };
}

function chartContextCopy() {
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

  const teamSource = state.baselines.TEAM?.source === "historical" ? "historical team scoring" : "projection-only team scoring";
  const start = el("historyStart")?.value || "2015";
  return {
    year: cfg.year,
    weeks: cfg.weeks,
    roster: rosterBits.join(" / "),
    scoring: scoringBits.join(" / "),
    teamSource,
    historyStart: start
  };
}

function renderProjectionChart(rows) {
  updateProjectionWorkspace();
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
  if (el("showRankCurveOverlay")?.checked) {
    traces.push(...projectionRankCurveOverlayTraces(xKey));
  }

  Plotly.react("projectionChart", traces, {
    title: { text: copy.title, font: { size: 18 }, x: 0.02, xanchor: "left" },
    margin: { l: 56, r: 18, t: 62, b: 82 },
    xaxis: { title: xKey, zeroline: false, gridcolor: "rgba(240,240,240,0.18)", color: "#f0f0f0" },
    yaxis: { title: "ADP / overall rank", autorange: "reversed", gridcolor: "rgba(240,240,240,0.18)", color: "#f0f0f0" },
    legend: { orientation: "h", y: -0.18, x: 0 },
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

function projectionRankCurveOverlayTraces(xKey) {
  const curve = state.historicalModel?.curve || [];
  if (!curve.length) return [];
  if (!["WAR", "Historical WAR"].includes(xKey)) return [];
  const selected = el("rankCurvePosition")?.value || "ALL";
  const positions = selected === "ALL" ? ["QB", "RB", "WR", "TE"] : [selected];
  return positions.map((pos) => ({
    type: "scatter",
    mode: "lines",
    name: `${pos} historical rank curve`,
    x: curve.map((row) => number(row[`${pos} WAR`])),
    y: curve.map((row) => number(row.Rank)),
    text: curve.map((row) => `${pos}${row.Rank}`),
    hovertemplate: `<b>%{text}</b><br>Historical WAR: %{x:.2f}<br>Rank: %{y}<extra></extra>`,
    line: { color: posColors[pos], width: 2, dash: "dash" },
    opacity: 0.95,
    yaxis: "y",
    xaxis: "x"
  }));
}

function renderRankCurve() {
  updateProjectionWorkspace();
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

function historicalRankCurvePositions() {
  const selected = el("historicalRankCurvePosition")?.value || "ALL";
  return selected === "ALL" ? ["QB", "RB", "WR", "TE"] : [selected];
}

function historicalRankCurveCutoff() {
  return Math.max(1, Math.min(250, number(el("historicalRankCurveCutoff")?.value, 70)));
}

function historicalRankCurveData() {
  const start = number(el("historicalPlotStart")?.value, 2015);
  const end = number(el("historicalPlotEnd")?.value, settings().year - 1);
  const avgOrNull = (values) => {
    const clean = values.filter((value) => Number.isFinite(value));
    return clean.length ? average(clean) : null;
  };
  const buckets = new Map();
  for (const row of state.historicalModel?.playerRows || []) {
    if (!["QB", "RB", "WR", "TE"].includes(row.Pos) || row.Year < start || row.Year > end || !row.Rank) continue;
    const key = `${row.Pos}|${row.Rank}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        Pos: row.Pos,
        Rank: row.Rank,
        WAR: [],
        FlexWAR: [],
        SuperFlexWAR: [],
        AVG: [],
        Games: [],
        seasons: new Set(),
        samples: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.WAR.push(number(row.WAR, null));
    bucket.FlexWAR.push(number(row["Flex WAR"], null));
    bucket.SuperFlexWAR.push(number(row["SuperFlex WAR"], null));
    bucket.AVG.push(number(row.AVG, null));
    bucket.Games.push(number(row.Games, null));
    bucket.seasons.add(row.Year);
    bucket.samples += 1;
  }

  return [...buckets.values()]
    .map((bucket) => ({
      Pos: bucket.Pos,
      Rank: bucket.Rank,
      WAR: avgOrNull(bucket.WAR),
      "Flex WAR": avgOrNull(bucket.FlexWAR),
      "SuperFlex WAR": avgOrNull(bucket.SuperFlexWAR),
      "FPTS/G": avgOrNull(bucket.AVG),
      "Avg Games": avgOrNull(bucket.Games),
      "Player Seasons": bucket.samples,
      Seasons: bucket.seasons.size
    }))
    .sort((a, b) => (["QB", "RB", "WR", "TE"].indexOf(a.Pos) - ["QB", "RB", "WR", "TE"].indexOf(b.Pos)) || a.Rank - b.Rank);
}

function renderHistoricalRankCurve() {
  const chart = el("historicalRankCurveChart");
  const body = el("historicalRankCurveBody");
  if (!chart || !body) return;
  const start = number(el("historicalPlotStart")?.value, 2015);
  const end = number(el("historicalPlotEnd")?.value, settings().year - 1);
  const rows = historicalRankCurveData();
  const positions = historicalRankCurvePositions();
  const cutoff = historicalRankCurveCutoff();
  const shownRows = rows.filter((row) => positions.includes(row.Pos) && row.Rank <= cutoff);
  const context = chartContextCopy();
  if (el("historicalRankCurveSubtitle")) {
    el("historicalRankCurveSubtitle").textContent = `${start}-${end} average positional-rank WAR curve through rank ${cutoff} - ${context.roster} - ${context.scoring} - ${context.weeks} weeks`;
  }

  if (!shownRows.length) {
    body.innerHTML = `<tr><td colspan="9">Historical rank curve data is still loading.</td></tr>`;
    Plotly.react(chart, [], historicalLayout("Historical Rank Curve", "Pos rank", "WAR", "Historical data is still loading"), historicalRankCurvePlotConfig(cutoff));
    return;
  }

  const traces = positions.map((pos) => {
    const points = shownRows.filter((row) => row.Pos === pos).sort((a, b) => a.Rank - b.Rank);
    return {
      type: "scatter",
      mode: "lines+markers",
      name: pos,
      x: points.map((row) => row.Rank),
      y: points.map((row) => row.WAR),
      customdata: points.map((row) => [row["FPTS/G"], row["Player Seasons"], row.Seasons]),
      line: { color: posColors[pos], width: 2.8, dash: posDashes[pos], shape: "spline", smoothing: 0.35 },
      marker: { size: 6, symbol: posSymbols[pos], color: posColors[pos], line: { color: "#111111", width: 1 } },
      hovertemplate: `<b>${pos}%{x}</b><br>Avg WAR: %{y:.2f}<br>Avg FPTS/G: %{customdata[0]:.2f}<br>Player seasons: %{customdata[1]}<br>Seasons: %{customdata[2]}<extra></extra>`
    };
  });
  Plotly.react(chart, traces, {
    ...historicalLayout("Historical Rank Curve", "Pos rank", "Average WAR"),
    margin: { l: 58, r: 18, t: 46, b: 70 },
    showlegend: positions.length > 1
  }, historicalRankCurvePlotConfig(cutoff));

  body.innerHTML = shownRows.map((row) => `
    <tr>
      <td><span class="pos-pill ${row.Pos.toLowerCase()}">${row.Pos}</span></td>
      <td>${row.Rank}</td>
      <td>${fmt(row.WAR, 3)}</td>
      <td>${fmt(row["Flex WAR"], 3)}</td>
      <td>${fmt(row["SuperFlex WAR"], 3)}</td>
      <td>${fmt(row["FPTS/G"], 2)}</td>
      <td>${fmt(row["Avg Games"], 1)}</td>
      <td>${row["Player Seasons"]}</td>
      <td>${row.Seasons}</td>
    </tr>
  `).join("");
}

function historicalRankCurvePlotConfig(cutoff) {
  return {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
    toImageButtonOptions: {
      format: "png",
      filename: `historical-rank-curve-top-${cutoff}`,
      height: 900,
      width: 1600,
      scale: 2
    }
  };
}

function historicalPlayerTokens() {
  return String(el("historicalPlayers")?.value || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [name, start] = token.split(":").map((part) => part.trim());
      return { name, key: playerKey(name), start: number(start, null) };
    });
}

function updateProjectionWorkspace() {
  const workspace = document.querySelector("#projectionsView .workspace");
  if (!workspace) return;
  workspace.classList.toggle("rank-expanded", state.projectionFocus === "rank");
}

function setProjectionFocus(focus) {
  if (!["projection", "rank"].includes(focus) || state.projectionFocus === focus) return;
  state.projectionFocus = focus;
  updateProjectionWorkspace();
  setTimeout(() => {
    if (window.Plotly) {
      const projectionChart = el("projectionChart");
      const rankCurveChart = el("rankCurveChart");
      if (projectionChart) Plotly.Plots.resize(projectionChart);
      if (rankCurveChart) Plotly.Plots.resize(rankCurveChart);
    }
  }, 0);
}

function updateHistoricalControlVisibility() {
  const mode = el("historicalMode")?.value || "rank";
  const always = ["mode", "metric", "startYear", "endYear"];
  const byMode = {
    rank: ["positions", "rank"],
    player: ["players", "timeline"],
    weeklyBins: ["positions", "binSize", "binMax"],
    adpThresholds: ["positions", "adpPlot", "adpScoring", "threshold"],
    adpRoundHitRates: ["positions", "adpScoring", "roundLimit", "roundHitSize", "seasonThresholds"],
    boomBustHeatmap: ["positions", "adpScoring", "threshold"],
    adpOutcome: ["positions", "adpScoring"],
    adpTrends: ["positions", "adpScoring"]
  };
  const visible = new Set([...(always || []), ...(byMode[mode] || [])]);
  document.querySelectorAll(".historical-controls [data-control]").forEach((control) => {
    const show = visible.has(control.dataset.control);
    control.hidden = !show;
  });
}

function selectedHistoricalPositions() {
  const checked = [...document.querySelectorAll("input[name='historicalPosFilter']:checked")]
    .map((input) => input.value)
    .filter((pos) => ["QB", "RB", "WR", "TE"].includes(pos));
  if (checked.length) return checked;
  const legacy = el("historicalPositions")?.value || "ALL";
  return legacy === "ALL" ? ["QB", "RB", "WR", "TE"] : [legacy];
}

function historicalPositionText() {
  const positions = selectedHistoricalPositions();
  return positions.length === 4 ? "QB/RB/WR/TE" : positions.join("/");
}

function historicalPlayerOptions() {
  const seen = new Map();
  for (const row of state.historicalModel?.playerRows || []) {
    if (!seen.has(row.PlayerKey)) seen.set(row.PlayerKey, { Player: row.Player, Pos: row.Pos });
  }
  return [...seen.values()].sort((a, b) => a.Player.localeCompare(b.Player));
}

function currentHistoricalPlayerToken() {
  const value = el("historicalPlayers")?.value || "";
  return value.split(",").pop().trim().split(":")[0].trim();
}

function renderHistoricalPlayerSuggestions() {
  const box = el("historicalPlayerSuggestions");
  if (!box) return;
  const query = currentHistoricalPlayerToken().toLowerCase();
  if (!query || query.length < 2 || !state.historicalModel?.playerRows?.length) {
    box.innerHTML = "";
    return;
  }
  const matches = historicalPlayerOptions()
    .filter((player) => player.Player.toLowerCase().includes(query))
    .slice(0, 8);
  box.innerHTML = matches.map((player) => `
    <button type="button" data-player-suggestion="${escapeHtml(player.Player)}">
      <span>${escapeHtml(player.Player)}</span>
      <em>${player.Pos}</em>
    </button>
  `).join("");
}

function applyHistoricalPlayerSuggestion(name) {
  const input = el("historicalPlayers");
  if (!input) return;
  const parts = input.value.split(",");
  parts[parts.length - 1] = ` ${name}`;
  input.value = parts.map((part, index) => index === 0 ? part.trim() : part.trim()).filter(Boolean).join(", ");
  renderHistoricalPlayerSuggestions();
  scheduleRender(0);
}

function historicalExplorerTitle(mode, metric) {
  const context = chartContextCopy();
  const start = number(el("historicalPlotStart")?.value, 2015);
  const end = number(el("historicalPlotEnd")?.value, settings().year - 1);
  if (mode === "weeklyBins") {
    const binSize = historicalBinSize();
    const maxFpts = historicalBinMax();
    const yMetric = historicalWarMetric(metric);
    return {
      title: `${start}-${end} Weekly Fantasy Points vs Single-Week ${yMetric} by Position`,
      subtitle: `${historicalPositionText()} individual player-weeks grouped into ${binSize}-point bins through ${maxFpts} FPTS - ${context.roster} - ${context.scoring}`,
      yMetric
    };
  }
  if (mode === "adpThresholds") {
    const threshold = weekWinningThreshold();
    const plotTypeValue = el("historicalAdpPlotType")?.value || "heatmap";
    const plotType = plotTypeValue === "box" ? "Distribution" : plotTypeValue === "hitRate" ? "Hit-rate heatmap" : "Heatmap";
    const yMetric = historicalWarMetric(metric);
    return {
      title: `${start}-${end} Draft Cost of Week-Winning ${yMetric} Seasons by Position`,
      subtitle: `${plotType} of historical ${historicalAdpScoringLabel()} ADP for top-${HISTORICAL_ADP_PLAYER_CAP} draft costs with at least one weekly ${yMetric} above each threshold - ${threshold.toFixed(2)} highlighted`
    };
  }
  if (mode === "boomBustHeatmap") {
    const threshold = weekWinningThreshold();
    const yMetric = historicalWarMetric(metric);
    return {
      title: `${start}-${end} ${historicalAdpScoringLabel()} ADP by Boom/Bust Weekly ${yMetric} Profile`,
      subtitle: `${historicalPositionText()} player-seasons drafted in the top-${HISTORICAL_ADP_PLAYER_CAP} - boom weeks above ${threshold.toFixed(2)} ${yMetric}, bust weeks below 0.00 ${yMetric} - ${context.roster} - ${context.scoring}`
    };
  }
  if (mode === "adpRoundHitRates") {
    const yMetric = historicalAdpMetric(metric);
    const maxRounds = historicalRoundLimit();
    const thresholdText = yMetric.includes("WAR")
      ? ` - min ${historicalWarThresholdMin().toFixed(1)}, ${historicalWarThresholdStepLow().toFixed(1)} below 2 / ${historicalWarThresholdStepHigh().toFixed(1)} above 2`
      : "";
    return {
      title: `${start}-${end} ${historicalAdpScoringLabel()} Round Hit Rates by Season ${yMetric} Threshold`,
      subtitle: `% of each position drafted in each round that reached each season ${yMetric} mark - rounds 1-${maxRounds}${thresholdText} - ${context.roster} - ${context.scoring}`
    };
  }
  if (mode === "adpOutcome") {
    return {
      title: `${start}-${end} Historical ${historicalAdpScoringLabel()} ADP vs Season ${metric}`,
      subtitle: `Top-${HISTORICAL_ADP_PLAYER_CAP} player-season outcomes by draft cost - ${historicalPositionText()} - ${context.roster} - ${context.scoring} - lower ADP means earlier draft capital`
    };
  }
  if (mode === "adpTrends") {
    return {
      title: `${start}-${end} Year-over-Year ${metric} Trends by ADP Bucket and Position`,
      subtitle: `Historical ${historicalAdpScoringLabel()} ADP buckets reveal which positions returned the most ${metric} - ${adpBucketWidth()}-pick buckets from the top-${HISTORICAL_ADP_PLAYER_CAP} draft costs - ${context.roster} - ${context.scoring}`
    };
  }
  if (mode === "player") {
    const aligned = el("historicalTimeline")?.value === "aligned";
    const timeline = aligned ? "Aligned Career-Year" : "Calendar-Year";
    const tokens = historicalPlayerTokens();
    const playerText = tokens.length
      ? tokens.slice(0, 4).map((token) => token.start ? `${token.name} (${token.start}+)` : token.name).join(", ") + (tokens.length > 4 ? ` +${tokens.length - 4} more` : "")
      : "Top Latest-Season Players";
    return {
      title: `${timeline} Historical ${metric}: ${playerText}`,
      subtitle: `${start}-${end} seasons - ${context.roster} - ${context.scoring} - ${context.weeks} weeks - ${context.teamSource}`
    };
  }
  const rank = number(el("historicalRank")?.value, 1);
  return {
    title: `${start}-${end} Historical ${metric} for ${historicalPositionText()} Positional Rank ${rank}`,
    subtitle: `${context.roster} - ${context.scoring} - ${context.weeks} weeks - ${context.teamSource} from ${context.historyStart}+ seasons`
  };
}

function renderHistoricalExplorer() {
  const chart = el("historicalExplorerChart");
  if (!chart) return;
  updateHistoricalControlVisibility();
  renderHistoricalRankCurve();
  const mode = el("historicalMode")?.value || "rank";
  const metric = el("historicalMetric")?.value || "WAR";
  const start = number(el("historicalPlotStart")?.value, 2015);
  const end = number(el("historicalPlotEnd")?.value, settings().year - 1);
  const copy = historicalExplorerTitle(mode, metric);
  if (el("historicalChartTitle")) el("historicalChartTitle").textContent = copy.title;
  if (el("historicalChartSubtitle")) el("historicalChartSubtitle").textContent = copy.subtitle;
  renderHistoricalPlayerSuggestions();

  const rows = (state.historicalModel?.playerRows || []).filter((row) => row.Year >= start && row.Year <= end);
  if (!rows.length) {
    Plotly.react(chart, [], historicalLayout(copy.title, "Year", metric, "Historical data is still loading"), { responsive: true });
    return;
  }

  if (mode === "weeklyBins") {
    const traces = historicalWeeklyBinTraces(rows, metric);
    Plotly.react(chart, traces, historicalWeeklyBinLayout(copy), { responsive: true });
    return;
  }

  if (mode === "adpThresholds") {
    const plot = historicalAdpThresholdPlot(rows, copy, metric);
    Plotly.react(chart, plot.traces, plot.layout, { responsive: true });
    return;
  }

  if (mode === "boomBustHeatmap") {
    const plot = historicalBoomBustAdpHeatmap(rows, copy, metric);
    Plotly.react(chart, plot.traces, plot.layout, { responsive: true });
    return;
  }

  if (mode === "adpRoundHitRates") {
    const plot = historicalAdpRoundHitRatePlot(rows, copy, metric);
    Plotly.react(chart, plot.traces, plot.layout, { responsive: true });
    return;
  }

  if (mode === "adpOutcome") {
    const plot = historicalAdpOutcomePlot(rows, copy, metric);
    Plotly.react(chart, plot.traces, plot.layout, { responsive: true });
    return;
  }

  if (mode === "adpTrends") {
    const plot = historicalAdpTrendPlot(rows, copy, metric);
    Plotly.react(chart, plot.traces, plot.layout, { responsive: true });
    return;
  }

  const traces = mode === "player"
    ? historicalPlayerTraces(rows, metric)
    : historicalRankTraces(rows, metric);
  const xTitle = mode === "player" && el("historicalTimeline")?.value === "aligned" ? "Player season index" : "Season";
  Plotly.react(chart, traces, historicalLayout(copy.title, xTitle, metric), { responsive: true });
}

function historicalRankTraces(rows, metric) {
  const rank = number(el("historicalRank")?.value, 1);
  return selectedHistoricalPositions().map((pos) => {
    const points = rows
      .filter((row) => row.Pos === pos && row.Rank === rank)
      .sort((a, b) => a.Year - b.Year);
    return {
      type: "scatter",
      mode: "lines+markers",
      name: `${pos}${rank}`,
      x: points.map((row) => row.Year),
      y: points.map((row) => number(row[metric])),
      text: points.map((row) => `${row.Year} ${row.Player}`),
      line: { color: posColors[pos], width: 2, dash: posDashes[pos] },
      marker: { color: posColors[pos], symbol: posSymbols[pos], size: 8 },
      hovertemplate: "<b>%{text}</b><br>%{y:.2f}<extra></extra>"
    };
  });
}

function historicalPlayerTraces(rows, metric) {
  const tokens = historicalPlayerTokens();
  const selectedRows = tokens.length
    ? tokens.map((token) => ({ token, rows: rows.filter((row) => row.PlayerKey === token.key && (!token.start || row.Year >= token.start)) }))
    : defaultHistoricalPlayers(rows);
  const aligned = el("historicalTimeline")?.value === "aligned";
  return selectedRows
    .filter((entry) => entry.rows.length)
    .map((entry, index) => {
      const points = entry.rows.sort((a, b) => a.Year - b.Year);
      const pos = points[0]?.Pos || ["QB", "RB", "WR", "TE"][index % 4];
      const color = playerTraceColors[index % playerTraceColors.length];
      return {
        type: "scatter",
        mode: "lines+markers",
        name: points[0]?.Player || entry.token?.name || `Player ${index + 1}`,
        x: points.map((row, pointIndex) => aligned ? pointIndex + 1 : row.Year),
        y: points.map((row) => number(row[metric])),
        text: points.map((row) => `${row.Year} ${row.Player} (${row.Pos})`),
        line: { color, width: 2 },
        marker: { color, symbol: posSymbols[pos] || "circle", size: 8 },
        hovertemplate: "<b>%{text}</b><br>%{y:.2f}<extra></extra>"
      };
    });
}

function defaultHistoricalPlayers(rows) {
  const latest = Math.max(...rows.map((row) => row.Year));
  return rows
    .filter((row) => row.Year === latest)
    .sort((a, b) => b.WAR - a.WAR)
    .slice(0, 6)
    .map((row) => ({ token: { name: row.Player, key: row.PlayerKey }, rows: rows.filter((candidate) => candidate.PlayerKey === row.PlayerKey && candidate.Pos === row.Pos) }));
}

function historicalBinSize() {
  return Math.max(1, Math.min(20, number(el("historicalBinSize")?.value, 5)));
}

function historicalBinMax() {
  const binSize = historicalBinSize();
  return Math.max(binSize, Math.min(100, number(el("historicalBinMax")?.value, 55)));
}

function historicalWarMetric(metric) {
  return ["WAR", "Flex WAR", "SuperFlex WAR"].includes(metric) ? metric : "WAR";
}

function historicalAdpMetric(metric) {
  return ["WAR", "FPTS", "AVG", "Flex WAR", "SuperFlex WAR"].includes(metric) ? metric : "WAR";
}

function adpBucketWidth() {
  return Math.max(2, settings().teams * 2);
}

function adpBucketRanges() {
  const width = adpBucketWidth();
  const ranges = [];
  for (let start = 1; start <= HISTORICAL_ADP_PLAYER_CAP; start += width) {
    const end = Math.min(HISTORICAL_ADP_PLAYER_CAP, start + width - 1);
    const roundStart = Math.floor((start - 1) / settings().teams) + 1;
    const roundEnd = Math.ceil(end / settings().teams);
    ranges.push({
      start,
      end,
      label: roundStart === roundEnd
        ? `Rd ${roundStart} (${start}-${end})`
        : `Rds ${roundStart}-${roundEnd} (${start}-${end})`
    });
  }
  return ranges;
}

function adpBucket(adp) {
  const value = number(adp, null);
  if (value === null) return null;
  const range = adpBucketRanges().find((bucket) => value >= bucket.start && value <= bucket.end);
  return range?.label || null;
}

function historicalAdpBucketOrder() {
  return adpBucketRanges().map((bucket) => bucket.label);
}

function adpRoundRanges() {
  const teams = Math.max(1, settings().teams);
  const ranges = [];
  const maxRounds = historicalRoundLimit();
  const maxPick = Math.min(HISTORICAL_ADP_PLAYER_CAP, maxRounds * teams);
  for (let start = 1; start <= maxPick; start += teams) {
    const end = Math.min(HISTORICAL_ADP_PLAYER_CAP, start + teams - 1);
    const round = Math.floor((start - 1) / teams) + 1;
    ranges.push({ round, start, end, label: `Rd ${round}` });
  }
  return ranges;
}

function historicalRoundLimit() {
  return Math.max(1, Math.min(20, number(el("historicalRoundLimit")?.value, 12)));
}

function historicalRoundHitSize() {
  const value = el("historicalRoundHitSize")?.value || "normal";
  if (value === "xl") return 1.45;
  if (value === "large") return 1.2;
  return 1;
}

function historicalWarThresholdMin() {
  return Math.max(0, Math.min(10, number(el("historicalWarThresholdMin")?.value, 0.2)));
}

function historicalWarThresholdStepLow() {
  return Math.max(0.1, Math.min(2, number(el("historicalWarThresholdStepLow")?.value, 0.2)));
}

function historicalWarThresholdStepHigh() {
  return Math.max(0.1, Math.min(5, number(el("historicalWarThresholdStepHigh")?.value, 0.5)));
}

function adpRoundBucket(adp) {
  const value = number(adp, null);
  if (value === null) return null;
  const range = adpRoundRanges().find((bucket) => value >= bucket.start && value <= bucket.end);
  return range?.label || null;
}

function seasonThresholdsForMetric(points, metric) {
  const values = points.map((row) => number(row[metric], null)).filter((value) => value !== null && value > 0);
  if (!values.length) return metric === "AVG" ? [5, 10, 15, 20] : metric === "FPTS" ? [50, 100, 150, 200] : [0.2, 0.4, 0.6, 0.8, 1.0];
  const maxValue = Math.max(...values);
  if (metric === "FPTS") {
    const thresholds = [];
    for (let value = 25; value <= Math.min(200, maxValue) + 0.001; value += 25) thresholds.push(value);
    for (let value = 250; value <= maxValue + 0.001; value += 50) thresholds.push(value);
    return thresholds.length ? thresholds : [Math.floor(maxValue)];
  }
  if (metric === "AVG") {
    const thresholds = [];
    for (let value = 2; value <= Math.min(20, maxValue) + 0.001; value += 2) thresholds.push(value);
    for (let value = 25; value <= maxValue + 0.001; value += 5) thresholds.push(value);
    return thresholds.length ? thresholds : [Number(maxValue.toFixed(1))];
  }
  const thresholds = [];
  const minValue = Math.min(historicalWarThresholdMin(), maxValue);
  const lowStep = historicalWarThresholdStepLow();
  const highStep = historicalWarThresholdStepHigh();
  for (let value = minValue; value <= Math.min(2, maxValue) + 0.001; value += lowStep) thresholds.push(Number(value.toFixed(2)));
  const highStart = minValue > 2 ? minValue : 2 + highStep;
  for (let value = highStart; value <= maxValue + 0.001; value += highStep) thresholds.push(Number(value.toFixed(2)));
  return thresholds.length ? [...new Set(thresholds)] : [Number(maxValue.toFixed(2))];
}

function historicalRowsWithAdp(rows) {
  const positionSet = new Set(selectedHistoricalPositions());
  const adpMap = historicalAdpMap();
  return rows
    .filter((row) => positionSet.has(row.Pos))
    .map((row) => {
      const playerAdp = adpMap.get(`${row.Year}|${playerAdpKey(row.Player)}|${row.Pos}`) || adpMap.get(`${row.Year}|${playerAdpKey(row.Player)}`);
      const adp = playerAdp?.adp ?? null;
      if (adp === null || adp > HISTORICAL_ADP_PLAYER_CAP) return null;
      return adp === null ? null : { ...row, ADP: adp, "ADP Rank": playerAdp.rank, "Pos ADP Rank": playerAdp.posRank, ADPBucket: adpBucket(adp), ADPRound: adpRoundBucket(adp) };
    })
    .filter(Boolean);
}

function historicalWeeklyPlayerWeeks(rows, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const positionSet = new Set(selectedHistoricalPositions());
  const maxFpts = historicalBinMax();
  const playerWeeks = [];
  for (const row of rows) {
    if (!positionSet.has(row.Pos)) continue;
    for (const week of row.Weeks || []) {
      const fpts = number(week.FPTS, null);
      const war = number(week[yMetric], null);
      if (fpts === null || war === null || fpts < 0 || fpts >= maxFpts) continue;
      playerWeeks.push({
        Player: row.Player,
        Pos: row.Pos,
        Year: row.Year,
        Week: week.Week,
        FPTS: fpts,
        Metric: war
      });
    }
  }
  return playerWeeks;
}

function historicalWeeklyBinTraces(rows, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const binSize = historicalBinSize();
  const maxFpts = historicalBinMax();
  const positions = selectedHistoricalPositions();
  const playerWeeks = historicalWeeklyPlayerWeeks(rows, yMetric);
  const bins = Array.from({ length: Math.ceil(maxFpts / binSize) }, (_, index) => {
    const start = index * binSize;
    const end = Math.min(maxFpts, start + binSize);
    return { start, end, label: `${start}-${end}` };
  });

  return positions.map((pos) => {
    const posWeeks = playerWeeks.filter((week) => week.Pos === pos);
    const points = bins.map((bin) => {
        const binWeeks = posWeeks.filter((week) => week.FPTS >= bin.start && week.FPTS < bin.end);
        return {
          label: bin.label,
          avgWar: binWeeks.length ? average(binWeeks.map((week) => week.Metric)) : null,
          count: binWeeks.length,
          avgFpts: binWeeks.length ? average(binWeeks.map((week) => week.FPTS)) : null
        };
    });
    return {
      type: "scatter",
      mode: "lines+markers",
      name: pos,
      x: points.map((point) => point.label),
      y: points.map((point) => point.avgWar),
      customdata: points.map((point) => [point.count, point.avgFpts]),
      line: { color: posColors[pos], width: 3.5, shape: "spline", smoothing: 0.65 },
      marker: {
        color: posColors[pos],
        symbol: posSymbols[pos],
        size: 9,
        line: { color: "#111111", width: 1.5 }
      },
      connectgaps: false,
      hovertemplate: `<b>${pos} %{x} FPTS</b><br>Avg weekly ${yMetric}: %{y:.3f}<br>Player-weeks: %{customdata[0]:,}<br>Avg FPTS: %{customdata[1]:.1f}<extra></extra>`
    };
  });
}

function historicalAdpScoringKey() {
  const explicit = el("historicalAdpScoring")?.value;
  if (explicit && explicit !== "auto") return explicit;
  const rec = settings().scoring.rec;
  if (rec >= 0.75) return "ppr";
  if (rec >= 0.25) return "half";
  return "standard";
}

function historicalAdpScoringLabel() {
  return ({ ppr: "PPR", half: "Half-PPR", standard: "Standard" }[historicalAdpScoringKey()] || "ADP");
}

function weekWinningThreshold() {
  return Math.max(0, Math.min(2, number(el("weekWinningWar")?.value, 0.5)));
}

function historicalAdpMap() {
  const scoring = historicalAdpScoringKey();
  const map = new Map();
  for (const row of state.historicalAdpRows || []) {
    const year = number(row.Year ?? row.year, null);
    const adp = number(row.ADP ?? row.adp, null);
    const player = row.Player ?? row.player;
    const rowScoring = String(row.Scoring ?? row.scoring ?? scoring).toLowerCase();
    if (year === null || adp === null || !player || rowScoring !== scoring) continue;
    const pos = String(row.Pos ?? row.POS ?? "").toUpperCase().replace(/[0-9]/g, "");
    const key = `${year}|${playerAdpKey(player)}${pos ? `|${pos}` : ""}`;
    map.set(key, { adp, rank: number(row["ADP Rank"] ?? row.adp_rank, null), posRank: row.POS ?? row["Pos ADP Rank"] ?? "" });
    map.set(`${year}|${playerAdpKey(player)}`, { adp, rank: number(row["ADP Rank"] ?? row.adp_rank, null), posRank: row.POS ?? row["Pos ADP Rank"] ?? "" });
  }
  return map;
}

function historicalAdpThresholdRows(rows, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const positionSet = new Set(selectedHistoricalPositions());
  const adpMap = historicalAdpMap();
  const thresholds = [0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
  const output = [];
  const seen = new Set();
  for (const row of rows) {
    if (!positionSet.has(row.Pos)) continue;
    const playerAdp = adpMap.get(`${row.Year}|${playerAdpKey(row.Player)}|${row.Pos}`) || adpMap.get(`${row.Year}|${playerAdpKey(row.Player)}`);
    if (!playerAdp || playerAdp.adp === null || playerAdp.adp > HISTORICAL_ADP_PLAYER_CAP) continue;
    const maxWar = Math.max(...(row.Weeks || []).map((week) => number(week[yMetric], -Infinity)));
    if (!Number.isFinite(maxWar)) continue;
    for (const threshold of thresholds) {
      if (maxWar <= threshold) continue;
      const key = `${row.Year}|${row.PlayerKey}|${row.Pos}|${threshold}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        Player: row.Player,
        Pos: row.Pos,
        Year: row.Year,
        ADP: playerAdp.adp,
        Threshold: threshold,
        MaxWar: maxWar
      });
    }
  }
  return output;
}

function historicalAdpThresholdPlot(rows, copy, metric = "WAR") {
  const plotType = el("historicalAdpPlotType")?.value || "heatmap";
  const points = historicalAdpThresholdRows(rows, metric);
  const threshold = weekWinningThreshold();
  if (!points.length) {
    return {
      traces: [],
      layout: historicalLayout(copy.title, `${historicalWarMetric(metric)} threshold`, "ADP", "No historical ADP rows matched the selected years, scoring, and positions")
    };
  }
  return plotType === "box"
    ? historicalAdpBoxPlot(points, copy, threshold, metric)
    : plotType === "hitRate"
      ? historicalAdpHitRatePlot(rows, copy, threshold, metric)
    : historicalAdpHeatmap(points, copy, threshold, metric);
}

function historicalAdpBoxPlot(points, copy, threshold, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const positions = uniqueSorted(points.map((point) => point.Pos)).filter((pos) => ["QB", "RB", "WR", "TE"].includes(pos));
  const thresholds = [0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
  const traces = positions.map((pos) => {
    const posPoints = points.filter((point) => point.Pos === pos);
    return {
      type: "box",
      name: pos,
      x: posPoints.map((point) => point.Threshold),
      y: posPoints.map((point) => point.ADP),
      text: posPoints.map((point) => `${point.Player} (${point.Year})<br>Max weekly ${yMetric} ${point.MaxWar.toFixed(3)}`),
      marker: { color: posColors[pos] },
      line: { color: posColors[pos], width: 2 },
      boxmean: true,
      boxpoints: false,
      hovertemplate: "<b>%{text}</b><br>Threshold: %{x}<br>ADP: %{y:.1f}<extra></extra>"
    };
  });
  const highlighted = thresholds.reduce((best, value) => Math.abs(value - threshold) < Math.abs(best - threshold) ? value : best, thresholds[0]);
  return {
    traces,
    layout: {
      ...historicalAdpBaseLayout(copy),
      xaxis: {
        title: { text: `${yMetric} threshold (at least one week above)`, standoff: 18 },
        range: [0.8, 0.05],
        tickmode: "array",
        tickvals: thresholds,
        ticktext: thresholds.map((value) => value.toFixed(1)),
        gridcolor: "rgba(240,240,240,0.08)",
        color: "#f0f0f0"
      },
      yaxis: {
        title: { text: "Historical ADP", standoff: 18 },
        range: [HISTORICAL_ADP_PLAYER_CAP, 0],
        gridcolor: "rgba(240,240,240,0.10)",
        color: "#f0f0f0"
      },
      shapes: [{
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: highlighted + 0.035,
        x1: highlighted - 0.035,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(204,51,51,0.12)",
        line: { width: 0 },
        layer: "below"
      }],
      boxmode: "group"
    }
  };
}

function historicalAdpHeatmap(points, copy, threshold, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const positions = ["QB", "RB", "WR", "TE"].filter((pos) => points.some((point) => point.Pos === pos));
  const thresholds = [0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
  const stats = thresholds.map((warCut) => positions.map((pos) => {
    const group = points.filter((point) => point.Pos === pos && point.Threshold === warCut);
    const adps = group.map((point) => point.ADP).filter((value) => value !== null);
    if (!adps.length) return null;
    return {
      avg: average(adps),
      min: Math.min(...adps),
      max: Math.max(...adps),
      count: adps.length,
      players: new Set(group.map((point) => `${point.Year}-${point.Player}`)).size
    };
  }));
  const z = stats.map((row) => row.map((cell) => cell?.avg ?? null));
  const text = stats.map((row) => row.map((cell) => cell ? `Avg ${cell.avg.toFixed(1)}<br>Min ${cell.min.toFixed(0)} Max ${cell.max.toFixed(0)}<br>${cell.players} players` : "N/A"));
  const highlightIndex = thresholds.reduce((best, value, index) => Math.abs(value - threshold) < Math.abs(thresholds[best] - threshold) ? index : best, 0);
  return {
    traces: [{
      type: "heatmap",
      x: positions,
      y: thresholds.map((value) => value.toFixed(1)),
      z,
      text,
      texttemplate: "%{text}",
      hovertemplate: `<b>%{x}</b><br>${yMetric} threshold %{y}<br>%{text}<extra></extra>`,
      colorscale: [
        [0, "#f2f2f2"],
        [0.35, "#c9dcae"],
        [0.7, "#8fba7a"],
        [1, "#c46f6f"]
      ],
      reversescale: true,
      colorbar: { title: "Avg ADP", tickfont: { color: "#f0f0f0" }, titlefont: { color: "#f0f0f0" } },
      xgap: 4,
      ygap: 4
    }],
    layout: {
      ...historicalAdpBaseLayout(copy),
      xaxis: { title: "Position", color: "#f0f0f0", side: "top" },
      yaxis: { title: `${yMetric} threshold`, color: "#f0f0f0" },
      shapes: [{
        type: "line",
        xref: "paper",
        yref: "y",
        x0: 0,
        x1: 1,
        y0: thresholds[highlightIndex].toFixed(1),
        y1: thresholds[highlightIndex].toFixed(1),
        line: { color: "rgba(204,51,51,0.95)", width: 2 },
        layer: "above"
      }]
    }
  };
}

function historicalAdpBaseLayout(copy) {
  return {
    title: {
      text: `<b>${copy.title}</b><br><span style="font-size:12px;color:#b8b8b8"><i>${copy.subtitle}</i></span>`,
      font: { family: "Kanit FPTS, Impact, sans-serif", size: 21, color: "#f7f7f7" },
      x: 0.02,
      xanchor: "left",
      y: 0.94
    },
    margin: { l: 84, r: 64, t: 132, b: 128 },
    legend: { orientation: "h", y: -0.16, x: 0, font: { size: 12 } },
    annotations: [{
      text: "Source: Historical weekly scoring, WAR Lab historical model, and historical ADP. ADP is draft cost, so lower means earlier.",
      xref: "paper",
      yref: "paper",
      x: 0,
      y: -0.24,
      xanchor: "left",
      showarrow: false,
      font: { color: "rgba(240,240,240,0.62)", size: 11 }
    }],
    font: { family: "Mulish, sans-serif", color: "#f0f0f0" },
    plot_bgcolor: "#111111",
    paper_bgcolor: "#111111",
    hoverlabel: { bgcolor: "#111111", bordercolor: "#cc3333", font: { color: "#f0f0f0" } }
  };
}

function historicalAdpHitRatePlot(rows, copy, threshold, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const points = historicalRowsWithAdp(rows);
  if (!points.length) {
    return {
      traces: [],
      layout: historicalLayout(copy.title, "ADP bucket", "Position", "No historical ADP rows matched the selected years, scoring, and positions")
    };
  }
  const positions = ["QB", "RB", "WR", "TE"].filter((pos) => points.some((row) => row.Pos === pos));
  const buckets = historicalAdpBucketOrder().filter((bucket) => points.some((row) => row.ADPBucket === bucket));
  const stats = positions.map((pos) => buckets.map((bucket) => {
    const group = points.filter((row) => row.Pos === pos && row.ADPBucket === bucket);
    if (!group.length) return null;
    const hits = group.filter((row) => Math.max(...(row.Weeks || []).map((week) => number(week[yMetric], -Infinity))) > threshold).length;
    return { hits, total: group.length, rate: hits / group.length };
  }));
  const z = stats.map((row) => row.map((cell) => cell ? cell.rate * 100 : null));
  const text = stats.map((row) => row.map((cell) => cell ? `${(cell.rate * 100).toFixed(0)}%<br>${cell.hits}/${cell.total}` : "N/A"));
  return {
    traces: [{
      type: "heatmap",
      x: buckets,
      y: positions,
      z,
      text,
      texttemplate: "%{text}",
      hovertemplate: `<b>%{y} %{x}</b><br>Hit rate: %{z:.1f}%<br>Weekly ${yMetric} > ${threshold.toFixed(2)}<extra></extra>`,
      colorscale: [
        [0, "#1a1a1a"],
        [0.3, "#7aa6c2"],
        [0.65, "#8fba7a"],
        [1, "#c46f6f"]
      ],
      colorbar: { title: "Hit %", tickfont: { color: "#f0f0f0" }, titlefont: { color: "#f0f0f0" } },
      xgap: 4,
      ygap: 4
    }],
    layout: {
      ...historicalAdpBaseLayout(copy),
      xaxis: { title: "Historical ADP bucket", color: "#f0f0f0", side: "top" },
      yaxis: { title: "Position", color: "#f0f0f0" }
    }
  };
}

function historicalAdpRoundHitRatePlot(rows, copy, metric = "WAR") {
  const yMetric = historicalAdpMetric(metric);
  const points = historicalRowsWithAdp(rows)
    .map((row) => ({ ...row, MetricValue: number(row[yMetric], null) }))
    .filter((row) => row.ADPRound && row.MetricValue !== null);
  if (!points.length) {
    return {
      traces: [],
      layout: historicalLayout(copy.title, "Draft round", `${yMetric} threshold`, "No historical ADP rows matched the selected years, scoring, positions, and metric")
    };
  }

  const roundOrder = adpRoundRanges().map((round) => round.label).filter((label) => points.some((row) => row.ADPRound === label));
  const positions = selectedHistoricalPositions().filter((pos) => points.some((row) => row.Pos === pos));
  const thresholds = seasonThresholdsForMetric(points, yMetric).sort((a, b) => b - a);
  const panelDomains = historicalTrendPanelDomains(positions.length);
  const formatThreshold = (value) => yMetric === "FPTS" ? value.toFixed(0) : value.toFixed(1);
  const sizeMultiplier = historicalRoundHitSize();

  const traces = positions.map((pos, index) => {
    const stats = thresholds.map((thresholdValue) => roundOrder.map((roundLabel) => {
      const group = points.filter((row) => row.Pos === pos && row.ADPRound === roundLabel);
      if (!group.length) return null;
      const hits = group.filter((row) => row.MetricValue >= thresholdValue).length;
      return {
        hits,
        total: group.length,
        rate: hits / group.length,
        avg: average(group.map((row) => row.MetricValue))
      };
    }));
    const z = stats.map((row) => row.map((cell) => cell ? cell.rate * 100 : null));
    const text = stats.map((row) => row.map((cell) => cell ? `${(cell.rate * 100).toFixed(0)}%<br>${cell.hits}/${cell.total}` : ""));
    const customdata = stats.map((row) => row.map((cell) => cell ? [cell.avg, cell.hits, cell.total] : [null, 0, 0]));
    return {
      type: "heatmap",
      name: pos,
      x: roundOrder,
      y: thresholds.map(formatThreshold),
      z,
      text,
      customdata,
      texttemplate: "%{text}",
      hovertemplate: `<b>${pos} %{x}</b><br>${yMetric} threshold: %{y}<br>Hit rate: %{z:.1f}%<br>Hits: %{customdata[1]} / %{customdata[2]}<br>Avg season ${yMetric}: %{customdata[0]:.2f}<extra></extra>`,
      colorscale: [
        [0, "#1a1a1a"],
        [0.25, "#5c3140"],
        [0.5, "#c46f6f"],
        [0.75, "#d0a85b"],
        [1, "#f2f2f2"]
      ],
      zmin: 0,
      zmax: 100,
      xgap: 4,
      ygap: 4,
      zsmooth: false,
      connectgaps: false,
      colorbar: index === positions.length - 1
        ? { title: "Hit %", tickfont: { color: "#f0f0f0" }, titlefont: { color: "#f0f0f0" } }
        : undefined,
      showscale: index === positions.length - 1,
      xaxis: `x${index ? index + 1 : ""}`,
      yaxis: `y${index ? index + 1 : ""}`
    };
  });

  const base = historicalAdpBaseLayout(copy);
  const layout = {
    ...base,
    height: Math.round((positions.length <= 2 ? 780 : 1100) * sizeMultiplier),
    margin: { l: 108, r: 96, t: 146, b: 150 },
    hovermode: "closest",
    annotations: [
      ...(base.annotations || []),
      ...positions.map((pos, index) => ({
        text: `<b>${pos}</b>`,
        xref: "paper",
        yref: "paper",
        x: (panelDomains[index].x[0] + panelDomains[index].x[1]) / 2,
        y: panelDomains[index].y[1] + 0.055,
        showarrow: false,
        font: { color: posColors[pos], size: 16, family: "Kanit FPTS, Impact, sans-serif" }
      }))
    ]
  };
  positions.forEach((pos, index) => {
    const suffix = index ? index + 1 : "";
    const xRef = `x${suffix}`;
    const yRef = `y${suffix}`;
    layout[`xaxis${suffix}`] = {
      title: { text: "Draft round", standoff: 12 },
      tickangle: roundOrder.length > 12 ? -45 : 0,
      domain: panelDomains[index].x,
      anchor: yRef,
      gridcolor: "rgba(240,240,240,0.08)",
      color: "#f0f0f0",
      automargin: true,
      fixedrange: true
    };
    layout[`yaxis${suffix}`] = {
      title: { text: `${yMetric} threshold`, standoff: 12 },
      domain: panelDomains[index].y,
      anchor: xRef,
      categoryorder: "array",
      categoryarray: thresholds.map(formatThreshold),
      gridcolor: "rgba(240,240,240,0.08)",
      color: "#f0f0f0",
      automargin: true,
      fixedrange: true
    };
  });

  return { traces, layout };
}

function historicalBoomBustRows(rows, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const threshold = weekWinningThreshold();
  return historicalRowsWithAdp(rows)
    .map((row) => {
      const weekValues = (row.Weeks || [])
        .map((week) => number(week[yMetric], null))
        .filter((value) => value !== null);
      if (!weekValues.length) return null;
      const weeksAbove = weekValues.filter((value) => value > threshold).length;
      if (!weeksAbove) return null;
      return {
        Player: row.Player,
        Pos: row.Pos,
        Year: row.Year,
        ADP: row.ADP,
        WeeksAbove: weeksAbove,
        WeeksBelow: weekValues.filter((value) => value < 0).length,
        MaxWar: Math.max(...weekValues)
      };
    })
    .filter(Boolean);
}

function historicalBoomBustAdpHeatmap(rows, copy, metric = "WAR") {
  const yMetric = historicalWarMetric(metric);
  const threshold = weekWinningThreshold();
  const points = historicalBoomBustRows(rows, yMetric);
  if (!points.length) {
    return {
      traces: [],
      layout: historicalLayout(copy.title, "Weeks below 0 WAR", `Weeks above ${threshold.toFixed(2)} ${yMetric}`, "No historical ADP rows matched the selected years, scoring, positions, and threshold")
    };
  }
  const positions = selectedHistoricalPositions().filter((pos) => points.some((point) => point.Pos === pos));
  const columns = positions.length === 1 ? 1 : 2;
  const rowsCount = positions.length <= 2 ? 1 : 2;
  const gapX = columns === 1 ? 0 : 0.2;
  const gapY = rowsCount === 1 ? 0 : 0.34;
  const domainWidth = (1 - (gapX * (columns - 1))) / columns;
  const domainHeight = (1 - (gapY * (rowsCount - 1))) / rowsCount;
  const traces = [];
  const layoutAxes = {};
  const annotations = [];

  positions.forEach((pos, index) => {
    const posPoints = points.filter((point) => point.Pos === pos);
    const observedX = uniqueSorted(posPoints.map((point) => point.WeeksBelow), true);
    const observedY = uniqueSorted(posPoints.map((point) => point.WeeksAbove), true);
    const xMin = Math.min(...observedX);
    const xMax = Math.max(...observedX);
    const yMin = Math.min(...observedY);
    const yMax = Math.max(...observedY);
    const xValues = Array.from({ length: xMax - xMin + 1 }, (_, i) => xMin + i);
    const yValues = Array.from({ length: yMax - yMin + 1 }, (_, i) => yMax - i);
    const stats = yValues.map((weeksAbove) => xValues.map((weeksBelow) => {
      const group = posPoints.filter((point) => point.WeeksAbove === weeksAbove && point.WeeksBelow === weeksBelow);
      if (!group.length) return null;
      return {
        avg: average(group.map((point) => point.ADP)),
        count: group.length,
        min: Math.min(...group.map((point) => point.ADP)),
        max: Math.max(...group.map((point) => point.ADP))
      };
    }));
    const z = stats.map((row) => row.map((cell) => cell?.avg ?? null));
    const text = stats.map((row) => row.map((cell) => cell ? `${cell.avg.toFixed(1)}<br>N=${cell.count}` : ""));
    const customdata = stats.map((row) => row.map((cell) => cell ? [cell.min, cell.max, cell.count] : [null, null, 0]));
    const axisSuffix = index === 0 ? "" : `${index + 1}`;
    const xRef = `x${axisSuffix}`;
    const yRef = `y${axisSuffix}`;
    const xAxisKey = `xaxis${axisSuffix}`;
    const yAxisKey = `yaxis${axisSuffix}`;
    const col = index % columns;
    const rowIndex = Math.floor(index / columns);
    const x0 = col * (domainWidth + gapX);
    const x1 = x0 + domainWidth;
    const y1 = 1 - (rowIndex * (domainHeight + gapY));
    const y0 = y1 - domainHeight;

    traces.push({
      type: "heatmap",
      name: pos,
      x: xValues,
      y: yValues,
      z,
      text,
      customdata,
      texttemplate: "%{text}",
      hovertemplate: `<b>${pos}</b><br>Weeks above ${threshold.toFixed(2)} ${yMetric}: %{y}<br>Weeks below 0.00 ${yMetric}: %{x}<br>Avg ADP: %{z:.1f}<br>Min/Max ADP: %{customdata[0]:.0f} / %{customdata[1]:.0f}<br>Player-seasons: %{customdata[2]}<extra></extra>`,
      coloraxis: "coloraxis",
      xaxis: xRef,
      yaxis: yRef,
      xgap: 3,
      ygap: 3,
      zsmooth: false,
      connectgaps: false
    });

    layoutAxes[xAxisKey] = {
      domain: [x0, x1],
      anchor: yRef,
      type: "linear",
      range: [Math.min(...xValues) - 0.5, Math.max(...xValues) + 0.5],
      tickmode: "array",
      tickvals: xValues,
      ticktext: xValues.map((value) => String(value)),
      tickfont: { size: 10 },
      ticks: "outside",
      ticklen: 4,
      tickcolor: "rgba(240,240,240,0.68)",
      gridcolor: "rgba(240,240,240,0.06)",
      color: "#f0f0f0",
      showline: true,
      mirror: true,
      linecolor: "rgba(240,240,240,0.58)",
      linewidth: 1,
      zeroline: false,
      automargin: false,
      fixedrange: true
    };
    layoutAxes[yAxisKey] = {
      domain: [y0, y1],
      anchor: xRef,
      type: "linear",
      range: [Math.min(...yValues) - 0.5, Math.max(...yValues) + 0.5],
      tickmode: "array",
      tickvals: yValues,
      ticktext: yValues.map((value) => String(value)),
      tickfont: { size: 10 },
      ticks: "outside",
      ticklen: 4,
      tickcolor: "rgba(240,240,240,0.68)",
      gridcolor: "rgba(240,240,240,0.06)",
      color: "#f0f0f0",
      showline: true,
      mirror: true,
      linecolor: "rgba(240,240,240,0.58)",
      linewidth: 1,
      zeroline: false,
      automargin: false,
      fixedrange: true
    };
    annotations.push({
      text: `<b>${pos}</b>`,
      x: (x0 + x1) / 2,
      y: Math.min(1.02, y1 + 0.045),
      xref: "paper",
      yref: "paper",
      showarrow: false,
      font: { color: posColors[pos] || "#f0f0f0", size: 15 }
    });
    annotations.push({
      text: "Bust weeks (&lt; 0 WAR)",
      x: (x0 + x1) / 2,
      y: y0 - (rowsCount === 1 ? 0.095 : 0.07),
      xref: "paper",
      yref: "paper",
      showarrow: false,
      xanchor: "center",
      yanchor: "top",
      font: { color: "rgba(240,240,240,0.9)", size: 11 }
    });
    annotations.push({
      text: `Boom weeks (&gt; ${threshold.toFixed(2)} ${yMetric})`,
      x: x0 - (columns === 1 ? 0.07 : 0.055),
      y: (y0 + y1) / 2,
      xref: "paper",
      yref: "paper",
      showarrow: false,
      textangle: -90,
      xanchor: "center",
      yanchor: "middle",
      font: { color: "rgba(240,240,240,0.9)", size: 11 }
    });
  });

  return {
    traces,
    layout: {
      ...historicalAdpBaseLayout(copy),
      ...layoutAxes,
      height: positions.length <= 2 ? 780 : 1100,
      margin: { l: 132, r: 108, t: 146, b: 164 },
      annotations: [
        ...annotations,
        {
          text: "Cells show average historical ADP and player-season count. Lower ADP means more expensive draft cost.",
          xref: "paper",
          yref: "paper",
          x: 0,
          y: -0.16,
          xanchor: "left",
          showarrow: false,
          font: { color: "rgba(240,240,240,0.62)", size: 11 }
        }
      ],
      coloraxis: {
        colorscale: [
          [0, "#f2f2f2"],
          [0.26, "#f0c56d"],
          [0.55, "#d9854f"],
          [0.78, "#9d4b4b"],
          [1, "#421d2b"]
        ],
        reversescale: true,
        colorbar: { title: "Avg ADP", tickfont: { color: "#f0f0f0" }, titlefont: { color: "#f0f0f0" } }
      }
    }
  };
}

function historicalAdpOutcomePlot(rows, copy, metric = "WAR") {
  const yMetric = historicalAdpMetric(metric);
  const points = historicalRowsWithAdp(rows).filter((row) => number(row[yMetric], null) !== null);
  if (!points.length) {
    return {
      traces: [],
      layout: historicalLayout(copy.title, "Historical ADP", yMetric, "No historical ADP rows matched the selected years, scoring, and positions")
    };
  }
  const positions = ["QB", "RB", "WR", "TE"].filter((pos) => points.some((row) => row.Pos === pos));
  const traces = positions.map((pos) => {
    const posRows = points.filter((row) => row.Pos === pos);
    return {
      type: "scatter",
      mode: "markers",
      name: pos,
      x: posRows.map((row) => row.ADP),
      y: posRows.map((row) => number(row[yMetric])),
      customdata: posRows.map((row) => [
        row.Player,
        row.Year,
        row.FPTS,
        row.WAR,
        row["Flex WAR"],
        row["SuperFlex WAR"],
        row.ADPBucket
      ]),
      marker: {
        color: posColors[pos],
        symbol: posSymbols[pos],
        size: posRows.map((row) => Math.max(7, Math.min(18, 7 + number(row.Games, 0) * 0.35))),
        opacity: 0.72,
        line: { color: "#111111", width: 1 }
      },
      hovertemplate:
        "<b>%{customdata[0]}</b> (%{customdata[1]})<br>" +
        "ADP: %{x:.1f} (%{customdata[6]})<br>" +
        `${yMetric}: %{y:.3f}<br>` +
        "FPTS: %{customdata[2]:.1f}<br>WAR: %{customdata[3]:.3f}<br>Flex: %{customdata[4]:.3f}<br>SF: %{customdata[5]:.3f}<extra></extra>"
    };
  });
  return {
    traces,
    layout: {
      ...historicalAdpBaseLayout(copy),
      xaxis: {
        title: { text: "Historical ADP", standoff: 18 },
        range: [HISTORICAL_ADP_PLAYER_CAP, 0],
        gridcolor: "rgba(240,240,240,0.10)",
        color: "#f0f0f0"
      },
      yaxis: {
        title: { text: `Season ${yMetric}`, standoff: 18 },
        gridcolor: "rgba(240,240,240,0.10)",
        zeroline: true,
        zerolinecolor: "rgba(255,255,255,0.38)",
        color: "#f0f0f0"
      },
      hovermode: "closest"
    }
  };
}

function historicalAdpTrendPlot(rows, copy, metric = "WAR") {
  const yMetric = historicalAdpMetric(metric);
  const points = historicalRowsWithAdp(rows).filter((row) => row.ADPBucket && number(row[yMetric], null) !== null);
  if (!points.length) {
    return {
      traces: [],
      layout: historicalLayout(copy.title, "Year", yMetric, "No historical ADP rows matched the selected years, scoring, and positions")
    };
  }
  const selectedStart = number(el("historicalPlotStart")?.value, Math.min(...points.map((row) => row.Year)));
  const selectedEnd = number(el("historicalPlotEnd")?.value, Math.max(...points.map((row) => row.Year)));
  const adpStart = Math.min(...points.map((row) => row.Year));
  const adpEnd = Math.max(...points.map((row) => row.Year));
  const start = Math.max(selectedStart, adpStart);
  const end = Math.min(selectedEnd, adpEnd);
  const years = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  const buckets = historicalAdpBucketOrder().filter((bucket) => points.some((row) => row.ADPBucket === bucket));
  const positions = selectedHistoricalPositions().filter((pos) => points.some((row) => row.Pos === pos));
  const panelDomains = historicalTrendPanelDomains(positions.length);
  const traces = positions.map((pos, index) => {
    const z = buckets.map((bucket) => years.map((year) => {
      const group = points.filter((row) => row.Pos === pos && row.ADPBucket === bucket && row.Year === year);
      return group.length ? average(group.map((row) => number(row[yMetric]))) : null;
    }));
    const counts = buckets.map((bucket) => years.map((year) => points.filter((row) => row.Pos === pos && row.ADPBucket === bucket && row.Year === year).length));
    const text = z.map((row, rowIndex) => row.map((value, colIndex) => {
      const count = counts[rowIndex][colIndex];
      return value === null || !count ? "" : `${value.toFixed(2)}<br>N=${count}`;
    }));
    return {
      type: "heatmap",
      name: pos,
      x: years,
      y: buckets,
      z,
      text,
      texttemplate: "%{text}",
      hovertemplate: `<b>${pos} %{y}</b><br>%{x}<br>Avg ${yMetric}: %{z:.3f}<br>Players: %{customdata}<extra></extra>`,
      customdata: counts,
      colorscale: [
        [0, "#4f1f25"],
        [0.25, "#8d4545"],
        [0.5, "#f2f2f2"],
        [0.75, "#8fba7a"],
        [1, "#3f7b61"]
      ],
      zmid: 0,
      zsmooth: false,
      xgap: 4,
      ygap: 4,
      colorbar: index === positions.length - 1
        ? { title: `Avg ${yMetric}`, tickfont: { color: "#f0f0f0" }, titlefont: { color: "#f0f0f0" } }
        : undefined,
      showscale: index === positions.length - 1,
      xaxis: `x${index ? index + 1 : ""}`,
      yaxis: `y${index ? index + 1 : ""}`
    };
  });
  const layout = {
    ...historicalAdpBaseLayout(copy),
    margin: { l: 92, r: 88, t: 132, b: 118 },
    hovermode: "closest",
    annotations: [
      ...(historicalAdpBaseLayout(copy).annotations || []),
      ...positions.map((pos, index) => ({
        text: `<b>${pos}</b>`,
        xref: "paper",
        yref: "paper",
        x: (panelDomains[index].x[0] + panelDomains[index].x[1]) / 2,
        y: panelDomains[index].y[1] + 0.055,
        showarrow: false,
        font: { color: posColors[pos], size: 16, family: "Kanit FPTS, Impact, sans-serif" }
      }))
    ]
  };
  positions.forEach((pos, index) => {
    const suffix = index ? index + 1 : "";
    layout[`xaxis${suffix}`] = {
      title: index >= positions.length - 2 ? { text: "Season", standoff: 14 } : "",
      tickmode: "array",
      tickvals: years,
      domain: panelDomains[index].x,
      gridcolor: "rgba(240,240,240,0.08)",
      color: "#f0f0f0",
      automargin: true
    };
    layout[`yaxis${suffix}`] = {
      title: index % 2 === 0 ? { text: "ADP bucket", standoff: 12 } : "",
      domain: panelDomains[index].y,
      autorange: "reversed",
      gridcolor: "rgba(240,240,240,0.08)",
      color: "#f0f0f0",
      automargin: true
    };
  });
  return {
    traces,
    layout
  };
}

function historicalTrendPanelDomains(count) {
  if (count <= 1) return [{ x: [0, 1], y: [0, 1] }];
  if (count === 2) return [
    { x: [0, 0.47], y: [0, 1] },
    { x: [0.53, 1], y: [0, 1] }
  ];
  const domains = [
    { x: [0, 0.47], y: [0.55, 1] },
    { x: [0.53, 1], y: [0.55, 1] },
    { x: [0, 0.47], y: [0, 0.45] },
    { x: [0.53, 1], y: [0, 0.45] }
  ];
  return domains.slice(0, count);
}

function historicalWeeklyBinLayout(copy) {
  return {
    title: {
      text: `<b>${copy.title}</b><br><span style="font-size:12px;color:#b8b8b8;font-style:italic;font-weight:400">${copy.subtitle}</span>`,
      font: { size: 21, color: "#f7f7f7", family: "Kanit FPTS, Impact, sans-serif" },
      x: 0.02,
      xanchor: "left",
      y: 0.94
    },
    margin: { l: 82, r: 48, t: 132, b: 150 },
    xaxis: {
      title: { text: "Fantasy points bin (single week)", standoff: 18 },
      gridcolor: "rgba(240,240,240,0.08)",
      linecolor: "rgba(240,240,240,0.38)",
      tickfont: { size: 12 },
      color: "#f0f0f0",
      automargin: true
      },
      yaxis: {
      title: { text: `Average single-week ${copy.yMetric || "WAR"}`, standoff: 18 },
      gridcolor: "rgba(240,240,240,0.10)",
      linecolor: "rgba(240,240,240,0.38)",
      zeroline: true,
      zerolinecolor: "rgba(255,255,255,0.62)",
      zerolinewidth: 2,
      tickfont: { size: 12 },
      color: "#f0f0f0",
      automargin: true
    },
    annotations: [
      {
        text: "0.00 WAR = replacement-level weekly outcome",
        xref: "paper",
        yref: "y",
        x: 0.01,
        y: 0,
        xanchor: "left",
        yanchor: "bottom",
        showarrow: false,
        font: { color: "rgba(240,240,240,0.72)", size: 11 }
      },
      {
        text: "Source: Historical weekly scoring, WAR Lab historical model. Lines are averages of individual player-weeks in each bin.",
        xref: "paper",
        yref: "paper",
        x: 0,
        y: -0.32,
        xanchor: "left",
        showarrow: false,
        font: { color: "rgba(240,240,240,0.62)", size: 11 }
      }
    ],
    legend: { orientation: "h", y: -0.19, x: 0, font: { size: 12 }, itemwidth: 42 },
    font: { family: "Mulish, sans-serif", color: "#f0f0f0" },
    plot_bgcolor: "#111111",
    paper_bgcolor: "#111111",
    hovermode: "closest",
    hoverlabel: { bgcolor: "#111111", bordercolor: "#cc3333", font: { color: "#f0f0f0" } }
  };
}

function historicalLayout(title, xTitle, yTitle, annotation = null) {
  const annotations = annotation ? [{
    text: annotation,
    xref: "paper",
    yref: "paper",
    x: 0.5,
    y: 0.5,
    showarrow: false,
    font: { color: "#f0f0f0", size: 16 }
  }] : [];
  return {
    title: { text: title, font: { size: 18 }, x: 0.02, xanchor: "left" },
    margin: { l: 58, r: 20, t: 62, b: 82 },
    xaxis: { title: xTitle, gridcolor: "rgba(240,240,240,0.18)", color: "#f0f0f0" },
    yaxis: { title: yTitle, gridcolor: "rgba(240,240,240,0.18)", color: "#f0f0f0" },
    legend: { orientation: "h", y: -0.18, x: 0 },
    annotations,
    font: { family: "Mulish, sans-serif", color: "#f0f0f0" },
    plot_bgcolor: "#111111",
    paper_bgcolor: "#111111",
    hovermode: "closest",
    hoverlabel: { bgcolor: "#111111", bordercolor: "#cc3333", font: { color: "#f0f0f0" } }
  };
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

function playedWarValue(row, metric = "WAR") {
  return number(row?.[`Played ${metric}`], number(row?.[metric], null));
}

function playedWarPerGame(row, metric = "WAR") {
  const war = playedWarValue(row, metric);
  const games = number(row?.Games, null);
  return war !== null && games ? war / games : null;
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
      <td>${fmt(playedWarValue(row, "WAR"))}</td>
      <td>${fmt(playedWarPerGame(row, "WAR"), 3)}</td>
      <td>${fmt(playedWarValue(row, "Flex WAR"))}</td>
      <td>${fmt(playedWarValue(row, "SuperFlex WAR"))}</td>
      <td>${fmt(row.Games, 0)}</td>
    </tr>
  `).join("");
  return `
    <div class="history-panel">
      <div class="history-header">
        <h3>Historical Performance</h3>
        <span>${selected.Year} - ${fmt(selected.FPTS, 1)} FPTS - ${fmt(selected.AVG, 2)} / game - ${fmt(playedWarValue(selected, "WAR"))} played-week WAR</span>
      </div>
      <div class="history-season-table">
        <table>
          <thead><tr><th>Year</th><th>FPTS</th><th>AVG</th><th>Played WAR</th><th>WAR/G</th><th>Played Flex</th><th>Played SF</th><th>Games</th></tr></thead>
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

function draftOptimizerSettings() {
  const cfg = settings();
  return {
    teams: cfg.teams,
    slot: Math.max(1, Math.min(cfg.teams, number(el("draftSlot")?.value, 1))),
    rounds: Math.max(1, Math.min(30, number(el("draftRounds")?.value, number(el("draftRosterSpots")?.value, 16)))),
    rosterSpots: Math.max(1, Math.min(30, number(el("draftRosterSpots")?.value, 16))),
    window: Math.max(3, Math.min(80, number(el("draftCandidateWindow")?.value, 24))),
    uncertainty: el("draftUncertainty")?.value || "medium",
    earlyTarget: el("draftEarlyTarget")?.value || "none",
    strategy: el("draftStrategy")?.value || "balanced",
    metric: draftMetric(),
    caps: {
      QB: Math.max(0, Math.min(30, number(el("draftCapQB")?.value, 4))),
      RB: Math.max(0, Math.min(30, number(el("draftCapRB")?.value, 8))),
      WR: Math.max(0, Math.min(30, number(el("draftCapWR")?.value, 8))),
      TE: Math.max(0, Math.min(30, number(el("draftCapTE")?.value, 4)))
    }
  };
}

function draftUncertaintyScale(opts) {
  return { none: 0, low: 6, medium: 13, high: 24 }[opts.uncertainty] ?? 13;
}

function draftSeedValue(opts) {
  const capText = ["QB", "RB", "WR", "TE"].map((pos) => `${pos}${opts.caps?.[pos] ?? ""}`).join("|");
  const text = `${settings().year}|${opts.teams}|${opts.slot}|${opts.rounds}|${opts.rosterSpots}|${opts.window}|${opts.uncertainty}|${opts.earlyTarget}|${opts.strategy}|${opts.metric}|${capText}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function draftAvailability(player, pickNo, opts) {
  const adp = number(player?.ADP, null);
  if (adp === null) return opts.uncertainty === "none" ? 1 : 0.72;
  const scale = Math.max(4, draftUncertaintyScale(opts));
  if (opts.uncertainty === "none") return adp >= pickNo ? 1 : 0;
  return 1 / (1 + Math.exp((pickNo - adp) / scale));
}

function draftAvailabilityLabel(value) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function draftMetric() {
  const selected = el("draftMetric")?.value || "auto";
  if (selected !== "auto") return selected;
  return settings().slots.SUPERFLEX > 0 ? "SuperFlex WAR" : "WAR";
}

function snakePickNumber(round, slot, teams) {
  const roundStart = (round - 1) * teams;
  return roundStart + (round % 2 === 1 ? slot : teams - slot + 1);
}

function draftWarValue(player, metric = "WAR") {
  if (metric === "Flex WAR") return number(player["Flex WAR"], null) ?? number(player.WAR, 0);
  if (metric === "SuperFlex WAR") return number(player["SuperFlex WAR"], null) ?? number(player.WAR, 0);
  return number(player.WAR, 0);
}

function draftTargets(rosterSpots) {
  const cfg = settings();
  const flex = cfg.slots.FLEX;
  const superflex = cfg.slots.SUPERFLEX;
  const target = {
    QB: Math.max(cfg.slots.QB + superflex, superflex ? 3 : 2),
    RB: cfg.slots.RB + Math.ceil(flex * 0.6) + 3,
    WR: cfg.slots.WR + Math.ceil(flex * 0.7) + 3,
    TE: cfg.slots.TE + (cfg.scoring.tePremium > 0 ? 1 : 0)
  };
  while (Object.values(target).reduce((sum, value) => sum + value, 0) > rosterSpots) {
    const trimOrder = ["TE", superflex ? "QB" : "QB", "RB", "WR"];
    const pos = trimOrder.find((key) => target[key] > Math.max(1, cfg.slots[key] || 0));
    if (!pos) break;
    target[pos] -= 1;
  }
  return target;
}

function draftPositionCounts(roster) {
  return roster.reduce((map, row) => ({ ...map, [row.Pos]: (map[row.Pos] || 0) + 1 }), {});
}

function draftPositionAllowed(player, counts, opts) {
  const cap = opts.caps?.[player.Pos];
  return cap === undefined || (counts[player.Pos] || 0) < cap;
}

function draftEarlyTargetAdjustment(pos, counts, round, opts) {
  const target = opts.earlyTarget || "none";
  if (target === "none") return { score: 0, label: "" };
  const count = counts[pos] || 0;
  const earlyRound = round <= 4;
  const openingRound = round <= 2;
  const labels = {
    "early-qb": "Early QB",
    "early-te": "Early TE",
    "early-qb-te": "Early QB or TE",
    "first-2-rb": "First 2 RBs",
    "first-2-wr": "First 2 WRs",
    "hero-rb": "Hero RB",
    "zero-rb": "Zero RB start"
  };
  if (target === "early-qb") {
    if (pos === "QB" && count < 1 && round <= 3) return { score: 4.2 - (round * 0.28), label: labels[target] };
    if (pos === "QB" && count < 1 && earlyRound) return { score: 2.7, label: labels[target] };
    if (pos !== "QB" && (counts.QB || 0) < 1 && round <= 3) return { score: -0.45, label: "" };
  }
  if (target === "early-te") {
    if (pos === "TE" && count < 1 && round <= 3) return { score: 4.0 - (round * 0.28), label: labels[target] };
    if (pos === "TE" && count < 1 && earlyRound) return { score: 2.55, label: labels[target] };
    if (pos !== "TE" && (counts.TE || 0) < 1 && round <= 3) return { score: -0.38, label: "" };
  }
  if (target === "early-qb-te") {
    const hasOnesie = (counts.QB || 0) > 0 || (counts.TE || 0) > 0;
    if (["QB", "TE"].includes(pos) && !hasOnesie && round <= 3) return { score: 3.8 - (round * 0.22), label: labels[target] };
    if (["QB", "TE"].includes(pos) && !hasOnesie && earlyRound) return { score: 2.25, label: labels[target] };
    if (!["QB", "TE"].includes(pos) && !hasOnesie && round <= 3) return { score: -0.32, label: "" };
  }
  if (target === "first-2-rb") {
    if (pos === "RB" && count < 2 && round <= 3) return { score: 2.7 - (count * 0.45), label: labels[target] };
    if (pos !== "RB" && (counts.RB || 0) < 2 && round <= 2) return { score: -0.65, label: "" };
  }
  if (target === "first-2-wr") {
    if (pos === "WR" && count < 2 && round <= 3) return { score: 2.45 - (count * 0.4), label: labels[target] };
    if (pos !== "WR" && (counts.WR || 0) < 2 && round <= 2) return { score: -0.55, label: "" };
  }
  if (target === "hero-rb") {
    if (pos === "RB" && count < 2 && round <= 3) return { score: 3.35 - (count * 0.35), label: labels[target] };
    if (pos !== "RB" && (counts.RB || 0) < 2 && round <= 3) return { score: -0.8, label: "" };
    if (pos === "RB" && count < 4 && round <= 7) return { score: 2.25 - (count * 0.18), label: labels[target] };
    if (pos !== "RB" && (counts.RB || 0) < 4 && round <= 7) return { score: -0.32, label: "" };
  }
  if (target === "zero-rb") {
    if (pos === "RB" && count >= 1 && round <= 5) return { score: -2.2, label: labels[target] };
    if (pos === "RB" && count < 1 && round <= 5) return { score: -0.15, label: labels[target] };
    if (["WR", "TE", "QB"].includes(pos) && round <= 5) return { score: 0.5, label: labels[target] };
  }
  return { score: 0, label: "" };
}

function draftCandidateScore(player, roster, available, pickNo, nextUserPick, opts) {
  const cfg = settings();
  const counts = draftPositionCounts(roster);
  const round = Math.ceil(pickNo / opts.teams);
  const pos = player.Pos;
  const targets = draftTargets(opts.rosterSpots);
  const starters = { QB: cfg.slots.QB, RB: cfg.slots.RB, WR: cfg.slots.WR, TE: cfg.slots.TE };
  const metricWar = draftWarValue(player, opts.metric);
  const starterMissing = Math.max(0, (starters[pos] || 0) - (counts[pos] || 0));
  const flexEligible = ["RB", "WR", "TE"].includes(pos);
  const flexCount = ["RB", "WR", "TE"].reduce((sum, key) => sum + (counts[key] || 0), 0);
  const flexTarget = cfg.slots.RB + cfg.slots.WR + cfg.slots.TE + cfg.slots.FLEX;
  const depthMissing = Math.max(0, (targets[pos] || 0) - (counts[pos] || 0));
  const strategyWeights = {
    balanced: { starter: 1.35, depth: 0.48, scarcity: 0.22, value: 0.025 },
    upside: { starter: 0.9, depth: 0.38, scarcity: 0.48, value: 0.04 },
    need: { starter: 1.9, depth: 0.34, scarcity: 0.16, value: 0.015 }
  }[opts.strategy] || { starter: 1.35, depth: 0.48, scarcity: 0.22, value: 0.025 };
  const nextSamePos = available
    .filter((row) => row.id !== player.id && row.Pos === pos)
    .sort((a, b) => draftWarValue(b, opts.metric) - draftWarValue(a, opts.metric))[0];
  const scarcityDrop = Math.max(0, metricWar - draftWarValue(nextSamePos || {}, opts.metric));
  const adp = number(player.ADP, pickNo);
  const adpValue = Math.max(0, pickNo - adp);
  const waitPenalty = Math.max(0, adp - nextUserPick) * 0.035;
  const availability = draftAvailability(player, pickNo, opts);
  const availabilityPenalty = Math.max(0, 0.45 - availability) * 0.85;
  const overTargetPenalty = (counts[pos] || 0) >= (targets[pos] || 0)
    ? Math.max(0.8, metricWar * 0.22)
    : 0;
  const rbWrDepthBoost = ["RB", "WR"].includes(pos) ? 0.35 : 0;
  const flexBonus = flexEligible && flexCount < flexTarget ? 0.9 : 0;
  const superflexBonus = cfg.slots.SUPERFLEX && pos === "QB" && (counts.QB || 0) < targets.QB ? 1.1 : 0;
  const earlyTarget = draftEarlyTargetAdjustment(pos, counts, round, opts);
  const needScore =
    (starterMissing * strategyWeights.starter) +
    (depthMissing * strategyWeights.depth) +
    rbWrDepthBoost +
    flexBonus +
    superflexBonus +
    earlyTarget.score;
  const score =
    metricWar +
    needScore +
    (scarcityDrop * strategyWeights.scarcity) +
    (adpValue * strategyWeights.value) -
    waitPenalty -
    availabilityPenalty -
    overTargetPenalty;
  const reasonParts = [];
  let positionStrategy = "Maximize WAR";
  if (starterMissing) reasonParts.push("starter need");
  else if (depthMissing) reasonParts.push(`${pos} depth`);
  if (starterMissing) positionStrategy = `Fill ${pos} starter`;
  else if (superflexBonus) positionStrategy = "Prioritize SuperFlex QB depth";
  else if (flexBonus && ["RB", "WR"].includes(pos)) positionStrategy = `Build ${pos}/Flex depth`;
  else if (flexBonus) positionStrategy = "Cover Flex depth";
  else if (depthMissing) positionStrategy = `Build ${pos} depth`;
  else if (scarcityDrop > 0.4) positionStrategy = `Attack ${pos} scarcity`;
  if (earlyTarget.label && earlyTarget.score > 0) positionStrategy = earlyTarget.label;
  if (flexBonus) reasonParts.push("flex depth");
  if (superflexBonus) reasonParts.push("SF QB demand");
  if (earlyTarget.label && earlyTarget.score > 0) reasonParts.push(earlyTarget.label.toLowerCase());
  if (scarcityDrop > 0.4) reasonParts.push("scarcity cliff");
  if (adpValue >= 8) reasonParts.push("ADP fall");
  if (adp <= nextUserPick) reasonParts.push("may not return");
  if (availability < 0.35) reasonParts.push("availability risk");
  return {
    score,
    needScore,
    availability,
    positionStrategy,
    reason: reasonParts.length ? reasonParts.join(", ") : "best WAR in window"
  };
}

function draftAlternateLabel(candidate, opts) {
  if (!candidate?.player) return "-";
  return `${candidate.player.Player} (${candidate.player.Pos}, ${fmt(draftWarValue(candidate.player, opts.metric))})`;
}

function runDraftOptimization() {
  const opts = draftOptimizerSettings();
  const maxPicks = opts.teams * opts.rounds;
  const playerPool = [...state.results]
    .filter((player) => player.Player && ["QB", "RB", "WR", "TE"].includes(player.Pos))
    .sort((a, b) => (number(a.ADP, 9999) - number(b.ADP, 9999)) || (number(a["Overall Rank"], 9999) - number(b["Overall Rank"], 9999)));
  const available = new Map(playerPool.map((player) => [player.id, player]));
  const rng = seededRandom(draftSeedValue(opts));
  const marketPick = (pickNo) => {
    const rows = [...available.values()]
      .sort((a, b) => (number(a.ADP, 9999) - number(b.ADP, 9999)) || (draftWarValue(b, opts.metric) - draftWarValue(a, opts.metric)));
    if (!rows.length || opts.uncertainty === "none") return rows[0];
    const scale = draftUncertaintyScale(opts);
    const pool = rows.slice(0, Math.max(8, Math.min(rows.length, Math.round(scale * 1.8))));
    const scored = pool
      .map((player) => {
        const adp = number(player.ADP, pickNo);
        const reachNoise = (rng() - 0.5) * scale;
        const warPush = Math.max(0, draftWarValue(player, opts.metric)) * 0.9;
        return { player, cost: adp + reachNoise - warPush };
      })
      .sort((a, b) => a.cost - b.cost);
    const weights = scored.map((_, index) => Math.exp(-index / Math.max(1.5, scale / 7)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let roll = rng() * total;
    for (let index = 0; index < scored.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) return scored[index].player;
    }
    return scored[0].player;
  };
  const roster = [];
  let nextPick = 1;
  for (let round = 1; round <= opts.rounds && roster.length < opts.rosterSpots; round += 1) {
    const userPick = snakePickNumber(round, opts.slot, opts.teams);
    const nextUserPick = round < opts.rounds ? snakePickNumber(round + 1, opts.slot, opts.teams) : maxPicks + 1;
    while (nextPick < userPick && nextPick <= maxPicks && available.size) {
      const drafted = marketPick(nextPick);
      if (!drafted) break;
      available.delete(drafted.id);
      nextPick += 1;
    }
    const adpWindow = [...available.values()]
      .filter((player) => draftPositionAllowed(player, draftPositionCounts(roster), opts))
      .sort((a, b) => (number(a.ADP, 9999) - number(b.ADP, 9999)) || (draftWarValue(b, opts.metric) - draftWarValue(a, opts.metric)))
      .slice(0, opts.window);
    const warWindow = [...available.values()]
      .filter((player) => draftPositionAllowed(player, draftPositionCounts(roster), opts))
      .sort((a, b) => draftWarValue(b, opts.metric) - draftWarValue(a, opts.metric))
      .slice(0, Math.max(5, Math.floor(opts.window / 3)));
    const candidates = [...new Map([...adpWindow, ...warWindow].map((player) => [player.id, player])).values()];
    const scoredCandidates = candidates
      .map((player) => ({ player, ...draftCandidateScore(player, roster, [...available.values()], userPick, nextUserPick, opts) }))
      .sort((a, b) => b.score - a.score);
    const selected = scoredCandidates[0];
    const alternate = scoredCandidates[1];
    if (!selected) break;
    available.delete(selected.player.id);
    roster.push({
      ...selected.player,
      draftRound: round,
      draftPick: userPick,
      draftScore: selected.score,
      draftNeedScore: selected.needScore,
      draftPositionStrategy: selected.positionStrategy,
      draftReason: selected.reason,
      draftAvailability: selected.availability,
      draftAlternate: draftAlternateLabel(alternate, opts),
      draftMetricValue: draftWarValue(selected.player, opts.metric)
    });
    nextPick = userPick + 1;
  }
  return { opts, roster };
}

function optimizedStarterSelections(roster) {
  const cfg = settings();
  const slots = [
    ...Array.from({ length: cfg.slots.QB }, () => ({ eligible: (player) => player.Pos === "QB", metric: "WAR" })),
    ...Array.from({ length: cfg.slots.RB }, () => ({ eligible: (player) => player.Pos === "RB", metric: "WAR" })),
    ...Array.from({ length: cfg.slots.WR }, () => ({ eligible: (player) => player.Pos === "WR", metric: "WAR" })),
    ...Array.from({ length: cfg.slots.TE }, () => ({ eligible: (player) => player.Pos === "TE", metric: "WAR" })),
    ...Array.from({ length: cfg.slots.FLEX }, () => ({ eligible: (player) => ["RB", "WR", "TE"].includes(player.Pos), metric: "Flex WAR" })),
    ...Array.from({ length: cfg.slots.SUPERFLEX }, () => ({ eligible: () => true, metric: "SuperFlex WAR" }))
  ].sort((a, b) => roster.filter(a.eligible).length - roster.filter(b.eligible).length);
  const candidateIndexes = roster
    .map((player, index) => ({
      index,
      best: Math.max(
        draftWarValue(player, "WAR"),
        draftWarValue(player, "Flex WAR"),
        draftWarValue(player, "SuperFlex WAR")
      )
    }))
    .sort((a, b) => b.best - a.best)
    .slice(0, Math.max(12, Math.min(18, slots.length + 6)))
    .map((row) => row.index);
  const memo = new Map();
  const solve = (slotIndex, usedKey) => {
    if (slotIndex >= slots.length) return { total: 0, picks: [] };
    const key = `${slotIndex}|${usedKey}`;
    if (memo.has(key)) return memo.get(key);
    const used = new Set(usedKey ? usedKey.split(",").map(Number) : []);
    const slot = slots[slotIndex];
    let best = { total: 0, picks: [] };
    for (const rosterIndex of candidateIndexes) {
      if (used.has(rosterIndex) || !slot.eligible(roster[rosterIndex])) continue;
      const value = draftWarValue(roster[rosterIndex], slot.metric);
      const nextUsed = [...used, rosterIndex].sort((a, b) => a - b).join(",");
      const next = solve(slotIndex + 1, nextUsed);
      const total = value + next.total;
      if (total > best.total || !best.picks.length) best = { total, picks: [{ rosterIndex, value }, ...next.picks] };
    }
    memo.set(key, best);
    return best;
  };
  return new Map(solve(0, "").picks.map((pick) => [pick.rosterIndex, pick.value]));
}

function optimizedStarterWar(roster) {
  return [...optimizedStarterSelections(roster).values()].reduce((sum, value) => sum + value, 0);
}

function draftRosterTotalWar(roster, opts) {
  const starterSelections = optimizedStarterSelections(roster);
  return roster.reduce((sum, player, index) => {
    const starterValue = starterSelections.get(index);
    const value = starterValue ?? draftWarValue(player, opts.metric);
    return sum + (starterValue !== undefined ? value : Math.max(0, value));
  }, 0);
}

function renderDraftOptimizer() {
  const { opts, roster } = runDraftOptimization();
  const counts = draftPositionCounts(roster);
  const targets = draftTargets(opts.rosterSpots);
  const totalWar = draftRosterTotalWar(roster, opts);
  const starterWar = optimizedStarterWar(roster);
  if (el("draftTotalWar")) el("draftTotalWar").textContent = fmt(totalWar);
  if (el("draftStarterWar")) el("draftStarterWar").textContent = fmt(starterWar);
  if (el("draftRosterBuild")) el("draftRosterBuild").textContent = ["QB", "RB", "WR", "TE"].map((pos) => `${pos}${counts[pos] || 0}`).join(" / ");
  if (el("draftPositionStrategy")) el("draftPositionStrategy").textContent = ["QB", "RB", "WR", "TE"].map((pos) => `${pos}${counts[pos] || 0}/${targets[pos] || 0}`).join(" / ");
  const earlyTargetText = (el("draftEarlyTarget")?.selectedOptions?.[0]?.textContent || "Best WAR path").trim();
  const capText = ["QB", "RB", "WR", "TE"].map((pos) => `${pos}${opts.caps[pos]}`).join(" / ");
  if (el("draftSimulationNote")) el("draftSimulationNote").textContent = `${opts.teams} teams, slot ${opts.slot}, ${opts.window}-player window, ${opts.uncertainty} market uncertainty, ${earlyTargetText}, caps ${capText}. Alternates show the next-best pick if the target player is taken. Negative WAR only counts against the total when the player is in the optimized starting lineup.`;
  if (el("draftOptimizerSubtitle")) {
    el("draftOptimizerSubtitle").textContent = `Other teams draft by ADP between turns. Your picks optimize ${opts.metric} with starter, depth, and scarcity adjustments.`;
  }
  const body = el("draftOptimizerBody");
  if (body) {
    body.innerHTML = roster.map((player) => `
      <tr>
        <td>${fmt(player.draftRound, 0)}</td>
        <td>${fmt(player.draftPick, 0)}</td>
        <td><strong>${escapeHtml(player.Player)}</strong></td>
        <td><span class="pos-pill pos-${player.Pos}">${escapeHtml(player.Pos)}</span></td>
        <td>${escapeHtml(player.draftPositionStrategy || "-")}</td>
        <td>${escapeHtml(player.Team || "-")}</td>
        <td>${fmt(player.ADP, 1)}</td>
        <td>${fmt(player.draftMetricValue)}</td>
        <td>${draftAvailabilityLabel(player.draftAvailability)}</td>
        <td>${escapeHtml(player.draftAlternate || "-")}</td>
        <td>${fmt(player.draftNeedScore)}</td>
        <td>${escapeHtml(player.draftReason)}</td>
      </tr>
    `).join("");
  }
  renderDraftOptimizerChart(roster, opts);
}

function renderDraftOptimizerChart(roster, opts) {
  const chart = el("draftOptimizerChart");
  if (!chart) return;
  if (!roster.length) {
    Plotly.react(chart, [], {
      title: { text: "Draft Optimizer", font: { color: "#f0f0f0", size: 18 } },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      annotations: [{ text: "No projection rows available for the optimizer.", showarrow: false, font: { color: "#f0f0f0" } }]
    }, { responsive: true });
    return;
  }
  let cumulative = 0;
  const starterSelections = optimizedStarterSelections(roster);
  const cumulativeWar = roster.map((player, index) => {
    const starterValue = starterSelections.get(index);
    const value = starterValue ?? draftWarValue(player, opts.metric);
    cumulative += starterValue !== undefined ? value : Math.max(0, value);
    return cumulative;
  });
  const posCounts = ["QB", "RB", "WR", "TE"].map((pos) => roster.filter((player) => player.Pos === pos).length);
  const traces = [
    {
      type: "scatter",
      mode: "lines+markers",
      x: roster.map((player) => `R${player.draftRound}`),
      y: cumulativeWar,
      text: roster.map((player) => `${player.Player} (${player.Pos})`),
      line: { color: "#cc3333", width: 3 },
      marker: { color: roster.map((player) => posColors[player.Pos] || "#f0f0f0"), size: 9 },
      hovertemplate: "<b>%{text}</b><br>%{x}<br>Cumulative WAR: %{y:.2f}<extra></extra>",
      name: "Cumulative WAR"
    },
    {
      type: "bar",
      x: ["QB", "RB", "WR", "TE"],
      y: posCounts,
      marker: { color: ["QB", "RB", "WR", "TE"].map((pos) => posColors[pos]) },
      yaxis: "y2",
      name: "Roster count",
      opacity: 0.42,
      hovertemplate: "%{x}: %{y}<extra></extra>"
    }
  ];
  Plotly.react(chart, traces, {
    title: { text: `${opts.rounds}-Round Draft Plan from Slot ${opts.slot}`, font: { color: "#f0f0f0", size: 18 } },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(17,17,17,0.35)",
    font: { color: "#f0f0f0" },
    xaxis: { title: "Your picks", gridcolor: "rgba(240,240,240,0.12)" },
    yaxis: { title: `Cumulative ${opts.metric}`, gridcolor: "rgba(240,240,240,0.16)" },
    yaxis2: { title: "Roster count", overlaying: "y", side: "right", rangemode: "tozero", showgrid: false },
    legend: { orientation: "h", y: -0.22 },
    margin: { l: 58, r: 58, t: 58, b: 76 }
  }, { responsive: true });
}

function render() {
  if (state.renderTimer) {
    clearTimeout(state.renderTimer);
    state.renderTimer = null;
  }
  updateActiveView();
  computeHistoricalModel();
  if (state.activeView === "adpView") {
    renderAdpLab();
    return;
  }
  if (state.activeView === "dynastyView") {
    calculateWar(state.rawProjections);
    renderDynastyWar();
    return;
  }
  if (state.activeView === "draftOptimizerView") {
    calculateWar(state.rawProjections);
    renderDraftOptimizer();
    return;
  }
  if (state.activeView === "historicalView") {
    renderHistoricalExplorer();
    return;
  }
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

function updateActiveView() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    const target = panel.id || panel.dataset.viewSection;
    panel.classList.toggle("active", target === state.activeView);
  });
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
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return Papa.parse(await response.text(), { header: true, skipEmptyLines: true }).data;
}

async function loadJsonMaybeGzip(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  if (path.endsWith(".gz")) {
    if (!("DecompressionStream" in window)) throw new Error("This browser cannot decompress data shards.");
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  return response.json();
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
    state.warManifest = await loadJson(WAR_DATA_MANIFEST_PATH);
  } catch {
    state.warManifest = null;
  }
  try {
    const currentProjectionPath = state.warManifest?.current_projections?.path || CURRENT_PROJECTIONS_PATH;
    const currentAdpPath = state.warManifest?.current_adp?.path || CURRENT_ADP_PATH;
    state.rawProjections = currentProjectionPath.endsWith(".json.gz") ? await loadJsonMaybeGzip(currentProjectionPath) : await loadCsv(currentProjectionPath);
    state.adpRows = currentAdpPath.endsWith(".json.gz") ? await loadJsonMaybeGzip(currentAdpPath) : await loadCsv(currentAdpPath);
    state.projectionSource = currentProjectionPath;
    state.adpSource = currentAdpPath;
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
  loadDynastyInputs();
}

async function loadDynastyInputs() {
  try {
    state.draftMetadataRows = await loadCsv(DRAFT_METADATA_PATH);
  } catch {
    state.draftMetadataRows = [];
  }
  try {
    state.trustedWarCurveRows = await loadCsv(TRUSTED_WAR_CURVE_PATH);
  } catch {
    state.trustedWarCurveRows = [];
  }
  try {
    if (!state.customAdpManifest) state.customAdpManifest = await loadJsonMaybeGzip(CUSTOM_ADP_MANIFEST_PATH);
    const shards = state.customAdpManifest?.shards || [];
    const wanted = shards.filter((shard) => Number(shard.season) === settings().year && shard.league_format === "dynasty");
    const frames = await Promise.all(wanted.map((shard) => loadJsonMaybeGzip(shard.path)));
    state.dynastyAdpRows = frames.flat();
  } catch {
    state.dynastyAdpRows = [];
  }
  scheduleRender(0);
}

async function loadHistoricalData() {
  try {
    const shards = state.warManifest?.historical_weekly?.shards || [];
    if (shards.length) {
      const frames = await Promise.all(shards.map((shard) => loadJsonMaybeGzip(shard.path)));
      state.historicalWeeklyRows = frames.flat();
    } else {
      state.historicalWeeklyRows = await loadCsv(HISTORICAL_WEEKLY_PATH);
    }
  } catch {
    state.historicalWeeklyRows = [];
  }
  try {
    const historicalAdpPath = state.warManifest?.historical_adp?.path || HISTORICAL_ADP_PATH;
    state.historicalAdpRows = historicalAdpPath.endsWith(".json.gz") ? await loadJsonMaybeGzip(historicalAdpPath) : await loadCsv(historicalAdpPath);
  } catch {
    state.historicalAdpRows = [];
  }
  state.historicalModelKey = "";
  state.historicalScoredRowsKey = "";
  setDataStatus(state.projectionSource, state.adpSource, state.manifest);
  scheduleRender(0);
}

async function loadCustomAdpData() {
  const season = number(el("adpSeason")?.value, settings().year);
  const format = el("adpLeagueFormat")?.value || "redraft";
  const loadKey = `${season}|${format}`;
  if (state.customAdpLoaded && state.customAdpLoadedKey === loadKey) return;
  try {
    if (!state.customAdpManifest) {
      state.customAdpManifest = await loadJsonMaybeGzip(CUSTOM_ADP_MANIFEST_PATH);
      populateAdpControls();
    }
    const shards = state.customAdpManifest?.shards || [];
    const wanted = shards.filter((shard) => Number(shard.season) === season && (format === "all" || shard.league_format === format));
    if (!wanted.length) throw new Error(`No ADP shard found for ${season} ${format}`);
    const frames = await Promise.all(wanted.map((shard) => loadJsonMaybeGzip(shard.path)));
    state.customAdpRows = frames.flat();
    state.customAdpLoadedKey = loadKey;
  } catch {
    try {
      state.customAdpRows = await loadCsv(CUSTOM_ADP_PATH);
      state.customAdpLoadedKey = "legacy-csv";
    } catch {
      state.customAdpRows = [];
      state.customAdpLoadedKey = "";
    }
  }
  state.customAdpLoaded = true;
  populateAdpControls();
  scheduleRender(0);
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

function setDataStatus(projectionSource, adpSource, manifest) {
  const updatedAt = manifest?.updated_at ? new Date(manifest.updated_at) : null;
  const updatedText = updatedAt && !Number.isNaN(updatedAt.valueOf()) ? updatedAt.toLocaleString() : "Not recorded";
  if (el("projectionSource")) {
    el("projectionSource").textContent = projectionSource === FALLBACK_PROJECTIONS_PATH
      ? "Fallback data"
      : manifest?.current_projections_stale
        ? `${updatedText} - projections stale`
        : updatedText;
  }
  if (el("adpSource")) {
    el("adpSource").textContent = adpSource === "Unavailable"
      ? "Unavailable"
      : manifest?.current_adp_stale
        ? `${updatedText} - ADP stale`
        : updatedText;
  }
  if (el("lastRefresh")) {
    const year = manifest?.season_year ? ` · ${manifest.season_year}` : "";
    const historical = state.historicalWeeklyRows.length ? " · historical loaded" : " · historical missing";
    el("lastRefresh").textContent = updatedAt && !Number.isNaN(updatedAt.valueOf())
      ? `${updatedAt.toLocaleString()}${year}${historical}`
      : `Not recorded${historical}`;
  }
}

function downloadCsv(filename, columns, rows) {
  if (!rows.length) return;
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((col) => JSON.stringify(row[col] ?? "")).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportHistoricalRankCurve() {
  const selected = el("historicalRankCurvePosition")?.value || "ALL";
  const positions = historicalRankCurvePositions();
  const cutoff = historicalRankCurveCutoff();
  const start = number(el("historicalPlotStart")?.value, 2015);
  const end = number(el("historicalPlotEnd")?.value, settings().year - 1);
  const rows = historicalRankCurveData().filter((row) => positions.includes(row.Pos) && row.Rank <= cutoff);
  const columns = ["Pos", "Rank", "WAR", "Flex WAR", "SuperFlex WAR", "FPTS/G", "Avg Games", "Player Seasons", "Seasons"];
  downloadCsv(`historical-rank-curve-${selected.toLowerCase()}-top-${cutoff}-${start}-${end}.csv`, columns, rows);
}

function historicalSeasonExportRows(season) {
  const rows = (state.historicalModel?.playerRows || [])
    .filter((row) => row.Year === season)
    .sort((a, b) => (["QB", "RB", "WR", "TE"].indexOf(a.Pos) - ["QB", "RB", "WR", "TE"].indexOf(b.Pos)) || a.Rank - b.Rank);
  const weekNumbers = Array.from({ length: weekLimit() }, (_, index) => index + 1);
  return rows.map((row) => {
    const weekMap = new Map((row.Weeks || []).map((week) => [week.Week, week]));
    const output = {
      Year: row.Year,
      Rank: row.Rank,
      Player: row.Player,
      Team: row.Team,
      Pos: row.Pos,
      FPTS: row.FPTS,
      "FPTS/G": row.AVG,
      Games: row.Games,
      WAR: row.WAR,
      "WAR/G": playedWarPerGame(row, "WAR"),
      "Flex WAR": row["Flex WAR"],
      "SuperFlex WAR": row["SuperFlex WAR"],
      "Played WAR": row["Played WAR"],
      "Played Flex WAR": row["Played Flex WAR"],
      "Played SuperFlex WAR": row["Played SuperFlex WAR"]
    };
    for (const week of weekNumbers) {
      const weekRow = weekMap.get(week);
      output[`W${week} FPTS`] = weekRow?.FPTS ?? "";
      output[`W${week} WAR`] = weekRow?.WAR ?? "";
      output[`W${week} Flex WAR`] = weekRow?.["Flex WAR"] ?? "";
      output[`W${week} SuperFlex WAR`] = weekRow?.["SuperFlex WAR"] ?? "";
    }
    return output;
  });
}

function exportHistoricalSeasonWar() {
  const season = number(el("historicalExportSeason")?.value, null);
  if (season === null) return;
  const weekColumns = Array.from({ length: weekLimit() }, (_, index) => {
    const week = index + 1;
    return [`W${week} FPTS`, `W${week} WAR`, `W${week} Flex WAR`, `W${week} SuperFlex WAR`];
  }).flat();
  const columns = ["Year", "Rank", "Player", "Team", "Pos", "FPTS", "FPTS/G", "Games", "WAR", "WAR/G", "Flex WAR", "SuperFlex WAR", "Played WAR", "Played Flex WAR", "Played SuperFlex WAR", ...weekColumns];
  downloadCsv(`historical-war-player-seasons-${season}.csv`, columns, historicalSeasonExportRows(season));
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
  ["teamsInput", "qbSlots", "rbSlots", "wrSlots", "teSlots", "flexSlots", "superflexSlots", "receptions", "tePremium", "receivingYds", "receivingTd", "rushingYds", "rushingTd", "passingYds", "passingTd", "interception", "fumbleLost"].forEach((id) => {
    el(id)?.addEventListener("change", () => {
      if (state.activeView === "adpView") {
        syncAdpFromWarSettings();
        scheduleRender(0);
      }
    });
  });
  el("adpLeagueFormat")?.addEventListener("change", () => {
    applyAdpFormatDefaults();
    syncAdpFromWarSettings();
    state.customAdpLoaded = false;
    scheduleRender(0);
  });
  el("adpSeason")?.addEventListener("change", () => {
    state.customAdpLoaded = false;
    updateAdpDateControlsForSeason(true);
    scheduleRender(0);
  });
  el("adpScoring")?.addEventListener("change", () => {
    applyAdpTwoQbHint();
    scheduleRender(0);
  });
  el("adpFilterToggle")?.addEventListener("click", openAdpFilters);
  el("adpFilterClose")?.addEventListener("click", closeAdpFilters);
  el("adpFilterApply")?.addEventListener("click", () => {
    closeAdpFilters();
    scheduleRender(0);
  });
  el("adpFilterReset")?.addEventListener("click", resetAdpFilters);
  el("adpFilterOverlay")?.addEventListener("click", (event) => {
    if (event.target === el("adpFilterOverlay")) closeAdpFilters();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el("adpFilterOverlay")?.hidden) closeAdpFilters();
  });
  document.querySelectorAll("input[name='posFilter']").forEach((input) => input.addEventListener("change", () => scheduleRender(0)));
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      if (state.activeView === "adpView") {
        applyAdpFormatDefaults();
        syncAdpFromWarSettings();
      }
      scheduleRender(0);
    });
  });
  el("rankCurveCard")?.addEventListener("click", (event) => {
    if (event.target.closest("select, button, input, label")) return;
    setProjectionFocus("rank");
  });
  el("projectionChart")?.addEventListener("click", () => {
    if (state.projectionFocus === "rank") setProjectionFocus("projection");
  });
  el("historicalPlayers")?.addEventListener("input", renderHistoricalPlayerSuggestions);
  el("historicalPlayerSuggestions")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-player-suggestion]");
    if (!button) return;
    applyHistoricalPlayerSuggestion(button.dataset.playerSuggestion);
  });
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
  document.querySelectorAll("th[data-adp-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.adpSort;
      if (state.adpSortKey === key) state.adpSortDir = state.adpSortDir === "asc" ? "desc" : "asc";
      else {
        state.adpSortKey = key;
        state.adpSortDir = key === "full_name" || key === "position" || key === "rookie_inclusion" ? "asc" : "desc";
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
  el("adpBody")?.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-adp-player]");
    if (!row) return;
    state.selectedAdpPlayer = state.selectedAdpPlayer === row.dataset.adpPlayer ? null : row.dataset.adpPlayer;
    scheduleRender(0);
  });
  el("dynastyWarBody")?.addEventListener("click", (event) => {
    if (event.target.closest(".dynasty-detail-row")) return;
    const row = event.target.closest("tr[data-dynasty-key]");
    if (!row) return;
    state.selectedDynastyKey = state.selectedDynastyKey === row.dataset.dynastyKey ? null : row.dataset.dynastyKey;
    scheduleRender(0);
  });
  el("adpLeaguePresets")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset-key]");
    if (!button) return;
    applyAdpLeaguePreset(button.dataset.presetKey);
  });
  el("exportResults").addEventListener("click", exportResults);
  el("exportAdpBoard")?.addEventListener("click", exportAdpBoard);
  el("exportDynastyWar")?.addEventListener("click", exportDynastyWar);
  el("exportHistoricalRankCurve")?.addEventListener("click", exportHistoricalRankCurve);
  el("exportHistoricalSeasonWar")?.addEventListener("click", exportHistoricalSeasonWar);
  el("dynastyWarHead")?.addEventListener("click", (event) => {
    const th = event.target.closest("th[data-dynasty-sort]");
    if (!th) return;
    const key = th.dataset.dynastySort;
    if (state.dynastySortKey === key) state.dynastySortDir = state.dynastySortDir === "asc" ? "desc" : "asc";
    else {
      state.dynastySortKey = key;
      state.dynastySortDir = key === "Player" || key === "Pos" ? "asc" : "desc";
    }
    scheduleRender(0);
  });
}

function initControls() {
  el("historyStart").innerHTML = Array.from({ length: 12 }, (_, i) => 2026 - i)
    .filter((year) => year >= 2015)
    .map((year) => `<option value="${year}" ${year === 2015 ? "selected" : ""}>${year}</option>`)
    .join("");
  const years = Array.from({ length: 12 }, (_, i) => 2026 - i).filter((year) => year >= 2015);
  if (el("historicalPlotStart")) {
    el("historicalPlotStart").innerHTML = years
      .map((year) => `<option value="${year}" ${year === 2015 ? "selected" : ""}>${year}</option>`)
      .join("");
  }
  if (el("historicalPlotEnd")) {
    el("historicalPlotEnd").innerHTML = years
      .map((year) => `<option value="${year}" ${year === 2025 ? "selected" : ""}>${year}</option>`)
      .join("");
  }
  if (el("historicalExportSeason")) {
    el("historicalExportSeason").innerHTML = years
      .map((year) => `<option value="${year}" ${year === 2025 ? "selected" : ""}>${year}</option>`)
      .join("");
  }
  populateEmptyAdpControls();
  updateActiveView();
}

function selectOptions(id, values, selected, allLabel = null) {
  const control = el(id);
  if (!control) return;
  const options = [];
  if (allLabel) options.push(`<option value="all">${allLabel}</option>`);
  options.push(...values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(value)}</option>`));
  control.innerHTML = options.join("");
}

function populateEmptyAdpControls() {
  updateAdpScoringOptions();
  selectOptions("adpSeason", [2026], 2026);
  if (el("adpStartDate")) el("adpStartDate").value = "";
  if (el("adpEndDate")) el("adpEndDate").value = "";
}

function populateAdpControls() {
  updateAdpScoringOptions();
  const manifestShards = state.customAdpManifest?.shards || [];
  const rows = state.customAdpRows;
  const seasons = uniqueSorted(manifestShards.length ? manifestShards.map((row) => row.season) : rows.map((row) => row.season), true);
  const currentYear = settings().year;
  const selectedSeason = el("adpSeason")?.value;
  const selected = seasons.includes(String(selectedSeason)) || seasons.includes(number(selectedSeason, null))
    ? selectedSeason
    : seasons.includes(String(currentYear)) || seasons.includes(currentYear)
      ? currentYear
      : seasons[seasons.length - 1] || currentYear;
  selectOptions("adpSeason", seasons.length ? seasons : [currentYear], selected);
  updateAdpDateControlsForSeason(true);
}

initControls();
bindEvents();
initData().catch((error) => {
  const body = el("playersBody");
  if (body) body.innerHTML = `<tr><td colspan="12"><p class="eyebrow">Load error</p><h2>Data could not load</h2><p class="muted">${error.message}</p></td></tr>`;
});
