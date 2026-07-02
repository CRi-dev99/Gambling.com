import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const GAME_IDS = new Set(["blackjack", "poker", "solitaire", "slots", "corridor", "dice"]);
const MAX_BET = 10000;

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
