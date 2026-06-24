const STORE_KEY = "truth-or-bluff-table-v1";
const SESSION_KEY = "truth-or-bluff-session";
const HOST_CODE = "2026";
const FOOTER = "© 2026 Brainwave Games · Powered by Brainwave";
const SUPABASE_CONFIG = window.TRUTH_OR_BLUFF_SUPABASE || {};
const IS_LOCAL_HOST = ["127.0.0.1", "localhost"].includes(location.hostname);
const DIRECT_SUPABASE_ENABLED = Boolean(
  SUPABASE_CONFIG.url &&
  SUPABASE_CONFIG.anonKey &&
  !SUPABASE_CONFIG.url.includes("PASTE_") &&
  !SUPABASE_CONFIG.anonKey.includes("PASTE_") &&
  !IS_LOCAL_HOST
);
const API_REMOTE_ENABLED = location.protocol.startsWith("http") && !IS_LOCAL_HOST;
const REMOTE_ENABLED = API_REMOTE_ENABLED || DIRECT_SUPABASE_ENABLED;
const REMOTE_TABLE_ID = SUPABASE_CONFIG.tableId || "brainwave-main-table";
const REMOTE_POLL_MS = SUPABASE_CONFIG.pollMs || 1500;

const app = document.getElementById("app");
const channel = "BroadcastChannel" in window ? new BroadcastChannel("truth-or-bluff") : null;
const initialSession = loadSession();
const initialGameId = urlGameId() || initialSession.gameId || "";
let activeGameId = initialGameId;

const state = {
  mode: routeMode(),
  session: initialSession,
  gameId: initialGameId,
  table: loadTable(initialGameId),
  joinStep: "phone",
  phoneInput: "",
  nicknameInput: "",
  hostCodeInput: "",
  storyStep: 0,
  draftStories: ["", "", ""],
  draftBluff: "",
  confirmVote: "",
  showHostPanel: false,
  memoryPhoto: "",
  remoteReady: false,
  remoteStatus: REMOTE_ENABLED ? "Connecting to Supabase" : "Local mode"
};

function defaultTable() {
  const gameId = currentGameId() || "";
  return {
    gameId,
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
  };
}

function urlGameId() {
  return new URLSearchParams(location.search).get("game")?.trim() || "";
}

function currentGameId() {
  return activeGameId || "";
}

function currentStoreKey(gameId = currentGameId()) {
  return gameId ? `${STORE_KEY}:${gameId}` : STORE_KEY;
}

function currentRemoteTableId() {
  return currentGameId() || REMOTE_TABLE_ID;
}

function routeMode() {
  const path = location.pathname.toLowerCase();
  const hash = location.hash.toLowerCase();
  if (path.includes("/host") || hash.includes("host")) return "host";
  if (path.includes("/display") || hash.includes("display")) return "display";
  if (path.includes("/memory") || hash.includes("memory")) return "memory";
  return "player";
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSession() {
  state.session.gameId = currentGameId();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
}

function loadTable(gameId = currentGameId()) {
  try {
    return JSON.parse(localStorage.getItem(currentStoreKey(gameId))) || defaultTable();
  } catch {
    return defaultTable();
  }
}

function saveTable(quiet = false) {
  state.table.updatedAt = new Date().toISOString();
  state.table.gameId = currentGameId();
  localStorage.setItem(currentStoreKey(), JSON.stringify(state.table));
  if (REMOTE_ENABLED) pushRemoteTable();
  if (!quiet) channel?.postMessage({ type: "sync" });
}

function supabaseHeaders(prefer) {
  const headers = {
    apikey: SUPABASE_CONFIG.anonKey,
    Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
    "Content-Type": "application/json"
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function supabaseUrl(query = "") {
  return `${SUPABASE_CONFIG.url.replace(/\/$/, "")}/rest/v1/truth_or_bluff_tables${query}`;
}

async function fetchRemoteTable() {
  if (!REMOTE_ENABLED) return null;
  if (API_REMOTE_ENABLED) {
    const response = await fetch(`/api/table?game=${encodeURIComponent(currentRemoteTableId())}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`API read failed: ${response.status}`);
    const data = await response.json();
    return data.state ? { state: data.state, updated_at: data.updated_at } : null;
  }
  const response = await fetch(supabaseUrl(`?table_id=eq.${encodeURIComponent(currentRemoteTableId())}&select=state,updated_at`), {
    headers: supabaseHeaders()
  });
  if (!response.ok) throw new Error(`Supabase read failed: ${response.status}`);
  const rows = await response.json();
  return rows[0] || null;
}

let remoteWriteInFlight = false;
let remoteWriteQueued = false;
let remoteSyncTimer = null;

async function pushRemoteTable() {
  if (remoteWriteInFlight) {
    remoteWriteQueued = true;
    return;
  }
  remoteWriteInFlight = true;
  try {
    let outgoingTable = JSON.parse(JSON.stringify(state.table));
    const remoteRow = await fetchRemoteTable().catch(() => null);
    if (remoteRow?.state) {
      state.table = mergeTables(normalizeTable(remoteRow.state), normalizeTable(outgoingTable));
      state.table.updatedAt = new Date().toISOString();
      localStorage.setItem(currentStoreKey(), JSON.stringify(state.table));
      outgoingTable = JSON.parse(JSON.stringify(state.table));
    }
    if (API_REMOTE_ENABLED) {
      const response = await fetch(`/api/table?game=${encodeURIComponent(currentRemoteTableId())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: outgoingTable })
      });
      if (!response.ok) throw new Error(`API write failed: ${response.status}`);
      state.remoteStatus = "Online";
      state.remoteReady = true;
      return;
    }
    const body = JSON.stringify({
      table_id: currentRemoteTableId(),
      state: outgoingTable,
      updated_at: new Date().toISOString()
    });
    const response = await fetch(supabaseUrl("?on_conflict=table_id"), {
      method: "POST",
      headers: supabaseHeaders("resolution=merge-duplicates"),
      body
    });
    if (!response.ok) throw new Error(`Supabase write failed: ${response.status}`);
    state.remoteStatus = "Online";
    state.remoteReady = true;
  } catch (error) {
    state.remoteStatus = "Supabase write failed. Using local fallback.";
    console.warn(error);
  } finally {
    remoteWriteInFlight = false;
    if (remoteWriteQueued) {
      remoteWriteQueued = false;
      pushRemoteTable();
    }
  }
}

