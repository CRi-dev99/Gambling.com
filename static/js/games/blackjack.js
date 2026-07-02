export const GAME_ID = 'blackjack';

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const START_MESSAGE = 'Place a bet to start a blackjack round.';

export function createInitialState() {
  return {
    gameId: GAME_ID,
    phase: 'idle',
    deck: [],
    playerHand: [],
    dealerHand: [],
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
  const hideDealerHole = current.phase === 'player_turn' && current.dealerHand.length > 1;
  const dealerHand = hideDealerHole
    ? [cloneCard(current.dealerHand[0]), { hidden: true }]
    : cloneHand(current.dealerHand);
  const dealerScore = scoreHand(current.dealerHand);
  const visibleDealerScore = hideDealerHole
    ? scoreHand(current.dealerHand.slice(0, 1))
    : dealerScore;
  const playerScore = scoreHand(current.playerHand);

  return {
    gameId: GAME_ID,
    phase: current.phase,
    bet: current.bet,
    roundDelta: current.roundDelta,
    outcome: current.outcome,
    message: current.message,
    validationMessage: current.validationMessage,
    lastAction: current.lastAction,
    playerHand: cloneHand(current.playerHand),
    dealerHand,
    playerValue: playerScore.total,
    playerIsSoft: playerScore.softAces > 0,
    dealerValue: visibleDealerScore.total,
    dealerIsSoft: visibleDealerScore.softAces > 0,
    dealerHoleHidden: hideDealerHole,
    cardsRemaining: current.deck.length,
  };
}

export function startRound(state, bet) {
  const current = normalizeState(state);
  const parsedBet = normalizeBet(bet);

  if (current.phase === 'player_turn') {
    return withValidation(current, 'Finish the current round before starting another one.');
  }

  if (!parsedBet.ok) {
    return withValidation(current, parsedBet.message);
  }

  const deck = shuffle(createDeck());
  const playerHand = [draw(deck), draw(deck)];
  const dealerHand = [draw(deck), draw(deck)];
  const next = {
    ...createInitialState(),
    deck,
    playerHand,
    dealerHand,
    bet: parsedBet.value,
    phase: 'player_turn',
    message: 'Round started. Choose hit or stand.',
  };

  const playerBlackjack = isBlackjack(playerHand);
  const dealerBlackjack = isBlackjack(dealerHand);

  if (playerBlackjack && dealerBlackjack) {
    return finishRound(next, 'push', 0, 'Both you and the dealer have blackjack. Push.');
  }

  if (playerBlackjack) {
    return finishRound(
      next,
      'blackjack',
      parsedBet.value * 1.5,
      'Blackjack! You win 3:2.'
    );
  }

  if (dealerBlackjack) {
    return finishRound(
      next,
      'dealer_blackjack',
      -parsedBet.value,
      'Dealer has blackjack. You lose the round.'
    );
  }

  return next;
}

export function playerAction(state, action) {
  const current = normalizeState(state);
  const normalizedAction = normalizeAction(action);

  if (!normalizedAction) {
    return withValidation(current, 'Choose a valid action: hit or stand.');
  }

  if (current.phase !== 'player_turn') {
    return withValidation(current, actionUnavailableMessage(current.phase));
  }

  if (normalizedAction === 'hit') {
    if (scoreHand(current.playerHand).total >= 21) {
      return withValidation(current, 'You have 21. Stand to let the dealer play.');
    }

    return hit(current);
  }

  return stand(current);
}

export function getSuggestedActions(state) {
  const current = normalizeState(state);

  if (current.phase !== 'player_turn') {
    return [];
  }

  const playerScore = scoreHand(current.playerHand);
  return playerScore.total >= 21 ? ['stand'] : ['hit', 'stand'];
}

function hit(state) {
  const next = cloneState(state);
  next.playerHand.push(draw(next.deck));
  next.validationMessage = null;
  next.lastAction = 'hit';

  const playerScore = scoreHand(next.playerHand);

  if (playerScore.total > 21) {
    return finishRound(next, 'player_bust', -next.bet, 'You busted. Dealer wins.');
  }

  next.message = playerScore.total === 21
    ? 'You have 21. Stand to let the dealer play.'
    : 'Card dealt. Choose hit or stand.';

  return next;
}

function stand(state) {
  const next = cloneState(state);
  next.validationMessage = null;
  next.lastAction = 'stand';

  while (shouldDealerDraw(next.dealerHand)) {
    next.dealerHand.push(draw(next.deck));
  }

  const playerTotal = scoreHand(next.playerHand).total;
  const dealerTotal = scoreHand(next.dealerHand).total;

  if (dealerTotal > 21) {
    return finishRound(next, 'dealer_bust', next.bet, 'Dealer busted. You win 1:1.');
  }

  if (playerTotal > dealerTotal) {
    return finishRound(next, 'win', next.bet, 'You beat the dealer. You win 1:1.');
  }

  if (playerTotal < dealerTotal) {
    return finishRound(next, 'lose', -next.bet, 'Dealer beats your hand. You lose.');
  }

  return finishRound(next, 'push', 0, 'Push. Your bet is returned.');
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

function shouldDealerDraw(hand) {
  const score = scoreHand(hand);
  return score.total < 17;
}

function isBlackjack(hand) {
  return hand.length === 2 && scoreHand(hand).total === 21;
}

function scoreHand(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    if (!card || card.hidden) {
      continue;
    }

    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }

  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }

  return { total, softAces };
}

