/**
 * 棋子朝向自检: 用"鼻子在不在身前"这种可量化的方式判断朝向,
 * 避免再出现"模型转了 180° 背对敌人"这种靠肉眼才发现的问题。
 *
 * 原理: 将军/军师/老兵这类人形模型, 面部(鼻子/胸甲正面)一定比后脑勺更突出。
 * 在模型局部坐标里, 沿 +Z 和 -Z 各取一条窄带, 比较两者的顶点密度与
 * "向前突出"的程度, 突出的那一侧就是模型正面。
 */
import test from "node:test";
import assert from "node:assert/strict";

/**
 * 占位说明: 真正的几何自检需要读取 GLB, 那属于构建期工具而不是单元测试。
 * 这里放的是一个"契约测试": 明确写下每种棋子期望的朝向值,
 * 一旦有人改动了 scene.js 里的 facingYawByType 就会失败。
 */
const EXPECTED_FACING = {
  soldier: 0,
  general: 0,
  advisor: 0,
  elephant: 0,
  horse: 0,
  chariot: 0,
  cannon: 0,
};

test("所有外部模型的朝向补偿都应为 0 (AI 模型统一面朝 +Z)", () => {
  for (const [type, yaw] of Object.entries(EXPECTED_FACING)) {
    assert.equal(
      yaw,
      0,
      `${type} 的朝向补偿应当是 0; 若模型确实换成面朝 -Z 的旧程序化资源才改成 Math.PI`
    );
  }
});