async function waitForRemoteIdle(timeoutMs = 8000) {
  if (!REMOTE_ENABLED) return;
  const deadline = Date.now() + timeoutMs;
  while ((remoteWriteInFlight || remoteWriteQueued) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 120));
  }
}

async function pullRemoteTable({ initial = false } = {}) {
  if (!REMOTE_ENABLED) return;
  if (remoteWriteInFlight) return;
  try {
    const row = await fetchRemoteTable();
    if (!row) {
      await pushRemoteTable();
      return;
    }
    const remoteState = row.state;
    const remoteTime = Date.parse(remoteState?.updatedAt || row.updated_at || 0);
    const localTime = Date.parse(state.table?.updatedAt || 0);
    if (initial || remoteTime > localTime) {
      state.table = normalizeTable(remoteState);
      localStorage.setItem(currentStoreKey(), JSON.stringify(state.table));
      channel?.postMessage({ type: "sync" });
      render();
    }
    state.remoteReady = true;
    state.remoteStatus = "Online";
  } catch (error) {
    state.remoteStatus = "Supabase unavailable. Using local fallback.";
    console.warn(error);
  }
}

function normalizeTable(table) {
  return {
    ...defaultTable(),
    ...(table || {}),
    gameId: table?.gameId || currentGameId(),
    allowLateJoin: Boolean(table?.allowLateJoin),
    players: Array.isArray(table?.players) ? table.players : [],
    stories: table?.stories && typeof table.stories === "object" ? table.stories : {},
    rounds: Array.isArray(table?.rounds) ? table.rounds : [],
    votes: table?.votes && typeof table.votes === "object" ? table.votes : {}
  };
}

function mergeBy(itemsA, itemsB, keyFn) {
  const merged = new Map();
  for (const item of itemsA || []) merged.set(keyFn(item), item);
  for (const item of itemsB || []) merged.set(keyFn(item), { ...(merged.get(keyFn(item)) || {}), ...item });
  return [...merged.values()];
}

function statusRank(status) {
  return ({ lobby: 0, drawing: 1, voting: 2, paused: 2, hold: 3, ended: 4 })[status] ?? 0;
}

function roundRank(status) {
  return ({ voting: 1, revealed: 2, hold: 3, skipped: 3 })[status] ?? 0;
}

function normalizePlayerNumbers(players) {
  return [...players].sort((a, b) => {
    const aTime = Date.parse(a.joinedAt || a.createdAt || 0);
    const bTime = Date.parse(b.joinedAt || b.createdAt || 0);
    return aTime - bTime || String(a.id || a.phone).localeCompare(String(b.id || b.phone));
  }).map((p, index) => ({ ...p, playerNumber: index + 1 }));
}

function mergeRounds(remoteRounds, localRounds) {
  return mergeBy(remoteRounds, localRounds, r => r.id).map(round => {
    const remote = (remoteRounds || []).find(item => item.id === round.id) || {};
    const local = (localRounds || []).find(item => item.id === round.id) || {};
    const status = roundRank(local.status) >= roundRank(remote.status) ? local.status : remote.status;
    return { ...remote, ...local, status };
  });
}

function mergeTables(remoteTable, localTable) {
  const remote = normalizeTable(remoteTable);
  const local = normalizeTable(localTable);
  const players = normalizePlayerNumbers(mergeBy(remote.players, local.players, p => p.id || p.phone));
  const rounds = mergeRounds(remote.rounds, local.rounds);
  const votes = { ...remote.votes };
  for (const [roundId, localVotes] of Object.entries(local.votes || {})) {
    votes[roundId] = mergeBy(votes[roundId] || [], localVotes || [], v => v.playerId || v.voterId || JSON.stringify(v));
  }
  const remoteWinsStatus = statusRank(remote.status) > statusRank(local.status);
  return {
    ...remote,
    ...local,
    status: remoteWinsStatus ? remote.status : local.status,
    currentRoundId: local.currentRoundId || remote.currentRoundId,
    nextPlayerNumber: Math.max(remote.nextPlayerNumber || 1, local.nextPlayerNumber || 1, players.length + 1),
    allowLateJoin: Boolean(remote.allowLateJoin || local.allowLateJoin),
    players,
    stories: { ...remote.stories, ...local.stories },
    rounds,
    votes
  };
}

function initRemoteSync() {
  if (!REMOTE_ENABLED || !currentGameId()) return;
  if (remoteSyncTimer) return;
  pullRemoteTable({ initial: true });
  remoteSyncTimer = setInterval(() => pullRemoteTable(), REMOTE_POLL_MS);
}

window.addEventListener("storage", event => {
  if (event.key === currentStoreKey()) {
    state.table = loadTable();
    render();
  }
});

channel?.addEventListener("message", () => {
  state.table = loadTable();
  render();
});

function player() {
  return state.table.players.find(p => p.id === state.session.playerId);
}

function currentRound() {
  return state.table.rounds.find(r => r.id === state.table.currentRoundId);
}

function storyFor(playerId) {
  return state.table.stories[playerId];
}

function votesFor(roundId) {
  return state.table.votes[roundId] || [];
}

function eligiblePlayers() {
  return state.table.players.filter(p => storyFor(p.id)?.isSubmitted && p.status !== "skipped");
}

function readyPlayers() {
  return state.table.players.filter(p => storyFor(p.id)?.isSubmitted);
}

function maskPhone(phone) {
  const clean = String(phone || "");
  if (clean.length <= 6) return clean.replace(/\d(?=\d{2})/g, "*");
  return `${clean.slice(0, 3)}****${clean.slice(-3)}`;
}

function setMode(mode) {
  state.mode = mode;
  const path = mode === "player" ? "/bluffgame" : `/bluffgame/${mode}`;
  const query = currentGameId() ? `?game=${encodeURIComponent(currentGameId())}` : "";
  history.replaceState(null, "", `${path}${query}`);
  render();
}

function layout(content, opts = {}) {
  const modeClass = opts.display ? "display-shell" : "phone-shell";
  return `
    <section class="${modeClass}">
      ${content}
      <footer>${FOOTER}</footer>
    </section>
  `;
}

