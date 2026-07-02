export const GAME_ID = 'poker';

const HAND_SIZE = 5;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANK_VALUES = Object.freeze({
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
});

const HAND_RESULTS = Object.freeze({
  royalFlush: { rank: 'royalFlush', label: 'Royal Flush', multiplier: 100 },
  straightFlush: { rank: 'straightFlush', label: 'Straight Flush', multiplier: 50 },
  four: { rank: 'four', label: 'Four of a Kind', multiplier: 25 },
  fullHouse: { rank: 'fullHouse', label: 'Full House', multiplier: 9 },
  flush: { rank: 'flush', label: 'Flush', multiplier: 6 },
  straight: { rank: 'straight', label: 'Straight', multiplier: 4 },
  three: { rank: 'three', label: 'Three of a Kind', multiplier: 3 },
  twoPair: { rank: 'twoPair', label: 'Two Pair', multiplier: 2 },
  pair: { rank: 'pair', label: 'Pair', multiplier: 1 },
  none: { rank: 'none', label: 'No Win', multiplier: 0 },
});

function createDeck() {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      rank,
      suit,
      value: RANK_VALUES[rank],
      code: `${rank}${suit[0].toUpperCase()}`,
    })),
  );
}

function shuffle(cards) {
  const shuffled = cards.slice();

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function cloneCard(card) {
  return {
    rank: card.rank,
    suit: card.suit,
    value: card.value,
    code: card.code,
  };
}

function cloneCards(cards) {
  return Array.isArray(cards) ? cards.map(cloneCard) : [];
}

function normalizeHeld(held) {
  const normalized = Array.isArray(held) ? held.slice(0, HAND_SIZE).map(Boolean) : [];

  while (normalized.length < HAND_SIZE) {
    normalized.push(false);
  }

  return normalized;
}

function normalizeBet(bet) {
  const amount = Number(bet);

  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return 0;
  }

  return amount;
}

function withNoCreditDelta(state, message, error = null) {
  return {
    ...state,
    roundDelta: 0,
    message,
    error,
  };
}

function countBy(items) {
  return items.reduce((counts, item) => {
    counts.set(item, (counts.get(item) || 0) + 1);
    return counts;
  }, new Map());
}

function scoreHand(hand) {
  const values = hand.map((card) => card.value).sort((left, right) => left - right);
  const suits = hand.map((card) => card.suit);
  const uniqueValues = [...new Set(values)];
  const rankCounts = [...countBy(values).values()].sort((left, right) => right - left);
  const isFlush = suits.every((suit) => suit === suits[0]);
  const isWheel = values.join(',') === '2,3,4,5,14';
  const isStraight =
    uniqueValues.length === HAND_SIZE &&
    (isWheel || values[HAND_SIZE - 1] - values[0] === HAND_SIZE - 1);
  const isRoyal = isFlush && values.join(',') === '10,11,12,13,14';

  if (isRoyal) return HAND_RESULTS.royalFlush;
  if (isStraight && isFlush) return HAND_RESULTS.straightFlush;
  if (rankCounts[0] === 4) return HAND_RESULTS.four;
  if (rankCounts[0] === 3 && rankCounts[1] === 2) return HAND_RESULTS.fullHouse;
  if (isFlush) return HAND_RESULTS.flush;
  if (isStraight) return HAND_RESULTS.straight;
  if (rankCounts[0] === 3) return HAND_RESULTS.three;
  if (rankCounts[0] === 2 && rankCounts[1] === 2) return HAND_RESULTS.twoPair;
  if (rankCounts[0] === 2) return HAND_RESULTS.pair;

  return HAND_RESULTS.none;
}

function createDrawDeck(state, hand, neededCards) {
  const existingDeck = Array.isArray(state.deck) ? state.deck.map(cloneCard) : [];

  if (existingDeck.length >= neededCards) {
    return existingDeck;
  }

  const usedCodes = new Set([
    ...hand.map((card) => card.code),
    ...existingDeck.map((card) => card.code),
  ]);
  const topUpDeck = shuffle(createDeck().filter((card) => !usedCodes.has(card.code)));

  return existingDeck.concat(topUpDeck);
}

function resultForPublicState(result) {
  return result
    ? {
        rank: result.rank,
        label: result.label,
        multiplier: result.multiplier,
      }
    : null;
}

export function createInitialState() {
  return {
    gameId: GAME_ID,
    phase: 'idle',
    deck: [],
    hand: [],
    held: Array(HAND_SIZE).fill(false),
    bet: 0,
    payout: 0,
    roundDelta: 0,
    totalRoundDelta: 0,
    result: null,
    message: 'Place a bet to start.',
    error: null,
  };
}

