export const GAME_ID = 'poker';

const MAX_BET = 1000000000;
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
  return Array.isArray(cards) ? cards.filter(Boolean).map(cloneCard) : [];
}

function hiddenCards(count) {
  return Array.from({ length: count }, () => ({ hidden: true }));
}

function normalizeBet(bet) {
  const amount = Number(bet);
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) return 0;
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

function scoreFiveCards(hand) {
  const values = hand.map((card) => card.value).sort((left, right) => left - right);
  const groups = [...countBy(values).entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || right.value - left.value);
  const flush = hand.every((card) => card.suit === hand[0].suit);
  const wheel = values.join(',') === '2,3,4,5,14';
  const unique = [...new Set(values)];
  const straight = unique.length === 5 && (wheel || values[4] - values[0] === 4);
  const straightHigh = wheel ? 5 : values[4];

  if (straight && flush && straightHigh === 14) return { rank: 'royalFlush', strength: 10, tiebreak: [14], label: 'Royal Flush' };
  if (straight && flush) return { rank: 'straightFlush', strength: 9, tiebreak: [straightHigh], label: 'Straight Flush' };
  if (groups[0].count === 4) return { rank: 'four', strength: 8, tiebreak: [groups[0].value, groups[1].value], label: 'Four of a Kind' };
  if (groups[0].count === 3 && groups[1]?.count === 2) return { rank: 'fullHouse', strength: 7, tiebreak: [groups[0].value, groups[1].value], label: 'Full House' };
  if (flush) return { rank: 'flush', strength: 6, tiebreak: values.slice().sort((left, right) => right - left), label: 'Flush' };
  if (straight) return { rank: 'straight', strength: 5, tiebreak: [straightHigh], label: 'Straight' };
  if (groups[0].count === 3) {
    return {
      rank: 'three',
      strength: 4,
      tiebreak: [groups[0].value, ...groups.slice(1).map((group) => group.value).sort((left, right) => right - left)],
      label: 'Three of a Kind',
    };
  }
  if (groups[0].count === 2 && groups[1]?.count === 2) {
    return { rank: 'twoPair', strength: 3, tiebreak: [groups[0].value, groups[1].value, groups[2].value], label: 'Two Pair' };
  }
  if (groups[0].count === 2) {
    return {
      rank: 'pair',
      strength: 2,
      tiebreak: [groups[0].value, ...groups.slice(1).map((group) => group.value).sort((left, right) => right - left)],
      label: 'Pair',
    };
  }
  return { rank: 'highCard', strength: 1, tiebreak: values.slice().sort((left, right) => right - left), label: 'High Card' };
}

