import { createSupabaseBrowserClient, isSupabaseConfigured } from "./supabaseClient.js?v=auth-isolation-2";

const tokenKey = "gamblingAdminToken";
const expiryKey = "gamblingAdminTokenExpiresAt";
const adminAuthStorageKey = "gamblingAdminAuth";
const adminSupabase = createSupabaseBrowserClient({
  auth: {
    storageKey: adminAuthStorageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});
const tabs = ["users", "sessions", "tables", "audit"];
const slotSymbols = ["cherries", "lemon", "bell", "seven", "diamond", "crown", "lightning"];
const state = {
  adminToken: sessionStorage.getItem(tokenKey) || "",
  expiresAt: Number(sessionStorage.getItem(expiryKey) || 0),
  tab: "users",
  profiles: [],
  sessions: [],
  tables: [],
  selectedState: null,
  selectedProfileId: ""
};

const elements = {
  unlock: document.querySelector("#adminUnlock"),
  console: document.querySelector("#adminConsole"),
  loginForm: document.querySelector("#adminLoginForm"),
  email: document.querySelector("#adminEmail"),
  accountPassword: document.querySelector("#adminAccountPassword"),
  adminPassword: document.querySelector("#adminPassword"),
  loginButton: document.querySelector("#adminLoginButton"),
  loginMessage: document.querySelector("#adminLoginMessage"),
  sessionLabel: document.querySelector("#adminSessionLabel"),
  signOut: document.querySelector("#adminSignOut"),
  tabs: document.querySelector("#adminTabs"),
  message: document.querySelector("#adminMessage"),
  content: document.querySelector("#adminContent")
};

init();

function init() {
  bindEvents();
  if (!isSupabaseConfigured) {
    showLoginMessage("Supabase is not configured.", true);
    elements.loginButton.disabled = true;
    return;
  }
  if (state.adminToken && state.expiresAt > Date.now()) {
    showConsole();
    loadCurrentTab();
  }
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", unlockAdmin);
  elements.signOut.addEventListener("click", lockAdmin);
  elements.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    state.tab = button.dataset.tab;
    renderTabs();
    loadCurrentTab();
  });
  elements.content.addEventListener("click", handleContentClick);
  elements.content.addEventListener("change", handleContentChange);
}

async function unlockAdmin(event) {
  event.preventDefault();
  showLoginMessage("Unlocking...");
  elements.loginButton.disabled = true;

  try {
    const email = elements.email.value.trim();
    await signInAdmin(email, elements.accountPassword.value);
    const data = await invokeAdmin({ type: "admin:login", adminPassword: elements.adminPassword.value }, false);
    state.adminToken = data.adminToken;
    state.expiresAt = Number(data.expiresAt || 0);
    sessionStorage.setItem(tokenKey, state.adminToken);
    sessionStorage.setItem(expiryKey, String(state.expiresAt));
    elements.sessionLabel.textContent = `Unlocked as ${data.profile?.username || email}`;
    showConsole();
    await loadCurrentTab();
  } catch (error) {
    showLoginMessage(error.message, true);
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function lockAdmin() {
  sessionStorage.removeItem(tokenKey);
  sessionStorage.removeItem(expiryKey);
  state.adminToken = "";
  state.expiresAt = 0;
  state.selectedState = null;
  try {
    await signOutAdmin();
  } catch {
    // The admin token is already gone, which is what matters here.
  }
  elements.console.classList.add("is-hidden");
  elements.unlock.classList.remove("is-hidden");
}

function showConsole() {
  elements.unlock.classList.add("is-hidden");
  elements.console.classList.remove("is-hidden");
  renderTabs();
}

function renderTabs() {
  elements.tabs.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === state.tab);
  });
}

async function loadCurrentTab() {
  clearMessage();
  if (state.tab === "users") return loadProfiles();
  if (state.tab === "sessions") return loadSessions();
  if (state.tab === "tables") return loadTables();
  if (state.tab === "audit") return loadAudit();
}

async function loadProfiles(search = "") {
  renderLoading("Loading users...");
  try {
    const data = await invokeAdmin({ type: "admin:profiles:list", search });
    state.profiles = data.profiles || [];
    renderUsers();
  } catch (error) {
    renderError(error);
  }
}

async function loadSessions() {
  renderLoading("Loading sessions...");
  try {
    const data = await invokeAdmin({ type: "admin:sessions:list", status: "active" });
    state.sessions = data.sessions || [];
    renderSessions();
  } catch (error) {
    renderError(error);
  }
}