function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        rank,
        suit,
        value: cardValue(rank),
        code: `${rank}${suit[0].toUpperCase()}`,
        label: `${rank}${suitSymbol(suit)}`,
      });
    }
  }

  return deck;
}

function shuffle(cards) {
  const deck = cards.slice();

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

function draw(deck) {
  if (deck.length === 0) {
    deck.push(...shuffle(createDeck()));
  }

  return deck.pop();
}

function suitSymbol(suit) {
  switch (suit) {
    case 'clubs':
      return 'C';
    case 'diamonds':
      return 'D';
    case 'hearts':
      return 'H';
    case 'spades':
      return 'S';
    default:
      return '';
  }
}

function cardValue(rank) {
  if (rank === 'A') {
    return 11;
  }

  if (['K', 'Q', 'J'].includes(rank)) {
    return 10;
  }

  return Number(rank);
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') {
    return createInitialState();
  }

  return {
    ...createInitialState(),
    ...state,
    gameId: GAME_ID,
    deck: Array.isArray(state.deck) ? cloneHand(state.deck) : [],
    playerHand: Array.isArray(state.playerHand) ? cloneHand(state.playerHand) : [],
    dealerHand: Array.isArray(state.dealerHand) ? cloneHand(state.dealerHand) : [],
    bet: Number.isFinite(Number(state.bet)) ? Number(state.bet) : 0,
    roundDelta: Number.isFinite(Number(state.roundDelta)) ? Number(state.roundDelta) : 0,
  };
}

function cloneState(state) {
  return {
    ...state,
    deck: cloneHand(state.deck),
    playerHand: cloneHand(state.playerHand),
    dealerHand: cloneHand(state.dealerHand),
  };
}

function cloneHand(hand) {
  return hand.map(cloneCard);
}

function cloneCard(card) {
  return card ? { ...card } : card;
}

function normalizeAction(action) {
  if (action && typeof action === 'object') {
    return normalizeAction(action.type ?? action.action ?? action.move);
  }

  const normalized = String(action ?? '').trim().toLowerCase();
  return ['hit', 'stand'].includes(normalized) ? normalized : null;
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
    ...cloneState(state),
    roundDelta: 0,
    validationMessage,
    message: validationMessage,
  };
}

function actionUnavailableMessage(phase) {
  if (phase === 'idle') {
    return 'Start a round before choosing an action.';
  }

  if (phase === 'round_over') {
    return 'Round is over. Start a new round to keep playing.';
  }

  return 'Action is not available right now.';
}
