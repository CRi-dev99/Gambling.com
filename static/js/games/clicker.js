export const GAME_ID = 'clicker';

const START_MESSAGE = 'Click the credit to earn wallet credits.';
const BASE_UPGRADE_COST = 25;
const UPGRADE_MULTIPLIER = 1.45;
const MAX_BATCH_CLICKS = 50;
const RATE_WINDOW_MS = 500;
const MAX_CLICKS_PER_WINDOW = 6;

export function createInitialState() {
  return {
    gameId: GAME_ID,
    phase: 'active',
    status: 'active',
    upgradeLevel: 0,
    clickValue: 1,
    nextUpgradeCost: BASE_UPGRADE_COST,
    totalClicks: 0,
    totalEarned: 0,
    totalSpent: 0,
    roundDelta: 0,
    message: START_MESSAGE,
    validationMessage: null,
    lastAction: null,
    clickWindowStartedAt: 0,
    clicksInWindow: 0,
  };
}

export function getPublicState(state = createInitialState()) {
  const current = normalizeState(state);

  return {
    gameId: GAME_ID,
    phase: current.phase,
    status: current.status,
    upgradeLevel: current.upgradeLevel,
    clickValue: current.clickValue,
    nextUpgradeCost: current.nextUpgradeCost,
    totalClicks: current.totalClicks,
    totalEarned: current.totalEarned,
    totalSpent: current.totalSpent,
    roundDelta: current.roundDelta,
    message: current.message,
    validationMessage: current.validationMessage,
    lastAction: current.lastAction,
    suggestedActions: getSuggestedActions(current),
  };
}

export function startRound() {
  return createInitialState();
}

export function playerAction(state = createInitialState(), action = {}) {
  const current = normalizeState(state);
  const normalized = normalizeAction(action);

  if (normalized.type === 'click') {
    return clickCredits(current, normalized);
  }

  if (normalized.type === 'buyUpgrade') {
    return buyUpgrade(current, normalized);
  }

  return withValidation(current, 'Choose click or buy upgrade.');
}

export function getSuggestedActions(state = createInitialState()) {
  const current = normalizeState(state);
  return [
    {
      type: 'click',
      label: `Click for ${current.clickValue}`,
    },
    {
      type: 'buyUpgrade',
      label: `Upgrade for ${current.nextUpgradeCost}`,
    },
  ];
}

function clickCredits(state, action) {
  const clickCount = Number(action.clickCount ?? action.count ?? 1);
  if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > MAX_BATCH_CLICKS) {
    return withValidation(state, 'Click batch must be between 1 and 50.');
  }

  const now = Number.isFinite(Number(action.now)) ? Number(action.now) : Date.now();
  let clickWindowStartedAt = Number(state.clickWindowStartedAt || 0);
  let clicksInWindow = Number(state.clicksInWindow || 0);

  if (!clickWindowStartedAt || now - clickWindowStartedAt >= RATE_WINDOW_MS) {
    clickWindowStartedAt = now;
    clicksInWindow = 0;
  }

  if (clicksInWindow + clickCount > MAX_CLICKS_PER_WINDOW) {
    return withValidation(state, 'click_rate_limited');
  }

  const earned = clickCount * state.clickValue;

  return {
    ...state,
    totalClicks: state.totalClicks + clickCount,
    totalEarned: state.totalEarned + earned,
    roundDelta: earned,
    clickWindowStartedAt,
    clicksInWindow: clicksInWindow + clickCount,
    message: `Earned ${earned} credits.`,
    validationMessage: null,
    lastAction: 'click',
  };
}

function buyUpgrade(state, action) {
  if (Number.isFinite(Number(action.availableCredits)) && Number(action.availableCredits) < state.nextUpgradeCost) {
    return withValidation(state, 'insufficient_credits');
  }

  const nextLevel = state.upgradeLevel + 1;
  const nextClickValue = clickValueForLevel(nextLevel);
  const cost = state.nextUpgradeCost;

  return {
    ...state,
    upgradeLevel: nextLevel,
    clickValue: nextClickValue,
    nextUpgradeCost: upgradeCostForLevel(nextLevel),
    totalSpent: state.totalSpent + cost,
    roundDelta: -cost,
    message: `Upgrade bought. Each click is now worth ${nextClickValue} credits.`,
    validationMessage: null,
    lastAction: 'buyUpgrade',
  };
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') {
    return createInitialState();
  }

  const upgradeLevel = Math.max(0, Math.floor(Number(state.upgradeLevel || 0)));

  return {
    ...createInitialState(),
    ...state,
    gameId: GAME_ID,
    phase: 'active',
    status: 'active',
    upgradeLevel,
    clickValue: clickValueForLevel(upgradeLevel),
    nextUpgradeCost: upgradeCostForLevel(upgradeLevel),
    totalClicks: normalizeWholeNumber(state.totalClicks),
    totalEarned: normalizeCredits(state.totalEarned),
    totalSpent: normalizeCredits(state.totalSpent),
    roundDelta: normalizeCredits(state.roundDelta),
    clickWindowStartedAt: normalizeWholeNumber(state.clickWindowStartedAt),
    clicksInWindow: normalizeWholeNumber(state.clicksInWindow),
  };
}

function normalizeAction(action) {
  if (typeof action === 'string') {
    return { type: action };
  }

  const rawType = String(action?.type || action?.action || '').trim();
  const normalizedType = rawType.toLowerCase() === 'buyupgrade' ? 'buyUpgrade' : rawType;

  return {
    ...action,
    type: normalizedType,
  };
}

function upgradeCostForLevel(level) {
  return Math.floor(BASE_UPGRADE_COST * UPGRADE_MULTIPLIER ** Math.max(0, Number(level || 0)));
}

function clickValueForLevel(level) {
  return 1 + Math.max(0, Math.floor(Number(level || 0)));
}

function normalizeWholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function normalizeCredits(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function withValidation(state, validationMessage) {
  return {
    ...normalizeState(state),
    roundDelta: 0,
    validationMessage,
    message: validationMessage,
  };
}