async function loadTables() {
  renderLoading("Loading tables...");
  try {
    const data = await invokeAdmin({ type: "admin:tables:list" });
    state.tables = data.tables || [];
    renderTables();
  } catch (error) {
    renderError(error);
  }
}

async function loadAudit() {
  renderLoading("Loading audit log...");
  try {
    const data = await invokeAdmin({ type: "admin:audit:list" });
    renderAudit(data.entries || []);
  } catch (error) {
    renderError(error);
  }
}

function renderUsers() {
  elements.content.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-header">
        <div>
          <p class="eyebrow">Profiles</p>
          <h2>Credit control</h2>
        </div>
        <form class="admin-inline-form" data-user-search>
          <input id="adminUserSearch" placeholder="Search username or UUID">
          <button class="game-button" type="submit">Search</button>
          <button class="game-button" type="button" data-refresh-users>Refresh</button>
        </form>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>User</th><th>Credits</th><th>Set</th><th>Adjust</th><th>Controls</th></tr></thead>
          <tbody>
            ${state.profiles.map((profile) => `
              <tr>
                <td>
                  <strong>${escapeHtml(profile.username || "Player")}</strong>
                  <small>${escapeHtml(profile.id)}</small>
                </td>
                <td>${formatCredits(profile.credits)}</td>
                <td>
                  <input class="admin-small-input" data-credit-set="${escapeHtml(profile.id)}" type="number" min="0" max="1000000000000" step="1" value="${formatCredits(profile.credits)}">
                  <button class="game-button" type="button" data-set-credits="${escapeHtml(profile.id)}">Set</button>
                </td>
                <td>
                  <input class="admin-small-input" data-credit-adjust="${escapeHtml(profile.id)}" type="number" step="1" value="100">
                  <button class="game-button" type="button" data-adjust-credits="${escapeHtml(profile.id)}">Apply</button>
                </td>
                <td><button class="game-button" type="button" data-use-profile="${escapeHtml(profile.id)}">Use for next spin</button></td>
              </tr>
            `).join("") || `<tr><td colspan="5">No users found.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    ${renderPendingSpinPanel()}
  `;
  elements.content.querySelector("[data-user-search]").addEventListener("submit", (event) => {
    event.preventDefault();
    loadProfiles(elements.content.querySelector("#adminUserSearch").value.trim());
  });
}

function renderPendingSpinPanel() {
  return `
    <section class="admin-panel">
      <div class="admin-panel-header">
        <div>
          <p class="eyebrow">Slots</p>
          <h2>Set next spin</h2>
        </div>
      </div>
      <div class="admin-control-grid">
        <label class="field">
          <span>Profile id</span>
          <input id="slotProfileId" value="${escapeHtml(state.selectedProfileId)}" placeholder="Use a user from the table">
        </label>
        <label class="field">
          <span>Preset</span>
          <select id="slotPreset">
            <option value="lose">Lose</option>
            <option value="pair">Pair</option>
            <option value="jackpot">Jackpot</option>
          </select>
        </label>
        <label class="field">
          <span>Symbol</span>
          <select id="slotSymbol">${slotSymbols.map((symbol) => `<option value="${symbol}">${symbol}</option>`).join("")}</select>
        </label>
        <button class="primary-action admin-align-end" type="button" data-set-slot-spin>Queue spin</button>
      </div>
    </section>
  `;
}

function renderSessions() {
  elements.content.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-header">
        <div><p class="eyebrow">Solo</p><h2>Active sessions</h2></div>
        <button class="game-button" type="button" data-refresh-sessions>Refresh</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Game</th><th>User</th><th>Bet</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>
            ${state.sessions.map((session) => `
              <tr>
                <td>${escapeHtml(session.game_id)}</td>
                <td><strong>${escapeHtml(session.profile?.username || session.profile_id)}</strong><small>${escapeHtml(session.profile_id)}</small></td>
                <td>${formatCredits(session.bet)}</td>
                <td>${formatDate(session.updated_at)}</td>
                <td>
                  <button class="game-button" type="button" data-view-session="${escapeHtml(session.id)}">Inspect</button>
                  <button class="game-button" type="button" data-close-session="${escapeHtml(session.id)}">Close</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="5">No active solo sessions.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    ${renderStateInspector()}
  `;
}

function renderTables() {
  elements.content.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-header">
        <div><p class="eyebrow">Multiplayer</p><h2>Tables</h2></div>
        <button class="game-button" type="button" data-refresh-tables>Refresh</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Game</th><th>Status</th><th>Stake</th><th>Seats</th><th>Actions</th></tr></thead>
          <tbody>
            ${state.tables.map((table) => `
              <tr>
                <td>${escapeHtml(table.game_id)}<small>${escapeHtml(table.id)}</small></td>
                <td>${escapeHtml(table.status)}</td>
                <td>${formatCredits(table.stake)}</td>
                <td>${renderSeatList(table)}</td>
                <td>
                  <button class="game-button" type="button" data-view-table="${escapeHtml(table.id)}">Inspect</button>
                  <button class="game-button" type="button" data-force-timeout="${escapeHtml(table.id)}">Timeout</button>
                  <button class="game-button" type="button" data-cancel-table="${escapeHtml(table.id)}">Cancel</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="5">No tables found.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    ${renderStateInspector()}
  `;
}

function renderSeatList(table) {
  return (table.seats || []).map((seat) => `
    <span class="admin-seat-pill">
      ${escapeHtml(seat.username || "Player")}
      <small>${escapeHtml(seat.status || "")}</small>
      ${table.status === "waiting" ? `<button type="button" data-kick-seat="${escapeHtml(table.id)}" data-profile-id="${escapeHtml(seat.profileId)}">x</button>` : ""}
    </span>
  `).join("");
}

function renderStateInspector() {
  const selected = state.selectedState;
  if (!selected) {
    return `<section class="admin-panel"><p>Select a session or table to inspect controls.</p></section>`;
  }
  const gameId = selected.session?.game_id || selected.table?.game_id || selected.state?.gameId || "";
  const privateState = selected.session?.state || selected.state || {};
  return `
    <section class="admin-panel admin-state-panel">
      <div class="admin-panel-header">
        <div>
          <p class="eyebrow">${escapeHtml(selected.target || "state")}</p>
          <h2>${escapeHtml(gameId)} controls</h2>
        </div>
        <button class="game-button" type="button" data-clear-state-control>Clear pending dice controls</button>
      </div>
      ${renderGameControl(gameId, privateState)}
      <details class="admin-state-json">
        <summary>Inspect private state</summary>
        <pre>${escapeHtml(JSON.stringify(privateState, null, 2))}</pre>
      </details>
    </section>
  `;
}

function renderGameControl(gameId, privateState) {
  if (gameId === "blackjack" || gameId === "poker") {
    return `
      <div class="admin-control-grid">
        <label class="field admin-span-2">
          <span>Card codes in deal order</span>
          <input id="cardCodes" placeholder="AS,10H,7C">
        </label>
        <button class="primary-action admin-align-end" type="button" data-queue-cards>Queue cards</button>
      </div>
      <p class="form-message">Available deck: ${escapeHtml((privateState.deck || []).map(cardCode).join(", "))}</p>
    `;
  }
  if (gameId === "dice") {
    const multiplayer = Boolean(privateState.players);
    return `
      <div class="admin-control-grid">
        ${renderDieSelect("playerDie1", "Player die 1")}
        ${renderDieSelect("playerDie2", "Player die 2")}
        ${multiplayer ? "" : `${renderDieSelect("houseDie1", "House die 1")}${renderDieSelect("houseDie2", "House die 2")}`}
        <label class="field">
          <span>Profile id for table</span>
          <input id="diceProfileId" value="${escapeHtml(privateState.players?.[privateState.turnIndex]?.profileId || "")}" ${multiplayer ? "" : "disabled"}>
        </label>
        <button class="primary-action admin-align-end" type="button" data-set-dice>Set next roll</button>
      </div>
    `;
  }
  if (gameId === "corridor") {
    return `
      <div class="admin-door-grid">
        ${(privateState.currentDoors || []).map((door) => `
          <label class="field">
            <span>${escapeHtml(door.label || `Door ${door.index + 1}`)}</span>
            <select data-door-role="${door.index}">
              ${["safe", "bonus", "trap"].map((role) => `<option value="${role}" ${door.role === role ? "selected" : ""}>${role}</option>`).join("")}
            </select>
          </label>
        `).join("")}
        <button class="primary-action admin-align-end" type="button" data-save-doors>Save doors</button>
      </div>
    `;
  }
  if (gameId === "solitaire") {
    return `
      <div class="admin-control-grid">
        <label class="field">
          <span>Next stock card</span>
          <input id="solitaireStockCard" placeholder="AS or spades-1">
        </label>
        <button class="primary-action admin-align-end" type="button" data-set-solitaire-stock>Set stock top</button>
        <label class="field">
          <span>Flip tableau pile</span>
          <input id="solitairePileIndex" type="number" min="0" max="6" value="0">
        </label>
        <button class="game-button admin-align-end" type="button" data-flip-solitaire>Flip top card</button>
        <label class="field">
          <span>Move card</span>
          <input id="solitaireMoveCard" placeholder="KH or hearts-13">
        </label>
        <label class="field">
          <span>Destination</span>
          <input id="solitaireDestination" placeholder="waste, stock, tableau:0, foundation:hearts">
        </label>
        <button class="game-button admin-align-end" type="button" data-move-solitaire>Move</button>
      </div>
    `;
  }
  return `<p>No active controls for this state.</p>`;
}

function renderDieSelect(id, label) {
  return `
    <label class="field">
      <span>${label}</span>
      <select id="${id}">${[1, 2, 3, 4, 5, 6].map((value) => `<option value="${value}">${value}</option>`).join("")}</select>
    </label>
  `;
}

function renderAudit(entries) {
  elements.content.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-header">
        <div><p class="eyebrow">Trace</p><h2>Audit log</h2></div>
        <button class="game-button" type="button" data-refresh-audit>Refresh</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Targets</th></tr></thead>
          <tbody>
            ${entries.map((entry) => `
              <tr>
                <td>${formatDate(entry.created_at)}</td>
                <td>${escapeHtml(entry.admin_email || entry.admin_profile_id || "")}</td>
                <td><strong>${escapeHtml(entry.action)}</strong><small>${escapeHtml(JSON.stringify(entry.metadata || {}))}</small></td>
                <td>${escapeHtml([entry.target_profile_id, entry.target_session_id, entry.target_table_id].filter(Boolean).join(" / "))}</td>
              </tr>
            `).join("") || `<tr><td colspan="4">No audit entries.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

async function handleContentClick(event) {
  const button = event.target.closest("button");
  if (!button) return;

  try {
    if (button.matches("[data-refresh-users]")) return loadProfiles();
    if (button.matches("[data-refresh-sessions]")) return loadSessions();
    if (button.matches("[data-refresh-tables]")) return loadTables();
    if (button.matches("[data-refresh-audit]")) return loadAudit();
    if (button.dataset.useProfile) {
      state.selectedProfileId = button.dataset.useProfile;
      renderUsers();
      return;
    }
    if (button.dataset.setCredits) return updateCredits(button.dataset.setCredits, "set");
    if (button.dataset.adjustCredits) return updateCredits(button.dataset.adjustCredits, "adjust");
    if (button.matches("[data-set-slot-spin]")) return setPendingSlotSpin();
    if (button.dataset.viewSession) return viewState({ sessionId: button.dataset.viewSession });
    if (button.dataset.closeSession) return closeSession(button.dataset.closeSession);
    if (button.dataset.viewTable) return viewState({ tableId: button.dataset.viewTable });
    if (button.dataset.cancelTable) return cancelTable(button.dataset.cancelTable);
    if (button.dataset.forceTimeout) return forceTimeout(button.dataset.forceTimeout);
    if (button.dataset.kickSeat) return kickSeat(button.dataset.kickSeat, button.dataset.profileId);
    if (button.matches("[data-queue-cards]")) return setSelectedControl("queueCards", { cards: valueOf("#cardCodes") });
    if (button.matches("[data-set-dice]")) return setSelectedDice();
    if (button.matches("[data-save-doors]")) return saveDoorRoles();
    if (button.matches("[data-set-solitaire-stock]")) return setSelectedControl("nextStock", { card: valueOf("#solitaireStockCard") });
    if (button.matches("[data-flip-solitaire]")) return setSelectedControl("flipTableau", { pileIndex: Number(valueOf("#solitairePileIndex")) });
    if (button.matches("[data-move-solitaire]")) return setSelectedControl("moveCard", { card: valueOf("#solitaireMoveCard"), destination: valueOf("#solitaireDestination") });
    if (button.matches("[data-clear-state-control]")) return clearSelectedControl();
  } catch (error) {
    showMessage(error.message, true);
  }
}

function handleContentChange() {}

async function updateCredits(profileId, mode) {
  const selector = mode === "set" ? `[data-credit-set="${cssEscape(profileId)}"]` : `[data-credit-adjust="${cssEscape(profileId)}"]`;
  const amount = Number(elements.content.querySelector(selector)?.value);
  await invokeAdmin({ type: "admin:credits:update", profileId, mode, amount });
  showMessage("Credits updated.");
  await loadProfiles();
}

async function setPendingSlotSpin() {
  const profileId = valueOf("#slotProfileId");
  if (!profileId) throw new Error("Choose a profile first.");
  await invokeAdmin({
    type: "admin:game-control:set",
    profileId,
    gameId: "slots",
    controlType: "setSlotSpin",
    payload: { preset: valueOf("#slotPreset"), symbolId: valueOf("#slotSymbol") }
  });
  showMessage("Next slot spin queued.");
}

async function viewState(target) {
  state.selectedState = await invokeAdmin({ type: "admin:state:get", ...target });
  if (state.tab === "sessions") renderSessions();
  if (state.tab === "tables") renderTables();
}

async function closeSession(sessionId) {
  await invokeAdmin({ type: "admin:sessions:close", sessionId });
  showMessage("Session closed.");
  await loadSessions();
}

async function cancelTable(tableId) {
  await invokeAdmin({ type: "admin:tables:cancel", tableId });
  showMessage("Table cancelled.");
  await loadTables();
}

async function forceTimeout(tableId) {
  await invokeAdmin({ type: "admin:tables:force-timeout", tableId });
  showMessage("Timeout forced.");
  await loadTables();
}

async function kickSeat(tableId, profileId) {
  await invokeAdmin({ type: "admin:seats:kick-waiting", tableId, profileId });
  showMessage("Seat removed.");
  await loadTables();
}

async function setSelectedControl(controlType, payload) {
  if (!state.selectedState) throw new Error("Select a state first.");
  const target = state.selectedState.target === "session"
    ? { sessionId: state.selectedState.session.id }
    : { tableId: state.selectedState.table.id };
  state.selectedState = await invokeAdmin({ type: "admin:game-control:set", ...target, controlType, payload });
  showMessage("Control applied.");
  await viewState(target);
}

async function setSelectedDice() {
  const payload = {
    playerDice: [Number(valueOf("#playerDie1")), Number(valueOf("#playerDie2"))],
    houseDice: [Number(valueOf("#houseDie1")), Number(valueOf("#houseDie2"))],
    profileId: valueOf("#diceProfileId")
  };
  await setSelectedControl("setDice", payload);
}

async function saveDoorRoles() {
  const doorRoles = Array.from(elements.content.querySelectorAll("[data-door-role]")).map((select) => ({
    index: Number(select.dataset.doorRole),
    role: select.value
  }));
  await setSelectedControl("setDoors", { doorRoles });
}

async function clearSelectedControl() {
  if (!state.selectedState) return;
  const target = state.selectedState.target === "session"
    ? { sessionId: state.selectedState.session.id }
    : { tableId: state.selectedState.table.id };
  await invokeAdmin({ type: "admin:game-control:clear", ...target });
  showMessage("Pending controls cleared.");
  await viewState(target);
}

async function invokeAdmin(payload, includeToken = true) {
  if (!adminSupabase) throw new Error("Supabase is not configured.");
  const body = includeToken ? { ...payload, adminToken: state.adminToken } : payload;
  const { data, error } = await adminSupabase.functions.invoke("play-game", { body });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

async function signInAdmin(email, password) {
  if (!adminSupabase) throw new Error("Supabase is not configured.");
  const { data, error } = await adminSupabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOutAdmin() {
  if (!adminSupabase) return;
  const { error } = await adminSupabase.auth.signOut();
  if (error) throw error;
}

async function functionErrorMessage(error) {
  const fallback = error?.message || "Admin request failed.";
  const response = error?.context;
  if (!response || typeof response.clone !== "function") return fallback;
  try {
    const body = await response.clone().json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

function renderLoading(message) {
  elements.content.innerHTML = `<section class="admin-panel"><p>${escapeHtml(message)}</p></section>`;
}

function renderError(error) {
  elements.content.innerHTML = `<section class="admin-panel"><p class="delta-bad">${escapeHtml(error.message)}</p></section>`;
}

function showLoginMessage(message, isError = false) {
  elements.loginMessage.textContent = message;
  elements.loginMessage.classList.toggle("delta-bad", isError);
}

function showMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle("is-hidden", !message);
  elements.message.classList.toggle("delta-bad", isError);
}

function clearMessage() {
  showMessage("");
}

function valueOf(selector) {
  return elements.content.querySelector(selector)?.value?.trim() || "";
}

function cardCode(card) {
  if (!card?.rank || !card?.suit) return "";
  return `${card.rank}${String(card.suit).slice(0, 1).toUpperCase()}`;
}

function formatCredits(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "";
}

function cssEscape(value) {
  return String(value).replaceAll('"', '\\"');
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
