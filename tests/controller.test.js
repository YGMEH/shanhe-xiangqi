import test from "node:test";
import assert from "node:assert/strict";
import { GameController } from "../src/game/controller.js";
import { BoardState, createPiece, positionKey } from "../src/game/board.js";
import { PIECE_TYPES, SIDES } from "../src/game/constants.js";

globalThis.window = {
  setTimeout(callback) {
    queueMicrotask(callback);
    return 1;
  },
  clearTimeout() {},
};

function createHarness({ animateMove, defeatActor } = {}) {
  const toasts = [];
  const scene = {
    actors: new Map(),
    attachGame() {},
    syncBoard() {},
    setSelected() {},
    hideCheck() {},
    showCheck() {},
    playAttack(_piece, _kind, callback) {
      callback?.();
    },
    cannonShot: async () => {},
    animateMove: animateMove ?? (async () => {}),
    killAt() {},
    killFocus() {},
    defeatActor: defeatActor ?? (async () => {}),
  };
  const ui = {
    showToast(message) {
      toasts.push(message);
    },
    renderInspector() {},
    hideInspector() {},
    renderCaptures() {},
    renderHistory() {},
    renderTurn() {},
    showResult() {},
    hideResult() {},
  };
  const audio = new Proxy({}, { get: () => () => {} });
  const controller = new GameController({ scene, ui, audio });
  controller.autoSaveEnabled = false;
  controller.mode = "local";
  return { controller, scene, toasts };
}

function installPosition(controller, pieces, turn = SIDES.RED) {
  controller.state = new BoardState(pieces, turn, []);
  controller.positionKeys = [positionKey(controller.state.pieces, turn)];
}

