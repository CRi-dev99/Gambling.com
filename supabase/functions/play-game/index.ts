import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const GAME_IDS = new Set(["blackjack", "poker", "solitaire", "slots", "corridor", "dice"]);
const MULTIPLAYER_GAME_IDS = new Set(["blackjack", "poker", "dice"]);
const MAX_BET = 10000;
const TURN_TIMEOUT_SECONDS = 45;

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

    if (String(body.type || "").startsWith("multiplayer:")) {
      const result = await handleMultiplayer(admin, user, profile, body);
      return json(result);
    }

    if (!GAME_IDS.has(body.gameId)) {
      return json({ error: "unknown_game" }, 400);
    }

    if (body.type === "start") {
      const bet = parseBet(body.bet);
      const started = startGame(body.gameId, bet);
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
      const applied = await rpcSingle(admin, "apply_game_step", {
        p_profile_id: user.id,
        p_session_id: session.id,
        p_expected_version: session.version,
        p_game_id: body.gameId,
        p_state: stepped.state,
        p_status: stepped.status,
        p_bet: session.bet,
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
    const status = message.includes("insufficient_credits") ? 402 : 400;
    return json({ error: message }, status);
  }
});

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
  return { id: data.id, username: data.username, credits: Number(data.credits) };
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
      return { error: "unknown_multiplayer_request" };
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
  const stake = parseBet(body.stake);
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

  const { error } = await admin.from("multiplayer_table_seats").insert({
    table_id: table.id,
    profile_id: user.id,
    seat_index: seatIndex,
    username: profile.username,
    status: "seated"
  });
  if (error) throw error;

  await touchMultiplayerTable(admin, table.id);
  return { profile, table: await hydrateMultiplayerTable(admin, table.id, user.id) };
}

