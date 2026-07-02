export const GAME_ID = 'solitaire';

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RED_SUITS = new Set(['hearts', 'diamonds']);
const RANKS = [
  null,
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
];

function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (let value = 1; value <= 13; value += 1) {
      deck.push({
        id: `${suit}-${value}`,
        suit,
        rank: RANKS[value],
        value,
        color: RED_SUITS.has(suit) ? 'red' : 'black',
        faceUp: false,
      });
    }
  }

  return deck;
}

function shuffle(cards) {
  const shuffled = cards.map(cloneCard);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function createFoundations() {
  return {
    hearts: [],
    diamonds: [],
    clubs: [],
    spades: [],
  };
}

function cloneCard(card) {
  return { ...card };
}

function clonePile(pile) {
  return pile.map(cloneCard);
}

function cloneFoundations(foundations = createFoundations()) {
  return Object.fromEntries(
    SUITS.map((suit) => [suit, clonePile(foundations[suit] || [])]),
  );
}

function cloneState(state = {}) {
  const source = state && typeof state === 'object' ? state : {};
  const status = source.status || source.phase || 'idle';
  const bet = Number(source.bet);
  const roundDelta = Number(source.roundDelta);
  const moves = Number(source.moves);
  const stockPasses = Number(source.stockPasses);

  return {
    gameId: GAME_ID,
    status,
    phase: status,
    bet: Number.isFinite(bet) ? bet : 0,
    roundDelta: Number.isFinite(roundDelta) ? roundDelta : 0,
    moves: Number.isFinite(moves) ? moves : 0,
    stockPasses: Number.isFinite(stockPasses) ? stockPasses : 0,
    payout: Number.isFinite(Number(source.payout)) ? Number(source.payout) : 0,
    outcome: source.outcome || null,
    message: source.message || '',
    lastError: source.lastError || '',
    validationMessage: source.validationMessage || null,
    tableau: Array.from({ length: 7 }, (_, index) => clonePile(source.tableau?.[index] || [])),
    stock: clonePile(source.stock || []),
    waste: clonePile(source.waste || []),
    foundations: cloneFoundations(source.foundations),
  };
}

function topCard(pile) {
  return pile[pile.length - 1] || null;
}

function flipTopTableauCard(tableauPile) {
  const card = topCard(tableauPile);

  if (card && !card.faceUp) {
    card.faceUp = true;
    return true;
  }

  return false;
}

function isValidTableauIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < 7;
}

function normalizeAction(action) {
  if (typeof action === 'string') {
    return { type: action };
  }

  if (!action || typeof action !== 'object') {
    return { type: '' };
  }

  return {
    ...action,
    type: action.type || action.action || action.name || '',
  };
}

function withError(state, message) {
  return {
    ...cloneState(state),
    roundDelta: 0,
    lastError: message,
    validationMessage: message,
    message,
  };
}

function clearTurnDelta(state) {
  state.roundDelta = 0;
  state.lastError = '';
  state.validationMessage = null;
  state.message = '';
  return state;
}

function canMoveToFoundation(card, foundationPile) {
  if (!card || !card.faceUp) {
    return false;
  }

  const foundationTop = topCard(foundationPile);

  if (!foundationTop) {
    return card.value === 1;
  }

  return foundationTop.suit === card.suit && card.value === foundationTop.value + 1;
}

function canMoveToTableau(card, targetPile) {
  if (!card || !card.faceUp) {
    return false;
  }

  const targetTop = topCard(targetPile);

  if (!targetTop) {
    return card.value === 13;
  }

  return targetTop.faceUp && targetTop.color !== card.color && card.value === targetTop.value - 1;
}

function isValidFaceUpRun(cards) {
  if (!cards.length || cards.some((card) => !card.faceUp)) {
    return false;
  }

  for (let index = 1; index < cards.length; index += 1) {
    const previous = cards[index - 1];
    const current = cards[index];

    if (previous.color === current.color || current.value !== previous.value - 1) {
      return false;
    }
  }

  return true;
}

function hasWon(state) {
  return SUITS.every((suit) => state.foundations[suit].length === 13);
}

function finishIfWon(state) {
  if (state.status === 'playing' && hasWon(state)) {
    state.status = 'won';
    state.phase = 'won';
    state.outcome = 'win';
    state.payout = state.bet * 5;
    state.roundDelta = state.bet * 5;
    state.message = `Solitaire cleared. You won ${state.roundDelta} credits.`;
  }

  return state;
}

function publicCard(card) {
  if (!card) {
    return null;
  }

  if (!card.faceUp) {
    return { faceUp: false };
  }

  return {
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    value: card.value,
    color: card.color,
    faceUp: true,
  };
}

