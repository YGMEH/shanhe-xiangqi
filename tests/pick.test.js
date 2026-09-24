import test from "node:test";
import assert from "node:assert/strict";
import {
  nearestNodeOnScreen,
  resolveSquarePick,
  squareKey,
} from "../src/render/pick.js";

/**
 * 拾取层回归。背景: 立体棋子(旗杆/长枪/战车)会盖住相邻交叉点, 玩家点一个
 * 合法落点, 3D 射线却打到前排棋子, 引擎报"该落点不符合行棋规则"。这里钉住
 * 两条线索(射线命中 vs 屏幕最近交叉点)的裁决规则。
 */

const A = { x: 4, y: 4 };
const B = { x: 4, y: 3 }; // 相邻的前排格, 常被高模型遮挡

test("squareKey is stable and distinct per square", () => {
  assert.equal(squareKey(4, 4), "4,4");
  assert.notEqual(squareKey(12, 1), squareKey(1, 21));
});

test("aimIsLegal beats ray: 点被遮挡的合法落点不被判成前排棋子", () => {
  const pick = resolveSquarePick({
    raySquare: B,
    aimSquare: A,
    aimRatio: 0.9,
    rayRatio: 1.6,
    legalTargets: new Set([squareKey(A.x, A.y)]),
    aimedPieceSide: null,
    turnSide: "red",
  });
  assert.deepEqual(pick, A, "合法落点优先级最高");
});

test("rayIsLegal beats aim: 点吃子目标本体时不被投影带偏", () => {
  const pick = resolveSquarePick({
    raySquare: B,
    aimSquare: A,
    aimRatio: 0.4,
    rayRatio: 1.1,
    legalTargets: new Set([squareKey(B.x, B.y)]),
    aimedPieceSide: null,
    turnSide: "red",
  });
  assert.deepEqual(pick, B, "被吃目标本体应胜出");
});

test("clicking piece body selects the ray-hit piece", () => {
  const pick = resolveSquarePick({
    raySquare: B,
    aimSquare: A,
    aimRatio: 0.2,
    rayRatio: 0.5,
    legalTargets: null,
    aimedPieceSide: null,
    turnSide: "red",
  });
  assert.deepEqual(pick, B, "射线明确落在棋子身上时用射线");
});

test("clicking nearly dead-center of a node uses the projected node", () => {
  const pick = resolveSquarePick({
    raySquare: B,
    aimSquare: A,
    aimRatio: 0.12,
    rayRatio: 0.95,
    legalTargets: null,
    aimedPieceSide: null,
    turnSide: "red",
  });
  assert.deepEqual(pick, A, "几乎正中交叉点时以投影为准");
});

test("clicking own piece on the projected node selects that node", () => {
  const pick = resolveSquarePick({
    raySquare: B,
    aimSquare: A,
    aimRatio: 0.7,
    rayRatio: 1.4,
    legalTargets: null,
    aimedPieceSide: "red",
    turnSide: "red",
  });
  assert.deepEqual(pick, A, "站着我方棋子时选它");
});

test("otherwise falls back to what is visibly hit by the ray", () => {
  const pick = resolveSquarePick({
    raySquare: B,
    aimSquare: A,
    aimRatio: 0.7,
    rayRatio: 1.4,
    legalTargets: null,
    aimedPieceSide: "black",
    turnSide: "red",
  });
  assert.deepEqual(pick, B, "所见即所点");
});

test("missing ray or aim degrades gracefully", () => {
  assert.deepEqual(
    resolveSquarePick({ raySquare: null, aimSquare: A }),
    A,
    "射线打空时用投影"
  );
  assert.deepEqual(
    resolveSquarePick({ raySquare: B, aimSquare: null }),
    B,
    "投影缺失时用射线"
  );
  assert.equal(resolveSquarePick({}), null);
  assert.deepEqual(
    resolveSquarePick({ raySquare: A, aimSquare: { x: A.x, y: A.y } }),
    A,
    "两条线索一致时直接返回"
  );
});

test("nearestNodeOnScreen finds the closest visible node and local spacing", () => {
  const projection = [
    { x: 0, y: 0, px: 0, py: 0, behind: false },
    { x: 1, y: 0, px: 40, py: 0, behind: false },
    { x: 2, y: 0, px: 80, py: 0, behind: false },
    { x: 9, y: 9, px: 500, py: 500, behind: true },
  ];
  const near = nearestNodeOnScreen(projection, 44, 6);
  assert.equal(near.square.x, 1);
  assert.equal(near.square.y, 0);
  assert.equal(near.distance, Math.hypot(4, 6));
  assert.equal(near.spacing, 40);
  assert.ok(Math.abs(near.reach - 26.4) < 1e-9, `reach 应为 spacing*0.66, 实际 ${near.reach}`);
});

test("nearestNodeOnScreen ignores nodes behind the camera", () => {
  const projection = [
    { x: 0, y: 0, px: 0, py: 0, behind: true },
    { x: 1, y: 1, px: 200, py: 200, behind: false },
  ];
  const near = nearestNodeOnScreen(projection, 0, 0);
  assert.equal(near.square.x, 1);
  assert.equal(near.square.y, 1);
});

test("nearestNodeOnScreen returns null when nothing is visible", () => {
  assert.equal(nearestNodeOnScreen([], 0, 0), null);
  assert.equal(
    nearestNodeOnScreen([{ x: 0, y: 0, px: 0, py: 0, behind: true }], 0, 0),
    null
  );
});