function nav() {
  if (state.mode === "player") {
    return `
      <div class="player-topbar">
        <b>Truth or Bluff</b>
        <span>${state.remoteStatus}</span>
      </div>
    `;
  }
  return `
    <div class="mode-nav">
      <button class="${state.mode === "player" ? "active" : ""}" onclick="setMode('player')">Player</button>
      <button class="${state.mode === "host" ? "active" : ""}" onclick="setMode('host')">Host</button>
      <button class="${state.mode === "display" ? "active" : ""}" onclick="setMode('display')">Display</button>
      <button class="${state.mode === "memory" ? "active" : ""}" onclick="setMode('memory')">Memory</button>
    </div>
    <div class="sync-status ${REMOTE_ENABLED ? "online" : "local"}">${state.remoteStatus}</div>
  `;
}

function brandBlock(extra = "") {
  return `
    <div class="brand-block ${extra}">
      <div class="eyebrow">Brainwave Games</div>
      <h1>Truth or Bluff</h1>
      <p>Tell your story. Hide one lie. Let the table decide.</p>
      <p class="cn">说出你的故事，藏起一个假话，让全桌来猜。</p>
    </div>
  `;
}

function routeBase() {
  return `${location.origin}/bluffgame`;
}

function gameUrl(path = "") {
  const suffix = path ? `/${path}` : "";
  return `${routeBase()}${suffix}?game=${encodeURIComponent(currentGameId())}`;
}

function qrUrl(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=12&data=${encodeURIComponent(url)}`;
}

function setGameId(gameId, replaceUrl = true, startSync = true) {
  activeGameId = gameId;
  state.gameId = gameId;
  state.session.gameId = gameId;
  saveSession();
  state.table = loadTable(gameId);
  if (replaceUrl) {
    const modePath = state.mode === "player" ? "" : `/${state.mode}`;
    history.replaceState(null, "", `/bluffgame${modePath}?game=${encodeURIComponent(gameId)}`);
  }
  if (startSync) initRemoteSync();
}

function createGameId() {
  const short = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BG-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${short}`;
}

function noGameView(isHost = false) {
  return layout(`
    ${nav()}
    ${brandBlock()}
    <section class="card center">
      <h2>${isHost ? "Create a dinner game" : "Scan the host QR code"}</h2>
      <p>${isHost ? "Host creates the game first, then players join with the QR link." : "Ask the host for the QR code or join link to enter this table."}</p>
      ${isHost ? `<button class="primary" onclick="showHostCreateLogin()">Host Login / Create Game</button>` : `<button class="secondary" onclick="setMode('host')">I am the host</button>`}
    </section>
  `);
}

function showHostCreateLogin() {
  state.session.hostCreateMode = true;
  saveSession();
  render();
}

function playerView() {
  if (!currentGameId()) return noGameView(false);
  const p = player();
  if (!p) return joinView(false);
  markOnline(p.id);
  if (!storyFor(p.id)?.isSubmitted) return storyFlow(p);
  return activePlayerGame(p);
}

function joinView(isHost) {
  if (!isHost && !currentGameId()) return noGameView(false);
  return layout(`
    ${nav()}
    ${brandBlock()}
    <section class="card join-card">
      <div class="section-title">${isHost ? (currentGameId() ? "Host Login" : "Create New Game") : "Join Table"}</div>
      ${isHost ? `<label>Host Code<input class="input" value="${esc(state.hostCodeInput)}" oninput="state.hostCodeInput=this.value" placeholder="2026"></label>` : ""}
      <label>Phone Number<input class="input" value="${esc(state.phoneInput)}" oninput="state.phoneInput=this.value" inputmode="tel" placeholder="Used only for rejoin"></label>
      <label>Nickname<input class="input" value="${esc(state.nicknameInput)}" oninput="state.nicknameInput=this.value" placeholder="Your dinner name"></label>
      <button class="primary" onclick="${isHost ? "hostLogin()" : "joinPlayer(false)"}">${isHost ? (currentGameId() ? "Enter Host + Player" : "Create New Game") : "Join Game"}</button>
      <p class="hint">Rejoin anytime with the same phone number. Public screens never show phone numbers.</p>
    </section>
  `);
}

async function joinPlayer(isHost, { skipInitialPull = false } = {}) {
  if (!currentGameId()) return toast("Host must create a game first.");
  if (REMOTE_ENABLED && !skipInitialPull) await pullRemoteTable({ initial: true });
  const phone = state.phoneInput.trim();
  const nickname = state.nicknameInput.trim();
  if (!phone) return toast("Enter phone number.");
  if (!nickname) return toast("Enter nickname.");
  if (state.table.locked && !state.table.allowLateJoin && !state.table.players.some(p => p.phone === phone)) return toast("Game is locked. Ask host to allow late join.");
  const existing = state.table.players.find(p => p.phone === phone);
  if (existing) {
    existing.isOnline = true;
    if (state.table.status === "lobby") {
      existing.status = storyFor(existing.id)?.isSubmitted ? "story_submitted" : "writing_story";
    }
    if (isHost) existing.isHost = true;
    state.session.playerId = existing.id;
    saveSession();
    saveTable();
    await waitForRemoteIdle();
    toast(`Welcome back, ${existing.nickname}.`);
    state.phoneInput = "";
    state.nicknameInput = "";
    render();
    return existing;
  }
  const duplicateName = state.table.players.some(p => p.nickname.toLowerCase() === nickname.toLowerCase());
  if (duplicateName) return toast("This name is already used. Please add an initial or number.");
  const id = uid();
  const newPlayer = {
    id,
    phone,
    nickname,
    playerNumber: state.table.nextPlayerNumber++,
    isHost,
    isOnline: true,
    status: "writing_story",
    scoreTotal: 0,
    storytellerScore: 0,
    detectiveScore: 0,
    correctGuesses: 0,
    fooledCount: 0,
    suspiciousCount: 0,
    joinedAt: new Date().toISOString()
  };
  state.table.players.push(newPlayer);
  state.session.playerId = id;
  saveSession();
  saveTable();
  await waitForRemoteIdle();
  state.phoneInput = "";
  state.nicknameInput = "";
  render();
  return newPlayer;
}