async function setMultiplayerReady(admin, profileId, profile, body) {
  const table = await requireMultiplayerTableForSeat(admin, String(body.tableId || ""), profileId);
  if (table.status !== "waiting") throw new Error("table_already_started");
  const ready = body.ready !== false;
  const { error } = await admin
    .from("multiplayer_table_seats")
    .update({ status: ready ? "ready" : "seated", updated_at: new Date().toISOString() })
    .eq("table_id", table.id)
    .eq("profile_id", profileId);
  if (error) throw error;
  await touchMultiplayerTable(admin, table.id);
  return { profile, table: await hydrateMultiplayerTable(admin, table.id, profileId) };
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
  const credits = await rpcRows(admin, "apply_multiplayer_credit_entries", {
    p_table_id: table.id,
    p_game_id: table.game_id,
    p_entries: entries
  });

  const setupState = await getMultiplayerPrivateState(admin, table.id);
  const started = createMultiplayerState(table.game_id, Number(table.stake), activeSeats, setupState?.state?.diceMode);
  const publicState = multiplayerPublicState(started, table, activeSeats, profileId);
  const deadline = started.phase === "complete" ? null : turnDeadline();

  await saveMultiplayerState(admin, table.id, started);
  await admin
    .from("multiplayer_table_seats")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("table_id", table.id)
    .in("profile_id", activeSeats.map((seat) => seat.profile_id));

  const { error } = await admin
    .from("multiplayer_tables")
    .update({
      status: started.phase === "complete" ? "complete" : "active",
      public_state: publicState,
      turn_profile_id: started.phase === "complete" ? null : currentTurnProfileId(started),
      turn_deadline_at: deadline,
      version: Number(table.version) + 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", table.id);
  if (error) throw error;

  if (started.phase === "complete") {
    await settleMultiplayerTable(admin, table.id, table.game_id, Number(table.stake), started);
  }

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
  const publicState = multiplayerPublicState(next, table, seats, profileId);
  const complete = next.phase === "complete";
  let credits = [];

  await saveMultiplayerState(admin, table.id, next);
  if (complete) {
    credits = await settleMultiplayerTable(admin, table.id, table.game_id, Number(table.stake), next);
  }

  const { error } = await admin
    .from("multiplayer_tables")
    .update({
      status: complete ? "complete" : "active",
      public_state: publicState,
      turn_profile_id: complete ? null : currentTurnProfileId(next),
      turn_deadline_at: complete ? null : turnDeadline(),
      version: Number(table.version) + 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", table.id);
  if (error) throw error;

  return {
    profile: profileWithCredits(profile, credits, profileId),
    table: await hydrateMultiplayerTable(admin, table.id, profileId)
  };
}

async function leaveMultiplayerTable(admin, profileId, profile, body) {
  const table = await requireMultiplayerTableForSeat(admin, String(body.tableId || ""), profileId);
  if (table.status !== "waiting") throw new Error("cannot_leave_active_table");

  const { error } = await admin
    .from("multiplayer_table_seats")
    .delete()
    .eq("table_id", table.id)
    .eq("profile_id", profileId);
  if (error) throw error;

  const seats = await getMultiplayerSeats(admin, table.id);
  if (!seats.length) {
    await admin.from("multiplayer_tables").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", table.id);
    return { profile, table: null };
  }

  if (table.host_profile_id === profileId) {
    await admin
      .from("multiplayer_tables")
      .update({ host_profile_id: seats[0].profile_id, updated_at: new Date().toISOString() })
      .eq("id", table.id);
  } else {
    await touchMultiplayerTable(admin, table.id);
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

async function saveMultiplayerState(admin, tableId, state) {
  const { error } = await admin
    .from("multiplayer_table_state")
    .upsert({ table_id: tableId, state, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function touchMultiplayerTable(admin, tableId) {
  const { error } = await admin
    .from("multiplayer_tables")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", tableId);
  if (error) throw error;
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

async function settleMultiplayerTable(admin, tableId, gameId, stake, state) {
  const currentSeats = await getMultiplayerSeats(admin, tableId);
  const alreadySettled = state.players.every((player) =>
    currentSeats.some((seat) => seat.profile_id === player.profileId && seat.status === "settled")
  );
  if (alreadySettled) return [];

  const settlements = multiplayerSettlements(state, stake);
  const entries = settlements.map((item) => ({
    profileId: item.profileId,
    bet: stake,
    delta: item.payout,
    outcome: item.outcome,
    action: "multiplayer_settle"
  }));
  const credits = await rpcRows(admin, "apply_multiplayer_credit_entries", {
    p_table_id: tableId,
    p_game_id: gameId,
    p_entries: entries
  });

  for (const settlement of settlements) {
    await admin
      .from("multiplayer_table_seats")
      .update({
        status: "settled",
        settled_delta: roundMoney(settlement.payout - stake),
        updated_at: new Date().toISOString()
      })
      .eq("table_id", tableId)
      .eq("profile_id", settlement.profileId);
  }

  return credits;
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
    const hand = deck.splice(0, 5);
    return {
      profileId: seat.profile_id,
      username: seat.username,
      seatIndex: Number(seat.seat_index),
      hand,
      held: [false, false, false, false, false],
      status: "holding",
      result: null,
      outcome: null,
      payout: 0
    };
  });

  return {
    mode: "multiplayer",
    gameId: "poker",
    phase: "holding",
    stake,
    deck,
    players,
    turnIndex: 0,
    message: "Choose holds, then draw once."
  };
}

function stepMultiplayerPoker(state, profileId, action, timeout) {
  const player = state.players[state.turnIndex];
  if (!player || player.profileId !== profileId) throw new Error("not_your_turn");
  if (state.phase !== "holding") throw new Error("poker_table_not_active");

  const type = timeout ? "draw" : String(action?.type || action || "").toLowerCase();
  if (type === "togglehold") {
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index > 4) throw new Error("invalid_card_index");
    player.held[index] = !player.held[index];
    state.message = player.held[index] ? "Card held." : "Card released.";
    return state;
  }

  if (type !== "draw") throw new Error("invalid_poker_action");
  for (let i = 0; i < 5; i += 1) {
    if (!player.held[i]) player.hand[i] = state.deck.pop();
  }
  player.result = scorePokerCompetitive(player.hand);
  player.status = timeout ? "timed_out" : "drawn";
  state.message = timeout ? `${player.username} timed out and drew.` : `${player.username} drew.`;
  return advanceMultiplayerPoker(state);
}

function advanceMultiplayerPoker(state) {
  const nextIndex = state.players.findIndex((player) => player.status === "holding");
  if (nextIndex >= 0) {
    state.turnIndex = nextIndex;
    return state;
  }

  const best = state.players.reduce((leader, player) => {
    const result = player.result || scorePokerCompetitive(player.hand);
    player.result = result;
    if (!leader || comparePokerCompetitive(result, leader.result) > 0) return player;
    return leader;
  }, null);
  const winners = state.players.filter((player) => comparePokerCompetitive(player.result, best.result) === 0);
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

  player.dice = [secureRandom(6) + 1, secureRandom(6) + 1];
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

  return base;
}

function publicMultiplayerPlayer(state, player, viewerId) {
  const isViewer = player.profileId === viewerId;
  const common = {
    profileId: player.profileId,
    username: player.username,
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
      hand: visible ? player.hand : Array.from({ length: 5 }, () => ({ hidden: true })),
      held: visible ? player.held : [],
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

function parseBet(raw) {
  const bet = Number(raw);
  if (!Number.isInteger(bet) || bet <= 0) throw new Error("Bet must be a positive whole number.");
  if (bet > MAX_BET) throw new Error(`Bet cannot exceed ${MAX_BET} credits.`);
  return bet;
}

function actionName(action) {
  if (typeof action === "string") return action;
  return String(action?.type || action?.action || action?.mode || "action");
}

function startGame(gameId, bet) {
  if (gameId === "blackjack") return blackjackStart(bet);
  if (gameId === "poker") return pokerStart(bet);
  if (gameId === "solitaire") return solitaireStart(bet);
  if (gameId === "slots") return slotsStart(bet);
  if (gameId === "corridor") return corridorStart(bet);
  if (gameId === "dice") return diceStart(bet);
  throw new Error("unknown_game");
}

function stepGame(gameId, state, action) {
  if (gameId === "blackjack") return blackjackStep(state, action);
  if (gameId === "poker") return pokerStep(state, action);
  if (gameId === "solitaire") return solitaireStep(state, action);
  if (gameId === "corridor") return corridorStep(state, action);
  if (gameId === "dice") return diceStep(state, action);
  throw new Error("action_not_supported");
}

function publicState(gameId, state, roundDelta = 0, fallbackMessage = "") {
  if (gameId === "blackjack") return blackjackPublic(state, roundDelta, fallbackMessage);
  if (gameId === "poker") return pokerPublic(state, roundDelta, fallbackMessage);
  if (gameId === "solitaire") return solitairePublic(state, roundDelta, fallbackMessage);
  if (gameId === "slots") return slotsPublic(state, roundDelta, fallbackMessage);
  if (gameId === "corridor") return corridorPublic(state, roundDelta, fallbackMessage);
  if (gameId === "dice") return dicePublic(state, roundDelta, fallbackMessage);
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

function blackjackStart(bet) {
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

function pokerStart(bet) {
  const deck = shuffle(createPokerDeck());
  const state = {
    gameId: "poker",
    phase: "holding",
    deck: deck.slice(5),
    hand: deck.slice(0, 5),
    held: [false, false, false, false, false],
    bet,
    message: "Choose cards to hold, then draw."
  };
  return { state, status: "active", delta: -bet, outcome: "started", message: state.message };
}

function pokerStep(state, action) {
  const type = action?.type || action;
  if (type === "toggleHold") {
    if (state.phase !== "holding") throw new Error("poker_round_not_active");
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index > 4) throw new Error("invalid_card_index");
    state.held[index] = !state.held[index];
    state.message = state.held[index] ? "Card held." : "Card released.";
    return { state, status: "active", delta: 0, outcome: "hold", message: state.message };
  }
  if (type !== "draw") throw new Error("invalid_poker_action");
  if (state.phase !== "holding") throw new Error("poker_round_not_active");
  for (let i = 0; i < 5; i += 1) {
    if (!state.held[i]) state.hand[i] = state.deck.pop();
  }
  const result = scorePoker(state.hand);
  const payout = state.bet * result.multiplier;
  state.phase = "complete";
  state.result = result;
  state.payout = payout;
  state.message = result.multiplier ? `${result.label} pays ${result.multiplier}x.` : "No winning hand.";
  return { state, status: "complete", delta: payout, outcome: result.rank, message: state.message };
}

function scorePoker(hand) {
  const values = hand.map((card) => card.value).sort((a, b) => a - b);
  const suits = hand.map((card) => card.suit);
  const counts = [...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map()).values()].sort((a, b) => b - a);
  const unique = [...new Set(values)];
  const flush = suits.every((suit) => suit === suits[0]);
  const wheel = values.join(",") === "2,3,4,5,14";
  const straight = unique.length === 5 && (wheel || values[4] - values[0] === 4);
  const royal = flush && values.join(",") === "10,11,12,13,14";
  if (royal) return { rank: "royalFlush", label: "Royal Flush", multiplier: 100 };
  if (straight && flush) return { rank: "straightFlush", label: "Straight Flush", multiplier: 50 };
  if (counts[0] === 4) return { rank: "four", label: "Four of a Kind", multiplier: 25 };
  if (counts[0] === 3 && counts[1] === 2) return { rank: "fullHouse", label: "Full House", multiplier: 9 };
  if (flush) return { rank: "flush", label: "Flush", multiplier: 6 };
  if (straight) return { rank: "straight", label: "Straight", multiplier: 4 };
  if (counts[0] === 3) return { rank: "three", label: "Three of a Kind", multiplier: 3 };
  if (counts[0] === 2 && counts[1] === 2) return { rank: "twoPair", label: "Two Pair", multiplier: 2 };
  if (counts[0] === 2) return { rank: "pair", label: "Pair", multiplier: 1 };
  return { rank: "none", label: "No Win", multiplier: 0 };
}

function pokerPublic(state, roundDelta, message) {
  return {
    gameId: "poker",
    phase: state.phase,
    hand: state.hand,
    held: state.held,
    bet: state.bet,
    payout: state.payout || 0,
    roundDelta,
    result: state.result || null,
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

function slotsStart(bet) {
  const reels = [pickSlotSymbol(), pickSlotSymbol(), pickSlotSymbol()];
  const counts = reels.reduce((map, symbol) => ({ ...map, [symbol.id]: (map[symbol.id] || 0) + 1 }), {});
  const match = Object.entries(counts).find(([, count]) => count >= 2);
  let payout = 0;
  let outcome = "lose";
  let message = `No match. You lost ${bet} credits.`;
  if (match) {
    const symbol = SLOT_SYMBOLS.find((item) => item.id === match[0]);
    const multiplier = match[1] === 3 ? symbol.multiplier : 1;
    payout = bet * multiplier;
    outcome = match[1] === 3 ? "jackpot" : "pair";
    message = match[1] === 3 ? `Three ${symbol.label} pays ${multiplier}x.` : "Pair pays 1x. Bet returned.";
  }
  const state = { gameId: "slots", phase: "round_over", status: "complete", reels, bet, payout, outcome, message };
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
    lastSpin: { reels: state.reels, payout: state.payout, result: state.outcome },
    message: message || state.message,
    payoutTable: {
      twoMatch: { label: "Any two matching symbols", pays: "1x bet" },
      threeMatch: SLOT_SYMBOLS.map((symbol) => ({ label: symbol.label, pays: `${symbol.multiplier}x bet` }))
    }
  };
}

function diceStart(bet) {
  const state = { gameId: "dice", phase: "choosing_mode", bet, playerDice: [], houseDice: [], message: "Choose high, low, or doubles." };
  return { state, status: "active", delta: -bet, outcome: "started", message: state.message };
}

function diceStep(state, action) {
  const mode = String(action?.mode || action?.type || action || "").toLowerCase();
  if (!["high", "low", "doubles"].includes(mode)) throw new Error("invalid_dice_mode");
  const playerDice = [secureRandom(6) + 1, secureRandom(6) + 1];
  const houseDice = [secureRandom(6) + 1, secureRandom(6) + 1];
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

const CORRIDOR_BONUS_RATES = [0.25, 0.4, 0.6, 0.85, 1.15];

function corridorStart(bet) {
  const state = {
    gameId: "corridor",
    phase: "inRound",
    totalRooms: 5,
    roomIndex: 0,
    roomsCleared: 0,
    bet,
    pendingBonus: 0,
    currentDoors: createCorridorDoors(0, bet),
    history: [],
    message: "Room 1 waits. Choose a door."
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
    state.message = `Cashed out ${payout} bonus credits.`;
    return { state, status: "complete", delta: payout, outcome: "cashOut", message: state.message };
  }
  if (type !== "chooseDoor") throw new Error("invalid_corridor_action");
  const door = state.currentDoors.find((item) => item.index === Number(action.doorIndex ?? action.index));
  if (!door) throw new Error("door_not_available");
  const bonus = door.role === "bonus" ? door.bonus : 0;
  state.history.push({ roomNumber: state.roomIndex + 1, label: door.label, outcome: door.role, bonusAwarded: bonus });
  if (door.role === "trap") {
    state.phase = "trapped";
    state.currentDoors = [];
    state.pendingBonus = 0;
    state.message = "Trap door. Run lost.";
    return { state, status: "complete", delta: 0, outcome: "trap", message: state.message };
  }
  state.pendingBonus += bonus;
  state.roomIndex += 1;
  state.roomsCleared += 1;
  if (state.roomIndex >= 5) {
    const payout = state.bet * 8 + state.pendingBonus;
    state.phase = "won";
    state.currentDoors = [];
    state.pendingBonus = 0;
    state.message = `All rooms cleared. Won ${payout} credits.`;
    return { state, status: "complete", delta: payout, outcome: "win", message: state.message };
  }
  state.currentDoors = createCorridorDoors(state.roomIndex, state.bet);
  state.message = bonus ? `Bonus door. ${state.pendingBonus} pending credits.` : "Safe door. Next room waits.";
  return { state, status: "active", delta: 0, outcome: door.role, message: state.message };
}

function createCorridorDoors(roomIndex, bet) {
  const labels = ["Left", "Center", "Right"];
  const roles = shuffle(["safe", "bonus", "trap"]);
  const bonus = Math.max(1, Math.round(bet * CORRIDOR_BONUS_RATES[roomIndex]));
  return roles.map((role, index) => ({ index, label: labels[index], role, bonus: role === "bonus" ? bonus : 0 }));
}

function corridorPublic(state, roundDelta, message) {
  return {
    gameId: "corridor",
    phase: state.phase,
    totalRooms: state.totalRooms,
    roomNumber: state.phase === "inRound" ? state.roomIndex + 1 : null,
    roomsCleared: state.roomsCleared,
    bet: state.bet,
    pendingBonus: state.pendingBonus,
    roundDelta,
    canCashOut: state.phase === "inRound" && state.roomsCleared > 0,
    doors: (state.currentDoors || []).map((door) => ({ index: door.index, label: door.label })),
    history: state.history || [],
    message: message || state.message
  };
}

const SOLITAIRE_SUITS = ["hearts", "diamonds", "clubs", "spades"];
const SOLITAIRE_RED = new Set(["hearts", "diamonds"]);
const SOLITAIRE_RANKS = [null, "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function solitaireStart(bet) {
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
