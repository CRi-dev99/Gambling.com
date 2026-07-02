export const GAME_ID = 'corridor';

const TOTAL_ROOMS = 5;
const DOORS_PER_ROOM = 3;
const GRAND_PRIZE_MULTIPLIER = 8;
const DOOR_LABELS = ['Left', 'Center', 'Right'];
const BONUS_RATES = [0.25, 0.4, 0.6, 0.85, 1.15];

export function createInitialState() {
  return {
    gameId: GAME_ID,
    phase: 'idle',
    totalRooms: TOTAL_ROOMS,
    doorsPerRoom: DOORS_PER_ROOM,
    roomIndex: 0,
    roomsCleared: 0,
    bet: 0,
    pendingBonus: 0,
    roundDelta: 0,
    payout: 0,
    currentDoors: [],
    history: [],
    lastResult: null,
    validationMessage: null,
    message: 'Choose a bet to enter the corridor.',
  };
}

export function getPublicState(state) {
  const current = normalizeState(state);

  return {
    gameId: GAME_ID,
    phase: current.phase,
    totalRooms: current.totalRooms,
    doorsPerRoom: current.doorsPerRoom,
    roomIndex: current.roomIndex,
    roomNumber: current.phase === 'inRound' ? current.roomIndex + 1 : null,
    roomsCleared: current.roomsCleared,
    bet: current.bet,
    pendingBonus: current.pendingBonus,
    roundDelta: current.roundDelta,
    payout: current.payout,
    canCashOut: canCashOut(current),
    doors: current.currentDoors.map(toPublicDoor),
    history: current.history.map(toPublicHistoryEntry),
    lastResult: current.lastResult ? { ...current.lastResult } : null,
    validationMessage: current.validationMessage,
    message: current.message,
    suggestedActions: getSuggestedActions(current),
  };
}

export function startRound(state, bet) {
  const current = normalizeState(state);
  const parsedBet = normalizeBet(bet);

  if (current.phase === 'inRound') {
    return withError(current, 'Finish or cash out before starting another run.');
  }

  if (!parsedBet.ok) {
    return withError(current, parsedBet.message);
  }

  return {
    ...createInitialState(),
    phase: 'inRound',
    roomIndex: 0,
    roomsCleared: 0,
    bet: parsedBet.value,
    roundDelta: -parsedBet.value,
    currentDoors: createRoomDoors(0, parsedBet.value),
    message: 'Room 1 waits. Choose one of the three doors.',
  };
}

export function playerAction(state, action) {
  const current = normalizeState(state);
  const normalizedAction = normalizeAction(action);

  if (current.phase !== 'inRound') {
    return withError(current, 'Start a run before choosing corridor actions.');
  }

  if (normalizedAction.type === 'cashOut') {
    return cashOut(current);
  }

  if (normalizedAction.type === 'chooseDoor') {
    return chooseDoor(current, normalizedAction);
  }

  return withError(current, 'Choose a door or cash out.');
}

export function getSuggestedActions(state) {
  const current = normalizeState(state);

  if (current.phase !== 'inRound') {
    return [];
  }

  const doorActions = current.currentDoors.map((door) => ({
    type: 'chooseDoor',
    doorIndex: door.index,
    doorId: door.id,
    label: door.label,
  }));

  if (canCashOut(current)) {
    doorActions.push({
      type: 'cashOut',
      label: 'Cash out',
      payout: current.pendingBonus,
    });
  }

  return doorActions;
}

