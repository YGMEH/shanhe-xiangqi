import test from "node:test";
import assert from "node:assert/strict";
import { BoardState, createPiece } from "../src/game/board.js";
import { PIECE_TYPES, SIDES } from "../src/game/constants.js";
import {
  gameStatus,
  getAllLegalMoves,
  getLegalMoves,
  getPseudoMoves,
  isInCheck,
  isMoveLegal,
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

test("chariot crosses the river from any column (standard xiangqi)", () => {
  const chariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 1, 5);
  const board = state([
    chariot,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const moves = getLegalMoves(board, chariot);
  // 车不受"桥"限制, 任意列都能过河
  assert.equal(hasMove(chariot, moves, 1, 4), true);
  assert.equal(hasMove(chariot, moves, 1, 3), true);
  assert.equal(hasMove(chariot, moves, 1, 0), true);
  // 横向平移照常
  assert.equal(hasMove(chariot, moves, 4, 5), true);
  assert.equal(hasMove(chariot, moves, 0, 5), true);
});

test("cannon crosses the river from any column (standard xiangqi)", () => {
  const cannon = createPiece(PIECE_TYPES.CANNON, SIDES.RED, 1, 7);
  const board = state([
    cannon,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const moves = getLegalMoves(board, cannon);
  // 炮不架炮时走法同车, 同样不受桥限制
  assert.equal(hasMove(cannon, moves, 1, 4), true);
  assert.equal(hasMove(cannon, moves, 1, 0), true);
  assert.equal(hasMove(cannon, moves, 5, 7), true);
});

test("cannon captures an enemy across the river without a bridge", () => {
  const cannon = createPiece(PIECE_TYPES.CANNON, SIDES.RED, 1, 7);
  const screenPiece = createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 1, 5);
  const victim = createPiece(PIECE_TYPES.CHARIOT, SIDES.BLACK, 1, 3);
  const board = state([
    cannon,
    screenPiece,
    victim,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const moves = getLegalMoves(board, cannon);
  // 隔一个炮架可以吃河对岸的敌子
  assert.equal(hasMove(cannon, moves, 1, 3), true);
  // 不能直接吃炮架
  assert.equal(hasMove(cannon, moves, 1, 5), false);
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

test("generals are attack targets, not capturable legal destinations", () => {
  const redGeneral = createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9);
  const blackGeneral = createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0);
  const board = state([redGeneral, blackGeneral]);

  const moves = getLegalMoves(board, redGeneral);
  assert.equal(
    moves.some((move) => move.x === 4 && move.y === 0),
    false,
    "飞将只能表示攻击关系, 不能作为跨棋盘移动"
  );
  assert.equal(
    moves.some((move) => move.captured?.type === PIECE_TYPES.GENERAL),
    false,
    "合法着法不能直接吃将"
  );
  assert.equal(isInCheck(board, SIDES.RED), true);
  assert.equal(isInCheck(board, SIDES.BLACK), true);
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


test("move validation rejects a piece when it is not that side's turn", () => {
  const redSoldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 6);
  const board = state([
    redSoldier,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ], SIDES.BLACK);

  assert.equal(isMoveLegal(board, redSoldier.id, 0, 5), null);
  assert.ok(isMoveLegal(board, redSoldier.id, 0, 5, { requireTurn: false }));
});

test("legal move generation resolves the live board piece instead of stale coordinates", () => {
  const soldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 6);
  const board = state([
    soldier,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);
  const stalePiece = { ...soldier, x: 8, y: 8 };

  const moves = getLegalMoves(board, stalePiece);
  assert.equal(hasMove(stalePiece, moves, 0, 5), true);
  assert.equal(hasMove(stalePiece, moves, 8, 7), false);
});

test("a side without its general is already lost", () => {
  const redGeneral = createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9);
  const board = state([
    redGeneral,
    createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 5),
  ], SIDES.RED);

  const status = gameStatus(board);
  assert.equal(status.over, true, "黑将缺失应立即结束");
  assert.equal(status.winner, SIDES.RED, "黑将缺失应判红方胜");
  assert.equal(status.reason, "checkmate");
  assert.equal(status.inCheck, true, "将帅被擒应按绝杀而非困毙结算");
});

test("when the enemy general is directly capturable, it stays attack-only and never becomes a move", () => {
  const redChariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 0);
  const blackGeneral = createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0);
  const board = state([
    redChariot,
    blackGeneral,
    createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 3, 3),
  ], SIDES.RED);

  const chariotMoves = getLegalMoves(board, redChariot);
  assert.equal(
    chariotMoves.some((move) => move.x === 4 && move.y === 0),
    false,
    "红车可以直接威胁黑将, 但吃将不应成为可执行着法"
  );
  assert.equal(
    isInCheck(board, SIDES.BLACK),
    true,
    "黑方应仍处于被将军状态"
  );
});

/**
 * Perft: 从标准开局做穷举着法计数。
 * 公认标准值 depth1=44, depth2=1920, depth3=79666。
 * 只要走法生成有任何偏差(蹩马腿/塞象眼/九宫/过河/炮架/将帅照面),
 * 这些数字就对不上 —— 比逐条写用例更严密。
 */
function perft(board, depth) {
  if (depth === 0) return 1;
  const moves = getAllLegalMoves(board, board.turn);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    const record = board.moveInPlace(move.pieceId, move.x, move.y);
    const turnBefore = board.turn;
    board.turn = turnBefore === SIDES.RED ? SIDES.BLACK : SIDES.RED;
    nodes += perft(board, depth - 1);
    board.turn = turnBefore;
    board.undoMove(record);
  }
  return nodes;
}

test("perft matches standard xiangqi move counts", () => {
  const board = new BoardState();
  assert.equal(perft(board, 1), 44, "开局一步着法应为 44");
  assert.equal(perft(board, 2), 1920, "开局两步着法应为 1920");
  assert.equal(perft(board, 3), 79666, "开局三步着法应为 79666");
  assert.equal(
    board.pieces.length,
    32,
    "perft 不应破坏棋盘(棋子数)"
  );
});