function compareResults(left, right) {
  if (left.strength !== right.strength) return left.strength - right.strength;
  const length = Math.max(left.tiebreak.length, right.tiebreak.length);
  for (let index = 0; index < length; index += 1) {
    const difference = Number(left.tiebreak[index] || 0) - Number(right.tiebreak[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function bestHand(cards) {
  const usable = cloneCards(cards);
  let best = null;
  for (let a = 0; a < usable.length - 4; a += 1) {
    for (let b = a + 1; b < usable.length - 3; b += 1) {
      for (let c = b + 1; c < usable.length - 2; c += 1) {
        for (let d = c + 1; d < usable.length - 1; d += 1) {
          for (let e = d + 1; e < usable.length; e += 1) {
            const result = scoreFiveCards([usable[a], usable[b], usable[c], usable[d], usable[e]]);
            if (!best || compareResults(result, best) > 0) best = result;
          }
        }
      }
    }
  }
  return best || { rank: 'highCard', strength: 0, tiebreak: [], label: 'High Card' };
}

function resultForPublicState(result) {
  return result
    ? {
        rank: result.rank,
        label: result.label,
        strength: result.strength,
      }
    : null;
}

function advanceStreet(state) {
  const communityCards = cloneCards(state.communityCards);
  const deck = cloneCards(state.deck);

  if (state.phase === 'preflop') {
    return { phase: 'flop', communityCards: communityCards.concat(deck.splice(0, 3)), deck, message: 'Flop revealed.' };
  }
  if (state.phase === 'flop') {
    return { phase: 'turn', communityCards: communityCards.concat(deck.splice(0, 1)), deck, message: 'Turn revealed.' };
  }
  if (state.phase === 'turn') {
    return { phase: 'river', communityCards: communityCards.concat(deck.splice(0, 1)), deck, message: 'River revealed.' };
  }
  return null;
}

export function createInitialState() {
  return {
    gameId: GAME_ID,
    phase: 'idle',
    deck: [],
    hand: [],
    opponentHand: [],
    communityCards: [],
    bet: 0,
    payout: 0,
    roundDelta: 0,
    totalRoundDelta: 0,
    outcome: null,
    result: null,
    opponentResult: null,
    message: 'Place a bet to start.',
    error: null,
  };
}

export function getPublicState(state = createInitialState()) {
  const safeState = state || createInitialState();
  const complete = safeState.phase === 'complete';

  return {
    gameId: GAME_ID,
    phase: safeState.phase,
    hand: cloneCards(safeState.hand),
    opponentHand: complete ? cloneCards(safeState.opponentHand) : hiddenCards(2),
    communityCards: cloneCards(safeState.communityCards),
    bet: safeState.bet || 0,
    payout: safeState.payout || 0,
    roundDelta: safeState.roundDelta || 0,
    totalRoundDelta: safeState.totalRoundDelta || 0,
    outcome: safeState.outcome || null,
    result: resultForPublicState(safeState.result),
    opponentResult: complete ? resultForPublicState(safeState.opponentResult) : null,
    message: safeState.message || '',
    error: safeState.error || null,
    deckRemaining: Array.isArray(safeState.deck) ? safeState.deck.length : 0,
    suggestedActions: getSuggestedActions(safeState),
  };
}

export function startRound(state = createInitialState(), bet) {
  const currentState = state || createInitialState();

  if (['preflop', 'flop', 'turn', 'river'].includes(currentState.phase)) {
    return withNoCreditDelta(currentState, 'Finish the current hand before dealing again.', 'roundActive');
  }

  const amount = normalizeBet(bet);
  if (amount <= 0) return withNoCreditDelta(currentState, 'Enter a positive whole-credit bet.', 'invalidBet');

  const deck = shuffle(createDeck());

  return {
    gameId: GAME_ID,
    phase: 'preflop',
    deck: deck.slice(4),
    hand: deck.slice(0, 2),
    opponentHand: deck.slice(2, 4),
    communityCards: [],
    bet: amount,
    payout: 0,
    roundDelta: -amount,
    totalRoundDelta: -amount,
    outcome: null,
    result: null,
    opponentResult: null,
    message: 'Hole cards dealt. Reveal the flop.',
    error: null,
  };
}

export function playerAction(state = createInitialState(), action = {}) {
  const currentState = state || createInitialState();
  const actionType = String(typeof action === 'string' ? action : action?.type || '').toLowerCase();

  if (actionType === 'newround') return createInitialState();

  if (actionType === 'raisebet' || actionType === 'bet') {
    if (!['preflop', 'flop', 'turn', 'river'].includes(currentState.phase)) {
      return withNoCreditDelta(currentState, 'Start a hand before betting.', 'roundNotActive');
    }

    const amount = normalizeBet(action?.amount ?? action?.bet);
    if (amount <= 0) return withNoCreditDelta(currentState, 'Enter a positive whole-credit bet.', 'invalidBet');
    const nextBet = (currentState.bet || 0) + amount;
    if (nextBet > MAX_BET) return withNoCreditDelta(currentState, 'That would exceed the table maximum.', 'betTooHigh');

    return {
      ...currentState,
      bet: nextBet,
      roundDelta: -amount,
      totalRoundDelta: (currentState.totalRoundDelta || 0) - amount,
      message: `Added ${amount} credits to the pot.`,
      error: null,
    };
  }

  if (!['advanceholdem', 'check', 'draw'].includes(actionType)) {
    return withNoCreditDelta(currentState, 'Choose a valid poker action.', 'invalidAction');
  }

  if (!['preflop', 'flop', 'turn', 'river'].includes(currentState.phase)) {
    return withNoCreditDelta(currentState, 'Start a round before checking.', 'roundNotActive');
  }

  const nextStreet = advanceStreet(currentState);
  if (nextStreet) {
    return {
      ...currentState,
      ...nextStreet,
      roundDelta: 0,
      message: nextStreet.message,
      error: null,
    };
  }

  const playerResult = bestHand([...currentState.hand, ...currentState.communityCards]);
  const opponentResult = bestHand([...currentState.opponentHand, ...currentState.communityCards]);
  const comparison = compareResults(playerResult, opponentResult);
  const bet = currentState.bet || 0;
  const payout = comparison > 0 ? bet * 2 : comparison === 0 ? bet : 0;
  const outcome = comparison > 0 ? 'win' : comparison === 0 ? 'push' : 'lose';
  const roundDelta = payout;
  const totalRoundDelta = (currentState.totalRoundDelta || -bet) + roundDelta;

  return {
    ...currentState,
    phase: 'complete',
    payout,
    roundDelta,
    totalRoundDelta,
    outcome,
    result: playerResult,
    opponentResult,
    message:
      comparison > 0
        ? `${playerResult.label} wins the pot.`
        : comparison === 0
          ? `Push with ${playerResult.label}.`
          : `${opponentResult.label} wins.`,
    error: null,
  };
}

export function getSuggestedActions(state = createInitialState()) {
  const safeState = state || createInitialState();

  if (['preflop', 'flop', 'turn', 'river'].includes(safeState.phase)) {
    return [
      {
        type: 'raiseBet',
        label: 'Bet',
      },
      {
        type: 'advanceHoldem',
        label: safeState.phase === 'preflop' ? 'Reveal flop' : safeState.phase === 'flop' ? 'Reveal turn' : safeState.phase === 'turn' ? 'Reveal river' : 'Showdown',
      },
    ];
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