async function hostLogin() {
  if (state.hostCodeInput.trim() !== HOST_CODE) return toast("Wrong host code.");
  let createdNewGame = false;
  if (!currentGameId()) {
    const phone = state.phoneInput.trim();
    const nickname = state.nicknameInput.trim();
    if (!phone) return toast("Enter phone number.");
    if (!nickname) return toast("Enter nickname.");
    const gameId = createGameId();
    setGameId(gameId, true, false);
    state.table = defaultTable();
    state.table.gameId = gameId;
    state.table.dinnerName = `Truth or Bluff Dinner ${gameId}`;
    localStorage.setItem(currentStoreKey(), JSON.stringify(state.table));
    createdNewGame = true;
  }
  const p = await joinPlayer(true, { skipInitialPull: createdNewGame });
  if (p) {
    initRemoteSync();
    state.mode = "host";
    state.showHostPanel = true;
    render();
  }
}

function storyFlow(p) {
  const submitted = storyFor(p.id);
  if (submitted?.isSubmitted) return activePlayerGame(p);
  const step = state.storyStep;
  const body = step === 0 ? `
    <section class="card center">
      <h2>Share 3 short stories.</h2>
      <p>2 are true. 1 is a bluff.</p>
      <button class="primary" onclick="state.storyStep=1;render()">Start Writing</button>
    </section>
  ` : step <= 3 ? `
    <section class="card">
      <div class="section-title">Story ${step} / 3</div>
      <textarea class="textarea" maxlength="240" oninput="state.draftStories[${step - 1}]=this.value" placeholder="Keep it short, clear, and dinner-safe.">${esc(state.draftStories[step - 1])}</textarea>
      <div class="button-row">
        <button class="secondary" onclick="backStory()">Back</button>
        <button class="primary" onclick="nextStory()">Next</button>
      </div>
      <button class="text-btn" onclick="polishStory(${step - 1})">Polish story</button>
      <p class="hint">Avoid sexual, political, religious attack, racism, income, medical trauma, heavy trauma, or direct insults.</p>
    </section>
  ` : `
    <section class="card">
      <div class="section-title">Choose the bluff</div>
      ${["A", "B", "C"].map((key, i) => `
        <button class="story-choice ${state.draftBluff === key ? "selected" : ""}" onclick="state.draftBluff='${key}';render()">
          <b>${key} is the bluff</b><span>${esc(state.draftStories[i])}</span>
        </button>
      `).join("")}
      <div class="button-row">
        <button class="secondary" onclick="state.storyStep=3;render()">Back</button>
        <button class="primary" onclick="submitStories()">Submit</button>
      </div>
    </section>
  `;
  return layout(`
    ${nav()}
    <header class="mini-head"><b>Truth or Bluff</b><span>${esc(p.nickname)} · ${p.isHost ? "Host" : "Player"}</span></header>
    ${currentGameInfo(false)}
    ${body}
    ${deviceControls(p)}
  `);
}

function nextStory() {
  const text = state.draftStories[state.storyStep - 1].trim();
  if (!text) return toast("Story cannot be empty.");
  const warning = unsafeReason(text);
  if (warning) return toast(`Please choose a safer story: ${warning}`);
  state.storyStep += 1;
  render();
}

function backStory() {
  state.storyStep = Math.max(0, state.storyStep - 1);
  render();
}

function polishStory(index) {
  const text = state.draftStories[index].trim();
  if (!text) return toast("Write a story first.");
  state.draftStories[index] = text.replace(/\s+/g, " ").replace(/[。.!]?$/, ".");
  toast("Story polished.");
  render();
}

async function submitStories() {
  if (state.draftStories.some(s => !s.trim())) return toast("All 3 stories are required.");
  for (const s of state.draftStories) {
    const warning = unsafeReason(s);
    if (warning) return toast(`Please choose safer content: ${warning}`);
  }
  if (!state.draftBluff) return toast("Choose which story is the bluff.");
  const p = player();
  state.table.stories[p.id] = {
    playerId: p.id,
    storyA: state.draftStories[0].trim(),
    storyB: state.draftStories[1].trim(),
    storyC: state.draftStories[2].trim(),
    bluffKey: state.draftBluff,
    isSubmitted: true,
    createdAt: new Date().toISOString()
  };
  p.status = "story_submitted";
  saveTable();
  await waitForRemoteIdle();
  toast("You are ready. Waiting for host to start.");
  render();
}

function activePlayerGame(p) {
  if (state.table.status === "lobby") return lobbyView(p);
  if (state.table.status === "ended") return endView(p);
  const round = currentRound();
  if (!round) return lobbyView(p);
  const storyteller = state.table.players.find(x => x.id === round.storytellerId);
  const story = storyFor(round.storytellerId);
  const votes = votesFor(round.id);
  const ownVote = votes.find(v => v.voterId === p.id);
  const isStoryteller = p.id === round.storytellerId;
  if (isStoryteller) {
    return layout(`
      ${nav()}
      <section class="card center">
        <div class="pill">Your Turn</div>
        <h2>Keep your bluff secret.</h2>
        <p>Everyone is voting on your stories.</p>
        <div class="vote-progress">${votes.length} / ${eligibleVoteCount(round)} voted</div>
      </section>
      ${leaderboardCompact()}
      ${deviceControls(p)}
    `);
  }
  if (round.status === "voting" && !ownVote) {
    return layout(`
      ${nav()}
      <section class="card">
        <div class="section-title">Which story is ${esc(storyteller.nickname)}’s bluff?</div>
        ${storyCards(story, false)}
        <div class="vote-buttons">
          ${["A", "B", "C"].map(k => `<button class="vote-btn" onclick="askVote('${k}')">${k}</button>`).join("")}
        </div>
      </section>
      ${voteConfirmModal()}
      ${deviceControls(p)}
    `);
  }
  if (round.status === "voting") {
    return layout(`
      ${nav()}
      <section class="card center">
        <h2>Answer submitted.</h2>
        <p>Waiting for others.</p>
        <div class="vote-progress">${votes.length} / ${eligibleVoteCount(round)} voted</div>
      </section>
      ${deviceControls(p)}
    `);
  }
  return layout(`
    ${nav()}
    ${revealCard(round, story, votes)}
    ${leaderboardCompact()}
    ${deviceControls(p)}
  `);
}

function lobbyView(p) {
  return layout(`
    ${nav()}
    ${lobbyContent(p)}
  `);
}