function moveTopTableauCardToFoundation(state, sourceIndex) {
  if (!isValidTableauIndex(sourceIndex)) {
    return withError(state, 'Choose a valid tableau pile.');
  }

  const sourcePile = state.tableau[sourceIndex];
  const card = topCard(sourcePile);

  if (!canMoveToFoundation(card, state.foundations[card?.suit])) {
    return withError(state, 'That tableau card cannot move to a foundation.');
  }

  state.foundations[card.suit].push(sourcePile.pop());
  flipTopTableauCard(sourcePile);
  state.moves += 1;

  return finishIfWon(state);
}

function moveWasteCardToFoundation(state) {
  const card = topCard(state.waste);

  if (!canMoveToFoundation(card, state.foundations[card?.suit])) {
    return withError(state, 'The waste card cannot move to a foundation.');
  }

  state.foundations[card.suit].push(state.waste.pop());
  state.moves += 1;

  return finishIfWon(state);
}

function moveWasteCardToTableau(state, targetIndex) {
  if (!isValidTableauIndex(targetIndex)) {
    return withError(state, 'Choose a valid tableau pile.');
  }

  const card = topCard(state.waste);
  const targetPile = state.tableau[targetIndex];

  if (!canMoveToTableau(card, targetPile)) {
    return withError(state, 'The waste card cannot move to that tableau pile.');
  }

  targetPile.push(state.waste.pop());
  state.moves += 1;

  return state;
}

function moveFoundationCardToTableau(state, suit, targetIndex) {
  if (!SUITS.includes(suit)) {
    return withError(state, 'Choose a valid foundation suit.');
  }

  if (!isValidTableauIndex(targetIndex)) {
    return withError(state, 'Choose a valid tableau pile.');
  }

  const foundationPile = state.foundations[suit];
  const card = topCard(foundationPile);
  const targetPile = state.tableau[targetIndex];

  if (!canMoveToTableau(card, targetPile)) {
    return withError(state, 'That foundation card cannot move to that tableau pile.');
  }

  targetPile.push(foundationPile.pop());
  state.moves += 1;

  return state;
}

function moveTableauRun(state, sourceIndex, targetIndex, count) {
  if (!isValidTableauIndex(sourceIndex) || !isValidTableauIndex(targetIndex)) {
    return withError(state, 'Choose valid tableau piles.');
  }

  if (sourceIndex === targetIndex) {
    return withError(state, 'Choose two different tableau piles.');
  }

  if (!Number.isInteger(count) || count <= 0) {
    return withError(state, 'Choose at least one tableau card to move.');
  }

  const sourcePile = state.tableau[sourceIndex];
  const targetPile = state.tableau[targetIndex];

  if (count > sourcePile.length) {
    return withError(state, 'That tableau pile does not have enough cards.');
  }

  const movingCards = sourcePile.slice(sourcePile.length - count);
  const firstMovingCard = movingCards[0];

  if (!isValidFaceUpRun(movingCards) || !canMoveToTableau(firstMovingCard, targetPile)) {
    return withError(state, 'That tableau move is not legal.');
  }

  sourcePile.splice(sourcePile.length - count, count);
  targetPile.push(...movingCards);
  flipTopTableauCard(sourcePile);
  state.moves += 1;

  return state;
}

function drawFromStock(state) {
  if (state.stock.length > 0) {
    const card = state.stock.pop();
    card.faceUp = true;
    state.waste.push(card);
    state.moves += 1;
    return state;
  }

  if (state.waste.length > 0) {
    state.stock = state.waste.reverse().map((card) => ({
      ...card,
      faceUp: false,
    }));
    state.waste = [];
    state.stockPasses += 1;
    state.moves += 1;
    state.message = 'Waste returned to the stock.';
    return state;
  }

  return withError(state, 'There are no stock cards to draw.');
}

export function createInitialState() {
  return {
    gameId: GAME_ID,
    status: 'idle',
    phase: 'idle',
    bet: 0,
    roundDelta: 0,
    moves: 0,
    stockPasses: 0,
    payout: 0,
    outcome: null,
    message: '',
    lastError: '',
    validationMessage: null,
    tableau: Array.from({ length: 7 }, () => []),
    stock: [],
    waste: [],
    foundations: createFoundations(),
  };
}

export function getPublicState(state) {
  const safeState = cloneState(state);

  return {
    gameId: GAME_ID,
    status: safeState.status,
    phase: safeState.phase,
    bet: safeState.bet,
    roundDelta: safeState.roundDelta,
    moves: safeState.moves,
    stockPasses: safeState.stockPasses,
    payout: safeState.payout,
    outcome: safeState.outcome,
    stockCount: safeState.stock.length,
    wasteCount: safeState.waste.length,
    message: safeState.message,
    lastError: safeState.lastError,
    validationMessage: safeState.validationMessage,
    tableau: safeState.tableau.map((pile) => pile.map(publicCard)),
    waste: safeState.waste.map(publicCard),
    wasteTop: publicCard(topCard(safeState.waste)),
    foundations: Object.fromEntries(
      SUITS.map((suit) => [
        suit,
        {
          count: safeState.foundations[suit].length,
          cards: safeState.foundations[suit].map(publicCard),
          top: publicCard(topCard(safeState.foundations[suit])),
        },
      ]),
    ),
    suggestedActions: getSuggestedActions(safeState),
  };
}

