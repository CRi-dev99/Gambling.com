import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const GAME_IDS = new Set(["blackjack", "poker", "solitaire", "slots", "corridor", "dice", "clicker"]);
const MULTIPLAYER_GAME_IDS = new Set(["blackjack", "poker", "dice"]);
const MAX_BET = 1000000000;
const MAX_MULTIPLAYER_STAKE = 10000;
const MAX_CREDITS = 1000000000000;
const TURN_TIMEOUT_SECONDS = 45;
const MAX_AVATAR_DATA_URL_LENGTH = 260000;
const ADMIN_TOKEN_TTL_SECONDS = 60 * 60 * 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const env = getSupabaseEnv();
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(env.url, env.anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const admin = createClient(env.url, env.serviceKey);
    const { data: authData, error: authError } = await userClient.auth.getUser();

    if (authError || !authData?.user) {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const user = authData.user;
    const profile = await ensureProfile(admin, user);

    if (body.type === "profile") {
      return json({ profile });
    }

    if (body.type === "profile:update") {
      return json({ profile: await updateProfile(admin, user.id, body) });
    }

    if (body.type === "leaderboard") {
      return json(await listLeaderboard(admin, body));
    }

    if (String(body.type || "").startsWith("admin:")) {
      const result = await handleAdmin(admin, user, profile, body);
      return json(result);
    }

    if (String(body.type || "").startsWith("multiplayer:")) {
      const result = await handleMultiplayer(admin, user, profile, body);
      return json(result);
    }

    if (body.type === "clicker:load") {
      return json(await loadClickerSession(admin, user, profile));
    }

    if (!GAME_IDS.has(body.gameId)) {
      return json({ error: "unknown_game" }, 400);
    }

    if (body.type === "start") {
      const bet = parseBet(body.bet);
      const override = await consumePendingGameOverride(admin, user.id, body.gameId, "solo_start");
      const started = startGame(body.gameId, bet, override?.payload || null);
      const created = await rpcSingle(admin, "create_game_session", {
        p_profile_id: user.id,
        p_game_id: body.gameId,
        p_state: started.state,
        p_status: started.status,
        p_bet: bet,
        p_delta: started.delta,
        p_outcome: started.outcome,
        p_action: "start"
      });

      return json({
        profile: { ...profile, credits: Number(created.credits) },
        sessionId: created.session_id,
        sessionVersion: created.session_version,
        publicState: publicState(body.gameId, started.state, started.delta, started.message)
      });
    }

    if (body.type === "action") {
      const sessionId = String(body.sessionId || "");
      if (!sessionId) return json({ error: "missing_session" }, 400);

      const { data: session, error: sessionError } = await admin
        .from("game_sessions")
        .select("id, game_id, status, bet, state, version")
        .eq("id", sessionId)
        .eq("profile_id", user.id)
        .eq("game_id", body.gameId)
        .maybeSingle();

      if (sessionError) throw sessionError;
      if (!session) return json({ error: "session_not_found" }, 404);
      if (session.status !== "active") return json({ error: "session_closed" }, 409);

      const stepped = stepGame(body.gameId, session.state, body.action || {});
      const nextBet = Number(stepped.bet ?? stepped.state?.bet ?? session.bet);
      const applied = await rpcSingle(admin, "apply_game_step", {
        p_profile_id: user.id,
        p_session_id: session.id,
        p_expected_version: session.version,
        p_game_id: body.gameId,
        p_state: stepped.state,
        p_status: stepped.status,
        p_bet: Number.isFinite(nextBet) ? nextBet : session.bet,
        p_delta: stepped.delta,
        p_outcome: stepped.outcome,
        p_action: actionName(body.action)
      });

      return json({
        profile: { ...profile, credits: Number(applied.credits) },
        sessionId: session.id,
        sessionVersion: applied.session_version,
        publicState: publicState(body.gameId, stepped.state, stepped.delta, stepped.message)
      });
    }

    return json({ error: "unknown_request_type" }, 400);
  } catch (error) {
    const message = String(error?.message || error);
    console.error("play-game error", message);
    return json({ error: publicErrorMessage(message) }, publicErrorStatus(message));
  }
});

function publicErrorStatus(message) {
  if (message.includes("insufficient_credits")) return 402;
  if (message.includes("unauthorized") || message.includes("admin_token") || message.includes("admin_login_failed")) return 401;
  if (message.includes("not_your_turn") || message.includes("host_only") || message.includes("admin_forbidden")) return 403;
  if (message.includes("session_not_found") || message.includes("table_not_found")) return 404;
  if (message.includes("stale_or_closed_game_session") || message.includes("session_closed")) return 409;
  return 400;
}

function publicErrorMessage(message) {
  const knownErrors = [
    "action_not_supported",
    "admin_card_unavailable",
    "admin_forbidden",
    "admin_login_failed",
    "admin_not_configured",
    "admin_token_expired",
    "admin_token_required",
    "already_at_table",
    "blackjack_round_not_active",
    "blackjack_table_not_active",
    "bet_exceeds_max",
    "bet_must_be_positive_integer",
    "cannot_leave_active_table",
    "cashout_not_available",
    "click_rate_limited",
    "could_not_create_invite_code",
    "dice_table_not_active",
    "door_not_available",
    "host_only",
    "illegal_move",
    "insufficient_credits",
    "invalid_action",
    "invalid_admin_action",
    "invalid_admin_token",
    "invalid_avatar",
    "invalid_bet",
    "invalid_blackjack_action",
    "invalid_card",
    "invalid_card_index",
    "invalid_corridor_action",
    "invalid_dice_action",
    "invalid_dice_mode",
    "invalid_invite_code",
    "invalid_multiplayer_status",
    "invalid_poker_action",
    "invalid_seat_count",
    "invalid_stake",
    "invalid_slot_symbol",
    "avatar_too_large",
    "max_players_must_be_2_to_6",
    "missing_session",
    "multiplayer_seats_changed",
    "multiplayer_settlement_changed",
    "multiplayer_state_not_found",
    "multiplayer_table_not_found",
    "need_at_least_two_players",
    "no_active_turn",
    "not_seated_at_table",
    "not_your_turn",
    "players_not_ready",
    "poker_round_not_active",
    "poker_table_not_active",
    "profile_not_found",
    "session_closed",
    "session_not_found",
    "stale_multiplayer_step",
    "stale_multiplayer_table",
    "stale_or_closed_game_session",
    "stand_required_at_21",
    "stock_empty",
    "table_already_started",
    "table_full",
    "table_not_active",
    "table_not_found",
    "turn_deadline_not_reached",
    "unknown_game",
    "unknown_multiplayer_game",
    "unknown_multiplayer_request",
    "unknown_request_type"
  ];
  return knownErrors.find((knownError) => message.includes(knownError)) || "game_request_failed";
}

