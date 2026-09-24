import test from "node:test";
import assert from "node:assert/strict";
import { BoardState, createPiece, positionKey } from "../src/game/board.js";
import { PIECE_TYPES, SIDES } from "../src/game/constants.js";
import {
  getAllLegalMoves,
  getLegalMoves,
  gameStatus,
  isInCheck,
} from "../src/game/rules.js";

function order(state) {
  return state.pieces.map((piece) => piece.id).join(",");
}

function snapshot(state) {
  return {
    order: order(state),
    key: state.pieces.map((p) => `${p.id}@${p.x},${p.y}`).sort().join("|"),
    turn: state.turn,
  };
}

/**
 * 回归: 规则查询内部用 moveInPlace + undoMove 做试走。旧实现把被吃的子
 * push 回数组末尾, 于是"查询一次规则"就会改变 state.pieces 的顺序。
 * getAllLegalMoves 是按 pieces 顺序枚举的, 所以同一局面下重复查询会给出
 * 不同的候选序 -> AI 的排序/择优随之漂移(AI 走出坏棋、难度手感不稳定)。
 */
test("undoMove restores a captured piece to its original index", () => {
  const chariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 5);
  const victim = createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 0, 4);
  const state = new BoardState(
    [
      createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
      createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
      chariot,
      victim,
      createPiece(PIECE_TYPES.HORSE, SIDES.BLACK, 8, 4),
    ],
    SIDES.RED
  );
  const before = order(state);

  const record = state.moveInPlace(chariot.id, 0, 4);
  assert.ok(record, "吃子试走应成功");
  assert.equal(state.pieces.length, 4, "被吃的子应暂时离场");
  state.undoMove(record);

  assert.equal(order(state), before, "悔棋后棋子顺序必须与查询前完全一致");
  assert.equal(state.pieces.length, 5);
  assert.equal(state.pieceById(victim.id).x, 0);
  assert.equal(state.pieceById(victim.id).y, 4);
});

test("move removes a captured piece passed as a deserialized copy", () => {
  const chariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 1);
  const victim = createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 0, 0);
  const state = new BoardState([
    chariot,
    victim,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  const record = state.move(chariot.id, 0, 0, { ...victim });
  assert.ok(record);
  assert.equal(state.pieceById(victim.id), null);
  assert.equal(state.pieceById(chariot.id).y, 0);
});

test("legal-move queries do not mutate piece order or turn", () => {
  const state = new BoardState();
  const start = snapshot(state);

  for (let i = 0; i < 6; i += 1) {
    for (const piece of state.pieces) getLegalMoves(state, piece);
    getAllLegalMoves(state, state.turn);
    getAllLegalMoves(state, state.turn === SIDES.RED ? SIDES.BLACK : SIDES.RED);
    isInCheck(state, state.turn);
    gameStatus(state);
    assert.deepEqual(snapshot(state), start, `第 ${i} 轮查询后局面必须原样`);
  }
});

test("repeated queries return identical move sets (order deterministic)", () => {
  const state = new BoardState();
  // 先做一个吃子, 制造 pieces 数组顺序"敏感"的局面
  state.moveInPlace(
    state.pieces.find((p) => p.type === PIECE_TYPES.CANNON && p.side === SIDES.RED).id,
    4,
    4
  );
  const first = getAllLegalMoves(state, SIDES.RED)
    .map((m) => `${m.pieceId}->${m.x},${m.y}`)
    .join("|");
  for (let i = 0; i < 5; i += 1) {
    getAllLegalMoves(state, SIDES.RED);
    gameStatus(state);
  }
  const again = getAllLegalMoves(state, SIDES.RED)
    .map((m) => `${m.pieceId}->${m.x},${m.y}`)
    .join("|");
  assert.equal(again, first, "同一局面的合法着法序列必须完全可复现");
});

/**
 * 回归: 旧 positionKey 只取 type 前两个字符(如 "Cha"/"Ca"), 结果
 * 车/炮、兵/仕 等不同兵种会生成相同 key, 被三次重复局面判定为和棋。
 * key 必须对棋子种类一一对应。
 */
test("positionKey does not collide across different piece types", () => {
  const base = [
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ];
  const chariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 5);
  const cannon = createPiece(PIECE_TYPES.CANNON, SIDES.RED, 0, 5);
  const soldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 2, 5);
  const advisor = createPiece(PIECE_TYPES.ADVISOR, SIDES.RED, 2, 5);

  const pairKeys = (a, b) => [
    positionKey([...base, a], SIDES.RED),
    positionKey([...base, b], SIDES.RED),
  ];

  const [kChariot, kCannon] = pairKeys(chariot, cannon);
  assert.notEqual(kChariot, kCannon, "车与炮不能碰撞");

  const [kSoldier, kAdvisor] = pairKeys(soldier, advisor);
  assert.notEqual(kSoldier, kAdvisor, "兵与仕不能碰撞");
});

test("positionKey is order independent and turn sensitive", () => {
  const pieces = [
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
    createPiece(PIECE_TYPES.HORSE, SIDES.RED, 1, 9),
  ];
  const shuffled = [pieces[2], pieces[0], pieces[1]];
  assert.equal(
    positionKey(pieces, SIDES.RED),
    positionKey(shuffled, SIDES.RED),
    "棋子数组顺序不应影响局面 key"
  );
  assert.notEqual(
    positionKey(pieces, SIDES.RED),
    positionKey(pieces, SIDES.BLACK),
    "行棋方是局面的一部分"
  );
});
