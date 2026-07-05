import {
  ensureProfile,
  getCurrentSession,
  getLeaderboard,
  isSupabaseConfigured,
  multiplayerRequest,
  onAuthChange,
  playGameServer,
  signIn,
  signOut,
  signUp,
  subscribeToMultiplayerTable,
  updateProfileAvatar
} from "./supabaseClient.js?v=clicker-1";

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
    title: "Texas Hold'em",
    type: "Card game",
    icon: "poker",
    description: "Play two hole cards with the board and win the showdown."
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
  },
  {
    id: "clicker",
    title: "Credit Clicker",
    type: "Clicker",
    icon: "clicker",
    description: "Click a credit coin, earn wallet credits, and buy stronger clicks."
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
    leaderboard: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8 21h8"></path>
        <path d="M12 17v4"></path>
        <path d="M7 4h10v4a5 5 0 0 1-10 0z"></path>
        <path d="M7 6H4a3 3 0 0 0 3 3"></path>
        <path d="M17 6h3a3 3 0 0 1-3 3"></path>
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
    `,
    clicker: `
      <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8"></circle>
        <path d="M15 8.8a4.2 4.2 0 1 0 0 6.4"></path>
        <path d="M12 2.8v2M12 19.2v2"></path>
      </svg>
    `
  };

  return icons[name] || icons.dashboard;
}

const betMemory = new Map(games.map((game) => [game.id, 10]));
const multiplayerGameIds = new Set(["blackjack", "poker", "dice"]);
const maxSoloBet = 1000000000;
const maxMultiplayerStake = 10000;
const botAvatarManifestPath = "static/img/bot-pfps/manifest.json";
const pokerBotNames = [
  "Ada",
  "Grace",
  "Hedy",
  "Einstein",
  "Nash",
  "Mira",
  "Noor",
  "Turing",
  "Katherine",
  "Claude"
];

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
  leaderboardView: document.querySelector("#leaderboardView"),
  gameView: document.querySelector("#gameView"),
  gameRoot: document.querySelector("#gameRoot"),
  viewTitle: document.querySelector("#viewTitle"),
  gameTitle: document.querySelector("#gameTitle"),
  gameTypeLabel: document.querySelector("#gameTypeLabel"),
  sessionLabel: document.querySelector("#sessionLabel"),
  creditBalance: document.querySelector("#creditBalance"),
  profileAvatarButton: document.querySelector("#profileAvatarButton"),
  profileAvatarPreview: document.querySelector("#profileAvatarPreview"),
  profileAvatarName: document.querySelector("#profileAvatarName"),
  avatarModal: document.querySelector("#avatarModal"),
  avatarModalClose: document.querySelector("#avatarModalClose"),
  avatarDropzone: document.querySelector("#avatarDropzone"),
  avatarFileInput: document.querySelector("#avatarFileInput"),
  avatarUploadButton: document.querySelector("#avatarUploadButton"),
  avatarClearButton: document.querySelector("#avatarClearButton"),
  avatarSaveButton: document.querySelector("#avatarSaveButton"),
  avatarModalPreview: document.querySelector("#avatarModalPreview"),
  avatarMessage: document.querySelector("#avatarMessage"),
  backButton: document.querySelector("#backButton"),
  signOutButton: document.querySelector("#signOutButton")
};

let authMode = "signin";
let profile = null;
let currentGame = null;
let unsubscribeAuth = () => {};
let unsubscribeMultiplayerTable = () => {};
let multiplayerSyncTimer = null;
let multiplayerRenderTimer = null;
let loadingProfileForUserId = null;
let shellMessage = "";
let pendingAvatarUrl = "";
let botAvatarUrls = [];
let clickerQueuedClicks = 0;
let clickerFlushTimer = null;

const clickerFlushMs = 250;
const clickerClientBatchLimit = 3;
const suspenseAnimationMs = 5000;
const slotSpinSymbolIds = ["cherries", "lemon", "bell", "seven", "diamond", "crown", "lightning"];

init();

async function init() {
  elements.setupWarning.classList.toggle("is-hidden", isSupabaseConfigured);
  renderNav();
  renderDashboard();
  bindShellEvents();
  setAuthMode("signin");
  loadBotAvatarManifest();

  unsubscribeAuth = onAuthChange((session) => {
    window.setTimeout(() => handleAuthSessionChange(session), 0);
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

async function handleAuthSessionChange(session) {
  if (session?.user) {
    await loadProfile(session.user);
    return;
  }

  const { session: currentSession, error } = await getCurrentSession();
  if (error) {
    showAuthMessage(error.message, true);
    showAuth();
    return;
  }

  if (currentSession?.user) {
    await loadProfile(currentSession.user);
    return;
  }

  showAuth();
}

function bindShellEvents() {
  elements.showSignIn.addEventListener("click", () => setAuthMode("signin"));
  elements.showSignUp.addEventListener("click", () => setAuthMode("signup"));
  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.backButton.addEventListener("click", showDashboard);
  elements.signOutButton.addEventListener("click", handleSignOut);
  elements.profileAvatarButton.addEventListener("click", openAvatarModal);
  elements.avatarModalClose.addEventListener("click", closeAvatarModal);
  elements.avatarModal.addEventListener("click", (event) => {
    if (event.target === elements.avatarModal) closeAvatarModal();
  });
  elements.avatarUploadButton.addEventListener("click", () => elements.avatarFileInput.click());
  elements.avatarDropzone.addEventListener("click", () => elements.avatarFileInput.click());
  elements.avatarDropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.avatarFileInput.click();
    }
  });
  elements.avatarFileInput.addEventListener("change", () => handleAvatarFile(elements.avatarFileInput.files?.[0]));
  elements.avatarClearButton.addEventListener("click", () => {
    pendingAvatarUrl = "";
    renderAvatarModalPreview();
    showAvatarMessage("Profile picture removed. Save to apply.");
  });
  elements.avatarSaveButton.addEventListener("click", saveAvatar);
  elements.avatarDropzone.addEventListener("dragover", handleAvatarDragOver);
  elements.avatarDropzone.addEventListener("dragleave", handleAvatarDragLeave);
  elements.avatarDropzone.addEventListener("drop", handleAvatarDrop);
  document.addEventListener("paste", handleAvatarPaste);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.avatarModal.classList.contains("is-hidden")) closeAvatarModal();
  });
}

async function loadBotAvatarManifest() {
  try {
    const response = await fetch(botAvatarManifestPath, { cache: "no-store" });
    if (!response.ok) return;
    const manifest = await response.json();
    const files = Array.isArray(manifest) ? manifest : manifest.files;
    botAvatarUrls = (Array.isArray(files) ? files : [])
      .map(normalizeBotAvatarPath)
      .filter(Boolean);
    if (currentGame?.meta?.id === "poker") renderCurrentGame();
  } catch {
    botAvatarUrls = [];
  }
}

function normalizeBotAvatarPath(path) {
  const value = String(path || "").trim().replaceAll("\\", "/");
  if (!value || value.includes("..")) return "";
  const normalized = value.startsWith("static/img/bot-pfps/")
    ? value
    : `static/img/bot-pfps/${value.replace(/^\/+/, "")}`;
  return /\.(png|jpe?g|webp)$/i.test(normalized) ? normalized : "";
}

function openAvatarModal() {
  pendingAvatarUrl = profile?.avatarUrl || "";
  renderAvatarModalPreview();
  showAvatarMessage("");
  elements.avatarFileInput.value = "";
  elements.avatarModal.classList.remove("is-hidden");
  elements.avatarDropzone.focus();
}

function closeAvatarModal() {
  elements.avatarModal.classList.add("is-hidden");
  elements.avatarDropzone.classList.remove("is-dragging");
}

function handleAvatarDragOver(event) {
  event.preventDefault();
  elements.avatarDropzone.classList.add("is-dragging");
}

function handleAvatarDragLeave(event) {
  if (!elements.avatarDropzone.contains(event.relatedTarget)) {
    elements.avatarDropzone.classList.remove("is-dragging");
  }
}

function handleAvatarDrop(event) {
  event.preventDefault();
  elements.avatarDropzone.classList.remove("is-dragging");
  handleAvatarFile(event.dataTransfer?.files?.[0]);
}

function handleAvatarPaste(event) {
  if (elements.avatarModal.classList.contains("is-hidden")) return;
  const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith("image/"));
  if (!item) return;
  event.preventDefault();
  handleAvatarFile(item.getAsFile());
}

async function handleAvatarFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showAvatarMessage("Choose an image file.", true);
    return;
  }

  try {
    showAvatarMessage("Preparing image...");
    pendingAvatarUrl = await imageFileToAvatarDataUrl(file);
    renderAvatarModalPreview();
    showAvatarMessage("Ready to save.");
  } catch (error) {
    showAvatarMessage(error.message, true);
  } finally {
    elements.avatarFileInput.value = "";
  }
}

async function saveAvatar() {
  if (!profile) return;
  elements.avatarSaveButton.disabled = true;
  showAvatarMessage("Saving...");

  try {
    profile = await updateProfileAvatar(pendingAvatarUrl);
    updateProfileAvatarUi();
    if (currentGame?.meta?.id === "poker") renderCurrentGame();
    showAvatarMessage("Saved.");
    closeAvatarModal();
  } catch (error) {
    showAvatarMessage(error.message, true);
  } finally {
    elements.avatarSaveButton.disabled = false;
  }
}

async function imageFileToAvatarDataUrl(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  const dataUrl = canvas.toDataURL("image/webp", 0.82);
  if (dataUrl.length > 240000) throw new Error("Image is too large after resizing.");
  return dataUrl;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Could not read that image.")));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Could not load that image.")));
    image.src = source;
  });
}

function renderAvatarModalPreview() {
  setAvatarElement(elements.avatarModalPreview, profileAvatarData({ ...profile, avatarUrl: pendingAvatarUrl }));
}

function showAvatarMessage(message, isError = false) {
  elements.avatarMessage.textContent = message;
  elements.avatarMessage.classList.toggle("delta-bad", isError);
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
  const isSameVisibleUser = profile?.id === user.id && !elements.appShell.classList.contains("is-hidden");

  try {
    if (!isSameVisibleUser) showAuthMessage("Loading account...");
    profile = await ensureProfile(user);
    if (isSameVisibleUser) {
      updateShellProfileUi();
      if (currentGame) renderCurrentGame();
    } else {
      enterApp();
    }
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
  updateShellProfileUi();
  showDashboard();
}

function updateShellProfileUi() {
  elements.sessionLabel.textContent = `Signed in as ${profile.username}`;
  elements.sessionLabel.classList.remove("delta-bad");
  shellMessage = "";
  updateWallet();
  updateProfileAvatarUi();
}

function showAuth() {
  clearMultiplayerSubscription();
  profile = null;
  currentGame = null;
  closeAvatarModal();
  elements.authScreen.classList.remove("is-hidden");
  elements.appShell.classList.add("is-hidden");
}

async function handleSignOut() {
  try {
    await signOut();
  } catch (error) {
    if (currentGame) {
      showGameMessage(error.message, true);
    } else {
      shellMessage = error.message;
      elements.sessionLabel.textContent = shellMessage;
      elements.sessionLabel.classList.add("delta-bad");
    }
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
    .join("") + `
      <div class="nav-section-title">Leaderboard</div>
      <button class="nav-button" type="button" data-leaderboard="true">
        <span class="nav-icon">${iconSvg("leaderboard")}</span>
        <span>Leaderboard</span>
      </button>
    `;

  elements.gameNav.querySelectorAll("[data-game]").forEach((button) => {
    button.addEventListener("click", () => openGame(button.dataset.game));
  });
  elements.gameNav.querySelector("[data-dashboard]").addEventListener("click", showDashboard);
  elements.gameNav.querySelector("[data-leaderboard]").addEventListener("click", showLeaderboard);
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
  clearClickerQueue();
  clearMultiplayerSubscription();
  currentGame = null;
  elements.viewTitle.textContent = "Casino Dashboard";
  elements.dashboardView.classList.remove("is-hidden");
  elements.leaderboardView.classList.add("is-hidden");
  elements.gameView.classList.add("is-hidden");
  elements.gameRoot.innerHTML = "";
  markActiveNav("dashboard");
}

async function showLeaderboard() {
  clearClickerQueue();
  clearMultiplayerSubscription();
  currentGame = null;
  elements.viewTitle.textContent = "Leaderboard";
  elements.dashboardView.classList.add("is-hidden");
  elements.leaderboardView.classList.remove("is-hidden");
  elements.gameView.classList.add("is-hidden");
  elements.gameRoot.innerHTML = "";
  markActiveNav("leaderboard");
  renderLeaderboardLoading();

  try {
    const data = await getLeaderboard(50);
    renderLeaderboard(data.leaders || []);
  } catch (error) {
    renderLeaderboardError(error);
  }
}

function renderLeaderboardLoading() {
  elements.leaderboardView.innerHTML = `
    <section class="leaderboard-panel">
      <p class="eyebrow">Ranked by credits</p>
      <h3>Loading leaderboard...</h3>
    </section>
  `;
}

function renderLeaderboardError(error) {
  elements.leaderboardView.innerHTML = `
    <section class="leaderboard-panel">
      <div class="leaderboard-header">
        <div>
          <p class="eyebrow">Ranked by credits</p>
          <h3>Leaderboard</h3>
        </div>
        <button class="secondary-action" type="button" data-refresh-leaderboard>Refresh</button>
      </div>
      <p class="form-message delta-bad">${escapeHtml(error.message || "Could not load leaderboard.")}</p>
    </section>
  `;
  bindLeaderboardActions();
}

function renderLeaderboard(leaders) {
  elements.leaderboardView.innerHTML = `
    <section class="leaderboard-panel">
      <div class="leaderboard-header">
        <div>
          <p class="eyebrow">Ranked by credits</p>
          <h3>Leaderboard</h3>
        </div>
        <button class="secondary-action" type="button" data-refresh-leaderboard>Refresh</button>
      </div>
      <div class="leaderboard-list">
        ${leaders.map(renderLeaderboardRow).join("") || `
          <div class="leaderboard-empty">No players found yet.</div>
        `}
      </div>
    </section>
  `;
  bindLeaderboardActions();
}

function renderLeaderboardRow(leader, index) {
  const rank = Number(leader.rank || index + 1);
  const isYou = leader.id === profile?.id;
  return `
    <article class="leaderboard-row ${isYou ? "is-you" : ""}">
      <div class="leaderboard-rank">${rank}</div>
      ${renderAvatarMarkup(leader, "leaderboard-avatar")}
      <div class="leaderboard-player">
        <strong>${escapeHtml(leader.username || "Player")}</strong>
        ${isYou ? `<span>You</span>` : ""}
      </div>
      <div class="leaderboard-credits">
        <span>Credits</span>
        <strong>${formatCredits(leader.credits)}</strong>
      </div>
    </article>
  `;
}

function bindLeaderboardActions() {
  elements.leaderboardView.querySelector("[data-refresh-leaderboard]")?.addEventListener("click", showLeaderboard);
}

async function openGame(gameId) {
  const meta = games.find((game) => game.id === gameId);
  if (!meta) return;

  try {
    clearClickerQueue();
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
    elements.leaderboardView.classList.add("is-hidden");
    elements.gameView.classList.remove("is-hidden");
    markActiveNav(gameId);
    renderCurrentGame();
    if (gameId === "clicker") {
      await loadClickerSession();
    }
  } catch (error) {
    showGameMessage(`Could not load ${meta.title}: ${error.message}`, true);
  }
}

function clearClickerQueue() {
  window.clearTimeout(clickerFlushTimer);
  clickerFlushTimer = null;
  clickerQueuedClicks = 0;
}

async function loadClickerSession() {
  await transitionState(() => playGameServer({ type: "clicker:load" }));
}

async function openMultiplayerLobby(gameId) {
  const meta = games.find((game) => game.id === gameId);
  if (!meta || !multiplayerGameIds.has(gameId)) return;

  clearClickerQueue();
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
  elements.leaderboardView.classList.add("is-hidden");
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
  elements.gameNav.querySelectorAll("[data-leaderboard]").forEach((button) => {
    button.classList.toggle("is-active", gameId === "leaderboard");
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

  if (currentGame.meta.id === "blackjack" || currentGame.meta.id === "poker") {
    const className = currentGame.meta.id === "blackjack" ? "blackjack-game" : "poker-game";
    elements.gameRoot.innerHTML = `
      <div class="${className}">
        ${content.surface}
      </div>
    `;
    bindGameControls(publicState);
    lockPendingControls();
    return;
  }

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
  lockPendingControls();
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
            <input id="mpStake" type="number" min="1" max="${maxMultiplayerStake}" step="1" value="${betMemory.get(currentGame.meta.id) || 10}">
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
  lockPendingControls();
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
        <p>${table.seats.length}/${table.maxPlayers} seats - ${table.stake} credits</p>
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
              <h4>${escapeHtml(gameTitle(table.gameId))} - ${escapeHtml(table.status)}</h4>
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
  lockPendingControls();
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
          ${seat ? renderAvatarMarkup(seat, "seat-avatar") : ""}
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
  const canAct = state.turnProfileId === profile?.id && ["preflop", "flop", "turn", "river"].includes(state.phase);
  const players = (state.players || []).map((player) => ({
    ...player,
    position: player.isYou ? "hero" : pokerPositionForIndex(player.seatIndex, false),
    credits: player.isYou ? profile?.credits : 998 + Number(player.seatIndex || 0),
    action: pokerPlayerAction(player, state)
  }));
  const pot = Number(state.stake || state.bet || 0) * Math.max(players.length, 1);
  return `
    ${renderPokerTable({
      state,
      players,
      mode: "multiplayer",
      canAct,
      pot,
      holdActionAttribute: "data-mp-action"
    })}
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
  scheduleTimeoutRerender(state.turnDeadlineAt);
  let actionButtons = "";
  if (table.gameId === "blackjack") {
    actionButtons = `
      <button class="game-button" type="button" data-mp-action="hit" ${yourTurn ? "" : "disabled"}>Hit</button>
      <button class="game-button" type="button" data-mp-action="stand" ${yourTurn ? "" : "disabled"}>Stand</button>
    `;
  } else if (table.gameId === "poker") {
    actionButtons = `
      <button class="game-button" type="button" data-mp-action="check" ${yourTurn ? "" : "disabled"}>${escapeHtml(pokerActionLabel(state))}</button>
      <button class="game-button" type="button" data-mp-action="fold" ${yourTurn ? "" : "disabled"}>Fold</button>
    `;
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
  await transitionMultiplayer(async (gameRef, isCurrent) => {
    const result = await multiplayerRequest({ type: "multiplayer:list", gameId: gameRef.meta.id });
    if (!isCurrent()) return;
    gameRef.tables = result.tables || [];
  });
}

async function createMultiplayerTableFromUi() {
  const stake = Number(elements.gameRoot.querySelector("#mpStake")?.value || 0);
  if (!validateMultiplayerStake(stake)) return;
  const maxPlayers = Number(elements.gameRoot.querySelector("#mpMaxPlayers")?.value || 6);
  if (!validateMaxPlayers(maxPlayers)) return;
  const visibility = elements.gameRoot.querySelector("#mpVisibility")?.value || "public";
  const diceMode = elements.gameRoot.querySelector("#mpDiceMode")?.value || "high";

  await transitionMultiplayer(async (gameRef, isCurrent) => {
    betMemory.set(gameRef.meta.id, stake);
    const result = await multiplayerRequest({
      type: "multiplayer:create",
      gameId: gameRef.meta.id,
      stake,
      maxPlayers,
      visibility,
      diceMode
    });
    if (!isCurrent()) return;
    acceptMultiplayerResult(result);
  });
}

async function joinMultiplayerByCodeFromUi() {
  const inviteCode = String(elements.gameRoot.querySelector("#mpInviteCode")?.value || "").trim().toUpperCase();
  if (!inviteCode) {
    currentGame.message = "Enter an invite code.";
    renderCurrentGame();
    return;
  }
  await joinMultiplayerTableFromUi(null, inviteCode);
}

async function joinMultiplayerTableFromUi(tableId, inviteCode = "") {
  await transitionMultiplayer(async (gameRef, isCurrent) => {
    const result = await multiplayerRequest({
      type: "multiplayer:join",
      gameId: gameRef.meta.id,
      tableId,
      inviteCode
    });
    if (!isCurrent()) return;
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
  await transitionMultiplayer(async (gameRef, isCurrent) => {
    const result = await multiplayerRequest({
      type: "multiplayer:leave",
      gameId: gameRef.meta.id,
      tableId: gameRef.table?.id
    });
    if (!isCurrent()) return;
    acceptMultiplayerResult(result);
    if (!result.table) {
      clearMultiplayerSubscription();
      gameRef.multiplayerView = "lobby";
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
  await transitionMultiplayer(async (gameRef, isCurrent) => {
    const result = await multiplayerRequest({
      ...payload,
      gameId: gameRef.meta.id,
      tableId: gameRef.table?.id
    });
    if (!isCurrent()) return;
    acceptMultiplayerResult(result);
  });
}

async function transitionMultiplayer(task) {
  const gameRef = currentGame;
  const token = Symbol("multiplayerRequest");
  gameRef.pendingToken = token;
  gameRef.pending = true;
  renderCurrentGame();

  try {
    const isCurrent = () => currentGame === gameRef && gameRef.pendingToken === token;
    if (!isCurrent()) return;
    gameRef.message = "";
    await task(gameRef, isCurrent);
  } catch (error) {
    if (currentGame === gameRef && gameRef.pendingToken === token) {
      gameRef.message = error.message;
    }
  } finally {
    if (currentGame === gameRef && gameRef.pendingToken === token) {
      gameRef.pending = false;
      gameRef.pendingToken = null;
      renderCurrentGame();
    }
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
  window.clearTimeout(multiplayerRenderTimer);
  multiplayerSyncTimer = null;
  multiplayerRenderTimer = null;
  unsubscribeMultiplayerTable();
  unsubscribeMultiplayerTable = () => {};
  if (currentGame) currentGame.subscribedTableId = null;
}

function actionFromMultiplayerButton(button) {
  const type = button.dataset.mpAction;
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
  if (stake > maxMultiplayerStake) {
    currentGame.message = `Multiplayer table stakes are capped at ${formatCredits(maxMultiplayerStake)} credits.`;
    renderCurrentGame();
    return false;
  }
  return true;
}

function validateMaxPlayers(maxPlayers) {
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 6) {
    currentGame.message = "Choose between 2 and 6 seats.";
    renderCurrentGame();
    return false;
  }
  return true;
}

function lockPendingControls() {
  if (!currentGame?.pending) return;
  elements.gameRoot.querySelectorAll("button, input, select").forEach((control) => {
    if (currentGame.meta?.id === "clicker" && control.matches("[data-clicker-coin]")) return;
    control.disabled = true;
  });
}

function scheduleTimeoutRerender(deadline) {
  window.clearTimeout(multiplayerRenderTimer);
  multiplayerRenderTimer = null;
  if (!deadline || !currentGame?.table || currentGame.table.status !== "active") return;
  const delay = Math.max(0, new Date(deadline).getTime() - Date.now()) + 250;
  multiplayerRenderTimer = window.setTimeout(() => {
    if (currentGame?.mode === "multiplayer") renderCurrentGame();
  }, delay);
}

function turnLabel(state) {
  const current = (state.players || []).find((player) => player.profileId === state.turnProfileId);
  if (!current) return state.phase || "waiting";
  const seconds = state.turnDeadlineAt
    ? Math.max(0, Math.ceil((new Date(state.turnDeadlineAt).getTime() - Date.now()) / 1000))
    : 0;
  return `${current.isYou ? "You" : current.username} - ${seconds}s`;
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
    case "clicker":
      return renderClicker(state);
    default:
      return { surface: "<p>Game unavailable.</p>", controls: "" };
  }
}

function renderClicker(state) {
  const clickValue = Number(state.clickValue || 1);
  const upgradeLevel = Number(state.upgradeLevel || 0);
  const nextUpgradeCost = Number(state.nextUpgradeCost || 25);
  const canUpgrade = Boolean(currentGame?.sessionId) && !currentGame?.pending && Number(profile?.credits || 0) >= nextUpgradeCost;

  return {
    surface: `
      <section class="clicker-stage" aria-label="Credit Clicker">
        <div class="clicker-meter">
          <span>Per click</span>
          <strong>${formatCredits(clickValue)}</strong>
        </div>
        <button class="clicker-coin" type="button" data-clicker-coin ${currentGame?.sessionId ? "" : "disabled"} aria-label="Click credit coin">
          <img class="clicker-coin-image" src="static/img/credit-clicker-coin.svg?v=flat-1" alt="" aria-hidden="true">
        </button>
        <div class="clicker-bank-note">
          <span>Wallet</span>
          <strong>${formatCredits(profile?.credits || 0)}</strong>
        </div>
      </section>
    `,
    controls: `
      <div class="control-stack clicker-control-card">
        <div class="clicker-level">
          <span>Upgrade level</span>
          <strong>${formatCredits(upgradeLevel)}</strong>
        </div>
        <div class="clicker-next">
          <span>Next upgrade</span>
          <strong>${formatCredits(nextUpgradeCost)} credits</strong>
        </div>
        <button class="game-button is-primary clicker-upgrade-button" type="button" data-clicker-upgrade ${canUpgrade ? "" : "disabled"}>
          Buy upgrade
        </button>
      </div>
    `
  };
}

function renderBlackjack(state) {
  const canAct = state.phase === "player_turn";
  const canHit = canAct && Number(state.playerValue || 0) < 21;
  const canDeal = !canAct;
  const currentBet = betMemory.get("blackjack") || 10;
  const tableBet = Number(state.bet || currentBet || 0);
  const playerValue = Number(state.playerValue || 0);
  const dealerValue = Number(state.dealerValue || 0);
  const statusLabel = state.phase === "player_turn" ? "In play" : state.phase === "round_over" ? "Round over" : "Place bet";
  const blackjackAnimations = getBlackjackAnimationPlan(state);

  return {
    surface: `
      <section class="blackjack-table" aria-label="Blackjack table">
        <div class="blackjack-felt-mark" aria-hidden="true">
          <span>Blackjack pays 3:2</span>
        </div>

        <div class="blackjack-bank">
          <span>Bank</span>
          <strong>${formatCredits(profile?.credits ?? 0)}</strong>
        </div>

        <div class="blackjack-count">
          <strong>${formatCredits(profile?.credits ?? 0)}</strong>
          <span class="mini-card-stack" aria-hidden="true">${iconSvg("poker")}</span>
        </div>

        <div class="blackjack-hand blackjack-dealer">
          <div class="blackjack-card-row">
            ${(state.dealerHand || []).map((card, index) => renderBlackjackCard(card, index, "dealer", blackjackAnimations.dealer[index])).join("") || renderBlackjackEmptyCards()}
          </div>
          <div class="blackjack-score ${dealerValue ? "" : "is-empty"}">
            <strong>${dealerValue || "-"}</strong>
            <span>Dealer</span>
          </div>
        </div>

        <div class="blackjack-action blackjack-action-left">
          <button class="blackjack-control-button" type="button" data-action="hit" ${canHit ? "" : "disabled"}>
            <span class="blackjack-button-icon" aria-hidden="true">+</span>
            Hit
          </button>
        </div>

        <div class="blackjack-pot">
          <div class="blackjack-chip">
            <span>Bet</span>
            <strong>${tableBet}</strong>
          </div>
          <strong class="blackjack-pot-value">${formatCredits(tableBet)}</strong>
        </div>

        <div class="blackjack-action blackjack-action-right">
          <button class="blackjack-control-button" type="button" data-action="split" disabled>Split</button>
          <button class="blackjack-control-button" type="button" data-action="stand" ${canAct ? "" : "disabled"}>
            <span class="blackjack-button-icon" aria-hidden="true">!</span>
            Stand
          </button>
        </div>

        <div class="blackjack-hand blackjack-player">
          <div class="blackjack-card-row">
            ${(state.playerHand || []).map((card, index) => renderBlackjackCard(card, index, "player", blackjackAnimations.player[index])).join("") || renderBlackjackEmptyCards()}
          </div>
          <div class="blackjack-score ${playerValue ? "" : "is-empty"}">
            <strong>${playerValue || "-"}</strong>
            <span>Player</span>
          </div>
        </div>

        <div class="blackjack-bet-panel">
          <div class="blackjack-status">
            <span>${escapeHtml(statusLabel)}</span>
            <strong>${formatSignedCredits(blackjackRoundNet(state))}</strong>
          </div>
          ${renderBetControl(canAct)}
          <button class="blackjack-deal-button" type="button" data-start-round ${canDeal ? "" : "disabled"}>Deal</button>
        </div>

        ${renderBlackjackResultOverlay(state)}
        ${renderBlackjackTableMessage(state)}
      </section>
    `,
    controls: ""
  };
}

function renderBlackjackResultOverlay(state) {
  if (state.phase !== "round_over") return "";

  const net = blackjackRoundNet(state);
  const resultClass = net > 0 ? "is-win" : net < 0 ? "is-loss" : "is-push";
  const title = net > 0
    ? `You won ${formatCredits(net)} credits`
    : net < 0
      ? `You lost ${formatCredits(Math.abs(net))} credits`
      : "Push. No credits lost";
  const message = state.message || "Round complete.";

  return `
    <div class="blackjack-result-overlay ${resultClass}" role="dialog" aria-live="assertive" aria-label="Blackjack round result">
      <div class="blackjack-result-banner">
        <p class="eyebrow">${escapeHtml(blackjackOutcomeLabel(state.outcome))}</p>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(message)}</span>
        <div class="blackjack-result-actions">
          <button class="blackjack-result-button is-primary" type="button" data-start-round>Play again</button>
          <button class="blackjack-result-button" type="button" data-exit-game>Exit</button>
        </div>
      </div>
    </div>
  `;
}

function renderBlackjackTableMessage(state) {
  if (state.phase === "round_over") return "";
  const message = currentGame.message || state.validationMessage || state.lastError || state.error || "";
  if (!message) return "";
  return `<p class="blackjack-table-message">${escapeHtml(message)}</p>`;
}

function blackjackRoundNet(state) {
  const bet = Number(state.bet || 0);
  const delta = Number(state.roundDelta || 0);
  switch (state.outcome) {
    case "win":
    case "dealer_bust":
      return delta - bet;
    case "lose":
    case "player_bust":
      return -bet;
    case "blackjack":
    case "dealer_blackjack":
      return delta;
    case "push":
      return 0;
    default:
      return delta;
  }
}

function blackjackOutcomeLabel(outcome) {
  return {
    blackjack: "Blackjack",
    dealer_blackjack: "Dealer blackjack",
    dealer_bust: "Dealer busted",
    player_bust: "Bust",
    push: "Push",
    win: "Win",
    lose: "Loss"
  }[outcome] || "Round over";
}

function renderPoker(state) {
  const canAct = ["preflop", "flop", "turn", "river"].includes(state.phase);
  const currentBet = Number(state.bet || betMemory.get("poker") || 10);
  return {
    surface: `
      ${renderPokerTable({
        state,
        players: getSoloPokerPlayers(),
        mode: "solo",
        canAct,
        pot: currentBet,
        controls: `
          <div class="poker-bottom-panel">
            <div class="poker-status">
              <span>${escapeHtml(pokerPhaseLabel(state))}</span>
              <strong>${escapeHtml(pokerResultLabel(state))}</strong>
            </div>
            ${renderBetControl(false)}
            <div class="poker-button-row">
              <button class="poker-control-button" type="button" data-action="raiseBet" ${canAct ? "" : "disabled"}>Bet</button>
              <button class="poker-control-button is-primary" type="button" data-start-round ${canAct ? "disabled" : ""}>Deal</button>
              <button class="poker-control-button" type="button" data-action="advanceHoldem" ${canAct ? "" : "disabled"}>${escapeHtml(pokerActionLabel(state))}</button>
              <button class="poker-control-button" type="button" data-action="newRound">Clear</button>
            </div>
          </div>
        `
      })}
    `,
    controls: ""
  };
}

function getSoloPokerPlayers() {
  if (!currentGame.soloPokerPlayers) {
    currentGame.soloPokerPlayers = createSoloPokerPlayers();
  }
  const hero = currentGame.soloPokerPlayers.find((player) => player.isYou);
  if (hero) {
    hero.username = "You";
    hero.avatarUrl = profile?.avatarUrl || "";
    hero.credits = profile?.credits || 0;
    hero.hand = currentGame.state?.hand || [];
    hero.result = currentGame.state?.result || null;
  }
  return currentGame.soloPokerPlayers;
}

function createSoloPokerPlayers() {
  const names = shuffleList(pokerBotNames).slice(0, 4);
  const positions = ["top-left", "top-right", "bottom-left", "bottom-right"];
  const bots = names.map((name, index) => ({
    username: name,
    avatarUrl: botAvatarUrls[index] || "",
    credits: 998 + index,
    action: index === 3 ? "Fold" : "Call",
    position: positions[index],
    palette: index
  }));

  return [
    ...bots,
    {
      username: "You",
      avatarUrl: profile?.avatarUrl || "",
      credits: profile?.credits || 0,
      action: "Check",
      position: "hero",
      isYou: true
    }
  ];
}

function shuffleList(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function renderPokerTable({ state, players, mode, canAct, pot, controls = "" }) {
  const normalizedPlayers = normalizePokerPlayers(players, state);
  const hero = normalizedPlayers.find((player) => player.isYou) || normalizedPlayers[normalizedPlayers.length - 1];
  const opponents = normalizedPlayers.filter((player) => player !== hero);
  const heroCards = hero.hand?.length ? hero.hand.slice(0, 2) : Array.from({ length: 2 }, () => ({ hidden: true }));

  return `
    <section class="poker-table ${mode === "multiplayer" ? "is-multiplayer" : ""}" aria-label="Poker table">
      <div class="poker-felt-mark" aria-hidden="true">Poker table</div>
      <div class="poker-pot">
        <span>Pot</span>
        <strong>${formatCredits(pot)}</strong>
      </div>
      ${opponents.map(renderPokerSeat).join("")}
      <div class="poker-community">
        ${(state.communityCards || []).concat(Array.from({ length: Math.max(0, 5 - (state.communityCards || []).length) }, () => ({ placeholder: true }))).map((card, index) => renderPokerTableCard(card, { index })).join("")}
      </div>
      <div class="poker-hero-hand">
        ${heroCards.map((card, index) => renderPokerTableCard(card, { index })).join("")}
      </div>
      ${renderPokerHeroPlate(hero, state)}
      ${renderPokerCenterMessage(state)}
      ${controls}
    </section>
  `;
}

function normalizePokerPlayers(players, state) {
  const list = (players || []).map((player, index) => ({
    ...player,
    position: player.position || pokerPositionForIndex(player.seatIndex ?? index, player.isYou),
    credits: Number(player.credits ?? profile?.credits ?? 998),
    action: player.action || pokerPlayerAction(player, state)
  }));

  return list.length ? list : createSoloPokerPlayers();
}

function pokerPositionForIndex(index, isYou = false) {
  if (isYou) return "hero";
  return ["top-left", "top-right", "bottom-right", "bottom-left", "top-center", "right-center"][Number(index) % 6] || "top-left";
}

function pokerPlayerAction(player, state) {
  if (state?.phase === "complete") return player.result?.label || player.outcome || "Done";
  if (player.isTurn) return "Turn";
  if (player.status === "checked" || player.status === "timed_out") return "Check";
  if (player.status === "folded") return "Fold";
  return "Call";
}

function renderPokerSeat(player) {
  const cards = pokerSeatCards(player);
  return `
    <article class="poker-seat seat-${escapeHtml(player.position)} ${player.isTurn ? "is-turn" : ""}">
      <div class="poker-seat-cards">
        ${cards.map((card, index) => renderPokerTableCard(card, { index, compact: true })).join("")}
      </div>
      <div class="poker-seat-body">
        ${renderAvatarMarkup(player, "poker-avatar")}
        <div class="poker-seat-stack">
          <span class="poker-seat-bank">${formatCredits(player.credits)}</span>
          <strong>${escapeHtml(player.username)}</strong>
        </div>
      </div>
      <span class="poker-action-bubble">${escapeHtml(player.action || "Call")}</span>
    </article>
  `;
}

function pokerSeatCards(player) {
  const hand = player.hand || [];
  const visible = hand.some((card) => card && !card.hidden);
  if (visible) return hand.slice(0, 2);
  return Array.from({ length: 2 }, () => ({ hidden: true }));
}

function renderPokerHeroPlate(hero, state) {
  return `
    <div class="poker-hero-plate">
      ${renderAvatarMarkup(hero, "poker-avatar")}
      <div>
        <span>${formatCredits(hero.credits)}</span>
        <strong>${escapeHtml(hero.username || "You")}</strong>
      </div>
      <small>${escapeHtml(hero.result?.label || pokerPhaseLabel(state))}</small>
    </div>
  `;
}

function renderPokerCenterMessage(state) {
  const message = currentGame.message || state.validationMessage || state.lastError || state.error || state.message || "";
  if (!message) return "";
  return `<p class="poker-table-message">${escapeHtml(message)}</p>`;
}

function pokerPhaseLabel(state) {
  if (state.phase === "preflop") return "Pre-flop";
  if (state.phase === "flop") return "Flop";
  if (state.phase === "turn") return "Turn";
  if (state.phase === "river") return "River";
  if (state.phase === "round_over" || state.phase === "complete") return "Round over";
  return "Place bet";
}

function pokerActionLabel(state) {
  if (state.phase === "preflop") return "Reveal flop";
  if (state.phase === "flop") return "Reveal turn";
  if (state.phase === "turn") return "Reveal river";
  if (state.phase === "river") return "Showdown";
  return "Check";
}

function pokerResultLabel(state) {
  if (state.result?.label) return state.result.label;
  if (state.outcome === "win") return "You won";
  if (state.outcome === "push") return "Push";
  if (state.outcome === "lose") return "You lost";
  const delta = Number(state.roundDelta || 0);
  if (delta) return formatSignedCredits(delta);
  return formatCredits(Number(state.bet || betMemory.get("poker") || 0));
}

function renderPokerTableCard(card, options = {}) {
  const tag = options.action ? "button" : "div";
  const type = options.action ? " type=\"button\"" : "";
  const tiltClass = `tilt-${Number(options.index || 0) % 5}`;
  const compactClass = options.compact ? " is-compact" : "";

  if (card?.placeholder) {
    return `<div class="poker-card is-placeholder ${tiltClass}${compactClass}"></div>`;
  }

  if (!card || card.hidden || card.faceUp === false) {
    return `<${tag} class="poker-card is-back ${tiltClass}${compactClass}"${type} ${options.action || ""}><span>G</span></${tag}>`;
  }

  const suit = card.suit || "";
  const red = suit === "hearts" || suit === "diamonds";
  const rank = escapeHtml(card.rank || "");
  const symbol = suitSymbol(suit);
  return `
    <${tag} class="poker-card ${red ? "is-red" : "is-black"} ${tiltClass}${compactClass}"${type} ${options.action || ""}>
      <span class="card-corner card-corner-top"><strong>${rank}</strong><small>${symbol}</small></span>
      <span class="card-face-symbol">${symbol}</span>
    </${tag}>
  `;
}

function renderSolitaire(state) {
  const playing = state.status === "playing";
  const foundations = Object.entries(state.foundations || {});
  const tableau = solitaireTableauForDisplay(state);
  const stockCount = Number(state.stockCount || 0);
  const wasteCount = Number(state.wasteCount || (state.wasteTop ? 1 : 0));
  const statusClass = solitaireStatusClass(state);
  const drawingStock = currentGame?.suspenseAnimation?.type === "solitaire-draw" && stockCount > 0;
  return {
    surface: `
      <div class="solitaire-table ${statusClass}">
        <div class="solitaire-top-row">
          <div class="solitaire-deck-zone ${drawingStock ? "is-drawing-stock" : ""}" aria-label="Stock and waste">
            ${renderSolitaireStock(stockCount, wasteCount, playing)}
            ${renderSolitaireWaste(state.wasteTop || null, wasteCount, playing)}
            ${drawingStock ? renderSolitaireDrawAnimation() : ""}
          </div>
          <div class="solitaire-foundations" aria-label="Foundations">
            ${foundations.map(([suit, pile]) => renderSolitaireFoundation(suit, pile, playing)).join("")}
          </div>
        </div>

        <div class="solitaire-board-header">
          <span>Tableau</span>
          <strong>${Number(state.moves || 0)} moves</strong>
        </div>

        <div class="solitaire-tableau" aria-label="Tableau piles">
          ${tableau.map((pile, index) => `
            ${renderSolitaireTableauPile(pile || [], index, playing)}
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
    `
  };
}

function solitaireTableauForDisplay(state) {
  const tableau = Array.isArray(state.tableau)
    ? state.tableau.map((pile) => Array.isArray(pile) ? pile : [])
    : [];
  const hasFaceDownCards = tableau.some((pile) => pile.some(isSolitaireFaceDown));
  const shouldShowFreshDealBacks = tableau.length === 7
    && !hasFaceDownCards
    && Number(state.moves || 0) === 0;

  if (!shouldShowFreshDealBacks) return tableau;

  return tableau.map((pile, pileIndex) => {
    const displayPile = [...pile];
    displayPile.visualHiddenCount = Math.max(0, pileIndex + 1 - displayPile.length);
    return displayPile;
  });
}

function renderSlots(state) {
  const spinning = currentGame?.suspenseAnimation?.type === "slots";
  const reels = state.lastSpin?.reels?.length ? state.lastSpin.reels : [
    { label: "Cherry" },
    { label: "Seven" },
    { label: "Crown" }
  ];
  const outcomeClass = spinning ? "is-spinning" : slotOutcomeClass(state);
  const winningId = state.lastSpin?.winningSymbol?.id || "";
  const resultLabel = spinning ? "Reels spinning..." : slotResultLabel(state);
  return {
    surface: `
      <div class="slot-machine ${outcomeClass}">
        <div class="slot-marquee">
          <span>Lucky Line</span>
          <strong>${escapeHtml(resultLabel)}</strong>
        </div>
        <div class="slot-reel-window" aria-label="Slot reels">
          ${reels.map((symbol, index) => {
            if (spinning) return renderSlotSpinningReel(index);
            const id = symbol.id || symbol.label;
            const isWinning = winningId && String(id).toLowerCase() === String(winningId).toLowerCase();
            return `
              <div class="reel ${isWinning ? "is-winning" : ""}" style="--reel-index: ${index}">
                <span class="slot-symbol" aria-hidden="true">${slotSymbol(id)}</span>
                <span class="slot-symbol-label">${escapeHtml(symbol.label || id || "Symbol")}</span>
              </div>
            `;
          }).join("")}
        </div>
        <div class="slot-payline" aria-hidden="true"></div>
        <div class="slot-lever" aria-hidden="true"><span></span></div>
      </div>
      <div class="table-zone slot-payout-zone">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Payouts</p>
            <h4>Prize ladder</h4>
          </div>
          <strong class="slot-multiplier">${escapeHtml(state.lastSpin?.payoutMultiplier ? `${state.lastSpin.payoutMultiplier}x` : "Ready")}</strong>
        </div>
        <div class="slot-payout-grid">
          ${state.payoutTable?.twoMatch ? `
            <div class="slot-payout-card"><span>Any pair</span><strong>${escapeHtml(state.payoutTable.twoMatch.pays || state.payoutTable.twoMatch.threeMatch || "")}</strong></div>
          ` : ""}
          ${(state.payoutTable?.threeMatch || []).map((entry) => `
            <div class="slot-payout-card">
              <span><i aria-hidden="true">${slotSymbol(entry.id || entry.label)}</i>${escapeHtml(entry.label)}</span>
              <strong>${escapeHtml(entry.threeMatch || entry.pays || "")}</strong>
            </div>
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
  const lastResult = state.lastResult || null;
  const corridorClass = corridorStateClass(state);
  return {
    surface: `
      <div class="corridor-scene ${corridorClass}">
        <div class="corridor-status-strip">
          <span>${inRound ? corridorRoomLabel(state) : corridorPhaseLabel(state.phase)}</span>
          <strong>${formatCredits(state.pendingBonus || state.payout || 0)} pending</strong>
        </div>
        <div class="corridor-hall" aria-label="Corridor doors">
          ${renderCorridorDoors(state)}
        </div>
        <div class="corridor-floor">
          <button class="corridor-escape-button" type="button" data-action="cashOut" ${state.canCashOut ? "" : "disabled"}>
            Escape with ${formatCredits(state.pendingBonus || 0)}
          </button>
        </div>
        ${lastResult ? `
          <div class="corridor-result ${corridorResultClass(lastResult)}">
            <span>${corridorResultIcon(lastResult)}</span>
            <strong>${escapeHtml(corridorResultText(lastResult))}</strong>
          </div>
        ` : ""}
      </div>
      <div class="table-zone corridor-history-zone">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Run history</p>
            <h4>${Number(state.roomsCleared || 0)} rooms cleared</h4>
          </div>
        </div>
        <div class="corridor-history">
          ${(state.history || []).map((entry) => `
            <div class="corridor-history-item ${corridorOutcomeClass(entry.outcome)}">
              <span>Room ${entry.roomNumber}</span>
              <strong>${escapeHtml(entry.label)} door</strong>
              <small>${escapeHtml(corridorOutcomeLabel(entry.outcome, entry.bonusAwarded))}</small>
            </div>
          `).join("") || "<p class=\"empty-state\">No rooms cleared yet.</p>"}
        </div>
      </div>
    `,
    controls: `
      ${renderBetControl(inRound)}
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-start-round ${inRound ? "disabled" : ""}>Enter</button>
        <button class="game-button" type="button" data-action="cashOut" ${state.canCashOut ? "" : "disabled"}>Escape</button>
      </div>
    `
  };
}

function renderDice(state) {
  const choosing = state.phase === "choosing_mode";
  const rolling = currentGame?.suspenseAnimation?.type === "dice";
  const outcomeClass = rolling ? "is-rolling" : diceOutcomeClass(state);
  const mode = rolling ? currentGame.suspenseAnimation.mode : state.mode;
  return {
    surface: `
      <div class="dice-duel ${outcomeClass}">
        <div class="dice-arena-header">
          <span>${escapeHtml(diceModeLabel(mode))}</span>
          <strong>${rolling ? "Rolling..." : diceResultLabel(state)}</strong>
        </div>
        <div class="dice-player-grid">
          <div class="dice-combatant is-player">
            <span>Player</span>
            <div class="dice-row">${renderDiceFaces(state.playerDice, { rolling, offset: 0 })}</div>
            <strong>${rolling ? "Rolling..." : `Total ${Number(state.playerTotal || 0)}`}</strong>
          </div>
          <div class="dice-versus" aria-hidden="true">VS</div>
          <div class="dice-combatant is-house">
            <span>House</span>
            <div class="dice-row">${renderDiceFaces(state.houseDice, { rolling, offset: 2 })}</div>
            <strong>${rolling ? "Rolling..." : `Total ${Number(state.houseTotal || 0)}`}</strong>
          </div>
        </div>
      </div>
    `,
    controls: `
      ${renderBetControl(choosing)}
      <div class="button-row">
        <button class="game-button is-primary" type="button" data-start-round ${choosing ? "disabled" : ""}>Start duel</button>
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

  elements.gameRoot.querySelectorAll("[data-exit-game]").forEach((button) => {
    button.addEventListener("click", showDashboard);
  });

  elements.gameRoot.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = actionFromButton(button, publicState);
      runPlayerAction(action);
    });
  });

  elements.gameRoot.querySelectorAll("[data-clicker-coin]").forEach((button) => {
    button.addEventListener("click", queueClickerClick);
  });

  elements.gameRoot.querySelectorAll("[data-clicker-upgrade]").forEach((button) => {
    button.addEventListener("click", buyClickerUpgrade);
  });

  if (currentGame?.meta?.id === "solitaire") {
    bindSolitaireDragAndDrop();
  }
}

function bindSolitaireDragAndDrop() {
  elements.gameRoot.querySelectorAll("[data-solitaire-drag]").forEach((source) => {
    source.addEventListener("dragstart", (event) => {
      source.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/json", JSON.stringify(solitaireDragPayload(source)));
    });

    source.addEventListener("dragend", () => {
      source.classList.remove("is-dragging");
      clearSolitaireDropTargets();
    });
  });

  elements.gameRoot.querySelectorAll("[data-solitaire-drop]").forEach((target) => {
    target.addEventListener("dragover", (event) => {
      event.preventDefault();
      target.classList.add("is-drop-target");
      event.dataTransfer.dropEffect = "move";
    });

    target.addEventListener("dragleave", () => {
      target.classList.remove("is-drop-target");
    });

    target.addEventListener("drop", (event) => {
      event.preventDefault();
      target.classList.remove("is-drop-target");
      const payload = parseSolitaireDragPayload(event.dataTransfer.getData("application/json"));
      const action = solitaireDropAction(payload, target);
      if (action) runPlayerAction(action);
    });
  });
}

function solitaireDragPayload(source) {
  return {
    source: source.dataset.solitaireDrag,
    sourceIndex: source.dataset.sourceIndex === undefined ? null : Number(source.dataset.sourceIndex),
    cardIndex: source.dataset.cardIndex === undefined ? null : Number(source.dataset.cardIndex),
    count: source.dataset.count === undefined ? 1 : Number(source.dataset.count),
    suit: source.dataset.suit || null
  };
}

function parseSolitaireDragPayload(raw) {
  try {
    const payload = JSON.parse(raw || "{}");
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function solitaireDropAction(payload, target) {
  if (!payload?.source) return null;
  const dropType = target.dataset.solitaireDrop;

  if (dropType === "foundation") {
    if (payload.source === "waste") return { type: "moveWasteToFoundation" };
    if (payload.source === "tableau" && Number(payload.count) === 1) {
      return { type: "moveTableauToFoundation", sourceIndex: Number(payload.sourceIndex) };
    }
    return null;
  }

  if (dropType === "tableau") {
    const targetIndex = Number(target.dataset.targetIndex);
    if (!Number.isInteger(targetIndex)) return null;
    if (payload.source === "waste") return { type: "moveWasteToTableau", targetIndex };
    if (payload.source === "foundation") return { type: "moveFoundationToTableau", suit: payload.suit, targetIndex };
    if (payload.source === "tableau") {
      if (Number(payload.sourceIndex) === targetIndex) return null;
      return {
        type: "moveTableauToTableau",
        sourceIndex: Number(payload.sourceIndex),
        targetIndex,
        count: Number(payload.count || 1)
      };
    }
  }

  return null;
}

function clearSolitaireDropTargets() {
  elements.gameRoot.querySelectorAll(".is-drop-target").forEach((target) => {
    target.classList.remove("is-drop-target");
  });
}

async function startRoundFromUi() {
  const bet = readBet();
  if (!validateBet(bet)) return;

  if (currentGame.meta.id === "blackjack") {
    currentGame.blackjackResetAnimationsOnNextState = true;
  }

  await transitionState(() => playGameServer({
    type: "start",
    gameId: currentGame.meta.id,
    bet
  }), suspenseOptionsForStart());
}

async function runPlayerAction(action) {
  if (action.type === "newRound") {
    currentGame.state = createInitialPublicState(currentGame.meta.id);
    currentGame.sessionId = null;
    currentGame.message = "";
    renderCurrentGame();
    return;
  }

  if (action.type === "raiseBet") {
    if (!validateBet(action.amount)) return;
    const nextBet = Number(currentGame.state?.bet || 0) + Number(action.amount || 0);
    if (nextBet > maxSoloBet) {
      currentGame.message = `The table maximum is ${formatCredits(maxSoloBet)} credits.`;
      renderCurrentGame();
      return;
    }
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
  }), suspenseOptionsForAction(action));
}

function queueClickerClick() {
  if (!currentGame || currentGame.meta.id !== "clicker" || !currentGame.sessionId) return;
  clickerQueuedClicks += 1;
  renderCurrentGame();
  scheduleClickerFlush();
}

function scheduleClickerFlush() {
  window.clearTimeout(clickerFlushTimer);
  clickerFlushTimer = window.setTimeout(flushClickerClicks, clickerFlushMs);
}

async function flushClickerClicks() {
  clickerFlushTimer = null;
  if (!currentGame || currentGame.meta.id !== "clicker" || !currentGame.sessionId || clickerQueuedClicks <= 0) return;
  if (currentGame.pending) {
    scheduleClickerFlush();
    return;
  }

  const clickCount = Math.min(clickerQueuedClicks, clickerClientBatchLimit);
  clickerQueuedClicks -= clickCount;

  await transitionState(() => playGameServer({
    type: "action",
    gameId: "clicker",
    sessionId: currentGame.sessionId,
    action: { type: "click", clickCount }
  }));

  if (clickerQueuedClicks > 0 && currentGame?.meta?.id === "clicker") {
    scheduleClickerFlush();
  }
}

async function buyClickerUpgrade() {
  if (!currentGame || currentGame.meta.id !== "clicker" || !currentGame.sessionId) return;
  if (clickerQueuedClicks > 0) await flushClickerClicks();

  await transitionState(() => playGameServer({
    type: "action",
    gameId: "clicker",
    sessionId: currentGame.sessionId,
    action: { type: "buyUpgrade" }
  }));
}

async function transitionState(nextStateFactory, options = {}) {
  const gameRef = currentGame;
  const token = Symbol("soloRequest");
  const suspenseAnimation = options.suspenseAnimation || null;
  gameRef.pendingToken = token;
  gameRef.pending = true;
  gameRef.suspenseAnimation = suspenseAnimation
    ? { ...suspenseAnimation, durationMs: suspenseAnimation.durationMs || suspenseAnimationMs, startedAt: Date.now() }
    : null;
  renderCurrentGame();

  try {
    if (currentGame !== gameRef || gameRef.pendingToken !== token) return;
    gameRef.message = "";
    const resultPromise = nextStateFactory();
    const result = gameRef.suspenseAnimation
      ? (await Promise.all([resultPromise, wait(gameRef.suspenseAnimation.durationMs)]))[0]
      : await resultPromise;
    if (currentGame !== gameRef || gameRef.pendingToken !== token) return;
    profile = result.profile || profile;
    gameRef.sessionId = result.sessionId || gameRef.sessionId;
    if (gameRef.meta.id === "blackjack" && gameRef.blackjackResetAnimationsOnNextState && result.publicState) {
      gameRef.blackjackAnimationSnapshot = createBlackjackAnimationSnapshot();
      gameRef.blackjackResetAnimationsOnNextState = false;
    }
    gameRef.state = result.publicState || gameRef.state;
    updateWallet();
  } catch (error) {
    if (currentGame === gameRef && gameRef.pendingToken === token) {
      gameRef.message = gameErrorMessage(error.message);
    }
  } finally {
    if (currentGame === gameRef && gameRef.pendingToken === token) {
      gameRef.pending = false;
      gameRef.pendingToken = null;
      gameRef.suspenseAnimation = null;
      renderCurrentGame();
    }
  }
}

function suspenseOptionsForStart() {
  if (currentGame?.meta?.id === "slots") {
    return {
      suspenseAnimation: {
        type: "slots",
        durationMs: suspenseAnimationMs
      }
    };
  }
  return {};
}

function suspenseOptionsForAction(action) {
  const type = String(action?.type || "").toLowerCase();
  if (currentGame?.meta?.id === "dice" && ["high", "low", "doubles"].includes(type)) {
    return {
      suspenseAnimation: {
        type: "dice",
        mode: type,
        durationMs: suspenseAnimationMs
      }
    };
  }
  if (currentGame?.meta?.id === "solitaire" && type === "drawstock") {
    return {
      suspenseAnimation: {
        type: "solitaire-draw",
        durationMs: 700
      }
    };
  }
  return {};
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function validateBet(bet) {
  if (!Number.isInteger(bet) || bet <= 0) {
    currentGame.message = "Choose a positive whole-credit bet.";
    renderCurrentGame();
    return false;
  }

  if (bet > maxSoloBet) {
    currentGame.message = `The table maximum is ${formatCredits(maxSoloBet)} credits.`;
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
  if (type === "raiseBet") {
    return { type, amount: readBet() };
  }
  return { type };
}

function renderBetControl(disabled) {
  const currentBet = betMemory.get(currentGame.meta.id) || 10;
  return `
    <label class="bet-control">
      <span class="eyebrow">Bet</span>
      <input id="betInput" type="number" min="1" max="${maxSoloBet}" step="1" value="${currentBet}" ${disabled ? "disabled" : ""}>
    </label>
    <div class="chip-row">
      ${[5, 10, 25, 50].map((value) => `
        <button class="chip-button ${currentBet === value ? "is-active" : ""}" type="button" data-chip="${value}" ${disabled ? "disabled" : ""}>${value}</button>
      `).join("")}
    </div>
  `;
}

function gameErrorMessage(message) {
  if (message === "bet_exceeds_max") {
    return `The table maximum is ${formatCredits(maxSoloBet)} credits.`;
  }
  if (message === "invalid_stake") {
    return `Multiplayer table stakes are capped at ${formatCredits(maxMultiplayerStake)} credits.`;
  }
  return message;
}

function renderStats(state) {
  const delta = Number(currentGame.state?.roundDelta || 0);
  if (state.gameId === "clicker") {
    return `
      <div class="stat-grid">
        <div class="stat"><span>Level</span><strong>${formatCredits(state.upgradeLevel || 0)}</strong></div>
        <div class="stat"><span>Per click</span><strong>${formatCredits(state.clickValue || 1)}</strong></div>
        <div class="stat"><span>Last delta</span><strong class="${delta >= 0 ? "delta-good" : "delta-bad"}">${formatSignedCredits(delta)}</strong></div>
        <div class="stat"><span>Balance</span><strong>${formatCredits(profile?.credits ?? 0)}</strong></div>
      </div>
    `;
  }

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
    return { ...common, hand: [], opponentHand: [], communityCards: [], phase: "idle", message: "Deal a Hold'em hand to begin." };
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
    return { ...common, totalRooms: null, isEndless: true, roomNumber: null, doors: [], history: [], canCashOut: false };
  }

  if (gameId === "dice") {
    return { ...common, playerDice: [], houseDice: [], playerTotal: 0, houseTotal: 0 };
  }

  if (gameId === "clicker") {
    return {
      ...common,
      phase: "active",
      status: "loading",
      clickValue: 1,
      upgradeLevel: 0,
      nextUpgradeCost: 25,
      totalClicks: 0,
      totalEarned: 0,
      totalSpent: 0,
      message: "Loading Credit Clicker..."
    };
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

function solitaireStatusClass(state) {
  if (state.status === "won" || state.outcome === "win") return "is-won";
  if (state.status === "playing") return "is-playing";
  return "is-idle";
}

function renderSolitaireStock(stockCount, wasteCount, playing) {
  const canDraw = playing && (stockCount > 0 || wasteCount > 0);
  const label = stockCount > 0 ? `${stockCount} in stock` : wasteCount > 0 ? "Recycle waste" : "Empty stock";
  const tag = canDraw ? "button" : "div";
  const type = canDraw ? " type=\"button\" data-action=\"drawStock\"" : "";

  return `
    <${tag} class="solitaire-slot solitaire-stock ${stockCount ? "has-cards" : ""}"${type}>
      <span class="solitaire-slot-label">Stock</span>
      <div class="playing-card face-down"><span>G</span></div>
      <strong>${escapeHtml(label)}</strong>
    </${tag}>
  `;
}

function renderSolitaireWaste(card, wasteCount, playing) {
  return `
    <div class="solitaire-slot solitaire-waste ${card ? "has-cards" : ""}">
      <span class="solitaire-slot-label">Waste</span>
      ${card ? renderSolitaireDraggableCard(renderCard(card), {
        enabled: playing,
        source: "waste"
      }) : renderSolitaireEmptySlot("Waste")}
      <strong>${formatCredits(wasteCount)} shown</strong>
    </div>
  `;
}

function renderSolitaireFoundation(suit, pile = {}, playing) {
  const count = Number(pile.count || (pile.cards || []).length || 0);
  const symbol = suitSymbol(suit);
  return `
    <div class="solitaire-slot solitaire-foundation ${count ? "has-cards" : ""}" data-solitaire-drop="foundation" data-suit="${escapeHtml(suit)}">
      <span class="solitaire-slot-label">${escapeHtml(suitLabel(suit))}</span>
      ${pile.top ? renderSolitaireDraggableCard(renderCard(pile.top), {
        enabled: playing,
        source: "foundation",
        suit
      }) : renderSolitaireEmptySlot(symbol, suit)}
      <strong>${count}/13</strong>
    </div>
  `;
}

function renderSolitaireTableauPile(pile, index, playing) {
  const cards = pile || [];
  const hiddenCount = cards.filter(isSolitaireFaceDown).length;
  const visualHiddenCount = Math.max(hiddenCount, Number(cards.visualHiddenCount || 0));
  const visualOnlyHiddenCount = Math.max(0, visualHiddenCount - hiddenCount);
  const visibleCount = Math.max(0, cards.length - hiddenCount);
  const hiddenGap = 118;
  const visibleGap = 56;
  const lastOffset = cards.length
    ? visualHiddenCount * hiddenGap + Math.max(0, visibleCount - 1) * visibleGap
    : 0;
  const stackHeight = Math.max(300, 164 + lastOffset);
  let hiddenSlot = 0;
  let visibleSlot = 0;
  return `
    <div class="solitaire-tableau-pile">
      <span class="solitaire-pile-index">${index + 1}</span>
      <div class="solitaire-card-stack" data-solitaire-drop="tableau" data-target-index="${index}" style="--card-count: ${cards.length + visualOnlyHiddenCount}; --stack-height: ${stackHeight}px">
        ${renderSolitaireVisualBacks(visualOnlyHiddenCount, hiddenGap)}
        ${cards.length ? cards.map((card, cardIndex) => {
          const isHidden = isSolitaireFaceDown(card);
          const offset = isHidden
            ? hiddenSlot++ * hiddenGap
            : visualHiddenCount * hiddenGap + visibleSlot++ * visibleGap;
          const layer = isHidden ? cardIndex + 1 : cardIndex + 50;
          const count = cards.length - cardIndex;
          const cardHtml = renderCard(card);
          return `
          <div class="solitaire-stacked-card ${isHidden ? "is-hidden-card" : "is-face-up-card"} ${card?.inferred ? "is-inferred-card" : ""}" style="top: ${offset}px; z-index: ${layer}; --card-index: ${cardIndex}; --card-offset: ${offset}px; --solitaire-card-z: ${layer}">
            ${isHidden ? cardHtml : renderSolitaireDraggableCard(cardHtml, {
              enabled: playing,
              source: "tableau",
              sourceIndex: index,
              cardIndex,
              count
            })}
          </div>
        `;
        }).join("") : renderSolitaireEmptySlot("K")}
      </div>
    </div>
  `;
}

function renderSolitaireVisualBacks(count, hiddenGap) {
  if (!count) return "";
  return Array.from({ length: count }, (_, cardIndex) => {
    const offset = cardIndex * hiddenGap;
    const layer = cardIndex + 1;
    return `
      <div class="solitaire-stacked-card is-hidden-card is-visual-hidden-card" style="top: ${offset}px; z-index: ${layer}; --card-index: ${cardIndex}; --card-offset: ${offset}px; --solitaire-card-z: ${layer}">
        ${renderCard({ faceUp: false, hidden: true })}
      </div>
    `;
  }).join("");
}

function renderSolitaireDrawAnimation() {
  return `
    <div class="solitaire-draw-travel" aria-hidden="true">
      <div class="playing-card face-down"><span>G</span></div>
    </div>
  `;
}

function isSolitaireFaceDown(card) {
  return !card || card.hidden || card.faceUp === false;
}

function renderSolitaireDraggableCard(cardHtml, data) {
  if (!data.enabled) return cardHtml;
  const attrs = [
    `data-solitaire-drag="${escapeHtml(data.source)}"`,
    data.sourceIndex !== undefined ? `data-source-index="${Number(data.sourceIndex)}"` : "",
    data.cardIndex !== undefined ? `data-card-index="${Number(data.cardIndex)}"` : "",
    data.count !== undefined ? `data-count="${Number(data.count)}"` : "",
    data.suit ? `data-suit="${escapeHtml(data.suit)}"` : ""
  ].filter(Boolean).join(" ");
  return `<div class="solitaire-draggable-card" draggable="true" ${attrs}>${cardHtml}</div>`;
}

function renderSolitaireEmptySlot(label, suit = "") {
  const red = suit === "hearts" || suit === "diamonds";
  return `
    <div class="playing-card is-empty ${red ? "red" : ""}">
      <span>${label}</span>
    </div>
  `;
}

function slotOutcomeClass(state) {
  if (state.lastSpin?.result === "jackpot") return "is-jackpot";
  if (state.lastSpin?.result === "pair" || state.outcome === "win" || state.outcome === "pair") return "is-win";
  if (state.outcome === "lose") return "is-loss";
  return "is-ready";
}

function slotResultLabel(state) {
  if (state.lastSpin?.result === "jackpot") return "Jackpot";
  if (state.lastSpin?.result === "pair") return "Pair pays";
  if (state.outcome === "lose") return "Try again";
  return "Spin to win";
}

function renderCorridorDoors(state) {
  const doors = state.doors || [];
  if (doors.length) {
    return doors.map((door) => `
      <button class="door-button" type="button" data-action="chooseDoor" data-index="${door.index}" aria-label="${escapeHtml(door.label || `Door ${door.index + 1}`)}">
        <span class="door-number">${door.index + 1}</span>
        <strong>${escapeHtml(door.label || "Door")}</strong>
      </button>
    `).join("");
  }

  if (state.lastResult?.doorIndex !== undefined) {
    return [0, 1, 2].map((index) => {
      const selected = Number(state.lastResult.doorIndex) === index;
      return `
        <div class="door-button corridor-result-door ${selected ? corridorResultClass(state.lastResult) : ""}">
          <span class="door-number">${index + 1}</span>
          <strong>${selected ? corridorResultText(state.lastResult) : "Closed"}</strong>
        </div>
      `;
    }).join("");
  }

  return [0, 1, 2].map((index) => `
    <div class="door-button is-locked">
      <span class="door-number">${index + 1}</span>
      <strong>Locked</strong>
    </div>
  `).join("");
}

function corridorStateClass(state) {
  if (state.phase === "won" || state.lastResult?.outcome === "win") return "is-win";
  if (state.phase === "trapped" || state.lastResult?.outcome === "trap") return "is-trap";
  if (state.phase === "cashedOut" || state.lastResult?.outcome === "cashOut") return "is-escaped";
  if (state.lastResult?.outcome === "bonus") return "is-bonus";
  if (state.lastResult?.outcome === "safe") return "is-safe";
  return "is-ready";
}

function corridorRoomLabel(state) {
  const roomNumber = Number(state.roomNumber || 1);
  if (state.isEndless || !state.totalRooms) return `Room ${roomNumber}`;
  return `Room ${roomNumber} of ${state.totalRooms}`;
}

function corridorResultClass(result) {
  const outcome = result?.outcome || result?.doorOutcome || "";
  if (outcome === "win" || outcome === "safe" || outcome === "bonus") return "is-success";
  if (outcome === "cashOut") return "is-escaped";
  if (outcome === "trap") return "is-fail";
  return "";
}

function corridorResultIcon(result) {
  const outcome = result?.outcome || result?.doorOutcome || "";
  if (outcome === "trap") return "!";
  if (outcome === "bonus") return "+";
  if (outcome === "cashOut") return ">";
  return "OK";
}

function corridorResultText(result) {
  const outcome = result?.outcome || result?.doorOutcome || "";
  if (outcome === "trap") return "Trap door";
  if (outcome === "bonus") return `Bonus +${formatCredits(result.bonusAwarded || 0)}`;
  if (outcome === "cashOut") return `Escaped +${formatCredits(result.payout || 0)}`;
  if (outcome === "win") return `Cleared +${formatCredits(result.payout || 0)}`;
  if (outcome === "safe") return "Safe door";
  return "Door opened";
}

function corridorPhaseLabel(phase) {
  return {
    idle: "Corridor closed",
    trapped: "Run failed",
    won: "Run cleared",
    cashedOut: "Escaped"
  }[phase] || "Corridor closed";
}

function corridorOutcomeLabel(outcome, bonusAwarded) {
  if (outcome === "bonus") return `Bonus +${formatCredits(bonusAwarded || 0)}`;
  if (outcome === "trap") return "Trap";
  if (outcome === "safe") return "Safe";
  return outcome || "Opened";
}

function corridorOutcomeClass(outcome) {
  if (outcome === "trap") return "is-fail";
  if (outcome === "bonus") return "is-bonus";
  if (outcome === "safe") return "is-success";
  return "";
}

function diceOutcomeClass(state) {
  if (state.outcome === "win") return "is-win";
  if (state.outcome === "lose") return "is-loss";
  if (state.outcome === "push") return "is-push";
  if (state.phase === "choosing_mode") return "is-choosing";
  return "is-ready";
}

function diceResultLabel(state) {
  if (state.outcome === "win") return "Player wins";
  if (state.outcome === "lose") return "House wins";
  if (state.outcome === "push") return "Push";
  if (state.phase === "choosing_mode") return "Choose a call";
  return "Ready";
}

function renderBlackjackEmptyCards() {
  return `
    <div class="blackjack-card is-placeholder"></div>
    <div class="blackjack-card is-placeholder"></div>
  `;
}

function createBlackjackAnimationSnapshot() {
  return { dealer: [], player: [] };
}

function getBlackjackAnimationPlan(state) {
  const previous = currentGame?.blackjackAnimationSnapshot || createBlackjackAnimationSnapshot();
  const current = {
    dealer: (state.dealerHand || []).map((card, index) => blackjackCardIdentity(card, index)),
    player: (state.playerHand || []).map((card, index) => blackjackCardIdentity(card, index))
  };
  const plan = createBlackjackAnimationSnapshot();
  const dealCandidates = [];

  ["player", "dealer"].forEach((owner) => {
    current[owner].forEach((identity, index) => {
      if (!identity) return;

      const priorIdentity = previous[owner]?.[index] || "";
      const holeReveal = isBlackjackHoleReveal(priorIdentity, identity);
      const shouldDeal = !priorIdentity || (priorIdentity !== identity && !holeReveal);

      if (shouldDeal) {
        dealCandidates.push({ owner, index, order: blackjackDealOrder(owner, index) });
        return;
      }

      if (holeReveal) {
        plan[owner][index] = { type: "reveal" };
      }
    });
  });

  dealCandidates
    .sort((a, b) => a.order - b.order)
    .forEach((candidate, sequence) => {
      plan[candidate.owner][candidate.index] = { type: "deal", sequence };
    });

  if (currentGame) {
    currentGame.blackjackAnimationSnapshot = current;
  }

  return plan;
}

function blackjackCardIdentity(card, index) {
  if (!card) return "";
  if (card.hidden || card.faceUp === false) return `hidden:${index}`;
  return `${card.rank || ""}:${card.suit || ""}:${card.value ?? ""}`;
}

function isBlackjackHoleReveal(previousIdentity, currentIdentity) {
  return previousIdentity.startsWith("hidden:") && !currentIdentity.startsWith("hidden:");
}

function blackjackDealOrder(owner, index) {
  if (index === 0) return owner === "player" ? 0 : 1;
  if (index === 1) return owner === "player" ? 2 : 3;
  return owner === "player" ? index + 4 : index + 5;
}

function blackjackCardAnimationAttributes(owner, animation) {
  if (!animation) return "";
  if (animation.type === "reveal") return " is-revealing";

  const delayStep = Math.min(Number(animation.sequence || 0), 4);
  return ` is-dealing deal-to-${owner} deal-delay-${delayStep}`;
}

function renderBlackjackCard(card, index, owner, animation) {
  const hidden = !card || card.hidden || card.faceUp === false;
  const tiltClass = `tilt-${index % 5}`;
  const animationClass = blackjackCardAnimationAttributes(owner, animation);

  if (hidden) {
    return `
      <div class="blackjack-card is-back ${tiltClass}${animationClass}">
        <span>G</span>
      </div>
    `;
  }

  const suit = card.suit || "";
  const red = suit === "hearts" || suit === "diamonds";
  const rank = escapeHtml(card.rank || "");
  const symbol = suitSymbol(suit);

  return `
    <div class="blackjack-card ${red ? "is-red" : "is-black"} ${tiltClass}${animationClass}">
      <span class="card-corner card-corner-top"><strong>${rank}</strong><small>${symbol}</small></span>
      <span class="card-face-symbol">${symbol}</span>
      <span class="card-corner card-corner-bottom"><strong>${rank}</strong><small>${symbol}</small></span>
    </div>
  `;
}

function renderCard(card, options = {}) {
  if (!card || card.hidden || card.faceUp === false) {
    if (options.action) {
      return `<button class="playing-card face-down" type="button" ${options.action} aria-label="Face-down card"><span>G</span></button>`;
    }
    return `<div class="playing-card face-down" aria-label="Face-down card"><span>G</span></div>`;
  }

  const suit = card.suit || "";
  const rank = escapeHtml(card.rank || "");
  const symbol = suitSymbol(suit);
  const red = suit === "hearts" || suit === "diamonds";
  return `
    <button class="playing-card ${red ? "red" : ""} ${options.held ? "is-held" : ""}" type="button" ${options.action || ""} aria-label="${rank} ${escapeHtml(suitLabel(suit))}">
      <span class="card-corner card-corner-top"><strong>${rank}</strong><small>${symbol}</small></span>
      <span class="card-face-symbol">${symbol}</span>
      <span class="card-corner card-corner-bottom"><strong>${rank}</strong><small>${symbol}</small></span>
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

function renderSlotSpinningReel(index) {
  const sequence = Array.from({ length: 4 }, () => slotSpinSymbolIds).flat();
  return `
    <div class="reel is-spinning" style="--reel-index: ${index}; --reel-speed: ${430 + index * 90}ms" aria-label="Reel spinning">
      <div class="slot-reel-strip">
        ${sequence.map((id) => `
          <span class="slot-spin-cell" aria-hidden="true">
            <span class="slot-symbol">${slotSymbol(id)}</span>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderDiceFaces(dice, options = {}) {
  const rolling = Boolean(options.rolling);
  const offset = Number(options.offset || 0);
  const faces = rolling ? [0, 1].map((index) => ((index + offset) % 6) + 1) : (dice?.length ? dice : ["?", "?"]);
  return faces.map((die, index) => {
    const value = Number(die);
    const rollingClass = rolling ? " is-rolling" : "";
    const style = rolling ? ` style="--die-index: ${index + offset}"` : "";
    if (!Number.isInteger(value) || value < 1 || value > 6) {
      return `<div class="dice-face is-unknown" aria-label="Die not rolled"><span>?</span></div>`;
    }

    return `
      <div class="dice-face die-value-${value}${rollingClass}" aria-label="${rolling ? "Rolling die" : value}"${style}>
        ${dicePipIndexes(value).map((index) => `<span class="dice-pip pip-${index}"></span>`).join("")}
      </div>
    `;
  }).join("");
}

function slotSymbol(id) {
  const symbols = {
    cherries: "cherries",
    cherry: "cherries",
    lemon: "lemon",
    bell: "bell",
    seven: "seven",
    diamond: "diamond",
    crown: "crown",
    lightning: "lightning"
  };
  const symbol = symbols[String(id).toLowerCase()] || "slot";
  return `<img class="slot-symbol-img" src="static/img/slot-symbols/${symbol}.png" alt="">`;
}

function dicePipIndexes(value) {
  return {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
  }[value] || [];
}

function suitInitial(suit) {
  return {
    hearts: "H",
    diamonds: "D",
    clubs: "C",
    spades: "S"
  }[suit] || "";
}

function suitSymbol(suit) {
  return {
    hearts: "&hearts;",
    diamonds: "&diams;",
    clubs: "&clubs;",
    spades: "&spades;"
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

function formatCredits(value) {
  return Number(value || 0).toLocaleString();
}

function formatSignedCredits(value) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${formatCredits(number)}`;
}

function updateWallet() {
  elements.creditBalance.textContent = formatCredits(profile?.credits || 0);
}

function updateProfileAvatarUi() {
  if (!profile) return;
  elements.profileAvatarName.textContent = profile.username || "Profile";
  setAvatarElement(elements.profileAvatarPreview, profileAvatarData(profile));
}

function profileAvatarData(person) {
  const name = person?.username || person?.name || "Player";
  return {
    name,
    avatarUrl: safeAvatarUrl(person?.avatarUrl || ""),
    initials: initialsForName(name),
    palette: Math.abs(hashString(name)) % 8
  };
}

function setAvatarElement(element, data) {
  if (!element) return;
  element.className = element.className
    .replace(/\bavatar-palette-\d+\b/g, "")
    .trim();
  element.classList.add(`avatar-palette-${data.palette}`);
  element.innerHTML = data.avatarUrl
    ? `<img src="${escapeHtml(data.avatarUrl)}" alt="">`
    : `<span>${escapeHtml(data.initials)}</span>`;
}

function renderAvatarMarkup(person, extraClass = "") {
  const data = profileAvatarData(person);
  const className = `profile-avatar avatar-palette-${data.palette} ${extraClass}`.trim();
  if (data.avatarUrl) {
    return `<span class="${escapeHtml(className)}"><img src="${escapeHtml(data.avatarUrl)}" alt=""></span>`;
  }
  return `<span class="${escapeHtml(className)}"><span>${escapeHtml(data.initials)}</span></span>`;
}

function safeAvatarUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i.test(url)) return url;
  if (/^static\/img\/bot-pfps\/[a-z0-9._/-]+\.(png|jpe?g|webp)$/i.test(url) && !url.includes("..")) return url;
  return "";
}

function initialsForName(name) {
  const parts = String(name || "Player").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1
    ? `${parts[0][0] || ""}${parts[1][0] || ""}`
    : String(parts[0] || "P").slice(0, 2);
  return letters.toUpperCase();
}

function hashString(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return hash;
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
