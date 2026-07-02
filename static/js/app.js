import {
  ensureProfile,
  getCurrentSession,
  isSupabaseConfigured,
  onAuthChange,
  playGameServer,
  signIn,
  signOut,
  signUp
} from "./supabaseClient.js";

const games = [
  {
    id: "blackjack",
    title: "Blackjack",
    type: "Table game",
    icon: "21",
    description: "Beat the dealer without busting. Blackjack pays 3:2."
  },
  {
    id: "poker",
    title: "Five-card Poker",
    type: "Card game",
    icon: "P",
    description: "Hold, draw, and chase a strong five-card hand."
  },
  {
    id: "solitaire",
    title: "Solitaire",
    type: "Card puzzle",
    icon: "S",
    description: "Clear Klondike foundations for a fixed credit prize."
  },
  {
    id: "slots",
    title: "Slots",
    type: "Machine",
    icon: "$",
    description: "Spin three weighted reels and chase premium symbols."
  },
  {
    id: "corridor",
    title: "Corridor",
    type: "Minigame",
    icon: "C",
    description: "Pick doors, bank bonuses, or risk the next room."
  },
  {
    id: "dice",
    title: "Dice Duel",
    type: "Minigame",
    icon: "D",
    description: "Call high, low, or doubles against the house dice."
  }
];

const betMemory = new Map(games.map((game) => [game.id, 10]));

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
  elements.gameNav.innerHTML = games
    .map(
      (game) => `
        <button class="nav-button" type="button" data-game="${game.id}">
          <span class="nav-icon">${escapeHtml(game.icon)}</span>
          <span>${escapeHtml(game.title)}</span>
        </button>
      `
    )
    .join("");

  elements.gameNav.querySelectorAll("[data-game]").forEach((button) => {
    button.addEventListener("click", () => openGame(button.dataset.game));
  });
}

function renderDashboard() {
  elements.dashboardView.innerHTML = games
    .map(
      (game) => `
        <article class="game-card">
          <div>
            <div class="game-card-icon">${escapeHtml(game.icon)}</div>
            <p class="eyebrow">${escapeHtml(game.type)}</p>
            <h3>${escapeHtml(game.title)}</h3>
            <p>${escapeHtml(game.description)}</p>
          </div>
          <button class="primary-action" type="button" data-game="${game.id}">Play</button>
        </article>
      `
    )
    .join("");

  elements.dashboardView.querySelectorAll("[data-game]").forEach((button) => {
    button.addEventListener("click", () => openGame(button.dataset.game));
  });
}

function showDashboard() {
  currentGame = null;
  elements.viewTitle.textContent = "Casino Dashboard";
  elements.dashboardView.classList.remove("is-hidden");
  elements.gameView.classList.add("is-hidden");
  elements.gameRoot.innerHTML = "";
  markActiveNav(null);
}

async function openGame(gameId) {
  const meta = games.find((game) => game.id === gameId);
  if (!meta) return;

  try {
    currentGame = {
      meta,
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

function markActiveNav(gameId) {
  elements.gameNav.querySelectorAll("[data-game]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.game === gameId);
  });
}

function renderCurrentGame() {
  if (!currentGame) return;

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

window.addEventListener("beforeunload", () => unsubscribeAuth());
