export const GAME_ID = 'dice';

const MODES = ['high', 'low', 'doubles'];
const START_MESSAGE = 'Place a bet to start a dice duel.';

export function createInitialState() {
  return {
    gameId: GAME_ID,
    phase: 'idle',
    playerDice: [],
    houseDice: [],
    mode: null,
    bet: 0,
    roundDelta: 0,
    outcome: null,
    message: START_MESSAGE,
    validationMessage: null,
    lastAction: null,
  };
}

export function getPublicState(state) {
  const current = normalizeState(state);

  return {
    gameId: GAME_ID,
    phase: current.phase,
    bet: current.bet,
    mode: current.mode,
    roundDelta: current.roundDelta,
    outcome: current.outcome,
    message: current.message,
    validationMessage: current.validationMessage,
    lastAction: current.lastAction,
    playerDice: current.playerDice.slice(),
    houseDice: current.houseDice.slice(),
    playerTotal: sumDice(current.playerDice),
    houseTotal: sumDice(current.houseDice),
  };
}

export function startRound(state, bet) {
  const current = normalizeState(state);
  const parsedBet = normalizeBet(bet);

  if (current.phase === 'choosing_mode') {
    return withValidation(current, 'Choose high, low, or doubles before starting another round.');
  }

  if (!parsedBet.ok) {
    return withValidation(current, parsedBet.message);
  }

  return {
    ...createInitialState(),
    phase: 'choosing_mode',
    bet: parsedBet.value,
    message: 'Round started. Choose high, low, or doubles.',
  };
}

export function playerAction(state, action) {
  const current = normalizeState(state);

  if (current.phase !== 'choosing_mode') {
    return withValidation(current, actionUnavailableMessage(current.phase));
  }

  const parsedBet = normalizeBet(current.bet);
  if (!parsedBet.ok) {
    return withValidation(current, parsedBet.message);
  }

  const mode = normalizeAction(action);
  if (!mode) {
    return withValidation(current, 'Choose a valid mode: high, low, or doubles.');
  }

  return rollRound(current, mode);
}

export function getSuggestedActions(state) {
  const current = normalizeState(state);
  return current.phase === 'choosing_mode' ? MODES.slice() : [];
}

function rollRound(state, mode) {
  const playerDice = [rollDie(), rollDie()];
  const houseDice = [rollDie(), rollDie()];
  const playerTotal = sumDice(playerDice);
  const houseTotal = sumDice(houseDice);
  const result = evaluateRound(mode, playerDice, playerTotal, houseTotal, state.bet);

  return finishRound(
    {
      ...state,
      playerDice,
      houseDice,
      mode,
      lastAction: mode,
    },
    result.outcome,
    result.roundDelta,
    result.message
  );
}

function evaluateRound(mode, playerDice, playerTotal, houseTotal, bet) {
  if (mode === 'doubles') {
    if (playerDice[0] === playerDice[1]) {
      return {
        outcome: 'win',
        roundDelta: bet * 5,
        message: 'Doubles! Your matching dice win 5:1.',
      };
    }

    return {
      outcome: 'lose',
      roundDelta: -bet,
      message: 'No doubles. House wins.',
    };
  }

  if (playerTotal === houseTotal) {
    return {
      outcome: 'push',
      roundDelta: 0,
      message: 'Push. Your bet is returned.',
    };
  }

  const playerWins = mode === 'high'
    ? playerTotal > houseTotal
    : playerTotal < houseTotal;

  if (playerWins) {
    return {
      outcome: 'win',
      roundDelta: bet,
      message: mode === 'high'
        ? 'Your total is higher. You win 1:1.'
        : 'Your total is lower. You win 1:1.',
    };
  }

  return {
    outcome: 'lose',
    roundDelta: -bet,
    message: mode === 'high'
      ? 'Your total is not higher. House wins.'
      : 'Your total is not lower. House wins.',
  };
}

function finishRound(state, outcome, roundDelta, message) {
  return {
    ...state,
    phase: 'round_over',
    outcome,
    roundDelta,
    message,
    validationMessage: null,
  };
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function sumDice(dice) {
  return dice.reduce((total, die) => total + die, 0);
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') {
    return createInitialState();
  }

  return {
    ...createInitialState(),
    ...state,
    gameId: GAME_ID,
    playerDice: normalizeDice(state.playerDice),
    houseDice: normalizeDice(state.houseDice),
    bet: Number.isFinite(Number(state.bet)) ? Number(state.bet) : 0,
    roundDelta: Number.isFinite(Number(state.roundDelta)) ? Number(state.roundDelta) : 0,
  };
}

function normalizeDice(dice) {
  return Array.isArray(dice)
    ? dice.map((die) => Number(die)).filter((die) => Number.isInteger(die) && die >= 1 && die <= 6)
    : [];
}

function normalizeAction(action) {
  if (action && typeof action === 'object') {
    return normalizeMode(action.mode ?? action.action ?? action.type);
  }

  return normalizeMode(action);
}

function normalizeMode(mode) {
  const normalized = String(mode ?? '').trim().toLowerCase();
  return MODES.includes(normalized) ? normalized : null;
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

function withValidation(state, validationMessage) {
  return {
    ...normalizeState(state),
    roundDelta: 0,
    validationMessage,
    message: validationMessage,
  };
}

function actionUnavailableMessage(phase) {
  if (phase === 'idle') {
    return 'Start a round before choosing a dice mode.';
  }

  if (phase === 'round_over') {
    return 'Round is over. Start a new round to keep playing.';
  }

  return 'Action is not available right now.';
}
