export const GAME_ID = 'slots';

const START_MESSAGE = 'Choose a bet and spin the reels.';
const REEL_COUNT = 3;
const TWO_MATCH_MULTIPLIER = 1;

const SYMBOLS = [
  { id: 'cherries', label: 'Cherries', multiplier: 3, weight: 28 },
  { id: 'lemon', label: 'Lemon', multiplier: 4, weight: 24 },
  { id: 'bell', label: 'Bell', multiplier: 6, weight: 18 },
  { id: 'seven', label: 'Seven', multiplier: 10, weight: 12 },
  { id: 'diamond', label: 'Diamond', multiplier: 15, weight: 8 },
  { id: 'crown', label: 'Crown', multiplier: 25, weight: 6 },
  { id: 'lightning', label: 'Lightning', multiplier: 50, weight: 4 },
];

const PAYOUT_TABLE = {
  twoMatch: {
    label: 'Any two matching symbols',
    multiplier: TWO_MATCH_MULTIPLIER,
    pays: `${TWO_MATCH_MULTIPLIER}x bet`,
  },
  threeMatch: SYMBOLS.map(({ id, label, multiplier }) => ({
    id,
    label,
    multiplier,
    pays: `${multiplier}x bet`,
  })),
};

export function createInitialState() {
  return {
    gameId: GAME_ID,
    phase: 'idle',
    status: 'ready',
    reels: [],
    bet: 0,
    payout: 0,
    roundDelta: 0,
    outcome: null,
    lastSpin: null,
    message: START_MESSAGE,
    validationMessage: null,
    lastAction: null,
  };
}

export function getPublicState(state = createInitialState()) {
  const current = normalizeState(state);

  return {
    gameId: GAME_ID,
    phase: current.phase,
    status: current.status,
    reels: cloneReels(current.reels),
    bet: current.bet,
    payout: current.payout,
    roundDelta: current.roundDelta,
    outcome: current.outcome,
    lastSpin: cloneLastSpin(current.lastSpin),
    message: current.message,
    validationMessage: current.validationMessage,
    lastAction: current.lastAction,
    payoutTable: clonePayoutTable(),
    suggestedActions: getSuggestedActions(current),
  };
}

export function startRound(state = createInitialState(), bet) {
  const current = normalizeState(state);
  const parsedBet = normalizeBet(bet);

  if (!parsedBet.ok) {
    return withValidation(current, parsedBet.message);
  }

  return spin(parsedBet.value);
}

export function playerAction(state = createInitialState(), action = {}) {
  const current = normalizeState(state);
  const normalizedAction = normalizeAction(action);

  if (normalizedAction.type === 'newRound') {
    return createInitialState();
  }

  if (normalizedAction.type === 'spin') {
    const parsedBet = normalizeBet(normalizedAction.bet ?? current.bet);

    if (!parsedBet.ok) {
      return withValidation(current, parsedBet.message);
    }

    return spin(parsedBet.value);
  }

  return withValidation(current, 'Choose spin to play slots.');
}

export function getSuggestedActions(state = createInitialState()) {
  const current = normalizeState(state);

  if (current.phase === 'round_over') {
    return [
      {
        type: 'spin',
        label: 'Spin again',
        requiresBet: true,
      },
      {
        type: 'newRound',
        label: 'Reset',
      },
    ];
  }

  return [
    {
      type: 'spin',
      label: 'Spin',
      requiresBet: true,
    },
  ];
}

function spin(bet) {
  const reels = spinReels();
  const score = scoreSpin(reels, bet);
  const message = buildMessage(score, bet);
  const lastSpin = {
    bet,
    reels,
    matchCount: score.matchCount,
    winningSymbol: score.winningSymbol,
    payoutMultiplier: score.payoutMultiplier,
    payout: score.payout,
    roundDelta: score.roundDelta,
    result: score.result,
  };

  return {
    ...createInitialState(),
    phase: 'round_over',
    status: 'complete',
    reels,
    bet,
    payout: score.payout,
    roundDelta: score.roundDelta,
    outcome: score.outcome,
    lastSpin,
    message,
    validationMessage: null,
    lastAction: 'spin',
  };
}

function spinReels() {
  return Array.from({ length: REEL_COUNT }, () => {
    const symbol = pickSymbol();

    return publicSymbol(symbol);
  });
}