function chooseDoor(state, action) {
  const door = findDoor(state.currentDoors, action);

  if (!door) {
    return withError(state, 'That door is not available in this room.');
  }

  const roomNumber = state.roomIndex + 1;
  const bonusAwarded = door.role === 'bonus' ? door.bonus : 0;
  const nextPendingBonus = state.pendingBonus + bonusAwarded;
  const nextHistory = [
    ...state.history,
    {
      roomNumber,
      doorIndex: door.index,
      doorId: door.id,
      label: door.label,
      outcome: door.role,
      bonusAwarded,
    },
  ];

  if (door.role === 'trap') {
    return {
      ...state,
      phase: 'trapped',
      roomIndex: state.roomIndex,
      roomsCleared: state.roomsCleared,
      pendingBonus: 0,
      roundDelta: 0,
      payout: 0,
      currentDoors: [],
      history: nextHistory,
      validationMessage: null,
      lastResult: {
        outcome: 'trap',
        roomNumber,
        doorIndex: door.index,
        bonusAwarded: 0,
        payout: 0,
      },
      message: `Room ${roomNumber} held the trap. The entry bet and pending bonus are lost.`,
    };
  }

  const nextRoomIndex = state.roomIndex + 1;
  const roomsCleared = state.roomsCleared + 1;

  if (nextRoomIndex >= TOTAL_ROOMS) {
    const payout = state.bet * GRAND_PRIZE_MULTIPLIER + nextPendingBonus;

    return {
      ...state,
      phase: 'won',
      roomIndex: TOTAL_ROOMS,
      roomsCleared,
      pendingBonus: 0,
      roundDelta: payout,
      payout,
      currentDoors: [],
      history: nextHistory,
      validationMessage: null,
      lastResult: {
        outcome: 'win',
        doorOutcome: door.role,
        roomNumber,
        doorIndex: door.index,
        bonusAwarded,
        payout,
      },
      message: `You cleared all ${TOTAL_ROOMS} rooms and won ${payout} credits.`,
    };
  }

  return {
    ...state,
    phase: 'inRound',
    roomIndex: nextRoomIndex,
    roomsCleared,
    pendingBonus: nextPendingBonus,
    roundDelta: 0,
    payout: 0,
    currentDoors: createRoomDoors(nextRoomIndex, state.bet),
    history: nextHistory,
    validationMessage: null,
    lastResult: {
      outcome: door.role,
      roomNumber,
      doorIndex: door.index,
      bonusAwarded,
      payout: 0,
    },
    message: buildAdvanceMessage(nextRoomIndex, door.role, bonusAwarded, nextPendingBonus),
  };
}

function cashOut(state) {
  if (!canCashOut(state)) {
    return withError(state, 'You can cash out only after clearing at least one room.');
  }

  const payout = state.pendingBonus;

  return {
    ...state,
    phase: 'cashedOut',
    pendingBonus: 0,
    roundDelta: payout,
    payout,
    currentDoors: [],
    validationMessage: null,
    lastResult: {
      outcome: 'cashOut',
      roomNumber: state.roomsCleared,
      bonusAwarded: 0,
      payout,
    },
    message: `You cashed out ${payout} pending bonus credits.`,
  };
}

function createRoomDoors(roomIndex, bet) {
  const bonus = Math.max(1, Math.round(bet * BONUS_RATES[roomIndex]));
  const roles = shuffle(['safe', 'bonus', 'trap']);

  return roles.map((role, index) => ({
    id: `room-${roomIndex + 1}-door-${index + 1}`,
    index,
    label: DOOR_LABELS[index],
    role,
    bonus: role === 'bonus' ? bonus : 0,
  }));
}

function shuffle(items) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') {
    return createInitialState();
  }

  return {
    ...createInitialState(),
    ...state,
    gameId: GAME_ID,
    totalRooms: TOTAL_ROOMS,
    doorsPerRoom: DOORS_PER_ROOM,
    roomIndex: normalizeInteger(state.roomIndex, 0, TOTAL_ROOMS),
    roomsCleared: normalizeInteger(state.roomsCleared, 0, TOTAL_ROOMS),
    bet: normalizeCreditValue(state.bet),
    pendingBonus: normalizeCreditValue(state.pendingBonus),
    roundDelta: Number.isFinite(Number(state.roundDelta)) ? Number(state.roundDelta) : 0,
    payout: normalizeCreditValue(state.payout),
    currentDoors: Array.isArray(state.currentDoors)
      ? state.currentDoors.map(cloneDoor).filter(Boolean)
      : [],
    history: Array.isArray(state.history)
      ? state.history.map(cloneHistoryEntry).filter(Boolean)
      : [],
    lastResult: state.lastResult && typeof state.lastResult === 'object'
      ? { ...state.lastResult }
      : null,
    validationMessage: state.validationMessage || null,
  };
}

function normalizeBet(bet) {
  const amount = Number(bet);

  if (!Number.isFinite(amount)) {
    return { ok: false, message: 'Enter a valid bet amount.' };
  }

  if (amount <= 0) {
    return { ok: false, message: 'Bet must be greater than zero.' };
  }

  if (!Number.isInteger(amount)) {
    return { ok: false, message: 'Bet must be a whole number of credits.' };
  }

  return { ok: true, value: amount };
}