export function startRound(state, bet) {
  const current = cloneState(state || createInitialState());

  if (current.status === 'playing') {
    return withError(current, 'Finish the current Solitaire deal before starting a new one.');
  }

  const entryFee = Number(bet);

  if (!Number.isFinite(entryFee) || !Number.isInteger(entryFee) || entryFee <= 0) {
    return withError(current, 'Solitaire needs a positive whole-credit entry fee.');
  }

  const deck = shuffle(createDeck());
  const tableau = Array.from({ length: 7 }, (_, pileIndex) => {
    const pile = [];

    for (let cardIndex = 0; cardIndex <= pileIndex; cardIndex += 1) {
      const card = deck.pop();
      card.faceUp = cardIndex === pileIndex;
      pile.push(card);
    }

    return pile;
  });

  return {
    gameId: GAME_ID,
    status: 'playing',
    phase: 'playing',
    bet: entryFee,
    roundDelta: -entryFee,
    moves: 0,
    stockPasses: 0,
    payout: 0,
    outcome: null,
    message: `Solitaire round started for ${entryFee} credits.`,
    lastError: '',
    validationMessage: null,
    tableau,
    stock: deck.map((card) => ({ ...card, faceUp: false })),
    waste: [],
    foundations: createFoundations(),
  };
}

export function playerAction(state, action) {
  const workingState = clearTurnDelta(cloneState(state));
  const normalizedAction = normalizeAction(action);

  if (workingState.status !== 'playing') {
    return withError(workingState, 'Start a Solitaire round before making a move.');
  }

  switch (normalizedAction.type) {
    case 'drawStock':
      return drawFromStock(workingState);
    case 'moveWasteToFoundation':
      return moveWasteCardToFoundation(workingState);
    case 'moveWasteToTableau':
      return moveWasteCardToTableau(workingState, normalizedAction.targetIndex);
    case 'moveFoundationToTableau':
      return moveFoundationCardToTableau(workingState, normalizedAction.suit, normalizedAction.targetIndex);
    case 'moveTableauToFoundation':
      return moveTopTableauCardToFoundation(workingState, normalizedAction.sourceIndex);
    case 'moveTableauToTableau':
      return moveTableauRun(
        workingState,
        normalizedAction.sourceIndex,
        normalizedAction.targetIndex,
        normalizedAction.count,
      );
    default:
      return withError(workingState, 'Choose a valid Solitaire action.');
  }
}

export function getSuggestedActions(state) {
  const safeState = cloneState(state);

  if (safeState.status !== 'playing') {
    return [];
  }

  const actions = [];

  if (safeState.stock.length > 0 || safeState.waste.length > 0) {
    actions.push({ type: 'drawStock' });
  }

  const wasteCard = topCard(safeState.waste);

  if (canMoveToFoundation(wasteCard, safeState.foundations[wasteCard?.suit])) {
    actions.push({ type: 'moveWasteToFoundation' });
  }

  if (wasteCard) {
    for (let targetIndex = 0; targetIndex < safeState.tableau.length; targetIndex += 1) {
      if (canMoveToTableau(wasteCard, safeState.tableau[targetIndex])) {
        actions.push({ type: 'moveWasteToTableau', targetIndex });
      }
    }
  }

  for (let sourceIndex = 0; sourceIndex < safeState.tableau.length; sourceIndex += 1) {
    const sourcePile = safeState.tableau[sourceIndex];
    const sourceTop = topCard(sourcePile);

    if (canMoveToFoundation(sourceTop, safeState.foundations[sourceTop?.suit])) {
      actions.push({ type: 'moveTableauToFoundation', sourceIndex });
    }

    for (let count = 1; count <= sourcePile.length; count += 1) {
      const movingCards = sourcePile.slice(sourcePile.length - count);
      const firstMovingCard = movingCards[0];

      if (!isValidFaceUpRun(movingCards)) {
        continue;
      }

      for (let targetIndex = 0; targetIndex < safeState.tableau.length; targetIndex += 1) {
        if (sourceIndex === targetIndex) {
          continue;
        }

        if (canMoveToTableau(firstMovingCard, safeState.tableau[targetIndex])) {
          actions.push({ type: 'moveTableauToTableau', sourceIndex, targetIndex, count });
        }
      }
    }
  }

  for (const suit of SUITS) {
    const foundationCard = topCard(safeState.foundations[suit]);

    for (let targetIndex = 0; targetIndex < safeState.tableau.length; targetIndex += 1) {
      if (canMoveToTableau(foundationCard, safeState.tableau[targetIndex])) {
        actions.push({ type: 'moveFoundationToTableau', suit, targetIndex });
      }
    }
  }

  return actions;
}