export function getPublicState(state = createInitialState()) {
  const safeState = state || createInitialState();

  return {
    gameId: GAME_ID,
    phase: safeState.phase,
    hand: cloneCards(safeState.hand),
    held: normalizeHeld(safeState.held),
    bet: safeState.bet || 0,
    payout: safeState.payout || 0,
    roundDelta: safeState.roundDelta || 0,
    totalRoundDelta: safeState.totalRoundDelta || 0,
    result: resultForPublicState(safeState.result),
    message: safeState.message || '',
    error: safeState.error || null,
    deckRemaining: Array.isArray(safeState.deck) ? safeState.deck.length : 0,
    suggestedActions: getSuggestedActions(safeState),
  };
}

export function startRound(state = createInitialState(), bet) {
  const currentState = state || createInitialState();

  if (currentState.phase === 'holding') {
    return withNoCreditDelta(currentState, 'Finish the current hand before dealing again.', 'roundActive');
  }

  const amount = normalizeBet(bet);

  if (amount <= 0) {
    return withNoCreditDelta(currentState, 'Enter a positive whole-credit bet.', 'invalidBet');
  }

  const deck = shuffle(createDeck());
  const hand = deck.slice(0, HAND_SIZE);
  const remainingDeck = deck.slice(HAND_SIZE);

  return {
    gameId: GAME_ID,
    phase: 'holding',
    deck: remainingDeck,
    hand,
    held: Array(HAND_SIZE).fill(false),
    bet: amount,
    payout: 0,
    roundDelta: -amount,
    totalRoundDelta: -amount,
    result: null,
    message: 'Choose cards to hold, then draw.',
    error: null,
  };
}

export function playerAction(state = createInitialState(), action = {}) {
  const currentState = state || createInitialState();
  const actionType = typeof action === 'string' ? action : action?.type;

  if (actionType === 'newRound') {
    return createInitialState();
  }

  if (actionType === 'toggleHold') {
    if (currentState.phase !== 'holding') {
      return withNoCreditDelta(currentState, 'Start a round before holding cards.', 'roundNotActive');
    }

    const index = Number(action.index);

    if (!Number.isInteger(index) || index < 0 || index >= HAND_SIZE) {
      return withNoCreditDelta(currentState, 'Choose a valid card to hold.', 'invalidCardIndex');
    }

    const held = normalizeHeld(currentState.held);
    held[index] = !held[index];

    return {
      ...currentState,
      held,
      roundDelta: 0,
      message: held[index] ? 'Card held.' : 'Card released.',
      error: null,
    };
  }

  if (actionType === 'draw') {
    if (currentState.phase !== 'holding') {
      return withNoCreditDelta(currentState, 'Start a round before drawing.', 'roundNotActive');
    }

    const hand = cloneCards(currentState.hand);

    if (hand.length !== HAND_SIZE) {
      return withNoCreditDelta(currentState, 'The hand is incomplete.', 'invalidHand');
    }

    const held = normalizeHeld(currentState.held);
    const cardsNeeded = held.filter((isHeld) => !isHeld).length;
    const drawDeck = createDrawDeck(currentState, hand, cardsNeeded);
    let deckIndex = 0;
    const finalHand = hand.map((card, index) => {
      if (held[index]) {
        return card;
      }

      const replacement = drawDeck[deckIndex];
      deckIndex += 1;
      return replacement;
    });
    const remainingDeck = drawDeck.slice(deckIndex);
    const result = scoreHand(finalHand);
    const bet = currentState.bet || 0;
    const payout = bet * result.multiplier;
    const roundDelta = payout;
    const totalRoundDelta = (currentState.totalRoundDelta || -bet) + roundDelta;

    return {
      ...currentState,
      phase: 'complete',
      deck: remainingDeck,
      hand: finalHand,
      held,
      payout,
      roundDelta,
      totalRoundDelta,
      result,
      message:
        result.multiplier > 0
          ? `${result.label} pays ${result.multiplier}x.`
          : 'No winning hand.',
      error: null,
    };
  }

  return withNoCreditDelta(currentState, 'Choose a valid poker action.', 'invalidAction');
}

export function getSuggestedActions(state = createInitialState()) {
  const safeState = state || createInitialState();

  if (safeState.phase === 'holding') {
    const held = normalizeHeld(safeState.held);
    const holdActions = held.map((isHeld, index) => ({
      type: 'toggleHold',
      index,
      label: isHeld ? `Release card ${index + 1}` : `Hold card ${index + 1}`,
    }));

    return holdActions.concat({
      type: 'draw',
      label: 'Draw',
    });
  }

  if (safeState.phase === 'complete') {
    return [
      {
        type: 'newRound',
        label: 'New round',
      },
    ];
  }

  return [];
}
