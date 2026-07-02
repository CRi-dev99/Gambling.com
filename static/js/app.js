import {
  ensureProfile,
  getCurrentSession,
  isSupabaseConfigured,
  multiplayerRequest,
  onAuthChange,
  playGameServer,
  signIn,
  signOut,
  signUp,
  subscribeToMultiplayerTable
} from "./supabaseClient.js";

const games = [
  {
    id: "blackjack",
    title: "Blackjack",
    type: "Table game",
    icon: "blackjack",
    description: "Beat the dealer without busting. Blackjack pays 3:2."
  },
  {
    id: "poker",
    title: "Five-card Poker",
    type: "Card game",
    icon: "poker",
    description: "Hold, draw, and chase a strong five-card hand."
  },
  {
    id: "solitaire",
    title: "Solitaire",
    type: "Card puzzle",
    icon: "solitaire",
    description: "Clear Klondike foundations for a fixed credit prize."
  },
  {
    id: "slots",
    title: "Slots",
    type: "Machine",
    icon: "slots",
    description: "Spin three weighted reels and chase premium symbols."
  },
  {
    id: "corridor",
    title: "Corridor",
    type: "Minigame",
    icon: "corridor",
    description: "Pick doors, bank bonuses, or risk the next room."
  },
  {
    id: "dice",
    title: "Dice Duel",
    type: "Minigame",
    icon: "dice",
    description: "Call high, low, or doubles against the house dice."
  }
];