function pickSymbol() {
  const totalWeight = SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const symbol of SYMBOLS) {
    roll -= symbol.weight;

    if (roll <= 0) {
      return symbol;
    }
  }

  return SYMBOLS[SYMBOLS.length - 1];
}

function scoreSpin(reels, bet) {
  const counts = countReels(reels);
  const winningEntry = Object.entries(counts).find(([, count]) => count >= 2);

  if (!winningEntry) {
    return {
      outcome: 'lose',
      result: 'loss',
      matchCount: 0,
      winningSymbol: null,
      payoutMultiplier: 0,
      payout: 0,
      roundDelta: -bet,
    };
  }

  const [symbolId, matchCount] = winningEntry;
  const symbol = getSymbol(symbolId);
  const payoutMultiplier =
    matchCount === REEL_COUNT ? symbol.multiplier : TWO_MATCH_MULTIPLIER;
  const payout = bet * payoutMultiplier;

  return {
    outcome: 'win',
    result: matchCount === REEL_COUNT ? 'jackpot' : 'pair',
    matchCount,
    winningSymbol: publicSymbol(symbol),
    payoutMultiplier,
    payout,
    roundDelta: payout - bet,
  };
}

function countReels(reels) {
  return reels.reduce((counts, symbol) => {
    counts[symbol.id] = (counts[symbol.id] || 0) + 1;
    return counts;
  }, {});
}

function buildMessage(score, bet) {
  if (score.result === 'loss') {
    return `No match. You lost ${bet} credits.`;
  }

  if (score.result === 'pair') {
    return `Two ${score.winningSymbol.label} symbols pay 1x. Your bet is returned.`;
  }

  return `Three ${score.winningSymbol.label} symbols pay ${score.payoutMultiplier}x for ${score.payout} credits.`;
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') {
    return createInitialState();
  }

  return {
    ...createInitialState(),
    ...state,
    gameId: GAME_ID,
    phase: state.phase || (state.status === 'complete' ? 'round_over' : 'idle'),
    status: state.status || (state.phase === 'round_over' ? 'complete' : 'ready'),
    reels: cloneReels(state.reels),
    bet: Number.isFinite(Number(state.bet)) ? Number(state.bet) : 0,
    payout: Number.isFinite(Number(state.payout)) ? Number(state.payout) : 0,
    roundDelta: Number.isFinite(Number(state.roundDelta)) ? Number(state.roundDelta) : 0,
    lastSpin: cloneLastSpin(state.lastSpin),
  };
}

function normalizeBet(bet) {
  const value = Number(bet);

  if (!Number.isFinite(value)) {
    return { ok: false, message: 'Enter a valid bet amount.' };
  }

  if (value <= 0) {
    return { ok: false, message: 'Bet must be greater than zero.' };
  }

  if (!Number.isInteger(value)) {
    return { ok: false, message: 'Bet must be a whole number of credits.' };
  }

  return { ok: true, value };
}

function normalizeAction(action) {
  if (typeof action === 'string') {
    return { type: action };
  }

  if (!action || typeof action !== 'object') {
    return { type: 'unknown' };
  }

  return {
    ...action,
    type: action.type || action.action || action.name || 'unknown',
  };
}

function withValidation(state, validationMessage) {
  return {
    ...normalizeState(state),
    roundDelta: 0,
    validationMessage,
    message: validationMessage,
  };
}

function getSymbol(id) {
  return SYMBOLS.find((symbol) => symbol.id === id) || SYMBOLS[0];
}

function publicSymbol(symbol) {
  return {
    id: symbol.id,
    label: symbol.label,
  };
}

function cloneReels(reels) {
  return Array.isArray(reels) ? reels.map((symbol) => ({ ...symbol })) : [];
}

function cloneLastSpin(lastSpin) {
  if (!lastSpin || typeof lastSpin !== 'object') {
    return null;
  }

  return {
    ...lastSpin,
    reels: cloneReels(lastSpin.reels),
    winningSymbol: lastSpin.winningSymbol ? { ...lastSpin.winningSymbol } : null,
  };
}

function clonePayoutTable() {
  return {
    twoMatch: { ...PAYOUT_TABLE.twoMatch },
    threeMatch: PAYOUT_TABLE.threeMatch.map((entry) => ({ ...entry })),
  };
}
