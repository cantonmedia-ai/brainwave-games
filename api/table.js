const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

const validGame = (value) => /^[A-Z0-9-]{6,40}$/i.test(value || "");

const defaultTable = (game) => ({
  gameId: game,
  dinnerName: "Truth or Bluff Dinner",
  status: "lobby",
  locked: false,
  allowLateJoin: false,
  currentRoundId: "",
  nextPlayerNumber: 1,
  players: [],
  stories: {},
  rounds: [],
  votes: {},
  memoryPhoto: "",
  updatedAt: new Date().toISOString()
});

const normalizeTable = (table, game) => ({
  ...defaultTable(game),
  ...(table || {}),
  gameId: table?.gameId || game,
  allowLateJoin: Boolean(table?.allowLateJoin),
  players: Array.isArray(table?.players) ? table.players : [],
  stories: table?.stories && typeof table.stories === "object" ? table.stories : {},
  rounds: Array.isArray(table?.rounds) ? table.rounds : [],
  votes: table?.votes && typeof table.votes === "object" ? table.votes : {}
});

const mergeBy = (itemsA, itemsB, keyFn) => {
  const merged = new Map();
  for (const item of itemsA || []) merged.set(keyFn(item), item);
  for (const item of itemsB || []) merged.set(keyFn(item), { ...(merged.get(keyFn(item)) || {}), ...item });
  return [...merged.values()];
};

const statusRank = (status) => ({
  lobby: 0,
  drawing: 1,
  voting: 2,
  paused: 2,
  hold: 3,
  ended: 4
})[status] ?? 0;

const roundRank = (status) => ({
  voting: 1,
  revealed: 2,
  hold: 3,
  skipped: 3
})[status] ?? 0;

const normalizePlayerNumbers = (players) => {
  const sorted = [...players].sort((a, b) => {
    const aTime = Date.parse(a.joinedAt || a.createdAt || 0);
    const bTime = Date.parse(b.joinedAt || b.createdAt || 0);
    return aTime - bTime || String(a.id || a.phone).localeCompare(String(b.id || b.phone));
  });
  sorted.forEach((player, index) => {
    player.playerNumber = index + 1;
  });
  return sorted;
};

const mergeRounds = (existingRounds, incomingRounds) => mergeBy(existingRounds, incomingRounds, r => r.id)
  .map(round => {
    const existing = (existingRounds || []).find(item => item.id === round.id) || {};
    const incoming = (incomingRounds || []).find(item => item.id === round.id) || {};
    const status = roundRank(incoming.status) >= roundRank(existing.status) ? incoming.status : existing.status;
    return { ...existing, ...incoming, status };
  });

const mergeTables = (existingTable, incomingTable, game) => {
  const existing = normalizeTable(existingTable, game);
  const incoming = normalizeTable(incomingTable, game);
  const players = normalizePlayerNumbers(mergeBy(existing.players, incoming.players, p => p.id || p.phone));
  const rounds = mergeRounds(existing.rounds, incoming.rounds);
  const votes = { ...existing.votes };
  for (const [roundId, incomingVotes] of Object.entries(incoming.votes || {})) {
    votes[roundId] = mergeBy(votes[roundId] || [], incomingVotes || [], v => v.playerId || v.voterId || JSON.stringify(v));
  }
  const existingWinsStatus = statusRank(existing.status) > statusRank(incoming.status);
  return {
    ...existing,
    ...incoming,
    status: existingWinsStatus ? existing.status : incoming.status,
    currentRoundId: incoming.currentRoundId || existing.currentRoundId,
    nextPlayerNumber: Math.max(existing.nextPlayerNumber || 1, incoming.nextPlayerNumber || 1, players.length + 1),
    allowLateJoin: Boolean(existing.allowLateJoin || incoming.allowLateJoin),
    players,
    stories: { ...existing.stories, ...incoming.stories },
    rounds,
    votes,
    updatedAt: new Date().toISOString()
  };
};

module.exports = async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(res, 500, { error: "Supabase server env missing" });

  const game = String(req.query.game || "").trim();
  if (!validGame(game)) return json(res, 400, { error: "Invalid game id" });

  const id = `truth_or_bluff:${game}`;
  const base = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/app_settings`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  };

  try {
    if (req.method === "GET") {
      const response = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&select=id,settings,updated_at`, { headers });
      const text = await response.text();
      if (!response.ok) return json(res, response.status, { error: text });
      const rows = JSON.parse(text);
      return json(res, 200, { state: rows[0]?.settings || null, updated_at: rows[0]?.updated_at || null });
    }

    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!body.state || typeof body.state !== "object") return json(res, 400, { error: "Missing state" });
      const readExisting = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&select=id,settings,updated_at`, { headers });
      const existingText = await readExisting.text();
      if (!readExisting.ok) return json(res, readExisting.status, { error: existingText });
      const existingRows = JSON.parse(existingText);
      const mergedState = mergeTables(existingRows[0]?.settings || null, body.state, game);
      const response = await fetch(`${base}?on_conflict=id`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ id, settings: mergedState, training: {} })
      });
      const text = await response.text();
      if (!response.ok) return json(res, response.status, { error: text });
      return json(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, 500, { error: error.message || "Server error" });
  }
};