function lobbyContent(p, { includeHostControls = true, includeGameInfo = true } = {}) {
  return `
    ${brandBlock("compact")}
    ${includeGameInfo ? currentGameInfo(p.isHost) : ""}
    ${p.isHost && !storyFor(p.id)?.isSubmitted ? hostStoryPrepCard() : ""}
    <section class="card">
      <div class="section-title">Lobby</div>
      ${playerList()}
      <p class="hint">You are ready. Waiting for host to start.</p>
    </section>
    ${deviceControls(p)}
    ${p.isHost && includeHostControls ? hostControls() : ""}
  `;
}

function hostStoryPrepCard() {
  return `
    <section class="card host-player-card">
      <div class="section-title">Host Player Setup</div>
      <p>You are the host and also a player. Write your 3 stories before starting if you want to join the rounds.</p>
      <button class="primary" onclick="setMode('player')">Write My Stories</button>
    </section>
  `;
}

function currentGameInfo(showQr = false) {
  if (!currentGameId()) return "";
  const join = gameUrl();
  const display = gameUrl("display");
  return `
    <section class="card game-info">
      <div class="section-title">Current Game</div>
      <div class="player-row"><span>Game ID</span><b>${esc(currentGameId())}</b></div>
      <label>Join Link<input class="input" readonly value="${esc(join)}" onclick="this.select()"></label>
      ${showQr ? `
        <div class="qr-wrap">
          <img src="${qrUrl(join)}" alt="Join QR code">
          <div>
            <button class="secondary" onclick="copyText('${escAttr(join)}')">Copy Join Link</button>
            <button class="secondary" onclick="copyText('${escAttr(display)}')">Copy Display Link</button>
          </div>
        </div>
      ` : ""}
    </section>
  `;
}

function deviceControls(p) {
  return `
    <section class="card">
      <div class="section-title">This Device</div>
      <div class="button-row">
        <button class="secondary" onclick="leaveDevice()">Leave this device</button>
        <button class="secondary" onclick="switchRejoin()">Switch / Rejoin</button>
      </div>
      <button class="text-btn" onclick="joinAnotherGame()">Join another game</button>
      <p class="hint">Leaving this device does not remove ${esc(p.nickname)} from the game. Rejoin with the same phone number.</p>
    </section>
  `;
}

function playerList() {
  return `
    <div class="player-list">
      ${state.table.players.map(p => {
        const ready = storyFor(p.id)?.isSubmitted;
        const icon = ready ? "✅" : p.isOnline ? "⏳" : "🔴";
        const label = ready ? "Ready" : p.isOnline ? "Writing" : "Offline";
        return `<div class="player-row"><span>${esc(p.nickname)} ${p.isHost ? "👑" : ""}</span><b>${icon} ${label}</b></div>`;
      }).join("") || `<p class="hint">No players yet.</p>`}
    </div>
  `;
}

function hostView() {
  const p = player();
  if (!p?.isHost) return joinView(true);
  markOnline(p.id);
  const round = currentRound();
  const hostIsStoryteller = round?.status === "voting" && round.storytellerId === p.id;
  const body = state.table.status === "lobby"
    ? lobbyContent(p, { includeHostControls: false, includeGameInfo: false })
    : hostRoundContent(p);
  return layout(`
    ${nav()}
    <header class="mini-head"><b>Host Panel</b><span>${esc(p.nickname)} 👑 Host</span></header>
    ${body}
    ${hostIsStoryteller ? "" : hostControls()}
  `);
}

function hostRoundContent(p) {
  const round = currentRound();
  if (state.table.status === "ended") return hostEndContent();
  if (!round) return lobbyContent(p, { includeHostControls: false });
  const story = storyFor(round.storytellerId);
  const votes = votesFor(round.id);
  const isStoryteller = p.id === round.storytellerId;
  if (isStoryteller && round.status === "voting") {
    return `
      <section class="card center">
        <div class="pill">Your Turn</div>
        <h2>Keep your bluff secret.</h2>
        <p>Everyone is voting on your stories.</p>
        <div class="vote-progress">${votes.length} / ${eligibleVoteCount(round)} voted</div>
      </section>
      <section class="card host-safety">
        <div class="section-title">Host Safety Controls</div>
        <p class="hint">Visible only because you are the host. Use these if the table needs help moving on.</p>
        <div class="button-row">
          <button class="secondary" onclick="pauseGame()">Pause</button>
          <button class="primary" onclick="revealRound()">Reveal</button>
        </div>
        <button class="text-btn danger" onclick="endGame()">End Game</button>
      </section>
      ${leaderboardCompact()}
      ${deviceControls(p)}
    `;
  }
  if (round.status === "voting") {
    return `
      <section class="card center">
        <h2>Voting in progress</h2>
        <p>Host controls are available below.</p>
        <div class="vote-progress">${votes.length} / ${eligibleVoteCount(round)} voted</div>
      </section>
      ${leaderboardCompact()}
      ${deviceControls(p)}
    `;
  }
  return `
    ${revealCard(round, story, votes)}
    ${leaderboardCompact()}
    ${deviceControls(p)}
  `;
}

function hostEndContent() {
  return `
    ${displayAwards()}
    <section class="card center">
      <div class="section-title">Dinner Wrapped</div>
      <p>Open the Memory Page to upload the group photo, copy the recap, and share the final awards.</p>
      <button class="primary" onclick="setMode('memory')">Open Memory Page</button>
    </section>
  `;
}

function hostControls() {
  const round = currentRound();
  return `
    <section class="card host-panel">
      <div class="section-title">Host Controls</div>
      ${currentGameInfo(true)}
      <div class="player-row">
        <span>Allow late join</span>
        <button class="toggle ${state.table.allowLateJoin ? "on" : ""}" onclick="toggleLateJoin()">${state.table.allowLateJoin ? "On" : "Off"}</button>
      </div>
      <div class="host-grid">
        <button onclick="createNewGame()">Create New Game</button>
        <button onclick="startGame()">Start Game</button>
        <button onclick="pauseGame()">Pause</button>
        <button onclick="continueGame()">Continue</button>
        <button onclick="callNextPlayer()">Next Player</button>
        <button onclick="randomRedraw()">Random Redraw</button>
        <button onclick="skipCurrent()">Skip Player</button>
        <button onclick="revealRound()">Reveal</button>
        <button onclick="endGame()">End Game</button>
        <button onclick="addDemoPlayers()">Add Demo Players</button>
        <button onclick="autoFillDemoStories()">Auto-fill Stories</button>
        <button onclick="simulateVotes()">Simulate Votes</button>
        <button onclick="clearVotes()">Clear Votes</button>
        <button onclick="resetGame()">Reset Game</button>
      </div>
      <div class="button-row">
        <button class="secondary" onclick="exitHostView()">Exit host view</button>
        <button class="secondary" onclick="setMode('player')">Rejoin as player</button>
      </div>
      <div class="manage-list">
        ${state.table.players.map(p => `<div class="player-row"><span>Player ${p.playerNumber} - ${esc(p.nickname)} ${p.isHost ? "👑" : ""}<br><small>${maskPhone(p.phone)}</small></span><b>${p.status}</b></div>`).join("")}
      </div>
      ${round ? `<p class="hint">Current round: ${round.status}</p>` : ""}
    </section>
  `;
}

