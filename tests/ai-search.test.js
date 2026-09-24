import test from "node:test";
import assert from "node:assert/strict";
import { BoardState, createPiece } from "../src/game/board.js";
import { PIECE_TYPES, SIDES } from "../src/game/constants.js";
import { chooseAiMove, evaluate, reviewPosition } from "../src/game/ai.js";
import { isMoveLegal } from "../src/game/rules.js";

function key(state) {
  return state.pieces
    .map((piece) => `${piece.id}@${piece.x},${piece.y}`)
    .sort()
    .join("|");
}

/**
 * 回归测试: chooseAiMove 用 moveInPlace 做同类搜索, 超时是靠抛 SearchTimeout
 * 退出的。早先的实现没有 try/finally, 抛异常时 state.undoMove 被跳过,
 * 调用方的棋盘会被永久污染 —— 表现就是 AI 走完一步后局面错乱,
 * 玩家任何"合法"走法都被 isMoveLegal 判为非法(提示"该落点不符合行棋规则"),
 * 而且回合会卡在同一方。
 */
for (const difficulty of [1, 2, 3]) {
  test(`AI search at difficulty ${difficulty} leaves the board untouched`, () => {
    const board = new BoardState();
    const before = key(board);
    const turnBefore = board.turn;
    const countBefore = board.pieces.length;

    const move = chooseAiMove(board, SIDES.BLACK, difficulty);

    assert.equal(key(board), before, "棋子坐标/身份必须原样恢复");
    assert.equal(board.turn, turnBefore, "回合必须原样恢复");
    assert.equal(board.pieces.length, countBefore, "不能多出或少掉棋子");
    assert.ok(move, "必须有一步可走的着法");
    assert.ok(
      isMoveLegal(board, move.pieceId, move.x, move.y, { requireTurn: false }),
      "AI 返回的着法本身必须是合法着法"
    );
    assert.equal(
      board.pieceById(move.pieceId).side,
      SIDES.BLACK,
      "黑方搜索不能选出红方的棋子"
    );
  });
}

test("AI moves are stable and legal across a full self-play sequence", () => {
  const board = new BoardState();
  for (let ply = 0; ply < 12; ply += 1) {
    const side = board.turn;
    const before = key(board);
    const move = chooseAiMove(board, side, 2);
    assert.ok(move, "自对弈到第 " + ply + " 手仍应有合法着法");
    assert.equal(key(board), before, "第 " + ply + " 手搜索后棋盘不应被污染");
    assert.equal(board.turn, side, "第 " + ply + " 手搜索后回合不应被改写");
    assert.ok(
      isMoveLegal(board, move.pieceId, move.x, move.y),
      "第 " + ply + " 手必须是当前行棋方的合法着法"
    );
    const record = board.moveInPlace(move.pieceId, move.x, move.y);
    assert.ok(record, "落子应成功");
    board.turn = side === SIDES.RED ? SIDES.BLACK : SIDES.RED;
  }
});

test("reviewPosition does not corrupt the board", () => {
  const board = new BoardState();
  const before = key(board);
  const turnBefore = board.turn;
  reviewPosition(board, SIDES.RED);
  assert.equal(key(board), before);
  assert.equal(board.turn, turnBefore);
});

/**
 * 回归: 兵种位置表是按红方视角写的(红方底线在 y=9, 表中第一行对应底线)。
 * 旧实现直接拿 9 - piece.y 去查黑方棋子, 等于把黑方的前进当成后退 ——
 * 实测黑方"过河卒往前走"会被扣 5.5 分, 于是 AI 把卒往回开、车马炮往
 * 自家底线缩。黑方必须沿河镜像后再查表。
 */
test("black positional table is mirrored: advancing is never penalised", () => {
  const score = (y) => {
    const board = new BoardState(
      [
        createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 3, 9),
        createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 5, 0),
        createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 4, y),
      ],
      SIDES.BLACK
    );
    return evaluate(board, SIDES.BLACK);
  };
  for (let y = 0; y < 8; y += 1) {
    assert.ok(
      score(y + 1) >= score(y) - 1e-9,
      `黑卒从 y=${y} 推进到 y=${y + 1} 不应降低评估 (${score(y)} -> ${score(y + 1)})`
    );
  }

  const redScore = (y) => {
    const board = new BoardState(
      [
        createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 3, 9),
        createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 5, 0),
        createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 4, y),
      ],
      SIDES.RED
    );
    return evaluate(board, SIDES.RED);
  };
  for (let y = 9; y > 1; y -= 1) {
    assert.ok(
      redScore(y - 1) >= redScore(y) - 1e-9,
      `红兵从 y=${y} 推进到 y=${y - 1} 不应降低评估`
    );
  }
});

test("mirrored positions evaluate equally for both sides", () => {
  const board = (side) => {
    const own = side === SIDES.RED ? "red" : "black";
    const enemy = side === SIDES.RED ? "black" : "red";
    const mirror = side === SIDES.RED ? (y) => y : (y) => 9 - y;
    const enemyMirror = side === SIDES.RED ? (y) => 9 - y : (y) => y;
    return new BoardState(
      [
        createPiece(PIECE_TYPES.GENERAL, own, 4, mirror(9)),
        createPiece(PIECE_TYPES.GENERAL, enemy, 4, enemyMirror(0)),
        createPiece(PIECE_TYPES.HORSE, own, 1, mirror(9)),
        createPiece(PIECE_TYPES.CANNON, enemy, 7, enemyMirror(2)),
      ],
      side
    );
  };
  const red = evaluate(board(SIDES.RED), SIDES.RED);
  const black = evaluate(board(SIDES.BLACK), SIDES.BLACK);
  assert.ok(
    Math.abs(red - black) < 30,
    `镜像局面的评估应基本对称, 实际红=${red.toFixed(1)} 黑=${black.toFixed(1)}`
  );
});