function iconSvg(name) {
  const icons = {
    dashboard: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="4" width="6" height="6" rx="1.5"></rect>
        <rect x="14" y="4" width="6" height="6" rx="1.5"></rect>
        <rect x="4" y="14" width="6" height="6" rx="1.5"></rect>
        <rect x="14" y="14" width="6" height="6" rx="1.5"></rect>
      </svg>
    `,
    blackjack: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="5" y="4" width="10" height="15" rx="2" transform="rotate(-7 10 11.5)"></rect>
        <rect x="9" y="5" width="10" height="15" rx="2" transform="rotate(7 14 12.5)"></rect>
        <path d="M9 9h4M9 13h6M9 17h5"></path>
      </svg>
    `,
    poker: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="7" width="8" height="13" rx="2" transform="rotate(-12 8 13.5)"></rect>
        <rect x="8" y="5" width="8" height="15" rx="2"></rect>
        <rect x="12" y="7" width="8" height="13" rx="2" transform="rotate(12 16 13.5)"></rect>
      </svg>
    `,
    solitaire: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="7" y="5" width="10" height="14" rx="2"></rect>
        <path d="M10 11l2-3 2 3"></path>
        <path d="M9 15h6"></path>
      </svg>
    `,
    slots: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="6" width="14" height="12" rx="2"></rect>
        <path d="M18 10h2M20 10v5"></path>
        <path d="M8 9v6M12 9v6M16 9v6"></path>
      </svg>
    `,
    corridor: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 20V5.8c0-.9.6-1.7 1.5-1.9L17 2v20l-8.5-1.9A1.9 1.9 0 0 1 7 18.2Z"></path>
        <path d="M17 5h2v14h-2"></path>
        <path d="M13.5 12h.1"></path>
      </svg>
    `,
    dice: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="5" y="5" width="14" height="14" rx="3"></rect>
        <circle cx="9" cy="9" r="1"></circle>
        <circle cx="15" cy="9" r="1"></circle>
        <circle cx="12" cy="12" r="1"></circle>
        <circle cx="9" cy="15" r="1"></circle>
        <circle cx="15" cy="15" r="1"></circle>
      </svg>
    `
  };

  return icons[name] || icons.dashboard;
}

const betMemory = new Map(games.map((game) => [game.id, 10]));
const multiplayerGameIds = new Set(["blackjack", "poker", "dice"]);

const elements = {
  authScreen: document.querySelector("#authScreen"),
  appShell: document.querySelector("#appShell"),
  setupWarning: document.querySelector("#setupWarning"),
  authForm: document.querySelector("#authForm"),
  authSubmit: document.querySelector("#authSubmit"),
  authMessage: document.querySelector("#authMessage"),
  showSignIn: document.querySelector("#showSignIn"),
  showSignUp: document.querySelector("#showSignUp"),
  usernameField: document.querySelector("#usernameField"),
  usernameInput: document.querySelector("#usernameInput"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  gameNav: document.querySelector("#gameNav"),
  dashboardView: document.querySelector("#dashboardView"),
  gameView: document.querySelector("#gameView"),
  gameRoot: document.querySelector("#gameRoot"),
  viewTitle: document.querySelector("#viewTitle"),
  gameTitle: document.querySelector("#gameTitle"),
  gameTypeLabel: document.querySelector("#gameTypeLabel"),
  sessionLabel: document.querySelector("#sessionLabel"),
  creditBalance: document.querySelector("#creditBalance"),
  backButton: document.querySelector("#backButton"),
  signOutButton: document.querySelector("#signOutButton")
};

let authMode = "signin";
let profile = null;
let currentGame = null;
let unsubscribeAuth = () => {};
let unsubscribeMultiplayerTable = () => {};
let multiplayerSyncTimer = null;
let loadingProfileForUserId = null;

init();

async function init() {
  elements.setupWarning.classList.toggle("is-hidden", isSupabaseConfigured);
  renderNav();
  renderDashboard();
  bindShellEvents();
  setAuthMode("signin");

  unsubscribeAuth = onAuthChange(async (session) => {
    if (session?.user) {
      window.setTimeout(() => loadProfile(session.user), 0);
    } else {
      showAuth();
    }
  });

  if (isSupabaseConfigured) {
    const { session, error } = await getCurrentSession();
    if (error) {
      showAuthMessage(error.message, true);
    }
    if (session?.user) {
      await loadProfile(session.user);
      return;
    }
  }

  showAuth();
}

function bindShellEvents() {
  elements.showSignIn.addEventListener("click", () => setAuthMode("signin"));
  elements.showSignUp.addEventListener("click", () => setAuthMode("signup"));
  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.backButton.addEventListener("click", showDashboard);
  elements.signOutButton.addEventListener("click", handleSignOut);
}

function setAuthMode(nextMode) {
  authMode = nextMode;
  const isSignup = authMode === "signup";
  elements.showSignIn.classList.toggle("is-active", !isSignup);
  elements.showSignUp.classList.toggle("is-active", isSignup);
  elements.usernameField.classList.toggle("is-hidden", !isSignup);
  elements.authSubmit.textContent = isSignup ? "Create account" : "Sign in";
  elements.passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
  showAuthMessage("");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!isSupabaseConfigured) {
    showAuthMessage("Configure Supabase before signing in.", true);
    return;
  }

  elements.authSubmit.disabled = true;
  showAuthMessage("Working...");

  try {
    const email = elements.emailInput.value.trim();
    const password = elements.passwordInput.value;
    if (authMode === "signup") {
      const username = elements.usernameInput.value.trim() || email.split("@")[0];
      const data = await signUp(email, password, username);
      if (data.session?.user) {
        showAuthMessage("Loading account...");
        await loadProfile(data.session.user);
      } else {
        showAuthMessage("Account created. Check your email if confirmation is enabled.");
      }
    } else {
      const data = await signIn(email, password);
      if (data.session?.user) {
        showAuthMessage("Loading account...");
        await loadProfile(data.session.user);
      } else {
        showAuthMessage("Signed in. Loading account...");
      }
    }
  } catch (error) {
    showAuthMessage(error.message, true);
  } finally {
    elements.authSubmit.disabled = false;
  }
}

async function loadProfile(user) {
  if (loadingProfileForUserId === user.id) return;
  loadingProfileForUserId = user.id;

  try {
    showAuthMessage("Loading account...");
    profile = await ensureProfile(user);
    enterApp();
  } catch (error) {
    showAuthMessage(error.message, true);
    showAuth();
  } finally {
    loadingProfileForUserId = null;
  }
}

function enterApp() {
  elements.authScreen.classList.add("is-hidden");
  elements.appShell.classList.remove("is-hidden");
  elements.sessionLabel.textContent = `Signed in as ${profile.username}`;
  updateWallet();
  showDashboard();
}

function showAuth() {
  clearMultiplayerSubscription();
  profile = null;
  currentGame = null;
  elements.authScreen.classList.remove("is-hidden");
  elements.appShell.classList.add("is-hidden");
}

async function handleSignOut() {
  try {
    await signOut();
  } catch (error) {
    showGameMessage(error.message, true);
  }
}

function renderNav() {
  elements.gameNav.innerHTML = `
    <button class="nav-button" type="button" data-dashboard="true">
      <span class="nav-icon">${iconSvg("dashboard")}</span>
      <span>Dashboard</span>
    </button>
  ` + games
    .map(
      (game) => `
        <button class="nav-button" type="button" data-game="${game.id}">
          <span class="nav-icon">${iconSvg(game.icon)}</span>
          <span>${escapeHtml(game.title)}</span>
        </button>
      `
    )
    .join("");

  elements.gameNav.querySelectorAll("[data-game]").forEach((button) => {
    button.addEventListener("click", () => openGame(button.dataset.game));
  });
  elements.gameNav.querySelector("[data-dashboard]").addEventListener("click", showDashboard);
}

function renderDashboard() {
  elements.dashboardView.innerHTML = games
    .map(
      (game) => `
        <article class="game-card">
          <div>
            <div class="game-card-icon">${iconSvg(game.icon)}</div>
            <p class="eyebrow">${escapeHtml(game.type)}</p>
            <h3>${escapeHtml(game.title)}</h3>
            <p>${escapeHtml(game.description)}</p>
          </div>
          <div class="card-actions">
            <button class="primary-action" type="button" data-game="${game.id}">Play Solo</button>
            ${multiplayerGameIds.has(game.id) ? `
              <button class="secondary-action" type="button" data-multiplayer="${game.id}">Multiplayer</button>
            ` : ""}
          </div>
        </article>
      `
    )
    .join("");

  elements.dashboardView.querySelectorAll("[data-game]").forEach((button) => {
    button.addEventListener("click", () => openGame(button.dataset.game));
  });
  elements.dashboardView.querySelectorAll("[data-multiplayer]").forEach((button) => {
    button.addEventListener("click", () => openMultiplayerLobby(button.dataset.multiplayer));
  });
}

function showDashboard() {
  clearMultiplayerSubscription();
  currentGame = null;
  elements.viewTitle.textContent = "Casino Dashboard";
  elements.dashboardView.classList.remove("is-hidden");
  elements.gameView.classList.add("is-hidden");
  elements.gameRoot.innerHTML = "";
  markActiveNav("dashboard");
}

async function openGame(gameId) {
  const meta = games.find((game) => game.id === gameId);
  if (!meta) return;

  try {
    clearMultiplayerSubscription();
    currentGame = {
      meta,
      mode: "solo",
      state: createInitialPublicState(gameId),
      sessionId: null,
      message: ""
    };
    elements.viewTitle.textContent = meta.title;
    elements.gameTitle.textContent = meta.title;
    elements.gameTypeLabel.textContent = meta.type;
    elements.dashboardView.classList.add("is-hidden");
    elements.gameView.classList.remove("is-hidden");
    markActiveNav(gameId);
    renderCurrentGame();
  } catch (error) {
    showGameMessage(`Could not load ${meta.title}: ${error.message}`, true);
  }
}

async function openMultiplayerLobby(gameId) {
  const meta = games.find((game) => game.id === gameId);
  if (!meta || !multiplayerGameIds.has(gameId)) return;

  clearMultiplayerSubscription();
  currentGame = {
    meta,
    mode: "multiplayer",
    multiplayerView: "lobby",
    table: null,
    tables: [],
    message: ""
  };
  elements.viewTitle.textContent = `${meta.title} Multiplayer`;
  elements.gameTitle.textContent = `${meta.title} Multiplayer`;
  elements.gameTypeLabel.textContent = "Real-player table";
  elements.dashboardView.classList.add("is-hidden");
  elements.gameView.classList.remove("is-hidden");
  markActiveNav(gameId);
  renderCurrentGame();
  await loadMultiplayerTables();
}

function markActiveNav(gameId) {
  elements.gameNav.querySelectorAll("[data-dashboard]").forEach((button) => {
    button.classList.toggle("is-active", gameId === "dashboard");
  });
  elements.gameNav.querySelectorAll("[data-game]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.game === gameId);
  });
}

function renderCurrentGame() {
  if (!currentGame) return;
  if (currentGame.mode === "multiplayer") {
    renderMultiplayerView();
    return;
  }

  const publicState = currentGame.state;
  const content = renderGameSurface(currentGame.meta.id, publicState);

  elements.gameRoot.innerHTML = `
    <div class="game-layout">
      <section class="play-surface">${content.surface}</section>
      <aside class="control-panel">
        ${renderStats(publicState)}
        ${content.controls}
        ${renderRoundMessage(publicState)}
      </aside>
    </div>
  `;

  bindGameControls(publicState);
}

function renderMultiplayerView() {
  if (!currentGame) return;

  if (currentGame.multiplayerView === "table" && currentGame.table) {
    renderMultiplayerTable();
  } else {
    renderMultiplayerLobby();
  }
}

function renderMultiplayerLobby() {
  elements.gameRoot.innerHTML = `
    <div class="game-layout multiplayer-layout">
      <section class="play-surface">
        <div class="table-zone">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Public lobby</p>
              <h4>${escapeHtml(currentGame.meta.title)} tables</h4>
            </div>
            <button class="game-button" type="button" data-refresh-lobby>Refresh</button>
          </div>
          <div class="lobby-list">
            ${renderLobbyTables()}
          </div>
        </div>
      </section>
      <aside class="control-panel">
        <div class="control-stack">
          <button class="game-button" type="button" data-open-solo>Play solo instead</button>
        </div>
        <div class="control-stack">
          <p class="eyebrow">Create table</p>
          <label class="bet-control">
            <span>Stake</span>
            <input id="mpStake" type="number" min="1" max="10000" step="1" value="${betMemory.get(currentGame.meta.id) || 10}">
          </label>
          <label class="bet-control">
            <span>Seats</span>
            <input id="mpMaxPlayers" type="number" min="2" max="6" step="1" value="6">
          </label>
          <label class="bet-control">
            <span>Visibility</span>
            <select id="mpVisibility">
              <option value="public">Public lobby</option>
              <option value="private">Invite only</option>
            </select>
          </label>
          ${currentGame.meta.id === "dice" ? `
            <label class="bet-control">
              <span>Dice mode</span>
              <select id="mpDiceMode">
                <option value="high">High total wins</option>
                <option value="low">Low total wins</option>
                <option value="doubles">Best doubles win</option>
              </select>
            </label>
          ` : ""}
          <button class="game-button is-primary" type="button" data-create-table>Create table</button>
        </div>
        <div class="control-stack">
          <p class="eyebrow">Invite code</p>
          <label class="bet-control">
            <span>Code</span>
            <input id="mpInviteCode" type="text" maxlength="12" placeholder="ABC123">
          </label>
          <button class="game-button" type="button" data-join-code>Join by code</button>
        </div>
        ${renderRoundMessage({ message: currentGame.message })}
      </aside>
    </div>
  `;

  bindMultiplayerControls();
}

function renderLobbyTables() {
  if (!currentGame.tables?.length) {
    return `<p class="empty-state">No public tables yet. Create one or join by invite code.</p>`;
  }

  return currentGame.tables.map((table) => `
    <article class="lobby-table">
      <div>
        <p class="eyebrow">${escapeHtml(table.status)}</p>
        <h4>${escapeHtml(gameTitle(table.gameId))}</h4>
        <p>${table.seats.length}/${table.maxPlayers} seats · ${table.stake} credits</p>
      </div>
      <button class="game-button" type="button" data-join-table="${escapeHtml(table.id)}" ${table.status !== "waiting" ? "disabled" : ""}>Join</button>
    </article>
  `).join("");
}

function renderMultiplayerTable() {
  const table = currentGame.table;
  const state = table.publicState || {};
  elements.gameRoot.innerHTML = `
    <div class="game-layout multiplayer-layout">
      <section class="play-surface">
        <div class="table-zone">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Table ${escapeHtml(table.inviteCode)}</p>
              <h4>${escapeHtml(gameTitle(table.gameId))} · ${escapeHtml(table.status)}</h4>
            </div>
            <button class="game-button" type="button" data-sync-table>Sync</button>
          </div>
          ${renderSeatList(table)}
        </div>
        ${renderMultiplayerGameSurface(table, state)}
      </section>
      <aside class="control-panel">
        ${renderMultiplayerStats(table, state)}
        ${renderMultiplayerTableControls(table, state)}
        ${renderRoundMessage({ message: currentGame.message || state.message })}
      </aside>
    </div>
  `;

  bindMultiplayerControls();
}

function renderSeatList(table) {
  const seats = Array.from({ length: table.maxPlayers }, (_, index) =>
    table.seats.find((seat) => seat.seatIndex === index) || null
  );

  return `
    <div class="seat-grid">
      ${seats.map((seat, index) => `
        <div class="seat-card ${seat?.profileId === profile?.id ? "is-you" : ""}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(seat?.username || "Open seat")}</strong>
          <small>${escapeHtml(seat?.status || "open")}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderMultiplayerGameSurface(table, state) {
  if (table.status === "waiting") {
    return `
      <div class="table-zone">
        <h4>Waiting room</h4>
        <p>Share invite code <strong>${escapeHtml(table.inviteCode)}</strong> or wait for players from the public lobby.</p>
      </div>
    `;
  }

  if (table.gameId === "blackjack") return renderMultiplayerBlackjack(state);
  if (table.gameId === "poker") return renderMultiplayerPoker(state);
  if (table.gameId === "dice") return renderMultiplayerDice(state);
  return `<div class="table-zone"><p>Multiplayer table unavailable.</p></div>`;
}

function renderMultiplayerBlackjack(state) {
  return `
    ${renderHandZone("Dealer", state.dealerHand || [], state.dealerValue)}
    ${(state.players || []).map((player) => renderHandZone(
      `${player.username}${player.isYou ? " (You)" : ""}`,
      player.hand || [],
      player.value
    )).join("")}
  `;
}

function renderMultiplayerPoker(state) {
  const canToggle = state.turnProfileId === profile?.id && state.phase === "holding";
  return `
    ${(state.players || []).map((player) => `
      <div class="hand-zone">
        <h4>${escapeHtml(player.username)}${player.isYou ? " (You)" : ""} ${player.result ? `· ${escapeHtml(player.result.label)}` : ""}</h4>
        <div class="card-row">
          ${(player.hand || []).map((card, index) => renderCard(card, {
            held: player.held?.[index],
            action: canToggle && player.isYou ? `data-mp-action="toggleHold" data-index="${index}"` : ""
          })).join("")}
        </div>
      </div>
    `).join("")}
  `;
}

function renderMultiplayerDice(state) {
  return `
    <div class="table-zone">
      <h4>${escapeHtml(diceModeLabel(state.diceMode || "high"))}</h4>
      <div class="dice-player-grid">
        ${(state.players || []).map((player) => `
          <div class="dice-player">
            <strong>${escapeHtml(player.username)}${player.isYou ? " (You)" : ""}</strong>
            <div class="dice-row">${renderDiceFaces(player.dice)}</div>
            <span>${player.total || 0}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMultiplayerStats(table, state) {
  return `
    <div class="stat-grid">
      <div class="stat"><span>Stake</span><strong>${table.stake}</strong></div>
      <div class="stat"><span>Seats</span><strong>${table.seats.length}/${table.maxPlayers}</strong></div>
      <div class="stat"><span>Turn</span><strong>${escapeHtml(turnLabel(state))}</strong></div>
      <div class="stat"><span>Balance</span><strong>${profile?.credits ?? 0}</strong></div>
    </div>
  `;
}

function renderMultiplayerTableControls(table, state) {
  if (table.status === "waiting") {
    const ready = table.viewerSeat?.status === "ready";
    const canStart = table.isHost && table.seats.length >= 2 && table.seats.every((seat) => seat.status === "ready");
    return `
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-ready="${ready ? "false" : "true"}">${ready ? "Unready" : "Ready"}</button>
        <button class="game-button" type="button" data-start-table ${canStart ? "" : "disabled"}>Start</button>
        <button class="game-button" type="button" data-leave-table>Leave</button>
      </div>
    `;
  }

  if (table.status === "complete") {
    return `
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-back-lobby>Back to lobby</button>
      </div>
    `;
  }

  const yourTurn = state.turnProfileId === profile?.id;
  const timeoutAvailable = Boolean(state.turnDeadlineAt && new Date(state.turnDeadlineAt).getTime() <= Date.now());
  let actionButtons = "";
  if (table.gameId === "blackjack") {
    actionButtons = `
      <button class="game-button" type="button" data-mp-action="hit" ${yourTurn ? "" : "disabled"}>Hit</button>
      <button class="game-button" type="button" data-mp-action="stand" ${yourTurn ? "" : "disabled"}>Stand</button>
    `;
  } else if (table.gameId === "poker") {
    actionButtons = `<button class="game-button" type="button" data-mp-action="draw" ${yourTurn ? "" : "disabled"}>Draw</button>`;
  } else if (table.gameId === "dice") {
    actionButtons = `<button class="game-button" type="button" data-mp-action="roll" ${yourTurn ? "" : "disabled"}>Roll</button>`;
  }

  return `
    <div class="button-row">
      ${actionButtons}
      <button class="game-button" type="button" data-timeout-table ${timeoutAvailable ? "" : "disabled"}>Apply timeout</button>
    </div>
  `;
}

function bindMultiplayerControls() {
  elements.gameRoot.querySelector("[data-open-solo]")?.addEventListener("click", () => openGame(currentGame.meta.id));
  elements.gameRoot.querySelector("[data-refresh-lobby]")?.addEventListener("click", loadMultiplayerTables);
  elements.gameRoot.querySelector("[data-create-table]")?.addEventListener("click", createMultiplayerTableFromUi);
  elements.gameRoot.querySelector("[data-join-code]")?.addEventListener("click", joinMultiplayerByCodeFromUi);
  elements.gameRoot.querySelector("[data-ready]")?.addEventListener("click", (event) => setReadyFromUi(event.currentTarget.dataset.ready === "true"));
  elements.gameRoot.querySelector("[data-start-table]")?.addEventListener("click", startMultiplayerFromUi);
  elements.gameRoot.querySelector("[data-leave-table]")?.addEventListener("click", leaveMultiplayerFromUi);
  elements.gameRoot.querySelector("[data-sync-table]")?.addEventListener("click", syncMultiplayerTableFromUi);
  elements.gameRoot.querySelector("[data-timeout-table]")?.addEventListener("click", timeoutMultiplayerFromUi);
  elements.gameRoot.querySelector("[data-back-lobby]")?.addEventListener("click", () => openMultiplayerLobby(currentGame.meta.id));
  elements.gameRoot.querySelectorAll("[data-join-table]").forEach((button) => {
    button.addEventListener("click", () => joinMultiplayerTableFromUi(button.dataset.joinTable));
  });
  elements.gameRoot.querySelectorAll("[data-mp-action]").forEach((button) => {
    button.addEventListener("click", () => runMultiplayerAction(actionFromMultiplayerButton(button)));
  });
}

async function loadMultiplayerTables() {
  if (!currentGame || currentGame.mode !== "multiplayer") return;
  await transitionMultiplayer(async () => {
    const result = await multiplayerRequest({ type: "multiplayer:list", gameId: currentGame.meta.id });
    currentGame.tables = result.tables || [];
  });
}

async function createMultiplayerTableFromUi() {
  await transitionMultiplayer(async () => {
    const stake = Number(elements.gameRoot.querySelector("#mpStake")?.value || 0);
    if (!validateMultiplayerStake(stake)) return;
    betMemory.set(currentGame.meta.id, stake);
    const result = await multiplayerRequest({
      type: "multiplayer:create",
      gameId: currentGame.meta.id,
      stake,
      maxPlayers: Number(elements.gameRoot.querySelector("#mpMaxPlayers")?.value || 6),
      visibility: elements.gameRoot.querySelector("#mpVisibility")?.value || "public",
      diceMode: elements.gameRoot.querySelector("#mpDiceMode")?.value || "high"
    });
    acceptMultiplayerResult(result);
  });
}

async function joinMultiplayerByCodeFromUi() {
  const inviteCode = elements.gameRoot.querySelector("#mpInviteCode")?.value || "";
  await joinMultiplayerTableFromUi(null, inviteCode);
}

async function joinMultiplayerTableFromUi(tableId, inviteCode = "") {
  await transitionMultiplayer(async () => {
    const result = await multiplayerRequest({
      type: "multiplayer:join",
      gameId: currentGame.meta.id,
      tableId,
      inviteCode
    });
    acceptMultiplayerResult(result);
  });
}

async function setReadyFromUi(ready) {
  await runMultiplayerRequest({ type: "multiplayer:ready", ready });
}

async function startMultiplayerFromUi() {
  await runMultiplayerRequest({ type: "multiplayer:start" });
}

async function leaveMultiplayerFromUi() {
  await transitionMultiplayer(async () => {
    const result = await multiplayerRequest({
      type: "multiplayer:leave",
      gameId: currentGame.meta.id,
      tableId: currentGame.table?.id
    });
    acceptMultiplayerResult(result);
    if (!result.table) {
      clearMultiplayerSubscription();
      currentGame.multiplayerView = "lobby";
      await loadMultiplayerTables();
    }
  });
}

async function syncMultiplayerTableFromUi() {
  if (!currentGame?.table?.id) return;
  await runMultiplayerRequest({ type: "multiplayer:sync" });
}

async function timeoutMultiplayerFromUi() {
  await runMultiplayerRequest({ type: "multiplayer:timeout" });
}

async function runMultiplayerAction(action) {
  await runMultiplayerRequest({ type: "multiplayer:action", action });
}

async function runMultiplayerRequest(payload) {
  await transitionMultiplayer(async () => {
    const result = await multiplayerRequest({
      ...payload,
      gameId: currentGame.meta.id,
      tableId: currentGame.table?.id
    });
    acceptMultiplayerResult(result);
  });
}

async function transitionMultiplayer(task) {
  try {
    currentGame.message = "";
    await task();
  } catch (error) {
    currentGame.message = error.message;
  } finally {
    renderCurrentGame();
  }
}

function acceptMultiplayerResult(result) {
  if (result.profile) {
    profile = result.profile;
    updateWallet();
  }
  if (Object.prototype.hasOwnProperty.call(result, "table")) {
    currentGame.table = result.table;
    if (result.table) {
      currentGame.multiplayerView = "table";
      subscribeToCurrentMultiplayerTable(result.table.id);
    }
  }
  if (result.tables) {
    currentGame.tables = result.tables;
  }
}

function subscribeToCurrentMultiplayerTable(tableId) {
  if (!tableId || currentGame.subscribedTableId === tableId) return;
  clearMultiplayerSubscription();
  currentGame.subscribedTableId = tableId;
  unsubscribeMultiplayerTable = subscribeToMultiplayerTable(tableId, () => {
    window.clearTimeout(multiplayerSyncTimer);
    multiplayerSyncTimer = window.setTimeout(() => {
      if (currentGame?.mode === "multiplayer" && currentGame.table?.id === tableId) {
        syncMultiplayerTableFromUi();
      }
    }, 250);
  });
}

function clearMultiplayerSubscription() {
  window.clearTimeout(multiplayerSyncTimer);
  multiplayerSyncTimer = null;
  unsubscribeMultiplayerTable();
  unsubscribeMultiplayerTable = () => {};
  if (currentGame) currentGame.subscribedTableId = null;
}

function actionFromMultiplayerButton(button) {
  const type = button.dataset.mpAction;
  if (type === "toggleHold") return { type, index: Number(button.dataset.index) };
  return { type };
}

function validateMultiplayerStake(stake) {
  if (!Number.isInteger(stake) || stake <= 0) {
    currentGame.message = "Choose a positive whole-credit stake.";
    renderCurrentGame();
    return false;
  }
  if (stake > profile.credits) {
    currentGame.message = "Your stake cannot be higher than your credit balance.";
    renderCurrentGame();
    return false;
  }
  return true;
}

function turnLabel(state) {
  const current = (state.players || []).find((player) => player.profileId === state.turnProfileId);
  if (!current) return state.phase || "waiting";
  const seconds = state.turnDeadlineAt
    ? Math.max(0, Math.ceil((new Date(state.turnDeadlineAt).getTime() - Date.now()) / 1000))
    : 0;
  return `${current.isYou ? "You" : current.username} · ${seconds}s`;
}

function gameTitle(gameId) {
  return games.find((game) => game.id === gameId)?.title || gameId;
}

function diceModeLabel(mode) {
  return {
    high: "High total wins",
    low: "Low total wins",
    doubles: "Best doubles win"
  }[mode] || "High total wins";
}

function renderGameSurface(gameId, state) {
  switch (gameId) {
    case "blackjack":
      return renderBlackjack(state);
    case "poker":
      return renderPoker(state);
    case "solitaire":
      return renderSolitaire(state);
    case "slots":
      return renderSlots(state);
    case "corridor":
      return renderCorridor(state);
    case "dice":
      return renderDice(state);
    default:
      return { surface: "<p>Game unavailable.</p>", controls: "" };
  }
}

function renderBlackjack(state) {
  const canAct = state.phase === "player_turn";
  const canHit = canAct && Number(state.playerValue || 0) < 21;
  return {
    surface: `
      ${renderHandZone("Dealer", state.dealerHand, state.dealerValue)}
      ${renderHandZone("Player", state.playerHand, state.playerValue)}
    `,
    controls: `
      ${renderBetControl(state.phase === "player_turn")}
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-start-round ${canAct ? "disabled" : ""}>Deal</button>
        <button class="game-button" type="button" data-action="hit" ${canHit ? "" : "disabled"}>Hit</button>
        <button class="game-button" type="button" data-action="stand" ${canAct ? "" : "disabled"}>Stand</button>
      </div>
    `
  };
}

function renderPoker(state) {
  const canHold = state.phase === "holding";
  return {
    surface: `
      <div class="hand-zone">
        <h4>Hand</h4>
        <div class="card-row">
          ${(state.hand || []).map((card, index) => renderCard(card, {
            held: state.held?.[index],
            action: canHold ? `data-action="toggleHold" data-index="${index}"` : ""
          })).join("") || "<p>Deal a hand to begin.</p>"}
        </div>
      </div>
    `,
    controls: `
      ${renderBetControl(canHold)}
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-start-round ${canHold ? "disabled" : ""}>Deal</button>
        <button class="game-button" type="button" data-action="draw" ${canHold ? "" : "disabled"}>Draw</button>
        <button class="game-button" type="button" data-action="newRound">Clear</button>
      </div>
    `
  };
}

function renderSolitaire(state) {
  const playing = state.status === "playing";
  return {
    surface: `
      <div class="table-zone">
        <h4>Foundations</h4>
        <div class="foundation-row">
          ${Object.entries(state.foundations || {}).map(([suit, pile]) => `
            <div class="pile">
              <strong>${suitLabel(suit)}</strong>
              ${renderCard(pile.top || null)}
            </div>
          `).join("")}
        </div>
      </div>
      <div class="table-zone">
        <h4>Stock and Waste</h4>
        <div class="pile-row">
          <div class="pile"><strong>Stock</strong><span>${state.stockCount || 0} cards</span></div>
          <div class="pile"><strong>Waste</strong>${renderCard(state.wasteTop || null)}</div>
        </div>
      </div>
      <div class="table-zone">
        <h4>Tableau</h4>
        <div class="pile-row">
          ${(state.tableau || []).map((pile, index) => `
            <div class="pile">
              <strong>${index + 1}</strong>
              ${(pile || []).slice(-5).map((card) => renderCard(card)).join("")}
            </div>
          `).join("")}
        </div>
      </div>
    `,
    controls: `
      ${renderBetControl(playing)}
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-start-round ${playing ? "disabled" : ""}>New deal</button>
        <button class="game-button" type="button" data-action="drawStock" ${playing ? "" : "disabled"}>Draw stock</button>
      </div>
      <div class="control-stack">
        ${renderSolitaireActionButtons(state)}
      </div>
    `
  };
}

function renderSlots(state) {
  const reels = state.lastSpin?.reels?.length ? state.lastSpin.reels : [
    { label: "Cherry" },
    { label: "Seven" },
    { label: "Crown" }
  ];
  return {
    surface: `
      <div class="reel-row">
        ${reels.map((symbol) => `<div class="reel">${slotSymbol(symbol.id || symbol.label)}</div>`).join("")}
      </div>
      <div class="table-zone">
        <h4>Payout table</h4>
        <div class="stat-grid">
          ${state.payoutTable?.twoMatch ? `
            <div class="stat"><span>${escapeHtml(state.payoutTable.twoMatch.label)}</span><strong>${escapeHtml(state.payoutTable.twoMatch.pays || state.payoutTable.twoMatch.threeMatch || "")}</strong></div>
          ` : ""}
          ${(state.payoutTable?.threeMatch || []).map((entry) => `
            <div class="stat"><span>${escapeHtml(entry.label)}</span><strong>${escapeHtml(entry.threeMatch || entry.pays || "")}</strong></div>
          `).join("")}
        </div>
      </div>
    `,
    controls: `
      ${renderBetControl(false)}
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-start-round>Spin</button>
      </div>
    `
  };
}

function renderCorridor(state) {
  const inRound = state.phase === "inRound";
  return {
    surface: `
      <div class="table-zone">
        <h4>${inRound ? `Room ${state.roomNumber} of ${state.totalRooms}` : "Corridor closed"}</h4>
        <div class="door-row">
          ${(state.doors || []).map((door) => `
            <button class="door-button" type="button" data-action="chooseDoor" data-index="${door.index}">
              ${door.index + 1}
            </button>
          `).join("") || "<p>Start a run to reveal the doors.</p>"}
        </div>
      </div>
      <div class="table-zone">
        <h4>Run history</h4>
        ${(state.history || []).map((entry) => `
          <p>Room ${entry.roomNumber}: ${escapeHtml(entry.label)} door, ${escapeHtml(entry.outcome)}</p>
        `).join("") || "<p>No rooms cleared yet.</p>"}
      </div>
    `,
    controls: `
      ${renderBetControl(inRound)}
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-start-round ${inRound ? "disabled" : ""}>Enter</button>
        <button class="game-button" type="button" data-action="cashOut" ${state.canCashOut ? "" : "disabled"}>Cash out</button>
      </div>
    `
  };
}

function renderDice(state) {
  const choosing = state.phase === "choosing_mode";
  return {
    surface: `
      <div class="table-zone">
        <h4>Player dice</h4>
        <div class="dice-row">${renderDiceFaces(state.playerDice)}</div>
      </div>
      <div class="table-zone">
        <h4>House dice</h4>
        <div class="dice-row">${renderDiceFaces(state.houseDice)}</div>
      </div>
    `,
    controls: `
      ${renderBetControl(choosing)}
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-start-round>Start duel</button>
        <button class="game-button" type="button" data-action="high" ${choosing ? "" : "disabled"}>High</button>
        <button class="game-button" type="button" data-action="low" ${choosing ? "" : "disabled"}>Low</button>
        <button class="game-button" type="button" data-action="doubles" ${choosing ? "" : "disabled"}>Doubles</button>
      </div>
    `
  };
}

function bindGameControls(publicState) {
  const betInput = elements.gameRoot.querySelector("#betInput");
  if (betInput) {
    betInput.addEventListener("input", () => {
      betMemory.set(currentGame.meta.id, Number(betInput.value));
    });
  }

  elements.gameRoot.querySelectorAll("[data-chip]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!betInput || betInput.disabled) return;
      betInput.value = button.dataset.chip;
      betInput.dispatchEvent(new Event("input"));
      renderCurrentGame();
    });
  });

  elements.gameRoot.querySelectorAll("[data-start-round]").forEach((button) => {
    button.addEventListener("click", () => startRoundFromUi());
  });

  elements.gameRoot.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = actionFromButton(button, publicState);
      runPlayerAction(action);
    });
  });
}

async function startRoundFromUi() {
  const bet = readBet();
  if (!validateBet(bet)) return;

  await transitionState(() => playGameServer({
    type: "start",
    gameId: currentGame.meta.id,
    bet
  }));
}

async function runPlayerAction(action) {
  if (action.type === "newRound") {
    currentGame.state = createInitialPublicState(currentGame.meta.id);
    currentGame.sessionId = null;
    currentGame.message = "";
    renderCurrentGame();
    return;
  }

  if (!currentGame.sessionId) {
    currentGame.message = "Start a round before choosing an action.";
    renderCurrentGame();
    return;
  }

  await transitionState(() => playGameServer({
    type: "action",
    gameId: currentGame.meta.id,
    sessionId: currentGame.sessionId,
    action
  }));
}

async function transitionState(nextStateFactory) {
  try {
    currentGame.message = "";
    const result = await nextStateFactory();
    profile = result.profile || profile;
    currentGame.sessionId = result.sessionId || currentGame.sessionId;
    currentGame.state = result.publicState || currentGame.state;
    updateWallet();
  } catch (error) {
    currentGame.message = error.message;
  } finally {
    renderCurrentGame();
  }
}

function validateBet(bet) {
  if (!Number.isInteger(bet) || bet <= 0) {
    currentGame.message = "Choose a positive whole-credit bet.";
    renderCurrentGame();
    return false;
  }

  if (bet > profile.credits) {
    currentGame.message = "Your bet cannot be higher than your credit balance.";
    renderCurrentGame();
    return false;
  }

  return true;
}

function readBet() {
  const value = Number(elements.gameRoot.querySelector("#betInput")?.value || 0);
  betMemory.set(currentGame.meta.id, value);
  return value;
}

function actionFromButton(button) {
  const type = button.dataset.action;
  if (type === "toggleHold") {
    return { type, index: Number(button.dataset.index) };
  }
  if (type === "chooseDoor") {
    return { type, doorIndex: Number(button.dataset.index) };
  }
  if (type === "moveWasteToTableau") {
    return { type, targetIndex: Number(button.dataset.target) };
  }
  if (type === "moveTableauToFoundation") {
    return { type, sourceIndex: Number(button.dataset.source) };
  }
  if (type === "moveTableauToTableau") {
    return {
      type,
      sourceIndex: Number(button.dataset.source),
      targetIndex: Number(button.dataset.target),
      count: Number(button.dataset.count)
    };
  }
  if (type === "moveFoundationToTableau") {
    return { type, suit: button.dataset.suit, targetIndex: Number(button.dataset.target) };
  }
  return { type };
}

function renderBetControl(disabled) {
  const currentBet = betMemory.get(currentGame.meta.id) || 10;
  return `
    <label class="bet-control">
      <span class="eyebrow">Bet</span>
      <input id="betInput" type="number" min="1" step="1" value="${currentBet}" ${disabled ? "disabled" : ""}>
    </label>
    <div class="chip-row">
      ${[5, 10, 25, 50].map((value) => `
        <button class="chip-button ${currentBet === value ? "is-active" : ""}" type="button" data-chip="${value}" ${disabled ? "disabled" : ""}>${value}</button>
      `).join("")}
    </div>
  `;
}

function renderStats(state) {
  const delta = Number(currentGame.state?.roundDelta || 0);
  return `
    <div class="stat-grid">
      <div class="stat"><span>Status</span><strong>${escapeHtml(state.phase || state.status || "ready")}</strong></div>
      <div class="stat"><span>Bet</span><strong>${escapeHtml(String(state.bet || state.currentBet || 0))}</strong></div>
      <div class="stat"><span>Last delta</span><strong class="${delta >= 0 ? "delta-good" : "delta-bad"}">${delta > 0 ? "+" : ""}${delta}</strong></div>
      <div class="stat"><span>Balance</span><strong>${profile?.credits ?? 0}</strong></div>
    </div>
  `;
}

function createInitialPublicState(gameId) {
  const common = {
    gameId,
    phase: "idle",
    status: "ready",
    bet: 0,
    roundDelta: 0,
    message: "Place a bet to start."
  };

  if (gameId === "blackjack") {
    return { ...common, playerHand: [], dealerHand: [], playerValue: 0, dealerValue: 0 };
  }

  if (gameId === "poker") {
    return { ...common, hand: [], held: [], phase: "idle", message: "Deal a hand to begin." };
  }

  if (gameId === "solitaire") {
    return {
      ...common,
      status: "idle",
      tableau: Array.from({ length: 7 }, () => []),
      foundations: { hearts: {}, diamonds: {}, clubs: {}, spades: {} },
      stockCount: 0,
      wasteTop: null,
      suggestedActions: []
    };
  }

  if (gameId === "slots") {
    return {
      ...common,
      lastSpin: null,
      payoutTable: {
        twoMatch: { label: "Any two matching symbols", pays: "1x bet" },
        threeMatch: [
          { label: "Cherries", pays: "3x bet" },
          { label: "Lemon", pays: "4x bet" },
          { label: "Bell", pays: "6x bet" },
          { label: "Seven", pays: "10x bet" },
          { label: "Diamond", pays: "15x bet" },
          { label: "Crown", pays: "25x bet" },
          { label: "Lightning", pays: "50x bet" }
        ]
      }
    };
  }

  if (gameId === "corridor") {
    return { ...common, totalRooms: 5, roomNumber: null, doors: [], history: [], canCashOut: false };
  }

  if (gameId === "dice") {
    return { ...common, playerDice: [], houseDice: [], playerTotal: 0, houseTotal: 0 };
  }

  return common;
}

function renderRoundMessage(state) {
  const message = currentGame.message || state.validationMessage || state.lastError || state.error || state.message || "";
  if (!message) return "";
  return `<p class="round-message">${escapeHtml(message)}</p>`;
}

function renderHandZone(title, cards, value) {
  return `
    <div class="hand-zone">
      <h4>${escapeHtml(title)} ${Number.isFinite(value) ? `(${value})` : ""}</h4>
      <div class="card-row">${(cards || []).map((card) => renderCard(card)).join("")}</div>
    </div>
  `;
}

function renderCard(card, options = {}) {
  if (!card || card.hidden || card.faceUp === false) {
    return `<div class="playing-card face-down" ${options.action || ""}>Card</div>`;
  }

  const suit = card.suit || "";
  const label = `${card.rank || ""}${suitInitial(suit)}`;
  const red = suit === "hearts" || suit === "diamonds";
  return `
    <button class="playing-card ${red ? "red" : ""} ${options.held ? "is-held" : ""}" type="button" ${options.action || ""}>
      ${escapeHtml(label)}
    </button>
  `;
}

function renderSolitaireActionButtons(state) {
  const actions = (state.suggestedActions || []).filter((action) => action.type !== "drawStock");
  if (!actions.length) return "<p>No automatic moves available.</p>";

  return actions.map((action) => {
    const label = solitaireActionLabel(action);
    const attrs = Object.entries({
      "data-action": action.type,
      "data-source": action.sourceIndex,
      "data-target": action.targetIndex,
      "data-count": action.count,
      "data-suit": action.suit
    })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}="${value}"`)
      .join(" ");

    return `<button class="game-button" type="button" ${attrs}>${escapeHtml(label)}</button>`;
  }).join("");
}

function solitaireActionLabel(action) {
  if (action.type === "moveWasteToFoundation") return "Waste to foundation";
  if (action.type === "moveWasteToTableau") return `Waste to tableau ${action.targetIndex + 1}`;
  if (action.type === "moveTableauToFoundation") return `Tableau ${action.sourceIndex + 1} to foundation`;
  if (action.type === "moveFoundationToTableau") return `${suitLabel(action.suit)} to tableau ${action.targetIndex + 1}`;
  if (action.type === "moveTableauToTableau") {
    return `Move ${action.count} from ${action.sourceIndex + 1} to ${action.targetIndex + 1}`;
  }
  return action.type;
}

function renderDiceFaces(dice) {
  const faces = dice?.length ? dice : ["?", "?"];
  return faces.map((die) => `<div class="dice-face">${escapeHtml(String(die))}</div>`).join("");
}

function slotSymbol(id) {
  const symbols = {
    cherries: "CH",
    cherry: "CH",
    lemon: "LE",
    bell: "BE",
    seven: "7",
    diamond: "DI",
    crown: "CR",
    lightning: "LT"
  };
  return symbols[String(id).toLowerCase()] || "G";
}

function suitInitial(suit) {
  return {
    hearts: "H",
    diamonds: "D",
    clubs: "C",
    spades: "S"
  }[suit] || "";
}

function suitLabel(suit) {
  return {
    hearts: "Hearts",
    diamonds: "Diamonds",
    clubs: "Clubs",
    spades: "Spades"
  }[suit] || suit;
}

function updateWallet() {
  elements.creditBalance.textContent = Number(profile?.credits || 0).toLocaleString();
}

function showAuthMessage(message, isError = false) {
  elements.authMessage.textContent = message;
  elements.authMessage.classList.toggle("delta-bad", isError);
}

function showGameMessage(message, isError = false) {
  if (!currentGame) return;
  currentGame.message = message;
  renderCurrentGame();
  if (isError) {
    elements.gameRoot.querySelector(".round-message")?.classList.add("delta-bad");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("beforeunload", () => {
  unsubscribeAuth();
  clearMultiplayerSubscription();
});