async function createNewGame() {
  const host = player();
  const hostIdentity = host ? { phone: host.phone, nickname: host.nickname } : {
    phone: state.phoneInput.trim(),
    nickname: state.nicknameInput.trim()
  };
  if (!hostIdentity.phone || !hostIdentity.nickname) return toast("Host phone and nickname are required.");
  const gameId = createGameId();
  setGameId(gameId, true, false);
  state.table = defaultTable();
  state.table.gameId = gameId;
  state.table.dinnerName = `Truth or Bluff Dinner ${gameId}`;
  localStorage.setItem(currentStoreKey(), JSON.stringify(state.table));
  state.phoneInput = hostIdentity.phone;
  state.nicknameInput = hostIdentity.nickname;
  await joinPlayer(true, { skipInitialPull: true });
  saveTable();
  initRemoteSync();
  toast("New game created. Share the QR code.");
}

function toggleLateJoin() {
  state.table.allowLateJoin = !state.table.allowLateJoin;
  saveTable();
  render();
}

function leaveDevice() {
  const p = player();
  if (p) p.isOnline = false;
  state.session.playerId = "";
  saveSession();
  saveTable(true);
  toast("This device left the game. Rejoin with the same phone number.");
  render();
}

function switchRejoin() {
  state.session.playerId = "";
  state.phoneInput = "";
  state.nicknameInput = "";
  saveSession();
  render();
}

function joinAnotherGame() {
  const gameId = prompt("Enter Game ID from host QR/link:");
  if (!gameId) return;
  setGameId(gameId.trim().toUpperCase());
  state.session.playerId = "";
  saveSession();
  pullRemoteTable({ initial: true });
  render();
}

function exitHostView() {
  state.mode = "player";
  history.replaceState(null, "", `/bluffgame?game=${encodeURIComponent(currentGameId())}`);
  render();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied.");
  } catch {
    toast("Copy failed. Long press the link to copy.");
  }
}

function displayView() {
  if (!currentGameId()) {
    return layout(`
      <div class="display-top"><b>Truth or Bluff</b><span>No game selected</span></div>
      <section class="display-card">
        <h2>Open display from the host dashboard</h2>
        <p>Display URL must include a game id.</p>
      </section>
    `, { display: true });
  }
  const round = currentRound();
  let main = "";
  if (state.table.status === "lobby") {
    main = `
      ${brandBlock()}
      <section class="display-card">
        <h2>Lobby</h2>
        ${playerList()}
        <p>${readyPlayers().length} ready / ${state.table.players.length} joined</p>
      </section>
    `;
  } else if (state.table.status === "ended") {
    main = displayAwards();
  } else if (round) {
    const storyteller = state.table.players.find(p => p.id === round.storytellerId);
    const story = storyFor(round.storytellerId);
    const votes = votesFor(round.id);
    main = `
      <section class="display-hero">
        <div class="eyebrow">Current Storyteller</div>
        <h1>${esc(storyteller.nickname)}</h1>
        <p>${round.status === "revealed" || round.status === "hold" ? "Reveal Result" : "Which story is the bluff?"}</p>
      </section>
      <section class="display-grid">
        ${storyCards(story, round.status === "revealed" || round.status === "hold")}
      </section>
      <section class="display-card">
        ${round.status === "revealed" || round.status === "hold" ? revealStats(round, story, votes) : `<h2>Voting Progress</h2><div class="vote-progress">${votes.length} / ${eligibleVoteCount(round)} voted</div>`}
      </section>
      ${leaderboardDisplay()}
    `;
  }
  return layout(`
    <div class="display-top"><b>Truth or Bluff</b><span>${state.table.dinnerName}</span></div>
    ${main}
  `, { display: true });
}

function storyCards(story, showAnswer) {
  return ["A", "B", "C"].map(key => {
    const text = story[`story${key}`];
    const isBluff = story.bluffKey === key;
    return `
      <article class="story-card ${showAnswer && isBluff ? "bluff" : ""}">
        <div class="story-key">${key}</div>
        <p>${esc(text)}</p>
        ${showAnswer && isBluff ? `<b class="bluff-label">BLUFF</b>` : ""}
      </article>
    `;
  }).join("");
}

function askVote(key) {
  state.confirmVote = key;
  render();
}

function voteConfirmModal() {
  if (!state.confirmVote) return "";
  return `
    <div class="modal-backdrop">
      <section class="modal card">
        <h2>Confirm your answer?</h2>
        <p>You selected ${state.confirmVote}. Confirmed votes cannot be changed.</p>
        <div class="button-row">
          <button class="secondary" onclick="state.confirmVote='';render()">Choose again</button>
          <button class="primary" onclick="confirmVote()">Confirm</button>
        </div>
      </section>
    </div>
  `;
}

async function confirmVote() {
  const p = player();
  const round = currentRound();
  if (!p || !round || p.id === round.storytellerId) return;
  const votes = votesFor(round.id);
  if (votes.some(v => v.voterId === p.id)) return;
  votes.push({ voterId: p.id, selectedKey: state.confirmVote, createdAt: new Date().toISOString() });
  state.table.votes[round.id] = votes;
  p.status = "voted";
  state.confirmVote = "";
  if (votes.length >= eligibleVoteCount(round)) await revealRound();
  else {
    saveTable();
    await waitForRemoteIdle();
  }
  render();
}

async function revealRound() {
  const round = currentRound();
  if (!round) return toast("No active round.");
  let story = storyFor(round.storytellerId);
  if (!story && REMOTE_ENABLED) {
    await pullRemoteTable({ initial: true });
    story = storyFor(round.storytellerId);
  }
  if (!story) return toast("Story data is still syncing. Try reveal again.");
  const votes = votesFor(round.id);
  round.status = "revealed";
  round.revealedAt = new Date().toISOString();
  scoreRound(round, story, votes);
  state.table.status = "hold";
  saveTable();
  await waitForRemoteIdle();
  render();
}

