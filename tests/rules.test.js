import test from "node:test";
import assert from "node:assert/strict";
import { BoardState, createPiece } from "../src/game/board.js";
import { PIECE_TYPES, SIDES } from "../src/game/constants.js";
import {
  getLegalMoves,
  getPseudoMoves,
  isInCheck,
} from "../src/game/rules.js";

function state(pieces, turn = SIDES.RED) {
  return new BoardState(pieces, turn, []);
}

function hasMove(piece, moves, x, y) {
  return moves.some((move) => move.x === x && move.y === y);
}

test("soldier moves forward, then sideways after crossing the river", () => {
  const redSoldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 4, 5);
  const before = state([
    redSoldier,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const beforeMoves = getLegalMoves(before, redSoldier);
  assert.equal(hasMove(redSoldier, beforeMoves, 3, 5), false);
  assert.equal(hasMove(redSoldier, beforeMoves, 4, 4), true);

  const crossed = state([
    createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 4, 4),
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const soldier = crossed.pieceAt(4, 4);
  const crossedMoves = getLegalMoves(crossed, soldier);
  assert.equal(hasMove(soldier, crossedMoves, 3, 4), true);
  assert.equal(hasMove(soldier, crossedMoves, 5, 4), true);
  assert.equal(hasMove(soldier, crossedMoves, 4, 3), true);

  const offBridge = state([
    createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 1, 5),
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const offBridgeSoldier = offBridge.pieceAt(1, 5);
  const offBridgeMoves = getLegalMoves(offBridge, offBridgeSoldier);
  assert.equal(hasMove(offBridgeSoldier, offBridgeMoves, 1, 5), false);
});

test("horse is blocked by a piece on its leg", () => {
  const horse = createPiece(PIECE_TYPES.HORSE, SIDES.RED, 4, 5);
  const board = state([
    horse,
    createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 4, 4),
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const moves = getLegalMoves(board, horse);
  assert.equal(hasMove(horse, moves, 3, 3), false);
  assert.equal(hasMove(horse, moves, 5, 3), false);
  assert.equal(hasMove(horse, moves, 3, 7), true);
});

test("chariot must use one of the three bridge columns to cross", () => {
  const chariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 1, 5);
  const board = state([
    chariot,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const moves = getLegalMoves(board, chariot);
  assert.equal(hasMove(chariot, moves, 1, 4), false);
  assert.equal(hasMove(chariot, moves, 4, 5), true);
  assert.equal(hasMove(chariot, moves, 0, 5), true);
});

test("cannon captures only across exactly one screen", () => {
  const cannon = createPiece(PIECE_TYPES.CANNON, SIDES.RED, 1, 7);
  const board = state([
    cannon,
    createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 1, 4),
    createPiece(PIECE_TYPES.CHARIOT, SIDES.BLACK, 1, 1),
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0),
  ]);
  const moves = getPseudoMoves(board, cannon);
  assert.equal(hasMove(cannon, moves, 1, 1), true);
  assert.equal(hasMove(cannon, moves, 1, 2), false);
  assert.equal(hasMove(cannon, moves, 1, 6), true);
});

test("elephant cannot cross the river and is blocked eye-to-eye", () => {
  const elephant = createPiece(PIECE_TYPES.ELEPHANT, SIDES.RED, 4, 9);
  const board = state([
    elephant,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 3, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0),
  ]);
  const moves = getLegalMoves(board, elephant);
  assert.equal(hasMove(elephant, moves, 2, 7), true);
  assert.equal(hasMove(elephant, moves, 6, 7), true);
  assert.equal(hasMove(elephant, moves, 2, 5), false);

  const blocked = state([
    elephant,
    createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 3, 8),
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 3, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0),
  ]);
  assert.equal(hasMove(elephant, getLegalMoves(blocked, elephant), 2, 7), false);
});

test("flying general exposes check when the file is clear", () => {
  const board = state([
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0),
  ]);
  assert.equal(isInCheck(board, SIDES.RED), true);
  assert.equal(isInCheck(board, SIDES.BLACK), true);

  board.move(board.pieceAt(4, 9).id, 4, 8);
  assert.equal(isInCheck(board, SIDES.RED), true);
  board.pieces.push(createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 4, 5));
  assert.equal(isInCheck(board, SIDES.RED), false);
});

test("legal move filtering prevents exposing own general", () => {
  const blocker = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 5);
  const board = state([
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    blocker,
    createPiece(PIECE_TYPES.CHARIOT, SIDES.BLACK, 4, 0),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
    createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 5, 5),
  ]);
  const moves = getLegalMoves(board, blocker);
  assert.equal(moves.some((move) => move.y > 5), false);
});
