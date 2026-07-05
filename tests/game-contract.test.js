import assert from "node:assert/strict";
import test from "node:test";

const gameIds = ["blackjack", "poker", "solitaire", "slots", "corridor", "dice", "clicker"];

for (const gameId of gameIds) {
  test(`${gameId} exports the shared game contract`, async () => {
    const game = await import(`../static/js/games/${gameId}.js`);
    assert.equal(game.GAME_ID, gameId);
    assert.equal(typeof game.createInitialState, "function");
    assert.equal(typeof game.getPublicState, "function");
    assert.equal(typeof game.startRound, "function");
    assert.equal(typeof game.playerAction, "function");
    assert.equal(typeof game.getSuggestedActions, "function");

    const initialState = game.createInitialState();
    const publicInitial = game.getPublicState(initialState);
    assert.equal(publicInitial.gameId, gameId);

    const started = game.startRound(initialState, 10);
    const publicStarted = game.getPublicState(started);
    assert.equal(publicStarted.gameId, gameId);
    assert.equal(Number.isFinite(Number(publicStarted.roundDelta || 0)), true);
  });
}

test("blackjack can complete by standing", async () => {
  const game = await import("../static/js/games/blackjack.js");
  const started = game.startRound(game.createInitialState(), 10);
  const finished = game.playerAction(started, "stand");
  assert.equal(game.getPublicState(finished).phase, "round_over");
});

test("poker hold'em reaches showdown", async () => {
  const game = await import("../static/js/games/poker.js");
  let state = game.startRound(game.createInitialState(), 10);
  assert.equal(game.getPublicState(state).hand.length, 2);
  state = game.playerAction(state, { type: "advanceHoldem" });
  state = game.playerAction(state, { type: "advanceHoldem" });
  state = game.playerAction(state, { type: "advanceHoldem" });
  const finished = game.playerAction(state, { type: "advanceHoldem" });
  const publicState = game.getPublicState(finished);
  assert.equal(publicState.phase, "complete");
  assert.equal(publicState.hand.length, 2);
  assert.equal(publicState.communityCards.length, 5);
});

test("poker can add to the bet during a live hand", async () => {
  const game = await import("../static/js/games/poker.js");
  let state = game.startRound(game.createInitialState(), 10);

  state = game.playerAction(state, { type: "raiseBet", amount: 15 });
  const publicState = game.getPublicState(state);

  assert.equal(publicState.phase, "preflop");
  assert.equal(publicState.bet, 25);
  assert.equal(publicState.roundDelta, -15);
  assert.equal(publicState.message, "Added 15 credits to the pot.");
});

test("slots spin records three reels", async () => {
  const game = await import("../static/js/games/slots.js");
  const spun = game.startRound(game.createInitialState(), 10);
  assert.equal(game.getPublicState(spun).lastSpin.reels.length, 3);
});

test("corridor continues past the old five-room limit", async () => {
  const game = await import("../static/js/games/corridor.js");
  let state = game.startRound(game.createInitialState(), 10);

  for (let index = 0; index < 7; index += 1) {
    const door = state.currentDoors.find((item) => item.role !== "trap");
    state = game.playerAction(state, { type: "chooseDoor", doorIndex: door.index });
  }

  const publicState = game.getPublicState(state);
  assert.equal(publicState.phase, "inRound");
  assert.equal(publicState.isEndless, true);
  assert.equal(publicState.roomsCleared, 7);
  assert.equal(publicState.roomNumber, 8);
});

test("credit clicker earns credits and buys upgrades", async () => {
  const game = await import("../static/js/games/clicker.js");
  let state = game.startRound(game.createInitialState());
  let publicState = game.getPublicState(state);

  assert.equal(publicState.upgradeLevel, 0);
  assert.equal(publicState.clickValue, 1);
  assert.equal(publicState.nextUpgradeCost, 25);

  state = game.playerAction(state, { type: "click", clickCount: 3, now: 1000 });
  publicState = game.getPublicState(state);
  assert.equal(publicState.roundDelta, 3);
  assert.equal(publicState.totalClicks, 3);
  assert.equal(publicState.totalEarned, 3);

  state = game.playerAction(state, { type: "buyUpgrade", availableCredits: 24 });
  publicState = game.getPublicState(state);
  assert.equal(publicState.validationMessage, "insufficient_credits");
  assert.equal(publicState.upgradeLevel, 0);

  state = game.playerAction(state, { type: "buyUpgrade", availableCredits: 25 });
  publicState = game.getPublicState(state);
  assert.equal(publicState.roundDelta, -25);
  assert.equal(publicState.upgradeLevel, 1);
  assert.equal(publicState.clickValue, 2);
  assert.equal(publicState.nextUpgradeCost, 36);
  assert.equal(publicState.totalSpent, 25);
});

test("credit clicker caps rapid click batches", async () => {
  const game = await import("../static/js/games/clicker.js");
  let state = game.startRound(game.createInitialState());

  state = game.playerAction(state, { type: "click", clickCount: 6, now: 2000 });
  assert.equal(game.getPublicState(state).roundDelta, 6);

  state = game.playerAction(state, { type: "click", clickCount: 1, now: 2200 });
  const publicState = game.getPublicState(state);
  assert.equal(publicState.validationMessage, "click_rate_limited");
  assert.equal(publicState.totalClicks, 6);
});