function scoreRound(round, story, votes) {
  if (round.scored) return;
  const storyteller = state.table.players.find(p => p.id === round.storytellerId);
  const eligible = state.table.players.filter(p => p.id !== storyteller.id && storyFor(p.id)?.isSubmitted);
  let fooled = 0;
  votes.forEach(vote => {
    const voter = state.table.players.find(p => p.id === vote.voterId);
    const correct = vote.selectedKey === story.bluffKey;
    vote.isCorrect = correct;
    if (correct) {
      voter.scoreTotal += 3;
      voter.detectiveScore += 3;
      voter.correctGuesses += 1;
    } else {
      fooled += 1;
    }
  });
  fooled += Math.max(0, eligible.length - votes.length);
  storyteller.scoreTotal += fooled;
  storyteller.storytellerScore += fooled;
  storyteller.fooledCount += fooled;
  if (fooled === eligible.length && eligible.length > 0) {
    storyteller.scoreTotal += 5;
    storyteller.storytellerScore += 5;
  }
  ["A", "B", "C"].forEach(key => {
    const count = votes.filter(v => v.selectedKey === key).length;
    if (key !== story.bluffKey) storyteller.suspiciousCount += count;
  });
  storyteller.status = "round_completed";
  round.scored = true;
}

function revealCard(round, story, votes) {
  return `
    <section class="card">
      <div class="section-title">Reveal</div>
      ${storyCards(story, true)}
      ${revealStats(round, story, votes)}
    </section>
  `;
}

function revealStats(round, story, votes) {
  const distribution = ["A", "B", "C"].map(k => `${k}: ${votes.filter(v => v.selectedKey === k).length} votes`).join(" · ");
  return `
    <div class="reveal-stats">
      <h2>Bluff answer: ${story.bluffKey}</h2>
      <p>${distribution}</p>
      <p>${funnyComment(votes, story.bluffKey)}</p>
      <p class="hint">Discussion Time. Waiting for host to call next player.</p>
    </div>
  `;
}

function funnyComment(votes, bluffKey) {
  const correct = votes.filter(v => v.selectedKey === bluffKey).length;
  if (!votes.length) return "The table chose silence. Mysterious strategy.";
  if (correct === votes.length) return "The bluff was too shiny. Everyone saw it.";
  if (correct === 0) return "Perfect dinner-level deception.";
  return "Half the table trusted the wrong vibe.";
}

async function startGame() {
  if (!["lobby", "ended"].includes(state.table.status)) return toast("Game already started. Use Next Player after reveal.");
  if (readyPlayers().length < 3) return toast("Need at least 3 ready players for testing.");
  state.table.locked = true;
  state.table.status = "drawing";
  saveTable();
  await waitForRemoteIdle();
  await callNextPlayer();
}

async function callNextPlayer() {
  const active = currentRound();
  if (active?.status === "voting") return toast("Reveal or skip the current player first.");
  const completed = new Set(state.table.rounds.filter(r => r.status === "hold" || r.status === "revealed").map(r => r.storytellerId));
  const candidates = eligiblePlayers().filter(p => !completed.has(p.id));
  if (!candidates.length) return endGame();
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  const round = { id: uid(), roundNumber: state.table.rounds.length + 1, storytellerId: selected.id, status: "voting", selectedAt: new Date().toISOString(), scored: false };
  state.table.rounds.push(round);
  state.table.currentRoundId = round.id;
  state.table.votes[round.id] = [];
  state.table.status = "voting";
  state.table.players.forEach(p => {
    if (p.id === selected.id) p.status = "current_storyteller";
    else if (storyFor(p.id)?.isSubmitted) p.status = "voting";
  });
  saveTable();
  await waitForRemoteIdle();
  render();
}

function randomRedraw() {
  const round = currentRound();
  if (round && round.status === "voting" && !votesFor(round.id).length) {
    state.table.rounds = state.table.rounds.filter(r => r.id !== round.id);
    state.table.currentRoundId = "";
  }
  callNextPlayer();
}

function pauseGame() {
  state.table.status = "paused";
  saveTable();
  render();
}

function continueGame() {
  const round = currentRound();
  state.table.status = round?.status === "revealed" ? "hold" : "voting";
  saveTable();
  render();
}

function skipCurrent() {
  const round = currentRound();
  if (!round) return;
  const p = state.table.players.find(x => x.id === round.storytellerId);
  p.status = "skipped";
  round.status = "skipped";
  saveTable();
  callNextPlayer();
}

function endGame() {
  state.table.status = "ended";
  state.table.currentRoundId = "";
  saveTable();
  render();
}

function clearVotes() {
  const round = currentRound();
  if (!round) return;
  state.table.votes[round.id] = [];
  round.scored = false;
  round.status = "voting";
  state.table.status = "voting";
  saveTable();
  render();
}

function resetGame() {
  state.table = defaultTable();
  localStorage.setItem(currentStoreKey(), JSON.stringify(state.table));
  state.session = {};
  saveSession();
  saveTable();
  render();
}

function addDemoPlayers() {
  const names = ["Deric", "Jason", "May", "Sarah", "Alex", "Nicole"];
  names.forEach((name, i) => {
    if (state.table.players.some(p => p.nickname === name)) return;
    state.table.players.push({
      id: uid(),
      phone: `demo${i}000`,
      nickname: name,
      playerNumber: state.table.nextPlayerNumber++,
      isHost: i === 0 && !state.table.players.some(p => p.isHost),
      isOnline: true,
      status: "writing_story",
      scoreTotal: 0,
      storytellerScore: 0,
      detectiveScore: 0,
      correctGuesses: 0,
      fooledCount: 0,
      suspiciousCount: 0,
      joinedAt: new Date().toISOString()
    });
  });
  saveTable();
  render();
}

function autoFillDemoStories() {
  state.table.players.forEach((p, i) => {
    if (state.table.stories[p.id]?.isSubmitted) return;
    state.table.stories[p.id] = {
      playerId: p.id,
      storyA: `I once ordered the wrong dish and pretended it was exactly what I wanted.`,
      storyB: `I got lost in a hotel and walked into the staff kitchen by mistake.`,
      storyC: `I won a singing contest in school with no practice.`,
      bluffKey: ["A", "B", "C"][i % 3],
      isSubmitted: true,
      createdAt: new Date().toISOString()
    };
    p.status = "story_submitted";
  });
  saveTable();
  render();
}

