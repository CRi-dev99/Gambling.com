import assert from "node:assert/strict";
import test from "node:test";

const gameIds = ["blackjack", "poker", "solitaire", "slots", "corridor", "dice"];

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

test("poker draw produces a complete hand", async () => {
  const game = await import("../static/js/games/poker.js");
  const started = game.startRound(game.createInitialState(), 10);
  const finished = game.playerAction(started, { type: "draw" });
  const publicState = game.getPublicState(finished);
  assert.equal(publicState.phase, "complete");
  assert.equal(publicState.hand.length, 5);
});

test("slots spin records three reels", async () => {
  const game = await import("../static/js/games/slots.js");
  const spun = game.startRound(game.createInitialState(), 10);
  assert.equal(game.getPublicState(spun).lastSpin.reels.length, 3);
});