function getSupabaseEnv() {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    firstJsonValue(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY") ||
    firstJsonValue(Deno.env.get("SUPABASE_SECRET_KEYS"));

  if (!url || !anonKey || !serviceKey) {
    throw new Error("Supabase function environment is missing required keys.");
  }

  return { url, anonKey, serviceKey };
}

function firstJsonValue(raw) {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

async function ensureProfile(admin, user) {
  const username = user.user_metadata?.username || user.email?.split("@")[0] || "Player";
  const data = await rpcSingle(admin, "ensure_profile", {
    p_profile_id: user.id,
    p_username: username
  });
  let { data: profileRow, error } = await admin
    .from("profiles")
    .select("id, username, credits, avatar_url")
    .eq("id", data.id)
    .single();
  if (error && String(error.message || "").includes("avatar_url")) {
    const fallback = await admin
      .from("profiles")
      .select("id, username, credits")
      .eq("id", data.id)
      .single();
    profileRow = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return publicProfile(profileRow);
}

async function updateProfile(admin, profileId, body) {
  const avatarUrl = normalizeAvatarUrl(body.avatarUrl ?? body.avatar_url ?? body.avatarDataUrl);
  const timestamp = new Date().toISOString();
  const { data, error } = await admin
    .from("profiles")
    .update({ avatar_url: avatarUrl, updated_at: timestamp })
    .eq("id", profileId)
    .select("id, username, credits, avatar_url")
    .single();
  if (error) throw error;

  const { error: seatError } = await admin
    .from("multiplayer_table_seats")
    .update({ avatar_url: avatarUrl, updated_at: timestamp })
    .eq("profile_id", profileId)
    .in("status", ["seated", "ready", "active", "settled"]);
  if (seatError) throw seatError;

  return publicProfile(data);
}

function publicProfile(row) {
  return {
    id: row.id,
    username: row.username,
    credits: Number(row.credits),
    avatarUrl: row.avatar_url || ""
  };
}

function normalizeAvatarUrl(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("invalid_avatar");
  if (value.length > MAX_AVATAR_DATA_URL_LENGTH) throw new Error("avatar_too_large");
  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
    throw new Error("invalid_avatar");
  }
  return value;
}

async function rpcSingle(client, fn, args) {
  const { data, error } = await client.rpc(fn, args).single();
  if (error) throw error;
  return data;
}

async function rpcRows(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw error;
  return data || [];
}

async function listLeaderboard(admin, body) {
  const requestedLimit = Number(body.limit || 25);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 25;
  const { data, error } = await admin
    .from("profiles")
    .select("id, username, credits, avatar_url")
    .order("credits", { ascending: false })
    .order("username", { ascending: true })
    .limit(limit);
  if (error) throw error;

  return {
    leaders: (data || []).map((row, index) => ({
      ...publicProfile(row),
      rank: index + 1
    }))
  };
}

async function loadClickerSession(admin, user, profile) {
  const { data: session, error } = await admin
    .from("game_sessions")
    .select("id, game_id, status, bet, state, version")
    .eq("profile_id", user.id)
    .eq("game_id", "clicker")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (session) {
    const state = normalizeClickerState(session.state);
    return {
      profile,
      sessionId: session.id,
      sessionVersion: session.version,
      publicState: clickerPublic(state, 0, state.message)
    };
  }

  const state = createClickerState();
  const created = await rpcSingle(admin, "create_game_session", {
    p_profile_id: user.id,
    p_game_id: "clicker",
    p_state: state,
    p_status: "active",
    p_bet: 0,
    p_delta: 0,
    p_outcome: "loaded",
    p_action: "clicker_load"
  });

  return {
    profile: { ...profile, credits: Number(created.credits) },
    sessionId: created.session_id,
    sessionVersion: created.session_version,
    publicState: clickerPublic(state, 0, state.message)
  };
}

async function handleAdmin(admin, user, profile, body) {
  if (body.type === "admin:login") return adminLogin(user, profile, body);

  const adminSession = await requireAdminUser(user, body);
  switch (body.type) {
    case "admin:profiles:list":
      return adminListProfiles(admin, body);
    case "admin:credits:update":
      return adminUpdateCredits(admin, adminSession, body);
    case "admin:sessions:list":
      return adminListSessions(admin, body);
    case "admin:tables:list":
      return adminListTables(admin, body);
    case "admin:state:get":
      return adminGetState(admin, body);
    case "admin:game-control:set":
      return adminSetGameControl(admin, adminSession, body);
    case "admin:game-control:clear":
      return adminClearGameControl(admin, adminSession, body);
    case "admin:sessions:close":
      return adminCloseSession(admin, adminSession, body);
    case "admin:tables:cancel":
      return adminCancelTable(admin, adminSession, body);
    case "admin:tables:force-timeout":
      return adminForceTableTimeout(admin, adminSession, body);
    case "admin:seats:kick-waiting":
      return adminKickWaitingSeat(admin, adminSession, body);
    case "admin:audit:list":
      return adminListAudit(admin, body);
    default:
      throw new Error("invalid_admin_action");
  }
}

async function adminLogin(user, profile, body) {
  const config = getAdminConfig();
  const email = String(user.email || "").toLowerCase();
  if (!config.emails.has(email) || String(body.adminPassword || body.password || "") !== config.password) {
    throw new Error("admin_login_failed");
  }

  const expiresAt = Date.now() + ADMIN_TOKEN_TTL_SECONDS * 1000;
  const adminToken = await signAdminToken({
    sub: user.id,
    email,
    exp: expiresAt
  }, config.tokenSecret);

  return {
    adminToken,
    expiresAt,
    profile
  };
}

async function requireAdminUser(user, body) {
  const config = getAdminConfig();
  const token = String(body.adminToken || "");
  if (!token) throw new Error("admin_token_required");
  const payload = await verifyAdminToken(token, config.tokenSecret);
  const email = String(user.email || "").toLowerCase();
  if (payload.sub !== user.id || payload.email !== email) throw new Error("invalid_admin_token");
  if (!config.emails.has(email)) throw new Error("admin_forbidden");
  if (Number(payload.exp || 0) < Date.now()) throw new Error("admin_token_expired");
  return { profileId: user.id, email };
}

function getAdminConfig() {
  const emails = new Set(String(Deno.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
  const password = Deno.env.get("ADMIN_PASSWORD") || "";
  const tokenSecret = Deno.env.get("ADMIN_TOKEN_SECRET") || "";
  if (!emails.size || !password || !tokenSecret) throw new Error("admin_not_configured");
  return { emails, password, tokenSecret };
}

async function signAdminToken(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSign(body, secret);
  return `${body}.${signature}`;
}

async function verifyAdminToken(token, secret) {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("invalid_admin_token");
  const expected = await hmacSign(body, secret);
  if (!timingSafeEqual(signature, expected)) throw new Error("invalid_admin_token");
  try {
    return JSON.parse(base64UrlDecode(body));
  } catch {
    throw new Error("invalid_admin_token");
  }
}

async function hmacSign(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function base64UrlEncode(value) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`;
  return atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return base64UrlEncode(binary);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function adminListProfiles(admin, body) {
  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);
  const search = String(body.search || "").trim();
  let query = admin
    .from("profiles")
    .select("id, username, credits, avatar_url, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (search) {
    query = /^[0-9a-f-]{36}$/i.test(search)
      ? query.eq("id", search)
      : query.ilike("username", `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return { profiles: (data || []).map(publicProfile) };
}

async function adminUpdateCredits(admin, adminSession, body) {
  const profileId = String(body.profileId || body.targetProfileId || "");
  if (!profileId) throw new Error("invalid_admin_action");
  const mode = String(body.mode || "adjust").toLowerCase();
  const amount = roundMoney(Number(body.amount));
  if (!Number.isFinite(amount) || !["set", "adjust"].includes(mode)) throw new Error("invalid_admin_action");

  const before = await getProfileRow(admin, profileId);
  if (!before) throw new Error("profile_not_found");
  const currentCredits = Number(before.credits);
  const nextCredits = roundMoney(mode === "set" ? amount : currentCredits + amount);
  if (nextCredits < 0 || nextCredits > MAX_CREDITS) throw new Error("invalid_admin_action");

  const { data: after, error } = await admin
    .from("profiles")
    .update({ credits: nextCredits, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .select("id, username, credits, avatar_url, created_at, updated_at")
    .single();
  if (error) throw error;

  const delta = roundMoney(nextCredits - currentCredits);
  const { error: historyError } = await admin.from("game_history").insert({
    profile_id: profileId,
    game_id: "admin",
    bet: 0,
    delta,
    balance_after: nextCredits,
    outcome: "admin_adjustment",
    action: `admin_${mode}`
  });
  if (historyError) throw historyError;

  await writeAdminAudit(admin, adminSession, {
    action: "credits:update",
    targetProfileId: profileId,
    beforeState: publicProfile(before),
    afterState: publicProfile(after),
    metadata: { mode, amount, delta, note: String(body.note || body.reason || "") }
  });

  return { profile: publicProfile(after) };
}

async function getProfileRow(admin, profileId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, username, credits, avatar_url, created_at, updated_at")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function adminListSessions(admin, body) {
  let query = admin
    .from("game_sessions")
    .select("id, profile_id, game_id, status, bet, state, version, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(Number(body.limit || 60), 1), 200));
  if (body.status) query = query.eq("status", String(body.status));
  if (body.gameId) query = query.eq("game_id", String(body.gameId));
  const { data, error } = await query;
  if (error) throw error;
  const profiles = await profilesById(admin, (data || []).map((session) => session.profile_id));
  return {
    sessions: (data || []).map((session) => ({
      ...session,
      profile: profiles.get(session.profile_id) || null
    }))
  };
}

async function adminListTables(admin, body) {
  let query = admin
    .from("multiplayer_tables")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(Number(body.limit || 60), 1), 200));
  if (body.status) query = query.eq("status", String(body.status));
  if (body.gameId) query = query.eq("game_id", parseMultiplayerGameId(body.gameId));
  const { data, error } = await query;
  if (error) throw error;
  const tables = [];
  for (const table of data || []) {
    const seats = await getMultiplayerSeats(admin, table.id);
    tables.push({ ...table, seats: seats.map(publicSeat) });
  }
  return { tables };
}

async function adminGetState(admin, body) {
  if (body.sessionId) {
    const session = await getAdminSession(admin, String(body.sessionId));
    if (!session) throw new Error("session_not_found");
    const profile = await getProfileRow(admin, session.profile_id);
    return {
      target: "session",
      session,
      profile: profile ? publicProfile(profile) : null,
      controls: adminControlHints(session.game_id, session.state)
    };
  }

  if (body.tableId) {
    const table = await getMultiplayerTable(admin, String(body.tableId));
    if (!table) throw new Error("multiplayer_table_not_found");
    const seats = await getMultiplayerSeats(admin, table.id);
    const state = await getMultiplayerPrivateState(admin, table.id);
    return {
      target: "table",
      table,
      seats: seats.map(publicSeat),
      state: state?.state || null,
      controls: adminControlHints(table.game_id, state?.state || {})
    };
  }

  throw new Error("invalid_admin_action");
}

function adminControlHints(gameId, state) {
  return {
    gameId,
    cardSuits: CARD_SUITS,
    cardRanks: gameId === "poker" ? POKER_RANKS : CARD_RANKS,
    slotSymbols: SLOT_SYMBOLS.map(({ id, label, multiplier }) => ({ id, label, multiplier })),
    currentPhase: state?.phase || state?.status || "unknown",
    availableDeckCards: Array.isArray(state?.deck) ? state.deck.map(cardCode) : [],
    stockCards: Array.isArray(state?.stock) ? state.stock.map(solitaireCardCode) : []
  };
}

async function getAdminSession(admin, sessionId) {
  const { data, error } = await admin
    .from("game_sessions")
    .select("id, profile_id, game_id, status, bet, state, version, created_at, updated_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function adminSetGameControl(admin, adminSession, body) {
  if (body.profileId && body.gameId && !body.sessionId && !body.tableId) {
    const payload = normalizePendingOverridePayload(body.gameId, body.controlType, body.payload || body.control || {});
    const { data, error } = await admin
      .from("admin_game_overrides")
      .insert({
        admin_profile_id: adminSession.profileId,
        profile_id: String(body.profileId),
        game_id: String(body.gameId),
        override_type: "solo_start",
        payload
      })
      .select("*")
      .single();
    if (error) throw error;
    await writeAdminAudit(admin, adminSession, {
      action: "game-control:pending",
      targetProfileId: String(body.profileId),
      afterState: data,
      metadata: { gameId: body.gameId, controlType: body.controlType }
    });
    return { override: data };
  }

  if (body.sessionId) return adminSetSessionGameControl(admin, adminSession, body);
  if (body.tableId) return adminSetTableGameControl(admin, adminSession, body);
  throw new Error("invalid_admin_action");
}

async function adminSetSessionGameControl(admin, adminSession, body) {
  const session = await getAdminSession(admin, String(body.sessionId));
  if (!session) throw new Error("session_not_found");
  if (session.status !== "active") throw new Error("session_closed");
  const beforeState = structuredClone(session.state || {});
  const nextState = applyAdminGameControl(session.game_id, structuredClone(session.state || {}), String(body.controlType || ""), body.payload || body.control || {}, "session");
  const { data, error } = await admin
    .from("game_sessions")
    .update({
      state: nextState,
      version: Number(session.version || 1) + 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", session.id)
    .select("id, profile_id, game_id, status, bet, state, version, created_at, updated_at")
    .single();
  if (error) throw error;
  await writeAdminAudit(admin, adminSession, {
    action: "game-control:session",
    targetProfileId: session.profile_id,
    targetSessionId: session.id,
    beforeState,
    afterState: nextState,
    metadata: { gameId: session.game_id, controlType: body.controlType }
  });
  return { session: data, controls: adminControlHints(data.game_id, data.state) };
}

async function adminSetTableGameControl(admin, adminSession, body) {
  const table = await getMultiplayerTable(admin, String(body.tableId));
  if (!table) throw new Error("multiplayer_table_not_found");
  const stateRow = await getMultiplayerPrivateState(admin, table.id);
  if (!stateRow?.state) throw new Error("multiplayer_state_not_found");
  const beforeState = structuredClone(stateRow.state);
  const nextState = applyAdminGameControl(table.game_id, structuredClone(stateRow.state), String(body.controlType || ""), body.payload || body.control || {}, "table");
  const seats = await getMultiplayerSeats(admin, table.id);
  const nextTable = await updateAdminMultiplayerState(admin, table, seats, nextState);
  await writeAdminAudit(admin, adminSession, {
    action: "game-control:table",
    targetTableId: table.id,
    beforeState,
    afterState: nextState,
    metadata: { gameId: table.game_id, controlType: body.controlType }
  });
  return { table: nextTable, state: nextState, controls: adminControlHints(table.game_id, nextState) };
}

async function adminClearGameControl(admin, adminSession, body) {
  if (body.overrideId) {
    const { data, error } = await admin
      .from("admin_game_overrides")
      .update({ consumed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", String(body.overrideId))
      .select("*")
      .single();
    if (error) throw error;
    await writeAdminAudit(admin, adminSession, { action: "game-control:clear-pending", afterState: data });
    return { override: data };
  }
  if (body.sessionId) {
    const session = await getAdminSession(admin, String(body.sessionId));
    if (!session) throw new Error("session_not_found");
    const nextState = { ...(session.state || {}) };
    delete nextState.adminControl;
    const { data, error } = await admin
      .from("game_sessions")
      .update({ state: nextState, version: Number(session.version || 1) + 1, updated_at: new Date().toISOString() })
      .eq("id", session.id)
      .select("id, profile_id, game_id, status, bet, state, version, created_at, updated_at")
      .single();
    if (error) throw error;
    await writeAdminAudit(admin, adminSession, { action: "game-control:clear-session", targetSessionId: session.id, beforeState: session.state, afterState: nextState });
    return { session: data };
  }
  if (body.tableId) {
    const table = await getMultiplayerTable(admin, String(body.tableId));
    if (!table) throw new Error("multiplayer_table_not_found");
    const stateRow = await getMultiplayerPrivateState(admin, table.id);
    const nextState = { ...(stateRow?.state || {}) };
    delete nextState.adminControl;
    const seats = await getMultiplayerSeats(admin, table.id);
    const nextTable = await updateAdminMultiplayerState(admin, table, seats, nextState);
    await writeAdminAudit(admin, adminSession, { action: "game-control:clear-table", targetTableId: table.id, beforeState: stateRow?.state || null, afterState: nextState });
    return { table: nextTable, state: nextState };
  }
  throw new Error("invalid_admin_action");
}

async function adminCloseSession(admin, adminSession, body) {
  const session = await getAdminSession(admin, String(body.sessionId || ""));
  if (!session) throw new Error("session_not_found");
  const { data, error } = await admin
    .from("game_sessions")
    .update({ status: "complete", version: Number(session.version || 1) + 1, updated_at: new Date().toISOString() })
    .eq("id", session.id)
    .select("id, profile_id, game_id, status, bet, state, version, created_at, updated_at")
    .single();
  if (error) throw error;
  await writeAdminAudit(admin, adminSession, { action: "sessions:close", targetProfileId: session.profile_id, targetSessionId: session.id, beforeState: session, afterState: data });
  return { session: data };
}

async function adminCancelTable(admin, adminSession, body) {
  const table = await getMultiplayerTable(admin, String(body.tableId || ""));
  if (!table) throw new Error("multiplayer_table_not_found");
  const seats = await getMultiplayerSeats(admin, table.id);
  const stateRow = await getMultiplayerPrivateState(admin, table.id);
  const refunds = [];

  if (table.status === "active") {
    for (const seat of seats.filter((seat) => ["active", "ready", "seated"].includes(seat.status))) {
      const refund = await adjustProfileCredits(admin, seat.profile_id, Number(table.stake), "admin_table_refund", table.game_id, table.id);
      refunds.push({ profileId: seat.profile_id, credits: refund.credits, delta: Number(table.stake) });
    }
  }

  const timestamp = new Date().toISOString();
  const publicState = {
    ...(table.public_state || {}),
    phase: "cancelled",
    status: "cancelled",
    message: "Table cancelled by admin."
  };
  const { data: nextTable, error } = await admin
    .from("multiplayer_tables")
    .update({
      status: "cancelled",
      turn_profile_id: null,
      turn_deadline_at: null,
      public_state: publicState,
      version: Number(table.version || 1) + 1,
      updated_at: timestamp
    })
    .eq("id", table.id)
    .select("*")
    .single();
  if (error) throw error;

  const { error: stateError } = await admin
    .from("multiplayer_table_state")
    .update({ state: { ...(stateRow?.state || {}), phase: "cancelled", message: "Table cancelled by admin." }, updated_at: timestamp })
    .eq("table_id", table.id);
  if (stateError) throw stateError;

  const { error: seatsError } = await admin
    .from("multiplayer_table_seats")
    .update({ status: "abandoned", updated_at: timestamp })
    .eq("table_id", table.id)
    .in("status", ["seated", "ready", "active"]);
  if (seatsError) throw seatsError;

  await writeAdminAudit(admin, adminSession, {
    action: "tables:cancel",
    targetTableId: table.id,
    beforeState: { table, seats, state: stateRow?.state || null },
    afterState: { table: nextTable, refunds },
    metadata: { refunds }
  });
  return { table: nextTable, refunds };
}

async function adminForceTableTimeout(admin, adminSession, body) {
  const table = await getMultiplayerTable(admin, String(body.tableId || ""));
  if (!table) throw new Error("multiplayer_table_not_found");
  if (table.status !== "active") throw new Error("table_not_active");
  const stateRow = await getMultiplayerPrivateState(admin, table.id);
  const state = stateRow?.state;
  if (!state) throw new Error("multiplayer_state_not_found");
  const actorProfileId = currentTurnProfileId(state);
  if (!actorProfileId) throw new Error("no_active_turn");
  const beforeState = structuredClone(state);
  const next = stepMultiplayerState(state, actorProfileId, {}, true);
  const seats = await getMultiplayerSeats(admin, table.id);
  const complete = next.phase === "complete";
  const settlements = complete ? multiplayerSettlements(next, Number(table.stake)) : [];
  const entries = settlements.map((item) => ({
    profileId: item.profileId,
    bet: Number(table.stake),
    delta: item.payout,
    outcome: item.outcome,
    action: "multiplayer_settle",
    settledDelta: item.net
  }));
  const storedPublicState = multiplayerStoredPublicState(next, table, seats);
  await rpcRows(admin, "apply_multiplayer_table_step", {
    p_table_id: table.id,
    p_expected_version: table.version,
    p_game_id: table.game_id,
    p_state: next,
    p_public_state: storedPublicState,
    p_turn_profile_id: complete ? null : currentTurnProfileId(next),
    p_turn_deadline_at: complete ? null : turnDeadline(),
    p_status: complete ? "complete" : "active",
    p_entries: entries
  });
  const updated = await hydrateMultiplayerTable(admin, table.id, actorProfileId);
  await writeAdminAudit(admin, adminSession, { action: "tables:force-timeout", targetTableId: table.id, beforeState, afterState: next, metadata: { actorProfileId } });
  return { table: updated };
}

async function adminKickWaitingSeat(admin, adminSession, body) {
  const table = await getMultiplayerTable(admin, String(body.tableId || ""));
  const profileId = String(body.profileId || "");
  if (!table || !profileId) throw new Error("invalid_admin_action");
  if (table.status !== "waiting") throw new Error("table_already_started");
  const beforeSeats = await getMultiplayerSeats(admin, table.id);
  const { error } = await admin
    .from("multiplayer_table_seats")
    .delete()
    .eq("table_id", table.id)
    .eq("profile_id", profileId);
  if (error) throw error;
  const afterSeats = await getMultiplayerSeats(admin, table.id);
  if (!afterSeats.length) {
    await admin.from("multiplayer_tables").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", table.id);
  } else if (table.host_profile_id === profileId) {
    await admin.from("multiplayer_tables").update({ host_profile_id: afterSeats[0].profile_id, updated_at: new Date().toISOString() }).eq("id", table.id);
  }
  await writeAdminAudit(admin, adminSession, { action: "seats:kick-waiting", targetProfileId: profileId, targetTableId: table.id, beforeState: beforeSeats, afterState: afterSeats });
  return { table: await hydrateMultiplayerTable(admin, table.id, adminSession.profileId).catch(() => null) };
}

async function adminListAudit(admin, body) {
  const { data, error } = await admin
    .from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Number(body.limit || 80), 1), 200));
  if (error) throw error;
  return { entries: data || [] };
}

async function updateAdminMultiplayerState(admin, table, seats, nextState) {
  const timestamp = new Date().toISOString();
  const { error: stateError } = await admin
    .from("multiplayer_table_state")
    .update({ state: nextState, updated_at: timestamp })
    .eq("table_id", table.id);
  if (stateError) throw stateError;
  const publicState = multiplayerStoredPublicState(nextState, table, seats);
  const { data, error } = await admin
    .from("multiplayer_tables")
    .update({
      public_state: publicState,
      version: Number(table.version || 1) + 1,
      updated_at: timestamp
    })
    .eq("id", table.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function profilesById(admin, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  const { data, error } = await admin
    .from("profiles")
    .select("id, username, credits, avatar_url")
    .in("id", unique);
  if (error) throw error;
  for (const row of data || []) map.set(row.id, publicProfile(row));
  return map;
}

async function adjustProfileCredits(admin, profileId, delta, action, gameId = "admin", tableId = null) {
  const profile = await getProfileRow(admin, profileId);
  if (!profile) throw new Error("profile_not_found");
  const credits = roundMoney(Number(profile.credits) + Number(delta));
  if (credits < 0 || credits > MAX_CREDITS) throw new Error("invalid_admin_action");
  const { data, error } = await admin
    .from("profiles")
    .update({ credits, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .select("id, username, credits, avatar_url")
    .single();
  if (error) throw error;
  const { error: historyError } = await admin.from("game_history").insert({
    profile_id: profileId,
    multiplayer_table_id: tableId,
    game_id: gameId,
    bet: 0,
    delta: roundMoney(delta),
    balance_after: credits,
    outcome: "admin_adjustment",
    action
  });
  if (historyError) throw historyError;
  return publicProfile(data);
}

async function writeAdminAudit(admin, adminSession, entry) {
  const { error } = await admin.from("admin_audit_log").insert({
    admin_profile_id: adminSession.profileId || null,
    admin_email: adminSession.email || null,
    action: entry.action,
    target_profile_id: entry.targetProfileId || null,
    target_session_id: entry.targetSessionId || null,
    target_table_id: entry.targetTableId || null,
    before_state: entry.beforeState ?? null,
    after_state: entry.afterState ?? null,
    metadata: entry.metadata || {}
  });
  if (error) throw error;
}

async function consumePendingGameOverride(admin, profileId, gameId, overrideType) {
  const { data, error } = await admin
    .from("admin_game_overrides")
    .select("*")
    .eq("profile_id", profileId)
    .eq("game_id", gameId)
    .eq("override_type", overrideType)
    .is("consumed_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    const message = String(error.message || "");
    if (error.code === "42P01" || message.includes("admin_game_overrides")) return null;
    throw error;
  }
  if (!data) return null;
  const { error: consumeError } = await admin
    .from("admin_game_overrides")
    .update({ consumed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("consumed_at", null);
  if (consumeError) throw consumeError;
  return data;
}

function normalizePendingOverridePayload(gameId, controlType, payload) {
  if (gameId === "slots") return normalizeSlotOverride(payload);
  if (gameId === "dice") return { nextDice: normalizeDiceOverride(payload, true) };
  if (gameId === "corridor") return { doorRoles: normalizeCorridorRolePayload(payload) };
  if (gameId === "blackjack" || gameId === "poker") {
    return { cards: normalizeAdminCards(payload.cards || payload.cardCodes || payload.card || [], gameId) };
  }
  if (gameId === "solitaire") return normalizeSolitaireControlPayload(controlType, payload);
  return payload || {};
}

function applyAdminGameControl(gameId, state, controlType, payload, targetKind) {
  const type = String(controlType || "").toLowerCase();
  if (gameId === "blackjack" && ["queuecards", "nextcard", "cards"].includes(type)) {
    moveCardsToDrawTop(state.deck, normalizeAdminCards(payload.cards || payload.cardCodes || payload.card || [], "blackjack"), "back");
    return state;
  }
  if (gameId === "poker" && ["queuecards", "nextcard", "nextstreet", "cards"].includes(type)) {
    moveCardsToDrawTop(state.deck, normalizeAdminCards(payload.cards || payload.cardCodes || payload.card || [], "poker"), "front");
    return state;
  }
  if (gameId === "dice" && ["setdice", "nextdice", "dice"].includes(type)) {
    const dice = normalizeDiceOverride(payload, targetKind === "session");
    state.adminControl = state.adminControl || {};
    if (targetKind === "table") {
      const profileId = String(payload.profileId || currentTurnProfileId(state) || "");
      if (!profileId) throw new Error("no_active_turn");
      state.adminControl.nextDiceByProfileId = state.adminControl.nextDiceByProfileId || {};
      state.adminControl.nextDiceByProfileId[profileId] = dice.playerDice || dice.dice;
    } else {
      state.adminControl.nextDice = dice;
    }
    return state;
  }
  if (gameId === "corridor" && ["setdoors", "doors", "trapdoor"].includes(type)) {
    state.currentDoors = applyCorridorDoorRoles(state.currentDoors || [], normalizeCorridorRolePayload(payload), state.bet, state.roomIndex || 0);
    return state;
  }
  if (gameId === "solitaire") {
    return applySolitaireAdminControl(state, type, payload);
  }
  throw new Error("invalid_admin_action");
}

function normalizeAdminCards(value, gameId) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const cards = list.map((item) => normalizeAdminCard(item, gameId)).filter(Boolean);
  if (!cards.length) throw new Error("invalid_card");
  const seen = new Set();
  for (const card of cards) {
    const key = cardKey(card);
    if (seen.has(key)) throw new Error("invalid_card");
    seen.add(key);
  }
  return cards;
}

function normalizeAdminCard(value, gameId) {
  if (!value) return null;
  if (typeof value === "object") {
    const rank = String(value.rank || "").toUpperCase();
    const suit = normalizeSuit(value.suit);
    return createAdminCard(rank, suit, gameId);
  }
  const code = String(value).trim().toUpperCase();
  if (!code) return null;
  const suit = normalizeSuit(code.slice(-1));
  const rank = code.slice(0, -1);
  return createAdminCard(rank, suit, gameId);
}

function createAdminCard(rank, suit, gameId) {
  const ranks = gameId === "poker" ? POKER_RANKS : CARD_RANKS;
  if (!ranks.includes(rank) || !CARD_SUITS.includes(suit)) throw new Error("invalid_card");
  return {
    rank,
    suit,
    value: gameId === "poker" ? POKER_VALUES[rank] : cardValue(rank)
  };
}

function normalizeSuit(value) {
  const key = String(value || "").trim().toLowerCase();
  const aliases = {
    c: "clubs",
    club: "clubs",
    clubs: "clubs",
    d: "diamonds",
    diamond: "diamonds",
    diamonds: "diamonds",
    h: "hearts",
    heart: "hearts",
    hearts: "hearts",
    s: "spades",
    spade: "spades",
    spades: "spades"
  };
  const suit = aliases[key];
  if (!suit) throw new Error("invalid_card");
  return suit;
}

function moveCardsToDrawTop(deck, cards, mode) {
  if (!Array.isArray(deck)) throw new Error("admin_card_unavailable");
  const moved = [];
  for (const card of cards) {
    const index = deck.findIndex((candidate) => cardKey(candidate) === cardKey(card));
    if (index < 0) throw new Error("admin_card_unavailable");
    moved.push(deck.splice(index, 1)[0]);
  }
  if (mode === "front") deck.unshift(...moved);
  else deck.push(...moved.slice().reverse());
}

function cardKey(card) {
  return `${String(card?.rank || "").toUpperCase()}:${normalizeSuit(card?.suit || "")}`;
}

function cardCode(card) {
  if (!card?.rank || !card?.suit) return "";
  return `${card.rank}${String(card.suit).slice(0, 1).toUpperCase()}`;
}

function normalizeDiceOverride(payload, solo) {
  const playerDice = normalizeDicePair(payload.playerDice || payload.dice || [payload.playerDie1, payload.playerDie2]);
  if (!solo) return { dice: playerDice };
  const houseDice = normalizeDicePair(payload.houseDice || [payload.houseDie1, payload.houseDie2]);
  return { playerDice, houseDice };
}

function normalizeDicePair(value) {
  const dice = Array.isArray(value) ? value : String(value || "").split(",");
  if (dice.length !== 2) throw new Error("invalid_dice_action");
  const normalized = dice.map((die) => Number(die));
  if (normalized.some((die) => !Number.isInteger(die) || die < 1 || die > 6)) throw new Error("invalid_dice_action");
  return normalized;
}

function consumeSoloDiceOverride(state) {
  const override = state.adminControl?.nextDice;
  if (!override) return null;
  delete state.adminControl.nextDice;
  if (!Object.keys(state.adminControl).length) delete state.adminControl;
  return override;
}

function consumeMultiplayerDiceOverride(state, profileId) {
  const dice = state.adminControl?.nextDiceByProfileId?.[profileId];
  if (!dice) return null;
  delete state.adminControl.nextDiceByProfileId[profileId];
  if (!Object.keys(state.adminControl.nextDiceByProfileId).length) delete state.adminControl.nextDiceByProfileId;
  if (!Object.keys(state.adminControl).length) delete state.adminControl;
  return dice;
}

function normalizeSlotOverride(payload) {
  const preset = String(payload.preset || "").toLowerCase();
  if (payload.reels) {
    return { reels: normalizeSlotReels(payload.reels) };
  }
  if (preset === "lose") return { reels: normalizeSlotReels(["cherries", "lemon", "bell"]) };
  if (preset === "pair") {
    const symbol = normalizeSlotSymbol(payload.symbolId || "cherries");
    const kicker = SLOT_SYMBOLS.find((item) => item.id !== symbol.id) || SLOT_SYMBOLS[1];
    return { reels: [symbol, symbol, { id: kicker.id, label: kicker.label }] };
  }
  if (preset === "jackpot") {
    const symbol = normalizeSlotSymbol(payload.symbolId || "seven");
    return { reels: [symbol, symbol, symbol] };
  }
  throw new Error("invalid_admin_action");
}

function normalizeSlotReels(value) {
  const reels = Array.isArray(value) ? value : String(value || "").split(",");
  if (reels.length !== 3) throw new Error("invalid_slot_symbol");
  return reels.map(normalizeSlotSymbol);
}

function normalizeSlotSymbol(value) {
  const id = typeof value === "object" ? String(value.id || "") : String(value || "");
  const symbol = SLOT_SYMBOLS.find((item) => item.id === id.trim().toLowerCase());
  if (!symbol) throw new Error("invalid_slot_symbol");
  return { id: symbol.id, label: symbol.label };
}

function normalizeCorridorRolePayload(payload) {
  const source = payload.doorRoles || payload.roles || payload.doors || payload;
  if (Array.isArray(source)) {
    return source.map((item, index) => ({
      index: Number(item.index ?? index),
      role: normalizeDoorRole(item.role),
      bonus: Number(item.bonus || 0)
    }));
  }
  return Object.entries(source || {}).map(([index, role]) => ({
    index: Number(index),
    role: normalizeDoorRole(role),
    bonus: 0
  }));
}

function normalizeDoorRole(role) {
  const value = String(role || "").toLowerCase();
  if (!["safe", "bonus", "trap"].includes(value)) throw new Error("invalid_corridor_action");
  return value;
}

function applyCorridorDoorRoles(currentDoors, roles, bet, roomIndex) {
  if (!Array.isArray(currentDoors) || currentDoors.length !== 3) throw new Error("door_not_available");
  if (roles.length !== 3) throw new Error("invalid_corridor_action");
  const roleSet = new Set(roles.map((item) => item.role));
  if (!roleSet.has("safe") || !roleSet.has("bonus") || !roleSet.has("trap")) throw new Error("invalid_corridor_action");
  const bonusDefault = Math.max(1, Math.round(Number(bet || 1) * corridorBonusRate(roomIndex || 0)));
  return currentDoors.map((door) => {
    const next = roles.find((item) => Number(item.index) === Number(door.index));
    if (!next) throw new Error("invalid_corridor_action");
    return {
      ...door,
      role: next.role,
      bonus: next.role === "bonus" ? Math.max(1, Number(next.bonus || bonusDefault)) : 0
    };
  });
}

function normalizeSolitaireControlPayload(controlType, payload) {
  if (String(controlType || "").toLowerCase().includes("stock")) {
    return { nextStockCard: normalizeSolitaireCardInput(payload.card || payload.nextStockCard || payload) };
  }
  return payload || {};
}

function applySolitaireAdminControl(state, type, payload) {
  if (["nextstock", "setnextstock", "stock"].includes(type)) {
    moveSolitaireCardToStockTop(state, normalizeSolitaireCardInput(payload.card || payload.nextStockCard || payload));
    return state;
  }
  if (["fliptableau", "flip"].includes(type)) {
    const pileIndex = Number(payload.pileIndex ?? payload.sourceIndex);
    const cardIndex = payload.cardIndex === undefined ? null : Number(payload.cardIndex);
    const pile = state.tableau?.[pileIndex];
    if (!pile) throw new Error("illegal_move");
    const card = cardIndex === null ? top(pile) : pile[cardIndex];
    if (!card) throw new Error("illegal_move");
    card.faceUp = payload.faceUp !== false;
    return state;
  }
  if (["movecard", "move"].includes(type)) {
    moveSolitaireAdminCard(state, payload);
    return state;
  }
  throw new Error("invalid_admin_action");
}

function normalizeSolitaireCardInput(value) {
  if (typeof value === "object" && value?.id) return String(value.id);
  if (typeof value === "object" && value?.suit && value?.value) return `${value.suit}-${Number(value.value)}`;
  const raw = String(value || "").trim();
  if (!raw) throw new Error("invalid_card");
  if (raw.includes("-")) return raw.toLowerCase();
  const card = normalizeAdminCard(raw, "poker");
  const valueNumber = card.rank === "A" ? 1 : card.rank === "J" ? 11 : card.rank === "Q" ? 12 : card.rank === "K" ? 13 : Number(card.rank);
  return `${card.suit}-${valueNumber}`;
}

function solitaireCardCode(card) {
  if (!card) return "";
  return card.id || `${card.suit}-${card.value}`;
}

function findSolitaireCardLocation(state, cardId) {
  const zones = [
    { name: "stock", pile: state.stock || [] },
    { name: "waste", pile: state.waste || [] }
  ];
  for (const suit of SOLITAIRE_SUITS) zones.push({ name: `foundation:${suit}`, pile: state.foundations?.[suit] || [] });
  (state.tableau || []).forEach((pile, index) => zones.push({ name: `tableau:${index}`, pile }));
  for (const zone of zones) {
    const index = zone.pile.findIndex((card) => solitaireCardCode(card) === cardId);
    if (index >= 0) return { ...zone, index, card: zone.pile[index] };
  }
  return null;
}

function moveSolitaireCardToStockTop(state, cardId) {
  const location = findSolitaireCardLocation(state, cardId);
  if (!location) throw new Error("admin_card_unavailable");
  location.pile.splice(location.index, 1);
  state.stock = state.stock || [];
  state.stock.push({ ...location.card, faceUp: false });
}

function moveSolitaireAdminCard(state, payload) {
  const cardId = normalizeSolitaireCardInput(payload.card || payload.cardId);
  const destination = String(payload.destination || "");
  const location = findSolitaireCardLocation(state, cardId);
  if (!location) throw new Error("admin_card_unavailable");
  const [card] = location.pile.splice(location.index, 1);
  if (destination === "stock") {
    state.stock.push({ ...card, faceUp: false });
    return;
  }
  if (destination === "waste") {
    state.waste.push({ ...card, faceUp: true });
    return;
  }
  if (destination.startsWith("foundation:")) {
    const suit = destination.split(":")[1];
    if (!SOLITAIRE_SUITS.includes(suit)) throw new Error("illegal_move");
    state.foundations[suit].push({ ...card, faceUp: true });
    return;
  }
  if (destination.startsWith("tableau:")) {
    const index = Number(destination.split(":")[1]);
    if (!state.tableau?.[index]) throw new Error("illegal_move");
    state.tableau[index].push({ ...card, faceUp: payload.faceUp !== false });
    return;
  }
  throw new Error("illegal_move");
}

async function handleMultiplayer(admin, user, profile, body) {
  switch (body.type) {
    case "multiplayer:list":
      return listMultiplayerTables(admin, user.id, body);
    case "multiplayer:create":
      return createMultiplayerTable(admin, user, profile, body);
    case "multiplayer:join":
      return joinMultiplayerTable(admin, user, profile, body);
    case "multiplayer:ready":
      return setMultiplayerReady(admin, user.id, profile, body);
    case "multiplayer:start":
      return startMultiplayerTable(admin, user.id, profile, body);
    case "multiplayer:action":
      return applyMultiplayerPlayerAction(admin, user.id, profile, body, false);
    case "multiplayer:timeout":
      return applyMultiplayerPlayerAction(admin, user.id, profile, body, true);
    case "multiplayer:leave":
      return leaveMultiplayerTable(admin, user.id, profile, body);
    case "multiplayer:sync":
      return syncMultiplayerTable(admin, user.id, profile, body);
    default:
      throw new Error("unknown_multiplayer_request");
  }
}

async function listMultiplayerTables(admin, viewerId, body) {
  let query = admin
    .from("multiplayer_tables")
    .select("*")
    .eq("visibility", "public")
    .in("status", ["waiting", "active"])
    .order("updated_at", { ascending: false })
    .limit(24);

  if (body.gameId) {
    const gameId = parseMultiplayerGameId(body.gameId);
    query = query.eq("game_id", gameId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const tables = [];
  for (const table of data || []) {
    tables.push(await hydrateMultiplayerTable(admin, table.id, viewerId, table));
  }
  return { tables };
}

async function createMultiplayerTable(admin, user, profile, body) {
  const gameId = parseMultiplayerGameId(body.gameId);
  const stake = parseBet(body.stake, MAX_MULTIPLAYER_STAKE, "invalid_stake");
  const maxPlayers = parseMaxPlayers(body.maxPlayers);
  const visibility = body.visibility === "private" ? "private" : "public";
  const inviteCode = await createInviteCode(admin);
  const publicState = {
    mode: "multiplayer",
    gameId,
    phase: "waiting",
    status: "waiting",
    stake,
    message: "Waiting for players."
  };

  const { data: table, error: tableError } = await admin
    .from("multiplayer_tables")
    .insert({
      game_id: gameId,
      host_profile_id: user.id,
      stake,
      max_players: maxPlayers,
      visibility,
      invite_code: inviteCode,
      public_state: publicState
    })
    .select("*")
    .single();
  if (tableError) throw tableError;

  const { error: seatError } = await admin.from("multiplayer_table_seats").insert({
    table_id: table.id,
    profile_id: user.id,
    seat_index: 0,
    username: profile.username,
    avatar_url: profile.avatarUrl || null,
    status: "ready"
  });
  if (seatError) throw seatError;

  const { error: stateError } = await admin.from("multiplayer_table_state").insert({
    table_id: table.id,
    state: {
      gameId,
      phase: "waiting",
      stake,
      diceMode: normalizeDiceMode(body.diceMode),
      message: "Waiting for players."
    }
  });
  if (stateError) throw stateError;

  return { profile, table: await hydrateMultiplayerTable(admin, table.id, user.id) };
}

async function joinMultiplayerTable(admin, user, profile, body) {
  const table = body.tableId
    ? await getMultiplayerTable(admin, String(body.tableId))
    : await getMultiplayerTableByInvite(admin, String(body.inviteCode || ""));
  if (!table) throw new Error("multiplayer_table_not_found");
  if (table.status !== "waiting") throw new Error("table_already_started");

  const seats = await getMultiplayerSeats(admin, table.id);
  const existing = seats.find((seat) => seat.profile_id === user.id);
  if (existing) return { profile, table: await hydrateMultiplayerTable(admin, table.id, user.id, table, seats) };
  if (seats.length >= table.max_players) throw new Error("table_full");

  const used = new Set(seats.map((seat) => Number(seat.seat_index)));
  let seatIndex = 0;
  while (used.has(seatIndex)) seatIndex += 1;

  const claimedTable = await claimWaitingTableMutation(admin, table);
  const { error } = await admin.from("multiplayer_table_seats").insert({
    table_id: table.id,
    profile_id: user.id,
    seat_index: seatIndex,
    username: profile.username,
    avatar_url: profile.avatarUrl || null,
    status: "seated"
  });
  if (error) throw error;

  return { profile, table: await hydrateMultiplayerTable(admin, table.id, user.id, claimedTable) };
}

async function setMultiplayerReady(admin, profileId, profile, body) {
  const table = await requireMultiplayerTableForSeat(admin, String(body.tableId || ""), profileId);
  if (table.status !== "waiting") throw new Error("table_already_started");
  const ready = body.ready !== false;
  const claimedTable = await claimWaitingTableMutation(admin, table);
  const { error } = await admin
    .from("multiplayer_table_seats")
    .update({ status: ready ? "ready" : "seated", updated_at: new Date().toISOString() })
    .eq("table_id", table.id)
    .eq("profile_id", profileId);
  if (error) throw error;
  return { profile, table: await hydrateMultiplayerTable(admin, table.id, profileId, claimedTable) };
}

async function startMultiplayerTable(admin, profileId, profile, body) {
  const table = await getMultiplayerTable(admin, String(body.tableId || ""));
  if (!table) throw new Error("multiplayer_table_not_found");
  if (table.host_profile_id !== profileId) throw new Error("host_only");
  if (table.status !== "waiting") throw new Error("table_already_started");

  const seats = await getMultiplayerSeats(admin, table.id);
  const activeSeats = seats.filter((seat) => ["seated", "ready"].includes(seat.status));
  if (activeSeats.length < 2) throw new Error("need_at_least_two_players");
  if (activeSeats.some((seat) => seat.status !== "ready")) throw new Error("players_not_ready");

  const entries = activeSeats.map((seat) => ({
    profileId: seat.profile_id,
    bet: Number(table.stake),
    delta: -Number(table.stake),
    outcome: "escrow",
    action: "multiplayer_escrow"
  }));

  const setupState = await getMultiplayerPrivateState(admin, table.id);
  const started = createMultiplayerState(table.game_id, Number(table.stake), activeSeats, setupState?.state?.diceMode);
  const deadline = started.phase === "complete" ? null : turnDeadline();
  const storedPublicState = multiplayerStoredPublicState(started, table, activeSeats);
  const credits = await rpcRows(admin, "start_multiplayer_table_round", {
    p_table_id: table.id,
    p_expected_version: table.version,
    p_game_id: table.game_id,
    p_state: started,
    p_public_state: storedPublicState,
    p_turn_profile_id: started.phase === "complete" ? null : currentTurnProfileId(started),
    p_turn_deadline_at: deadline,
    p_status: started.phase === "complete" ? "complete" : "active",
    p_entries: entries
  });

  return {
    profile: profileWithCredits(profile, credits, profileId),
    table: await hydrateMultiplayerTable(admin, table.id, profileId)
  };
}

async function applyMultiplayerPlayerAction(admin, profileId, profile, body, timeout) {
  const table = await requireMultiplayerTableForSeat(admin, String(body.tableId || ""), profileId);
  if (table.status !== "active") throw new Error("table_not_active");

  const stateRow = await getMultiplayerPrivateState(admin, table.id);
  const state = stateRow?.state;
  if (!state) throw new Error("multiplayer_state_not_found");
  const actorProfileId = timeout ? currentTurnProfileId(state) : profileId;
  if (!actorProfileId) throw new Error("no_active_turn");
  if (!timeout && table.turn_profile_id !== profileId) throw new Error("not_your_turn");
  if (timeout && table.turn_deadline_at && new Date(table.turn_deadline_at).getTime() > Date.now()) {
    throw new Error("turn_deadline_not_reached");
  }

  const next = stepMultiplayerState(state, actorProfileId, body.action || {}, timeout);
  const seats = await getMultiplayerSeats(admin, table.id);
  const complete = next.phase === "complete";
  const settlements = complete ? multiplayerSettlements(next, Number(table.stake)) : [];
  const entries = settlements.map((item) => ({
    profileId: item.profileId,
    bet: Number(table.stake),
    delta: item.payout,
    outcome: item.outcome,
    action: "multiplayer_settle",
    settledDelta: item.net
  }));

  const storedPublicState = multiplayerStoredPublicState(next, table, seats);
  const credits = await rpcRows(admin, "apply_multiplayer_table_step", {
    p_table_id: table.id,
    p_expected_version: table.version,
    p_game_id: table.game_id,
    p_state: next,
    p_public_state: storedPublicState,
    p_turn_profile_id: complete ? null : currentTurnProfileId(next),
    p_turn_deadline_at: complete ? null : turnDeadline(),
    p_status: complete ? "complete" : "active",
    p_entries: entries
  });

  return {
    profile: profileWithCredits(profile, credits, profileId),
    table: await hydrateMultiplayerTable(admin, table.id, profileId)
  };
}

async function leaveMultiplayerTable(admin, profileId, profile, body) {
  const table = await requireMultiplayerTableForSeat(admin, String(body.tableId || ""), profileId);
  if (table.status !== "waiting") throw new Error("cannot_leave_active_table");
  const claimedTable = await claimWaitingTableMutation(admin, table);

  const { error } = await admin
    .from("multiplayer_table_seats")
    .delete()
    .eq("table_id", table.id)
    .eq("profile_id", profileId);
  if (error) throw error;

  const seats = await getMultiplayerSeats(admin, table.id);
  if (!seats.length) {
    const { error: cancelError } = await admin
      .from("multiplayer_tables")
      .update({ status: "cancelled", version: Number(claimedTable.version) + 1, updated_at: new Date().toISOString() })
      .eq("id", table.id)
      .eq("version", claimedTable.version);
    if (cancelError) throw cancelError;
    return { profile, table: null };
  }

  if (table.host_profile_id === profileId) {
    const { error: hostError } = await admin
      .from("multiplayer_tables")
      .update({ host_profile_id: seats[0].profile_id, updated_at: new Date().toISOString() })
      .eq("id", table.id)
      .eq("version", claimedTable.version);
    if (hostError) throw hostError;
  }

  return { profile, table: null };
}

async function syncMultiplayerTable(admin, profileId, profile, body) {
  const table = await requireMultiplayerTableForSeat(admin, String(body.tableId || ""), profileId);
  return { profile, table: await hydrateMultiplayerTable(admin, table.id, profileId) };
}

async function getMultiplayerTable(admin, tableId) {
  if (!tableId) return null;
  const { data, error } = await admin.from("multiplayer_tables").select("*").eq("id", tableId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getMultiplayerTableByInvite(admin, inviteCode) {
  const normalized = normalizeInviteCode(inviteCode);
  if (!normalized) return null;
  const { data, error } = await admin.from("multiplayer_tables").select("*").eq("invite_code", normalized).maybeSingle();
  if (error) throw error;
  return data;
}

async function requireMultiplayerTableForSeat(admin, tableId, profileId) {
  const table = await getMultiplayerTable(admin, tableId);
  if (!table) throw new Error("multiplayer_table_not_found");
  const seats = await getMultiplayerSeats(admin, table.id);
  if (!seats.some((seat) => seat.profile_id === profileId && !["left", "abandoned"].includes(seat.status))) {
    throw new Error("not_seated_at_table");
  }
  return table;
}

async function getMultiplayerSeats(admin, tableId) {
  const { data, error } = await admin
    .from("multiplayer_table_seats")
    .select("*")
    .eq("table_id", tableId)
    .order("seat_index", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getMultiplayerPrivateState(admin, tableId) {
  const { data, error } = await admin.from("multiplayer_table_state").select("*").eq("table_id", tableId).maybeSingle();
  if (error) throw error;
  return data;
}

async function claimWaitingTableMutation(admin, table) {
  const { data, error } = await admin
    .from("multiplayer_tables")
    .update({
      version: Number(table.version) + 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", table.id)
    .eq("status", "waiting")
    .eq("version", table.version)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("stale_multiplayer_table");
  return data;
}

async function hydrateMultiplayerTable(admin, tableId, viewerId, tableRow = null, seatsRow = null) {
  const table = tableRow || await getMultiplayerTable(admin, tableId);
  if (!table) return null;
  const seats = seatsRow || await getMultiplayerSeats(admin, table.id);
  let publicState = table.public_state || {};

  if (table.status !== "waiting") {
    const stateRow = await getMultiplayerPrivateState(admin, table.id);
    if (stateRow?.state) {
      publicState = multiplayerPublicState(stateRow.state, table, seats, viewerId);
    }
  } else {
    publicState = {
      ...publicState,
      mode: "multiplayer",
      tableId: table.id,
      gameId: table.game_id,
      phase: "waiting",
      status: table.status,
      stake: Number(table.stake),
      maxPlayers: table.max_players,
      inviteCode: table.invite_code,
      message: seats.length >= 2 ? "Ready up, then the host can start." : "Waiting for another player.",
      seats: seats.map(publicSeat)
    };
  }

  return formatMultiplayerTable(table, seats, publicState, viewerId);
}

function formatMultiplayerTable(table, seats, publicState, viewerId) {
  const viewerSeat = seats.find((seat) => seat.profile_id === viewerId) || null;
  return {
    id: table.id,
    gameId: table.game_id,
    hostProfileId: table.host_profile_id,
    stake: Number(table.stake),
    maxPlayers: table.max_players,
    status: table.status,
    visibility: table.visibility,
    inviteCode: table.invite_code,
    turnProfileId: table.turn_profile_id,
    turnDeadlineAt: table.turn_deadline_at,
    version: table.version,
    isHost: table.host_profile_id === viewerId,
    viewerSeat: viewerSeat ? publicSeat(viewerSeat) : null,
    seats: seats.map(publicSeat),
    publicState
  };
}

function publicSeat(seat) {
  return {
    profileId: seat.profile_id,
    username: seat.username,
    avatarUrl: seat.avatar_url || "",
    seatIndex: Number(seat.seat_index),
    status: seat.status,
    settledDelta: Number(seat.settled_delta || 0)
  };
}

async function createInviteCode(admin) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomCode(6);
    const existing = await getMultiplayerTableByInvite(admin, code);
    if (!existing) return code;
  }
  throw new Error("could_not_create_invite_code");
}

function randomCode(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += alphabet[secureRandom(alphabet.length)];
  }
  return code;
}

function normalizeInviteCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseMultiplayerGameId(gameId) {
  const normalized = String(gameId || "");
  if (!MULTIPLAYER_GAME_IDS.has(normalized)) throw new Error("unknown_multiplayer_game");
  return normalized;
}

function parseMaxPlayers(raw) {
  const value = Number(raw || 6);
  if (!Number.isInteger(value) || value < 2 || value > 6) throw new Error("max_players_must_be_2_to_6");
  return value;
}

function normalizeDiceMode(raw) {
  const mode = String(raw || "high").toLowerCase();
  return ["high", "low", "doubles"].includes(mode) ? mode : "high";
}

function turnDeadline() {
  return new Date(Date.now() + TURN_TIMEOUT_SECONDS * 1000).toISOString();
}

function profileWithCredits(profile, rows, profileId) {
  const row = (rows || []).find((item) => item.profile_id === profileId || item.profileId === profileId);
  return row ? { ...profile, credits: Number(row.credits) } : profile;
}

function advanceHoldemStreet(state) {
  state.communityCards = state.communityCards || [];
  if (state.phase === "preflop") {
    state.communityCards.push(...state.deck.splice(0, 3));
    state.phase = "flop";
    return "Flop revealed.";
  }
  if (state.phase === "flop") {
    state.communityCards.push(...state.deck.splice(0, 1));
    state.phase = "turn";
    return "Turn revealed.";
  }
  if (state.phase === "turn") {
    state.communityCards.push(...state.deck.splice(0, 1));
    state.phase = "river";
    return "River revealed. Check for showdown.";
  }
  return "";
}

function createMultiplayerState(gameId, stake, seats, diceMode = "high") {
  if (gameId === "blackjack") return createMultiplayerBlackjack(stake, seats);
  if (gameId === "poker") return createMultiplayerPoker(stake, seats);
  if (gameId === "dice") return createMultiplayerDice(stake, seats, diceMode);
  throw new Error("unknown_multiplayer_game");
}

function stepMultiplayerState(state, profileId, action, timeout) {
  if (state.gameId === "blackjack") return stepMultiplayerBlackjack(state, profileId, action, timeout);
  if (state.gameId === "poker") return stepMultiplayerPoker(state, profileId, action, timeout);
  if (state.gameId === "dice") return stepMultiplayerDice(state, profileId, action, timeout);
  throw new Error("unknown_multiplayer_game");
}

function currentTurnProfileId(state) {
  if (state.phase === "complete") return null;
  return state.players?.[state.turnIndex]?.profileId || null;
}

function createMultiplayerBlackjack(stake, seats) {
  const state = {
    mode: "multiplayer",
    gameId: "blackjack",
    phase: "player_turn",
    stake,
    deck: shuffle(createDeck()),
    dealerHand: [],
    players: seats.map((seat) => ({
      profileId: seat.profile_id,
      username: seat.username,
      avatarUrl: seat.avatar_url || "",
      seatIndex: Number(seat.seat_index),
      hand: [],
      status: "playing",
      outcome: null,
      payout: 0
    })),
    turnIndex: 0,
    message: "Blackjack table started."
  };

  for (const player of state.players) player.hand.push(draw(state), draw(state));
  state.dealerHand.push(draw(state), draw(state));

  for (const player of state.players) {
    if (isBlackjack(player.hand)) player.status = "blackjack";
  }

  return advanceMultiplayerBlackjack(state);
}

function stepMultiplayerBlackjack(state, profileId, action, timeout) {
  const player = state.players[state.turnIndex];
  if (!player || player.profileId !== profileId) throw new Error("not_your_turn");
  if (state.phase !== "player_turn") throw new Error("blackjack_table_not_active");

  const type = timeout ? "stand" : String(action?.type || action || "").toLowerCase();
  if (type === "hit") {
    if (scoreBlackjack(player.hand).total >= 21) throw new Error("stand_required_at_21");
    player.hand.push(draw(state));
    const total = scoreBlackjack(player.hand).total;
    if (total > 21) {
      player.status = "busted";
      state.message = `${player.username} busted.`;
      return advanceMultiplayerBlackjack(state);
    }
    if (total === 21) {
      player.status = "stood";
      state.message = `${player.username} has 21.`;
      return advanceMultiplayerBlackjack(state);
    }
    state.message = `${player.username} hit.`;
    return state;
  }

  if (type !== "stand") throw new Error("invalid_blackjack_action");
  player.status = timeout ? "timed_out" : "stood";
  state.message = timeout ? `${player.username} timed out and stood.` : `${player.username} stood.`;
  return advanceMultiplayerBlackjack(state);
}

function advanceMultiplayerBlackjack(state) {
  const nextIndex = state.players.findIndex((player) => player.status === "playing");
  if (nextIndex >= 0) {
    state.turnIndex = nextIndex;
    state.phase = "player_turn";
    return state;
  }

  while (scoreBlackjack(state.dealerHand).total < 17) state.dealerHand.push(draw(state));
  const dealerTotal = scoreBlackjack(state.dealerHand).total;
  const dealerNatural = isBlackjack(state.dealerHand);

  for (const player of state.players) {
    const playerTotal = scoreBlackjack(player.hand).total;
    if (player.status === "busted") {
      player.outcome = "lose";
      player.payout = 0;
    } else if (dealerNatural && !isBlackjack(player.hand)) {
      player.outcome = "lose";
      player.payout = 0;
    } else if (isBlackjack(player.hand) && !dealerNatural) {
      player.outcome = "blackjack";
      player.payout = roundMoney(state.stake * 2.5);
    } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
      player.outcome = "win";
      player.payout = roundMoney(state.stake * 2);
    } else if (playerTotal === dealerTotal) {
      player.outcome = "push";
      player.payout = roundMoney(state.stake);
    } else {
      player.outcome = "lose";
      player.payout = 0;
    }
    player.status = "settled";
  }

  state.phase = "complete";
  state.turnIndex = -1;
  state.message = "Dealer resolved the table.";
  return state;
}

function createMultiplayerPoker(stake, seats) {
  const deck = shuffle(createPokerDeck());
  const players = seats.map((seat) => {
    const hand = deck.splice(0, 2);
    return {
      profileId: seat.profile_id,
      username: seat.username,
      avatarUrl: seat.avatar_url || "",
      seatIndex: Number(seat.seat_index),
      hand,
      status: "playing",
      result: null,
      outcome: null,
      payout: 0
    };
  });

  return {
    mode: "multiplayer",
    gameId: "poker",
    phase: "preflop",
    stake,
    deck,
    communityCards: [],
    players,
    turnIndex: 0,
    message: "Hole cards dealt. Check to reveal the flop."
  };
}

function stepMultiplayerPoker(state, profileId, action, timeout) {
  const player = state.players[state.turnIndex];
  if (!player || player.profileId !== profileId) throw new Error("not_your_turn");
  if (!["preflop", "flop", "turn", "river"].includes(state.phase)) throw new Error("poker_table_not_active");

  const type = timeout ? "check" : String(action?.type || action || "").toLowerCase();
  if (type === "fold") {
    player.status = "folded";
    player.outcome = "fold";
    state.message = `${player.username} folded.`;
    return advanceMultiplayerPoker(state);
  }

  if (!["check", "advanceholdem", "draw"].includes(type)) throw new Error("invalid_poker_action");
  player.status = timeout ? "timed_out" : "checked";
  state.message = timeout ? `${player.username} timed out and checked.` : `${player.username} checked.`;
  return advanceMultiplayerPoker(state);
}

function advanceMultiplayerPoker(state) {
  const activePlayers = state.players.filter((player) => player.status !== "folded");
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    winner.outcome = "win";
    winner.payout = roundMoney(state.stake * state.players.length);
    winner.status = "settled";
    for (const player of state.players) {
      if (player !== winner) {
        player.payout = 0;
        player.status = "settled";
      }
    }
    state.phase = "complete";
    state.turnIndex = -1;
    state.message = `${winner.username} won the pot.`;
    return state;
  }

  const nextIndex = state.players.findIndex((player) => player.status === "playing");
  if (nextIndex >= 0) {
    state.turnIndex = nextIndex;
    return state;
  }

  const nextStreet = advanceHoldemStreet(state);
  if (nextStreet) {
    for (const player of state.players) {
      if (player.status !== "folded") player.status = "playing";
    }
    state.turnIndex = state.players.findIndex((player) => player.status === "playing");
    state.message = nextStreet;
    return state;
  }

  const contenders = state.players.filter((player) => player.status !== "folded");
  const best = contenders.reduce((leader, player) => {
    const result = scoreBestPokerHand([...player.hand, ...state.communityCards]);
    player.result = result;
    if (!leader || comparePokerCompetitive(result, leader.result) > 0) return player;
    return leader;
  }, null);
  const winners = contenders.filter((player) => comparePokerCompetitive(player.result, best.result) === 0);
  const payout = roundMoney((state.stake * state.players.length) / winners.length);

  for (const player of state.players) {
    if (winners.includes(player)) {
      player.outcome = "win";
      player.payout = payout;
    } else {
      player.outcome = "lose";
      player.payout = 0;
    }
    player.status = "settled";
  }

  state.phase = "complete";
  state.turnIndex = -1;
  state.message = winners.length > 1 ? "Showdown split pot." : `${winners[0].username} won the pot.`;
  return state;
}

function createMultiplayerDice(stake, seats, diceMode) {
  return {
    mode: "multiplayer",
    gameId: "dice",
    phase: "rolling",
    stake,
    diceMode: normalizeDiceMode(diceMode),
    players: seats.map((seat) => ({
      profileId: seat.profile_id,
      username: seat.username,
      avatarUrl: seat.avatar_url || "",
      seatIndex: Number(seat.seat_index),
      dice: [],
      total: 0,
      status: "waiting",
      outcome: null,
      payout: 0
    })),
    turnIndex: 0,
    message: "Roll once against the table."
  };
}

function stepMultiplayerDice(state, profileId, action, timeout) {
  const player = state.players[state.turnIndex];
  if (!player || player.profileId !== profileId) throw new Error("not_your_turn");
  if (state.phase !== "rolling") throw new Error("dice_table_not_active");
  const type = String(action?.type || "roll").toLowerCase();
  if (!timeout && type !== "roll") throw new Error("invalid_dice_action");

  player.dice = consumeMultiplayerDiceOverride(state, player.profileId) || [secureRandom(6) + 1, secureRandom(6) + 1];
  player.total = player.dice[0] + player.dice[1];
  player.status = timeout ? "timed_out" : "rolled";
  state.message = timeout ? `${player.username} timed out and rolled.` : `${player.username} rolled.`;
  return advanceMultiplayerDice(state);
}

function advanceMultiplayerDice(state) {
  const nextIndex = state.players.findIndex((player) => player.status === "waiting");
  if (nextIndex >= 0) {
    state.turnIndex = nextIndex;
    return state;
  }

  const winners = diceWinners(state);
  const payout = roundMoney((state.stake * state.players.length) / winners.length);
  for (const player of state.players) {
    if (winners.includes(player)) {
      player.outcome = "win";
      player.payout = payout;
    } else {
      player.outcome = "lose";
      player.payout = 0;
    }
    player.status = "settled";
  }
  state.phase = "complete";
  state.turnIndex = -1;
  state.message = winners.length > 1 ? "Dice pot split." : `${winners[0].username} won the dice pot.`;
  return state;
}

function diceWinners(state) {
  if (state.diceMode === "low") {
    const low = Math.min(...state.players.map((player) => player.total));
    return state.players.filter((player) => player.total === low);
  }

  if (state.diceMode === "doubles") {
    const doubles = state.players.filter((player) => player.dice[0] === player.dice[1]);
    if (doubles.length) {
      const bestDouble = Math.max(...doubles.map((player) => player.dice[0]));
      return doubles.filter((player) => player.dice[0] === bestDouble);
    }
  }

  const high = Math.max(...state.players.map((player) => player.total));
  return state.players.filter((player) => player.total === high);
}

function multiplayerStoredPublicState(state, table, seats) {
  return multiplayerPublicState(state, table, seats, null);
}

function multiplayerPublicState(state, table, seats, viewerId) {
  const base = {
    mode: "multiplayer",
    tableId: table.id,
    gameId: table.game_id,
    phase: state.phase,
    status: state.phase === "complete" ? "complete" : "active",
    stake: Number(table.stake),
    bet: Number(table.stake),
    maxPlayers: table.max_players,
    inviteCode: table.invite_code,
    turnProfileId: currentTurnProfileId(state),
    turnDeadlineAt: table.turn_deadline_at,
    secondsPerTurn: TURN_TIMEOUT_SECONDS,
    message: state.message || "",
    seats: seats.map(publicSeat),
    players: state.players.map((player) => publicMultiplayerPlayer(state, player, viewerId))
  };

  if (state.gameId === "blackjack") {
    const hideHole = state.phase !== "complete" && state.dealerHand.length > 1;
    const dealerHand = hideHole ? [state.dealerHand[0], { hidden: true }] : state.dealerHand;
    return {
      ...base,
      dealerHand,
      dealerValue: hideHole ? scoreBlackjack([state.dealerHand[0]]).total : scoreBlackjack(state.dealerHand).total
    };
  }

  if (state.gameId === "dice") {
    return { ...base, diceMode: state.diceMode };
  }

  if (state.gameId === "poker") {
    return { ...base, communityCards: state.communityCards || [] };
  }

  return base;
}

function publicMultiplayerPlayer(state, player, viewerId) {
  const isViewer = player.profileId === viewerId;
  const common = {
    profileId: player.profileId,
    username: player.username,
    avatarUrl: player.avatarUrl || "",
    seatIndex: player.seatIndex,
    status: player.status,
    outcome: player.outcome,
    payout: Number(player.payout || 0),
    isTurn: currentTurnProfileId(state) === player.profileId,
    isYou: isViewer
  };

  if (state.gameId === "blackjack") {
    return {
      ...common,
      hand: player.hand,
      value: scoreBlackjack(player.hand).total
    };
  }

  if (state.gameId === "poker") {
    const visible = isViewer || state.phase === "complete";
    return {
      ...common,
      hand: visible ? player.hand : Array.from({ length: 2 }, () => ({ hidden: true })),
      result: state.phase === "complete" ? player.result : null
    };
  }

  return {
    ...common,
    dice: player.dice,
    total: player.total
  };
}

function multiplayerSettlements(state, stake) {
  return state.players.map((player) => ({
    profileId: player.profileId,
    payout: roundMoney(Number(player.payout || 0)),
    outcome: player.outcome || "lose",
    net: roundMoney(Number(player.payout || 0) - stake)
  }));
}

function scoreBestPokerHand(cards) {
  const usableCards = (cards || []).filter((card) => card && !card.hidden);
  if (usableCards.length < 5) return { strength: 0, tiebreak: [], label: "High Card" };
  let best = null;
  for (let a = 0; a < usableCards.length - 4; a += 1) {
    for (let b = a + 1; b < usableCards.length - 3; b += 1) {
      for (let c = b + 1; c < usableCards.length - 2; c += 1) {
        for (let d = c + 1; d < usableCards.length - 1; d += 1) {
          for (let e = d + 1; e < usableCards.length; e += 1) {
            const result = scorePokerCompetitive([usableCards[a], usableCards[b], usableCards[c], usableCards[d], usableCards[e]]);
            if (!best || comparePokerCompetitive(result, best) > 0) best = result;
          }
        }
      }
    }
  }
  return best;
}

function scorePokerCompetitive(hand) {
  const values = hand.map((card) => card.value).sort((a, b) => a - b);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const groups = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = hand.every((card) => card.suit === hand[0].suit);
  const wheel = values.join(",") === "2,3,4,5,14";
  const unique = [...new Set(values)];
  const straight = unique.length === 5 && (wheel || values[4] - values[0] === 4);
  const straightHigh = wheel ? 5 : values[4];

  if (straight && flush && straightHigh === 14) return { strength: 10, tiebreak: [14], label: "Royal Flush" };
  if (straight && flush) return { strength: 9, tiebreak: [straightHigh], label: "Straight Flush" };
  if (groups[0].count === 4) return { strength: 8, tiebreak: [groups[0].value, groups[1].value], label: "Four of a Kind" };
  if (groups[0].count === 3 && groups[1]?.count === 2) return { strength: 7, tiebreak: [groups[0].value, groups[1].value], label: "Full House" };
  if (flush) return { strength: 6, tiebreak: values.slice().sort((a, b) => b - a), label: "Flush" };
  if (straight) return { strength: 5, tiebreak: [straightHigh], label: "Straight" };
  if (groups[0].count === 3) return { strength: 4, tiebreak: [groups[0].value, ...groups.slice(1).map((item) => item.value).sort((a, b) => b - a)], label: "Three of a Kind" };
  if (groups[0].count === 2 && groups[1]?.count === 2) return { strength: 3, tiebreak: [groups[0].value, groups[1].value, groups[2].value], label: "Two Pair" };
  if (groups[0].count === 2) return { strength: 2, tiebreak: [groups[0].value, ...groups.slice(1).map((item) => item.value).sort((a, b) => b - a)], label: "Pair" };
  return { strength: 1, tiebreak: values.slice().sort((a, b) => b - a), label: "High Card" };
}

function comparePokerCompetitive(left, right) {
  if (left.strength !== right.strength) return left.strength - right.strength;
  const length = Math.max(left.tiebreak.length, right.tiebreak.length);
  for (let i = 0; i < length; i += 1) {
    const diff = Number(left.tiebreak[i] || 0) - Number(right.tiebreak[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function parseBet(raw, max = MAX_BET, maxError = "bet_exceeds_max") {
  const bet = Number(raw);
  if (!Number.isInteger(bet) || bet <= 0) throw new Error("bet_must_be_positive_integer");
  if (bet > max) throw new Error(maxError);
  return bet;
}

function actionName(action) {
  if (typeof action === "string") return action;
  return String(action?.type || action?.action || action?.mode || "action");
}

function startGame(gameId, bet, override = null) {
  if (gameId === "blackjack") return blackjackStart(bet, override);
  if (gameId === "poker") return pokerStart(bet, override);
  if (gameId === "solitaire") return solitaireStart(bet, override);
  if (gameId === "slots") return slotsStart(bet, override);
  if (gameId === "corridor") return corridorStart(bet, override);
  if (gameId === "dice") return diceStart(bet, override);
  throw new Error("unknown_game");
}

function stepGame(gameId, state, action) {
  if (gameId === "blackjack") return blackjackStep(state, action);
  if (gameId === "poker") return pokerStep(state, action);
  if (gameId === "solitaire") return solitaireStep(state, action);
  if (gameId === "corridor") return corridorStep(state, action);
  if (gameId === "dice") return diceStep(state, action);
  if (gameId === "clicker") return clickerStep(state, action);
  throw new Error("action_not_supported");
}

function publicState(gameId, state, roundDelta = 0, fallbackMessage = "") {
  if (gameId === "blackjack") return blackjackPublic(state, roundDelta, fallbackMessage);
  if (gameId === "poker") return pokerPublic(state, roundDelta, fallbackMessage);
  if (gameId === "solitaire") return solitairePublic(state, roundDelta, fallbackMessage);
  if (gameId === "slots") return slotsPublic(state, roundDelta, fallbackMessage);
  if (gameId === "corridor") return corridorPublic(state, roundDelta, fallbackMessage);
  if (gameId === "dice") return dicePublic(state, roundDelta, fallbackMessage);
  if (gameId === "clicker") return clickerPublic(state, roundDelta, fallbackMessage);
  return { gameId, roundDelta, message: fallbackMessage };
}

function secureRandom(maxExclusive) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % maxExclusive;
}

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = secureRandom(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const CARD_SUITS = ["clubs", "diamonds", "hearts", "spades"];
const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function createDeck(faceUp = true) {
  return CARD_SUITS.flatMap((suit) =>
    CARD_RANKS.map((rank) => ({ rank, suit, value: cardValue(rank), faceUp }))
  );
}

function cardValue(rank) {
  if (rank === "A") return 11;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return Number(rank);
}

function scoreBlackjack(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand || []) {
    if (card.rank === "A") aces += 1;
    total += cardValue(card.rank);
  }
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }
  return { total, softAces };
}

function isBlackjack(hand) {
  return hand.length === 2 && scoreBlackjack(hand).total === 21;
}

function draw(state) {
  if (!state.deck?.length) state.deck = shuffle(createDeck());
  return state.deck.pop();
}

function blackjackStart(bet, override = null) {
  const state = {
    gameId: "blackjack",
    phase: "player_turn",
    deck: shuffle(createDeck()),
    playerHand: [],
    dealerHand: [],
    bet,
    outcome: null,
    message: "Round started. Choose hit or stand."
  };
  if (override?.cards?.length) moveCardsToDrawTop(state.deck, normalizeAdminCards(override.cards, "blackjack"), "back");
  state.playerHand.push(draw(state), draw(state));
  state.dealerHand.push(draw(state), draw(state));

  const playerNatural = isBlackjack(state.playerHand);
  const dealerNatural = isBlackjack(state.dealerHand);
  if (playerNatural || dealerNatural) {
    if (playerNatural && dealerNatural) return finishBlackjack(state, "push", 0, "Both have blackjack. Push.");
    if (playerNatural) return finishBlackjack(state, "blackjack", bet * 1.5, "Blackjack pays 3:2.");
    return finishBlackjack(state, "dealer_blackjack", -bet, "Dealer has blackjack.");
  }

  return { state, status: "active", delta: -bet, outcome: "started", message: state.message };
}

function blackjackStep(state, action) {
  const type = String(action?.type || action || "").toLowerCase();
  if (state.phase !== "player_turn") throw new Error("blackjack_round_not_active");
  if (type === "hit") {
    if (scoreBlackjack(state.playerHand).total >= 21) throw new Error("stand_required_at_21");
    state.playerHand.push(draw(state));
    const score = scoreBlackjack(state.playerHand).total;
    if (score > 21) return finishBlackjack(state, "player_bust", 0, "You busted. Dealer wins.");
    state.message = score === 21 ? "You have 21. Stand to let the dealer play." : "Card dealt.";
    return { state, status: "active", delta: 0, outcome: "hit", message: state.message };
  }
  if (type !== "stand") throw new Error("invalid_blackjack_action");
  while (scoreBlackjack(state.dealerHand).total < 17) state.dealerHand.push(draw(state));
  const player = scoreBlackjack(state.playerHand).total;
  const dealer = scoreBlackjack(state.dealerHand).total;
  if (dealer > 21) return finishBlackjack(state, "dealer_bust", state.bet * 2, "Dealer busted. You win.");
  if (player > dealer) return finishBlackjack(state, "win", state.bet * 2, "You beat the dealer.");
  if (player < dealer) return finishBlackjack(state, "lose", 0, "Dealer wins.");
  return finishBlackjack(state, "push", state.bet, "Push. Bet returned.");
}

function finishBlackjack(state, outcome, delta, message) {
  state.phase = "round_over";
  state.outcome = outcome;
  state.message = message;
  return { state, status: "complete", delta, outcome, message };
}

function blackjackPublic(state, roundDelta, message) {
  const hideHole = state.phase === "player_turn" && state.dealerHand.length > 1;
  const dealerHand = hideHole ? [state.dealerHand[0], { hidden: true }] : state.dealerHand;
  const dealerScore = hideHole ? scoreBlackjack([state.dealerHand[0]]) : scoreBlackjack(state.dealerHand);
  return {
    gameId: "blackjack",
    phase: state.phase,
    bet: state.bet,
    roundDelta,
    outcome: state.outcome,
    message: message || state.message,
    playerHand: state.playerHand,
    dealerHand,
    playerValue: scoreBlackjack(state.playerHand).total,
    dealerValue: dealerScore.total
  };
}

const POKER_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const POKER_VALUES = Object.fromEntries(POKER_RANKS.map((rank, index) => [rank, index + 2]));

function createPokerDeck() {
  return CARD_SUITS.flatMap((suit) => POKER_RANKS.map((rank) => ({ rank, suit, value: POKER_VALUES[rank] })));
}

function pokerStart(bet, override = null) {
  const deck = shuffle(createPokerDeck());
  if (override?.cards?.length) moveCardsToDrawTop(deck, normalizeAdminCards(override.cards, "poker"), "front");
  const state = {
    gameId: "poker",
    phase: "preflop",
    deck: deck.slice(4),
    hand: deck.slice(0, 2),
    opponentHand: deck.slice(2, 4),
    communityCards: [],
    bet,
    message: "Hole cards dealt. Reveal the flop."
  };
  return { state, status: "active", delta: -bet, outcome: "started", message: state.message };
}

function pokerStep(state, action) {
  const type = String(action?.type || action || "").toLowerCase();
  if (type === "raisebet" || type === "bet") return pokerRaiseBet(state, action);
  if (!["advanceholdem", "check", "draw"].includes(type)) throw new Error("invalid_poker_action");
  if (!["preflop", "flop", "turn", "river"].includes(state.phase)) throw new Error("poker_round_not_active");

  const streetMessage = advanceHoldemStreet(state);
  if (streetMessage) {
    return { state, status: "active", delta: 0, outcome: state.phase, message: streetMessage };
  }

  const result = scoreBestPokerHand([...state.hand, ...state.communityCards]);
  const opponentResult = scoreBestPokerHand([...state.opponentHand, ...state.communityCards]);
  const comparison = comparePokerCompetitive(result, opponentResult);
  const payout = comparison > 0 ? state.bet * 2 : comparison === 0 ? state.bet : 0;
  const outcome = comparison > 0 ? "win" : comparison === 0 ? "push" : "lose";
  state.phase = "complete";
  state.result = result;
  state.opponentResult = opponentResult;
  state.payout = payout;
  state.outcome = outcome;
  state.message = comparison > 0
    ? `${result.label} wins the pot.`
    : comparison === 0
      ? `Push with ${result.label}.`
      : `${opponentResult.label} wins.`;
  return { state, status: "complete", delta: payout, outcome, message: state.message };
}

function pokerRaiseBet(state, action) {
  if (!["preflop", "flop", "turn", "river"].includes(state.phase)) throw new Error("poker_round_not_active");
  const amount = parseBet(action?.amount ?? action?.bet);
  const nextBet = Number(state.bet || 0) + amount;
  if (nextBet > MAX_BET) throw new Error("bet_exceeds_max");
  state.bet = nextBet;
  state.message = `Added ${amount} credits to the pot.`;
  return { state, status: "active", bet: nextBet, delta: -amount, outcome: "bet", message: state.message };
}

function pokerPublic(state, roundDelta, message) {
  const complete = state.phase === "complete";
  return {
    gameId: "poker",
    phase: state.phase,
    hand: state.hand,
    communityCards: state.communityCards || [],
    opponentHand: complete ? state.opponentHand : Array.from({ length: 2 }, () => ({ hidden: true })),
    bet: state.bet,
    payout: state.payout || 0,
    roundDelta,
    outcome: state.outcome || null,
    result: state.result || null,
    opponentResult: complete ? state.opponentResult : null,
    message: message || state.message
  };
}

const SLOT_SYMBOLS = [
  { id: "cherries", label: "Cherries", multiplier: 3, weight: 28 },
  { id: "lemon", label: "Lemon", multiplier: 4, weight: 24 },
  { id: "bell", label: "Bell", multiplier: 6, weight: 18 },
  { id: "seven", label: "Seven", multiplier: 10, weight: 12 },
  { id: "diamond", label: "Diamond", multiplier: 15, weight: 8 },
  { id: "crown", label: "Crown", multiplier: 25, weight: 6 },
  { id: "lightning", label: "Lightning", multiplier: 50, weight: 4 }
];

function slotsStart(bet, override = null) {
  const reels = override?.reels ? normalizeSlotReels(override.reels) : [pickSlotSymbol(), pickSlotSymbol(), pickSlotSymbol()];
  const counts = reels.reduce((map, symbol) => ({ ...map, [symbol.id]: (map[symbol.id] || 0) + 1 }), {});
  const match = Object.entries(counts).find(([, count]) => count >= 2);
  let payout = 0;
  let outcome = "lose";
  let winningSymbol = null;
  let payoutMultiplier = 0;
  let matchCount = 0;
  let message = `No match. You lost ${bet} credits.`;
  if (match) {
    const symbol = SLOT_SYMBOLS.find((item) => item.id === match[0]);
    matchCount = Number(match[1]);
    payoutMultiplier = matchCount === 3 ? symbol.multiplier : 1;
    winningSymbol = { id: symbol.id, label: symbol.label };
    payout = bet * payoutMultiplier;
    outcome = matchCount === 3 ? "jackpot" : "pair";
    message = matchCount === 3 ? `Three ${symbol.label} pays ${payoutMultiplier}x.` : "Pair pays 1x. Bet returned.";
  }
  const state = {
    gameId: "slots",
    phase: "round_over",
    status: "complete",
    reels,
    bet,
    payout,
    outcome,
    winningSymbol,
    payoutMultiplier,
    matchCount,
    message
  };
  return { state, status: "complete", delta: payout - bet, outcome, message };
}

function pickSlotSymbol() {
  const total = SLOT_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);
  let roll = secureRandom(total);
  for (const symbol of SLOT_SYMBOLS) {
    roll -= symbol.weight;
    if (roll < 0) return { id: symbol.id, label: symbol.label };
  }
  return SLOT_SYMBOLS[0];
}

function slotsPublic(state, roundDelta, message) {
  return {
    gameId: "slots",
    phase: "round_over",
    status: "complete",
    bet: state.bet,
    payout: state.payout,
    roundDelta,
    outcome: state.outcome,
    lastSpin: {
      reels: state.reels,
      payout: state.payout,
      result: state.outcome,
      winningSymbol: state.winningSymbol || null,
      payoutMultiplier: state.payoutMultiplier || 0,
      matchCount: state.matchCount || 0
    },
    message: message || state.message,
    payoutTable: {
      twoMatch: { label: "Any two matching symbols", pays: "1x bet" },
      threeMatch: SLOT_SYMBOLS.map((symbol) => ({
        id: symbol.id,
        label: symbol.label,
        multiplier: symbol.multiplier,
        pays: `${symbol.multiplier}x bet`
      }))
    }
  };
}

function diceStart(bet, override = null) {
  const state = { gameId: "dice", phase: "choosing_mode", bet, playerDice: [], houseDice: [], message: "Choose high, low, or doubles." };
  if (override?.nextDice) state.adminControl = { nextDice: normalizeDiceOverride(override.nextDice, true) };
  return { state, status: "active", delta: -bet, outcome: "started", message: state.message };
}

function diceStep(state, action) {
  const mode = String(action?.mode || action?.type || action || "").toLowerCase();
  if (!["high", "low", "doubles"].includes(mode)) throw new Error("invalid_dice_mode");
  const diceOverride = consumeSoloDiceOverride(state);
  const playerDice = diceOverride?.playerDice || [secureRandom(6) + 1, secureRandom(6) + 1];
  const houseDice = diceOverride?.houseDice || [secureRandom(6) + 1, secureRandom(6) + 1];
  const playerTotal = playerDice[0] + playerDice[1];
  const houseTotal = houseDice[0] + houseDice[1];
  let payout = 0;
  let outcome = "lose";
  if (mode === "doubles") {
    if (playerDice[0] === playerDice[1]) {
      payout = state.bet * 6;
      outcome = "win";
    }
  } else if (playerTotal === houseTotal) {
    payout = state.bet;
    outcome = "push";
  } else if ((mode === "high" && playerTotal > houseTotal) || (mode === "low" && playerTotal < houseTotal)) {
    payout = state.bet * 2;
    outcome = "win";
  }
  state.phase = "round_over";
  state.mode = mode;
  state.playerDice = playerDice;
  state.houseDice = houseDice;
  state.outcome = outcome;
  state.message = outcome === "win" ? "You won the dice duel." : outcome === "push" ? "Push. Bet returned." : "House wins.";
  return { state, status: "complete", delta: payout, outcome, message: state.message };
}

function dicePublic(state, roundDelta, message) {
  const playerTotal = (state.playerDice || []).reduce((sum, die) => sum + die, 0);
  const houseTotal = (state.houseDice || []).reduce((sum, die) => sum + die, 0);
  return { ...state, roundDelta, message: message || state.message, playerTotal, houseTotal };
}

const CLICKER_BASE_UPGRADE_COST = 25;
const CLICKER_UPGRADE_MULTIPLIER = 1.45;
const CLICKER_MAX_BATCH_CLICKS = 50;
const CLICKER_RATE_WINDOW_MS = 500;
const CLICKER_MAX_CLICKS_PER_WINDOW = 6;

function createClickerState() {
  return {
    gameId: "clicker",
    phase: "active",
    status: "active",
    upgradeLevel: 0,
    clickValue: 1,
    nextUpgradeCost: CLICKER_BASE_UPGRADE_COST,
    totalClicks: 0,
    totalEarned: 0,
    totalSpent: 0,
    roundDelta: 0,
    message: "Click the credit to earn wallet credits.",
    clickWindowStartedAt: 0,
    clicksInWindow: 0
  };
}

function clickerStep(state, action) {
  const current = normalizeClickerState(state);
  const type = String(action?.type || action?.action || action || "").trim().toLowerCase();

  if (type === "click") return clickerClick(current, action || {});
  if (type === "buyupgrade" || type === "upgrade") return clickerBuyUpgrade(current);

  throw new Error("invalid_action");
}

function clickerClick(state, action) {
  const clickCount = Number(action.clickCount ?? action.count ?? 1);
  if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > CLICKER_MAX_BATCH_CLICKS) {
    throw new Error("invalid_action");
  }

  const now = Date.now();
  let clickWindowStartedAt = Number(state.clickWindowStartedAt || 0);
  let clicksInWindow = Number(state.clicksInWindow || 0);

  if (!clickWindowStartedAt || now - clickWindowStartedAt >= CLICKER_RATE_WINDOW_MS) {
    clickWindowStartedAt = now;
    clicksInWindow = 0;
  }

  if (clicksInWindow + clickCount > CLICKER_MAX_CLICKS_PER_WINDOW) {
    throw new Error("click_rate_limited");
  }

  const earned = roundMoney(clickCount * state.clickValue);
  const nextState = {
    ...state,
    totalClicks: state.totalClicks + clickCount,
    totalEarned: roundMoney(state.totalEarned + earned),
    roundDelta: earned,
    clickWindowStartedAt,
    clicksInWindow: clicksInWindow + clickCount,
    message: `Earned ${earned} credits.`,
    lastAction: "click"
  };

  return {
    state: nextState,
    status: "active",
    delta: earned,
    outcome: "click",
    message: nextState.message
  };
}

function clickerBuyUpgrade(state) {
  const cost = state.nextUpgradeCost;
  const upgradeLevel = state.upgradeLevel + 1;
  const clickValue = clickerClickValue(upgradeLevel);
  const nextState = {
    ...state,
    upgradeLevel,
    clickValue,
    nextUpgradeCost: clickerUpgradeCost(upgradeLevel),
    totalSpent: roundMoney(state.totalSpent + cost),
    roundDelta: -cost,
    message: `Upgrade bought. Each click is now worth ${clickValue} credits.`,
    lastAction: "buyUpgrade"
  };

  return {
    state: nextState,
    status: "active",
    delta: -cost,
    outcome: "upgrade",
    message: nextState.message
  };
}

function clickerPublic(state, roundDelta, message) {
  const current = normalizeClickerState(state);
  return {
    gameId: "clicker",
    phase: current.phase,
    status: current.status,
    upgradeLevel: current.upgradeLevel,
    clickValue: current.clickValue,
    nextUpgradeCost: current.nextUpgradeCost,
    totalClicks: current.totalClicks,
    totalEarned: current.totalEarned,
    totalSpent: current.totalSpent,
    roundDelta,
    message: message || current.message,
    suggestedActions: [
      { type: "click", label: `Click for ${current.clickValue}` },
      { type: "buyUpgrade", label: `Upgrade for ${current.nextUpgradeCost}` }
    ]
  };
}

function normalizeClickerState(state) {
  if (!state || typeof state !== "object") return createClickerState();

  const upgradeLevel = Math.max(0, Math.floor(Number(state.upgradeLevel || 0)));
  return {
    ...createClickerState(),
    ...state,
    gameId: "clicker",
    phase: "active",
    status: "active",
    upgradeLevel,
    clickValue: clickerClickValue(upgradeLevel),
    nextUpgradeCost: clickerUpgradeCost(upgradeLevel),
    totalClicks: normalizeNonNegativeInteger(state.totalClicks),
    totalEarned: roundMoney(state.totalEarned),
    totalSpent: roundMoney(state.totalSpent),
    roundDelta: roundMoney(state.roundDelta),
    clickWindowStartedAt: normalizeNonNegativeInteger(state.clickWindowStartedAt),
    clicksInWindow: normalizeNonNegativeInteger(state.clicksInWindow)
  };
}

function clickerClickValue(level) {
  return 1 + Math.max(0, Math.floor(Number(level || 0)));
}

function clickerUpgradeCost(level) {
  return Math.floor(CLICKER_BASE_UPGRADE_COST * CLICKER_UPGRADE_MULTIPLIER ** Math.max(0, Math.floor(Number(level || 0))));
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

const CORRIDOR_BONUS_RATES = [0.25, 0.4, 0.6, 0.85, 1.15];
const CORRIDOR_MAX_BONUS_RATE = 2;

function corridorStart(bet, override = null) {
  const currentDoors = createCorridorDoors(0, bet);
  const state = {
    gameId: "corridor",
    phase: "inRound",
    totalRooms: null,
    isEndless: true,
    roomIndex: 0,
    roomsCleared: 0,
    bet,
    pendingBonus: 0,
    currentDoors: override?.doorRoles ? applyCorridorDoorRoles(currentDoors, normalizeCorridorRolePayload(override.doorRoles), bet, 0) : currentDoors,
    history: [],
    message: "Room 1 waits. The corridor keeps going until you escape or hit a trap."
  };
  return { state, status: "active", delta: -bet, outcome: "started", message: state.message };
}

function corridorStep(state, action) {
  const type = action?.type || action;
  if (type === "cashOut") {
    if (state.roomsCleared <= 0) throw new Error("cashout_not_available");
    const payout = state.pendingBonus;
    state.phase = "cashedOut";
    state.pendingBonus = 0;
    state.currentDoors = [];
    state.payout = payout;
    state.lastResult = { outcome: "cashOut", roomNumber: state.roomsCleared, payout };
    state.message = `Cashed out ${payout} bonus credits.`;
    return { state, status: "complete", delta: payout, outcome: "cashOut", message: state.message };
  }
  if (type !== "chooseDoor") throw new Error("invalid_corridor_action");
  const door = state.currentDoors.find((item) => item.index === Number(action.doorIndex ?? action.index));
  if (!door) throw new Error("door_not_available");
  const bonus = door.role === "bonus" ? door.bonus : 0;
  const roomNumber = state.roomIndex + 1;
  state.history.push({ roomNumber, doorIndex: door.index, label: door.label, outcome: door.role, bonusAwarded: bonus });
  state.lastResult = { outcome: door.role, roomNumber, doorIndex: door.index, bonusAwarded: bonus, payout: 0 };
  if (door.role === "trap") {
    state.phase = "trapped";
    state.currentDoors = [];
    state.pendingBonus = 0;
    state.payout = 0;
    state.message = "Trap door. Run lost.";
    return { state, status: "complete", delta: 0, outcome: "trap", message: state.message };
  }
  state.pendingBonus += bonus;
  state.roomIndex += 1;
  state.roomsCleared += 1;
  state.currentDoors = createCorridorDoors(state.roomIndex, state.bet);
  state.message = bonus
    ? `Bonus door. ${state.pendingBonus} pending credits. Room ${state.roomIndex + 1} waits.`
    : `Safe door. Room ${state.roomIndex + 1} waits.`;
  return { state, status: "active", delta: 0, outcome: door.role, message: state.message };
}

function createCorridorDoors(roomIndex, bet) {
  const labels = ["Left", "Center", "Right"];
  const roles = shuffle(["safe", "bonus", "trap"]);
  const bonus = Math.max(1, Math.round(bet * corridorBonusRate(roomIndex)));
  return roles.map((role, index) => ({ index, label: labels[index], role, bonus: role === "bonus" ? bonus : 0 }));
}

function corridorBonusRate(roomIndex) {
  const index = Math.max(0, Number.isInteger(Number(roomIndex)) ? Number(roomIndex) : 0);
  if (index < CORRIDOR_BONUS_RATES.length) return CORRIDOR_BONUS_RATES[index];

  const extraRooms = index - CORRIDOR_BONUS_RATES.length + 1;
  return Math.min(CORRIDOR_MAX_BONUS_RATE, CORRIDOR_BONUS_RATES[CORRIDOR_BONUS_RATES.length - 1] + extraRooms * 0.1);
}

function corridorPublic(state, roundDelta, message) {
  return {
    gameId: "corridor",
    phase: state.phase,
    totalRooms: state.totalRooms,
    isEndless: true,
    roomNumber: state.phase === "inRound" ? state.roomIndex + 1 : null,
    roomsCleared: state.roomsCleared,
    bet: state.bet,
    pendingBonus: state.pendingBonus,
    payout: state.payout || 0,
    roundDelta,
    canCashOut: state.phase === "inRound" && state.roomsCleared > 0,
    doors: (state.currentDoors || []).map((door) => ({ index: door.index, label: door.label })),
    history: state.history || [],
    lastResult: state.lastResult || null,
    message: message || state.message
  };
}

const SOLITAIRE_SUITS = ["hearts", "diamonds", "clubs", "spades"];
const SOLITAIRE_RED = new Set(["hearts", "diamonds"]);
const SOLITAIRE_RANKS = [null, "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function solitaireStart(bet, override = null) {
  const deck = shuffle(SOLITAIRE_SUITS.flatMap((suit) =>
    Array.from({ length: 13 }, (_, index) => {
      const value = index + 1;
      return { id: `${suit}-${value}`, suit, rank: SOLITAIRE_RANKS[value], value, color: SOLITAIRE_RED.has(suit) ? "red" : "black", faceUp: false };
    })
  ));
  const tableau = Array.from({ length: 7 }, (_, pileIndex) => {
    const pile = [];
    for (let i = 0; i <= pileIndex; i += 1) {
      const card = deck.pop();
      card.faceUp = i === pileIndex;
      pile.push(card);
    }
    return pile;
  });
  const state = {
    gameId: "solitaire",
    status: "playing",
    phase: "playing",
    bet,
    tableau,
    stock: deck,
    waste: [],
    foundations: Object.fromEntries(SOLITAIRE_SUITS.map((suit) => [suit, []])),
    moves: 0,
    message: "Solitaire started."
  };
  if (override?.nextStockCard) moveSolitaireCardToStockTop(state, normalizeSolitaireCardInput(override.nextStockCard));
  return { state, status: "active", delta: -bet, outcome: "started", message: state.message };
}

function solitaireStep(state, action) {
  const type = action?.type || action;
  if (type === "drawStock") {
    if (state.stock.length) {
      const card = state.stock.pop();
      card.faceUp = true;
      state.waste.push(card);
      state.moves += 1;
      state.message = "Drew from stock.";
      return { state: finishSolitaireIfWon(state), status: state.status === "won" ? "complete" : "active", delta: state.status === "won" ? state.bet * 5 : 0, outcome: state.status === "won" ? "win" : "draw", message: state.message };
    }
    if (state.waste.length) {
      state.stock = state.waste.reverse().map((card) => ({ ...card, faceUp: false }));
      state.waste = [];
      state.moves += 1;
      state.message = "Waste returned to stock.";
      return { state, status: "active", delta: 0, outcome: "recycle", message: state.message };
    }
    throw new Error("stock_empty");
  }
  if (type === "moveWasteToFoundation") return solitaireMoveWasteToFoundation(state);
  if (type === "moveWasteToTableau") return solitaireMoveWasteToTableau(state, Number(action.targetIndex));
  if (type === "moveTableauToFoundation") return solitaireMoveTableauToFoundation(state, Number(action.sourceIndex));
  if (type === "moveTableauToTableau") return solitaireMoveTableauToTableau(state, Number(action.sourceIndex), Number(action.targetIndex), Number(action.count));
  if (type === "moveFoundationToTableau") return solitaireMoveFoundationToTableau(state, String(action.suit), Number(action.targetIndex));
  throw new Error("invalid_solitaire_action");
}

function top(pile) {
  return pile[pile.length - 1] || null;
}

function canFoundation(card, pile) {
  if (!card?.faceUp) return false;
  const foundationTop = top(pile);
  return foundationTop ? foundationTop.suit === card.suit && card.value === foundationTop.value + 1 : card.value === 1;
}

function canTableau(card, pile) {
  if (!card?.faceUp) return false;
  const target = top(pile);
  return target ? target.faceUp && target.color !== card.color && card.value === target.value - 1 : card.value === 13;
}

function flipTop(pile) {
  const card = top(pile);
  if (card) card.faceUp = true;
}

function finishSolitaireIfWon(state) {
  if (SOLITAIRE_SUITS.every((suit) => state.foundations[suit].length === 13)) {
    state.status = "won";
    state.phase = "won";
    state.message = `Solitaire cleared. Won ${state.bet * 5} credits.`;
  }
  return state;
}

function solitaireResult(state, outcome, message) {
  finishSolitaireIfWon(state);
  const won = state.status === "won";
  return { state, status: won ? "complete" : "active", delta: won ? state.bet * 5 : 0, outcome: won ? "win" : outcome, message: won ? state.message : message };
}

function solitaireMoveWasteToFoundation(state) {
  const card = top(state.waste);
  if (!canFoundation(card, state.foundations[card?.suit])) throw new Error("illegal_move");
  state.foundations[card.suit].push(state.waste.pop());
  state.moves += 1;
  return solitaireResult(state, "move", "Moved waste to foundation.");
}

function solitaireMoveWasteToTableau(state, targetIndex) {
  const card = top(state.waste);
  const target = state.tableau[targetIndex];
  if (!target || !canTableau(card, target)) throw new Error("illegal_move");
  target.push(state.waste.pop());
  state.moves += 1;
  return solitaireResult(state, "move", "Moved waste to tableau.");
}

function solitaireMoveTableauToFoundation(state, sourceIndex) {
  const source = state.tableau[sourceIndex];
  const card = top(source || []);
  if (!source || !canFoundation(card, state.foundations[card?.suit])) throw new Error("illegal_move");
  state.foundations[card.suit].push(source.pop());
  flipTop(source);
  state.moves += 1;
  return solitaireResult(state, "move", "Moved tableau to foundation.");
}

function validRun(cards) {
  if (!cards.length || cards.some((card) => !card.faceUp)) return false;
  for (let i = 1; i < cards.length; i += 1) {
    if (cards[i - 1].color === cards[i].color || cards[i].value !== cards[i - 1].value - 1) return false;
  }
  return true;
}

function solitaireMoveTableauToTableau(state, sourceIndex, targetIndex, count) {
  const source = state.tableau[sourceIndex];
  const target = state.tableau[targetIndex];
  if (!source || !target || source === target || !Number.isInteger(count) || count <= 0 || count > source.length) throw new Error("illegal_move");
  const moving = source.slice(source.length - count);
  if (!validRun(moving) || !canTableau(moving[0], target)) throw new Error("illegal_move");
  source.splice(source.length - count, count);
  target.push(...moving);
  flipTop(source);
  state.moves += 1;
  return solitaireResult(state, "move", "Moved tableau run.");
}

function solitaireMoveFoundationToTableau(state, suit, targetIndex) {
  const source = state.foundations[suit];
  const target = state.tableau[targetIndex];
  const card = top(source || []);
  if (!source || !target || !canTableau(card, target)) throw new Error("illegal_move");
  target.push(source.pop());
  state.moves += 1;
  return solitaireResult(state, "move", "Moved foundation to tableau.");
}

function publicCard(card) {
  if (!card) return null;
  if (!card.faceUp) return { faceUp: false };
  return { id: card.id, suit: card.suit, rank: card.rank, value: card.value, color: card.color, faceUp: true };
}

function solitairePublic(state, roundDelta, message) {
  return {
    gameId: "solitaire",
    status: state.status,
    phase: state.phase,
    bet: state.bet,
    roundDelta,
    moves: state.moves,
    stockCount: state.stock.length,
    wasteTop: publicCard(top(state.waste)),
    tableau: state.tableau.map((pile) => pile.map(publicCard)),
    foundations: Object.fromEntries(SOLITAIRE_SUITS.map((suit) => [suit, { count: state.foundations[suit].length, top: publicCard(top(state.foundations[suit])) }])),
    suggestedActions: solitaireSuggestedActions(state),
    message: message || state.message
  };
}

function solitaireSuggestedActions(state) {
  if (state.status !== "playing") return [];
  const actions = [];
  if (state.stock.length || state.waste.length) actions.push({ type: "drawStock" });
  const wasteCard = top(state.waste);
  if (canFoundation(wasteCard, state.foundations[wasteCard?.suit])) actions.push({ type: "moveWasteToFoundation" });
  if (wasteCard) {
    state.tableau.forEach((pile, targetIndex) => {
      if (canTableau(wasteCard, pile)) actions.push({ type: "moveWasteToTableau", targetIndex });
    });
  }
  state.tableau.forEach((pile, sourceIndex) => {
    if (canFoundation(top(pile), state.foundations[top(pile)?.suit])) actions.push({ type: "moveTableauToFoundation", sourceIndex });
    for (let count = 1; count <= pile.length; count += 1) {
      const moving = pile.slice(pile.length - count);
      if (!validRun(moving)) continue;
      state.tableau.forEach((target, targetIndex) => {
        if (targetIndex !== sourceIndex && canTableau(moving[0], target)) actions.push({ type: "moveTableauToTableau", sourceIndex, targetIndex, count });
      });
    }
  });
  SOLITAIRE_SUITS.forEach((suit) => {
    state.tableau.forEach((target, targetIndex) => {
      if (canTableau(top(state.foundations[suit]), target)) actions.push({ type: "moveFoundationToTableau", suit, targetIndex });
    });
  });
  return actions;
}