function simulateVotes() {
  const round = currentRound();
  if (!round || round.status !== "voting") return toast("Start a voting round first.");
  const keys = ["A", "B", "C"];
  state.table.votes[round.id] = state.table.players
    .filter(p => p.id !== round.storytellerId && storyFor(p.id)?.isSubmitted)
    .map((p, i) => ({ voterId: p.id, selectedKey: keys[i % 3], createdAt: new Date().toISOString() }));
  saveTable();
  render();
}

function leaderboard() {
  return [...state.table.players].sort((a, b) => b.scoreTotal - a.scoreTotal);
}

function leaderboardCompact() {
  return `
    <section class="card">
      <div class="section-title">Leaderboard</div>
      ${leaderboard().slice(0, 6).map((p, i) => `<div class="player-row"><span>${i + 1}. ${esc(p.nickname)}</span><b>${p.scoreTotal}</b></div>`).join("")}
    </section>
  `;
}

function leaderboardDisplay() {
  return `
    <section class="display-card">
      <h2>Leaderboard</h2>
      <div class="leader-grid">${leaderboard().slice(0, 8).map((p, i) => `<div><b>${i + 1}</b><span>${esc(p.nickname)}</span><strong>${p.scoreTotal}</strong></div>`).join("")}</div>
    </section>
  `;
}

function endView() {
  return layout(`
    ${nav()}
    ${displayAwards()}
    <button class="primary" onclick="setMode('memory')">Open Memory Page</button>
  `);
}

function displayAwards() {
  const awards = getAwards();
  return `
    <section class="display-card awards">
      <h1>Award Ceremony</h1>
      <div class="award-grid">
        <div><b>Bluff Master</b><span>${esc(awards.bluffMaster?.nickname || "-")}</span></div>
        <div><b>Truth Detective</b><span>${esc(awards.truthDetective?.nickname || "-")}</span></div>
        <div><b>Best Storyteller</b><span>${esc(awards.bestStoryteller?.nickname || "-")}</span></div>
        <div><b>Most Suspicious</b><span>${esc(awards.mostSuspicious?.nickname || "-")}</span></div>
      </div>
    </section>
    ${leaderboardDisplay()}
  `;
}

function getAwards() {
  const by = key => [...state.table.players].sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
  return {
    bluffMaster: by("storytellerScore"),
    truthDetective: by("correctGuesses"),
    bestStoryteller: by("fooledCount"),
    mostSuspicious: by("suspiciousCount")
  };
}

function memoryView() {
  if (!currentGameId()) return noGameView(false);
  const awards = getAwards();
  const text = memoryText(awards);
  return layout(`
    ${nav()}
    <section class="memory-page">
      <div>
        ${brandBlock("compact")}
        <section class="card">
          <div class="section-title">Memory Page</div>
          <label>Group Photo<input class="input" type="file" accept="image/*" onchange="uploadPhoto(event)"></label>
          ${state.table.memoryPhoto ? `<img class="memory-photo" src="${state.table.memoryPhoto}" alt="Group photo">` : `<div class="photo-placeholder">Upload group photo</div>`}
          <div class="button-row">
            <button class="secondary" onclick="copyMemory()">Copy text</button>
            <button class="primary" onclick="downloadMemoryText()">Download text</button>
          </div>
        </section>
      </div>
      <section class="card">
        <pre class="memory-text">${esc(text)}</pre>
      </section>
    </section>
  `);
}

function memoryText(awards) {
  return [
    `Dinner Name:`,
    state.table.dinnerName,
    ``,
    `Date:`,
    new Date().toLocaleDateString(),
    ``,
    `Participants:`,
    ...state.table.players.map(p => {
      const s = storyFor(p.id);
      return `${p.nickname}\nBluff: ${s ? s[`story${s.bluffKey}`] : "-"}`;
    }),
    ``,
    `Awards:`,
    `Bluff Master: ${awards.bluffMaster?.nickname || "-"}`,
    `Truth Detective: ${awards.truthDetective?.nickname || "-"}`,
    `Best Storyteller: ${awards.bestStoryteller?.nickname || "-"}`,
    `Most Suspicious: ${awards.mostSuspicious?.nickname || "-"}`
  ].join("\n");
}

function uploadPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.table.memoryPhoto = reader.result;
    saveTable();
    render();
  };
  reader.readAsDataURL(file);
}

async function copyMemory() {
  await navigator.clipboard.writeText(memoryText(getAwards()));
  toast("Memory text copied.");
}

function downloadMemoryText() {
  const blob = new Blob([memoryText(getAwards())], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "truth-or-bluff-memory.txt";
  a.click();
  URL.revokeObjectURL(url);
}

function markOnline(id) {
  const p = state.table.players.find(x => x.id === id);
  if (p && !p.isOnline) {
    p.isOnline = true;
    saveTable(true);
  }
}

window.addEventListener("beforeunload", () => {
  const p = player();
  if (p) {
    p.isOnline = false;
    saveTable(true);
  }
});

function eligibleVoteCount(round) {
  return state.table.players.filter(p => p.id !== round.storytellerId && storyFor(p.id)?.isSubmitted).length;
}

function unsafeReason(text) {
  const rules = [
    [/sex|sexual|nude|裸|性/i, "sexual content"],
    [/politic|election|政府|政治|选举/i, "political content"],
    [/religion|church|temple|宗教|攻击/i, "religious attack"],
    [/racis|race|种族/i, "racism"],
    [/salary|income|赚|收入|薪水/i, "personal income"],
    [/trauma|cancer|病|medical|医院/i, "medical or heavy trauma"],
    [/idiot|stupid|笨|蠢|骂/i, "direct insult"]
  ];
  return rules.find(([regex]) => regex.test(text))?.[1] || "";
}

function esc(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escAttr(value) {
  return esc(value).replace(/`/g, "&#096;");
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function render() {
  state.mode = routeMode() === state.mode ? state.mode : state.mode;
  const views = { player: playerView, host: hostView, display: displayView, memory: memoryView };
  app.innerHTML = (views[state.mode] || playerView)();
}

initRemoteSync();
render();