test("a completed move clears selection and cannot move the same side twice", async () => {
  const { controller } = createHarness();
  const soldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 6);
  installPosition(controller, [
    soldier,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  assert.equal(controller.selectPiece(controller.state.pieceById(soldier.id)), true);
  await controller.squareClicked(0, 5);

  assert.equal(controller.state.turn, SIDES.BLACK);
  assert.equal(controller.selected, null);
  assert.deepEqual(controller.selectedMoves, []);
  assert.equal(controller.state.pieceById(soldier.id).y, 5);

  const movedAgain = await controller.performMove({ pieceId: soldier.id, x: 0, y: 4 });
  assert.equal(movedAgain, false);
  assert.equal(controller.state.pieceById(soldier.id).y, 5);
  assert.equal(controller.moveHistory.length, 1);
});

test("an illegal runtime move does not create history or an undo snapshot", async () => {
  const { controller } = createHarness();
  const soldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 6);
  installPosition(controller, [
    soldier,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  const moved = await controller.performMove({ pieceId: soldier.id, x: 1, y: 6 });
  assert.equal(moved, false);
  assert.equal(controller.undoStack.length, 0);
  assert.equal(controller.moveHistory.length, 0);
  assert.equal(controller.state.turn, SIDES.RED);
});

test("a pre-move animation failure leaves the board and undo stack unchanged", async () => {
  const { controller } = createHarness({
    animateMove: async () => {
      throw new Error("animation failed");
    },
  });
  const soldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 6);
  installPosition(controller, [
    soldier,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  const moved = await controller.performMove({ pieceId: soldier.id, x: 0, y: 5 });
  assert.equal(moved, false);
  assert.equal(controller.state.pieceById(soldier.id).y, 6);
  assert.equal(controller.undoStack.length, 0);
  assert.equal(controller.busy, false);
});

test("configure normalizes scenario pieces that arrive without ids", () => {
  const { controller } = createHarness();
  // 战役/残局剧本只写 type/side/x/y。旧实现原样塞给 BoardState, 全部棋子
  // 共享 undefined id: pieceById 找不到目标、渲染层 actors 互相覆盖,
  // 残局里整盘只剩一枚棋子能点。
  controller.configure({
    mode: "local",
    playerSide: SIDES.RED,
    pieces: [
      { type: PIECE_TYPES.CHARIOT, side: SIDES.RED, x: 0, y: 4 },
      { type: PIECE_TYPES.CHARIOT, side: SIDES.RED, x: 4, y: 1 },
      { type: PIECE_TYPES.GENERAL, side: SIDES.RED, x: 4, y: 9 },
      { type: PIECE_TYPES.GENERAL, side: SIDES.BLACK, x: 4, y: 0 },
    ],
  });

  const ids = controller.state.pieces.map((piece) => piece.id);
  assert.equal(ids.every((id) => typeof id === "string" && id.length > 0), true);
  assert.equal(new Set(ids).size, ids.length, "补发的 id 必须互不相同");
  const chariot = controller.state.pieceAt(0, 4);
  assert.equal(controller.state.pieceById(chariot.id), chariot);
});

test("undo keeps the repetition log consistent after a threefold position", async () => {
  // 回归: 撤销恢复到的是"动手之前"的快照, 但旧实现没有丢弃
  // 动手期间累积的 positionKeys 尾部, 于是同一局面会多记一次,
  // 玩家撤销两次循环后立即被误判"三次相同局面"成和。
  const { controller, toasts } = createHarness();
  const horse = createPiece(PIECE_TYPES.HORSE, SIDES.RED, 1, 9);
  const blackHorse = createPiece(PIECE_TYPES.HORSE, SIDES.BLACK, 1, 0);
  installPosition(controller, [
    horse,
    blackHorse,
    // 将帅不同列, 且黑方 2,2 有兵挡住黑马 1,0 -> 2,2 这一步,
    // 避免走位中途触发"白脸将"而把合法着法全部过滤掉。
    createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 2, 2),
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  const repeatCycle = async () => {
    assert.equal(await controller.performMove({ pieceId: horse.id, x: 2, y: 7 }), true);
    assert.equal(await controller.performMove({ pieceId: blackHorse.id, x: 0, y: 2 }), true);
    assert.equal(await controller.performMove({ pieceId: horse.id, x: 1, y: 9 }), true);
    assert.equal(await controller.performMove({ pieceId: blackHorse.id, x: 1, y: 0 }), true);
  };

  // 两轮完整循环后, 当前局面已经出现 3 次, 判和成立。
  await repeatCycle();
  await repeatCycle();
  assert.equal(controller.gameOver, true);

  // 撤销一步(黑方收马)后, 局面不再是三次重复, 不能继续保持"和局"结论。
  controller.undo();
  assert.equal(controller.gameOver, false);
  const occurrences = controller.positionKeys.filter(
    (key) => key === controller.positionKeys.at(-1)
  ).length;
  assert.equal(occurrences < 3, true);
  assert.equal(toasts.includes("暂无可撤回的行棋"), false);
});

test("a defeat animation failure does not interrupt a completed capture", async () => {
  const { controller } = createHarness({
    defeatActor: async () => {
      throw new Error("defeat animation failed");
    },
  });
  const chariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 1);
  const victim = createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 0, 0);
  installPosition(controller, [
    chariot,
    victim,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  const moved = await controller.performMove({ pieceId: chariot.id, x: 0, y: 0 });
  assert.equal(moved, true);
  assert.equal(controller.state.pieceById(victim.id), null);
  assert.equal(controller.state.pieceById(chariot.id).y, 0);
  assert.equal(controller.state.turn, SIDES.BLACK);
  assert.equal(controller.moveHistory.length, 1);
  assert.equal(controller.undoStack.length, 1);
  assert.equal(controller.busy, false);
});

test("AI execution is ignored when it is no longer the AI side's turn", async () => {
  const { controller } = createHarness();
  controller.mode = "ai";
  controller.playerSide = SIDES.RED;
  controller.aiSide = SIDES.BLACK;
  installPosition(controller, [
    createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 6),
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ], SIDES.RED);

  const moved = await controller.makeAiMove(controller.aiGeneration);
  assert.equal(moved, false);
  assert.equal(controller.moveHistory.length, 0);
  assert.equal(controller.state.turn, SIDES.RED);
});

test("clicking an uncapturable enemy piece reports an illegal move, not a turn error", async () => {
  const { controller, toasts } = createHarness();
  const soldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 6);
  const enemy = createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 4, 4);
  installPosition(controller, [
    soldier,
    enemy,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  controller.selectPiece(controller.state.pieceById(soldier.id));
  assert.ok(controller.selected, "应先选中红兵");
  toasts.length = 0;

  // 红兵走不到 (4,4), 且那枚黑子也不是红方能指挥的。
  await controller.squareClicked(4, 4);

  assert.equal(controller.state.turn, SIDES.RED, "轮次不应改变");
  assert.equal(controller.moveHistory.length, 0);
  assert.equal(controller.selected?.id, soldier.id, "选中项不应被换掉");
  assert.equal(
    toasts.includes("尚未轮到该军行动"),
    false,
    "轮到玩家时不应提示轮次错误"
  );
  assert.ok(
    toasts.includes("该落点不符合行棋规则"),
    `应提示落点非法, 实际: ${JSON.stringify(toasts)}`
  );
});

test("clicking an own piece while selected switches selection", async () => {
  const { controller } = createHarness();
  const a = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 0, 6);
  const b = createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 2, 6);
  installPosition(controller, [
    a,
    b,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  controller.selectPiece(controller.state.pieceById(a.id));
  await controller.squareClicked(2, 6);
  assert.equal(controller.selected?.id, b.id, "点己方另一子应切换选中");
  assert.equal(controller.moveHistory.length, 0);
});

test("captures are credited to the side that made the capture", async () => {
  const { controller } = createHarness();
  const chariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 1);
  const victim = createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 0, 0);
  installPosition(controller, [
    chariot,
    victim,
    createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
    createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
  ]);

  await controller.performMove({ pieceId: chariot.id, x: 0, y: 0 });

  assert.equal(
    controller.captures.red.length,
    1,
    "红方吃掉的子应记在红方名下(红方战利品)"
  );
  assert.equal(controller.captures.black.length, 0);
  assert.equal(controller.captures.red[0].side, SIDES.BLACK);

  // 黑方吃回一子后, 双方战利品应各归其主。
  const blackChariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.BLACK, 0, 9);
  controller.state.pieces.push(blackChariot);
  controller.state.turn = SIDES.BLACK;
  const redVictim = controller.state.pieceById(chariot.id);
  await controller.performMove({
    pieceId: blackChariot.id,
    x: redVictim.x,
    y: redVictim.y,
  });

  assert.equal(controller.captures.red.length, 1, "红方仍持有 1 枚战利品");
  assert.equal(controller.captures.black.length, 1, "黑方应新增 1 枚战利品");
  assert.equal(controller.captures.black[0].side, SIDES.RED);
  assert.equal(redVictim.side, SIDES.RED);
});

test("restoring an old save re-credits captures to the capturing side", () => {
  const { controller } = createHarness();
  const redChariot = createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 0);
  const blackSoldier = createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 0, 3);
  const restored = controller.restore({
    pieces: [
      { ...redChariot },
      createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
      createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 3, 0),
    ],
    turn: SIDES.BLACK,
    playerSide: SIDES.RED,
    aiSide: SIDES.BLACK,
    difficulty: 2,
    mode: "local",
    // 旧存档: 红方吃掉的黑卒被错记到了黑方名下。
    captures: { red: [], black: [{ ...blackSoldier }] },
    history: [
      {
        side: SIDES.RED,
        notation: "车A1至A2",
        captured: { ...blackSoldier },
      },
    ],
  });

  assert.equal(restored, true);
  assert.equal(
    controller.captures.red.length,
    1,
    "旧存档的红方战利品应被迁移回红方"
  );
  assert.equal(controller.captures.black.length, 0);
});