function normalizeAction(action) {
  if (typeof action === 'number') {
    return { type: 'chooseDoor', doorIndex: action };
  }

  if (typeof action === 'string') {
    return { type: normalizeActionType(action) };
  }

  if (!action || typeof action !== 'object') {
    return { type: 'unknown' };
  }

  const rawType = action.type || action.action || action.name;
  const type = normalizeActionType(rawType);

  return {
    ...action,
    type: type === 'unknown' && hasDoorSelection(action) ? 'chooseDoor' : type,
  };
}

function normalizeActionType(type) {
  const raw = String(type ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[\s_-]/g, '');

  if (!normalized) {
    return 'unknown';
  }

  if (normalized === 'cashout') {
    return 'cashOut';
  }

  if (
    normalized === 'choosedoor' ||
    normalized === 'opendoor' ||
    normalized === 'selectdoor' ||
    normalized === 'door'
  ) {
    return 'chooseDoor';
  }

  return raw;
}

function hasDoorSelection(action) {
  return (
    action.doorIndex !== undefined ||
    action.index !== undefined ||
    action.doorId !== undefined ||
    action.door !== undefined
  );
}

function findDoor(doors, action) {
  if (action.doorId !== undefined || action.door !== undefined) {
    const requestedDoor = action.doorId ?? action.door;
    const requestedIndex = Number(requestedDoor);

    if (Number.isInteger(requestedIndex)) {
      const indexedDoor = doors.find((door) => door.index === requestedIndex);

      if (indexedDoor) {
        return indexedDoor;
      }
    }

    const requestedId = String(requestedDoor);
    return doors.find(
      (door) => door.id === requestedId || door.label.toLowerCase() === requestedId.toLowerCase()
    );
  }

  const requestedIndex = Number(action.doorIndex ?? action.index);

  if (!Number.isInteger(requestedIndex)) {
    return null;
  }

  return doors.find((door) => door.index === requestedIndex);
}

function canCashOut(state) {
  return state.phase === 'inRound' && state.roomsCleared > 0 && state.roomIndex < TOTAL_ROOMS;
}

function withError(state, message) {
  return {
    ...state,
    roundDelta: 0,
    validationMessage: message,
    lastResult: {
      outcome: 'error',
      message,
    },
    message,
  };
}

function cloneDoor(door) {
  if (!door || typeof door !== 'object') {
    return null;
  }

  return {
    id: String(door.id ?? ''),
    index: normalizeInteger(door.index, 0, DOORS_PER_ROOM - 1),
    label: String(door.label ?? DOOR_LABELS[door.index] ?? 'Door'),
    role: ['safe', 'bonus', 'trap'].includes(door.role) ? door.role : 'safe',
    bonus: normalizeCreditValue(door.bonus),
  };
}

function cloneHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  return {
    roomNumber: normalizeInteger(entry.roomNumber, 1, TOTAL_ROOMS),
    doorIndex: normalizeInteger(entry.doorIndex, 0, DOORS_PER_ROOM - 1),
    doorId: String(entry.doorId ?? ''),
    label: String(entry.label ?? 'Door'),
    outcome: String(entry.outcome ?? ''),
    bonusAwarded: normalizeCreditValue(entry.bonusAwarded),
  };
}

function normalizeInteger(value, min, max) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

function normalizeCreditValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toPublicDoor(door) {
  return {
    id: door.id,
    index: door.index,
    label: door.label,
  };
}

function toPublicHistoryEntry(entry) {
  return {
    roomNumber: entry.roomNumber,
    doorIndex: entry.doorIndex,
    doorId: entry.doorId,
    label: entry.label,
    outcome: entry.outcome,
    bonusAwarded: entry.bonusAwarded,
  };
}

function buildAdvanceMessage(nextRoomIndex, outcome, bonusAwarded, pendingBonus) {
  const roomNumber = nextRoomIndex + 1;

  if (outcome === 'bonus') {
    return `Bonus door: +${bonusAwarded} pending credits. Room ${roomNumber} waits.`;
  }

  if (pendingBonus > 0) {
    return `Safe door. Room ${roomNumber} waits with ${pendingBonus} pending bonus credits.`;
  }

  return `Safe door. Room ${roomNumber} waits.`;
}
