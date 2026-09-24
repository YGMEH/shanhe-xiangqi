/**
 * 拾取解析: 把"3D 射线打到的棋子"和"屏幕投影最近的交叉点"两条互相矛盾的
 * 线索, 按棋局语义合并成一个格点。
 *
 * 为什么需要它: 立体棋子(尤其长枪/旗杆/战车)会投影到相邻交叉点上。实测
 * 1440x900 初始局面下, 90 个交叉点里有 20 个"点空格却打到前排棋子"——玩家
 * 点合法落点, 引擎收到的却是前排那一子, 于是弹"该落点不符合行棋规则"。
 * 反向也成立: 点棋子身体时它的投影会盖住身后交叉点, 只看投影会选错子。
 *
 * 判据(从强到弱):
 *   1. 该点正是当前选中棋子的合法落点 -> 就是它(直接消灭上述报错)。
 *   2. 点击离射线命中棋子自己的交叉点很近(按局部格距归一化) -> 玩家在点
 *      这枚棋子, 就用它。
 *   3. 点击几乎正中某个交叉点 -> 就是那个交叉点。
 *   4. 该交叉点上有可以选中的我方棋子 -> 就是它。
 *   5. 其余情况以"看得见的遮挡物为准", 返回射线命中的棋子(所见即所点)。
 */

/** 点击到自己棋子身上的判定阈值(点击点到该子交叉点的距离 / 局部格距)。 */
const PIECE_BODY_RATIO = 0.85;
/** 认为玩家"正中某个交叉点"的判定阈值。 */
const NODE_CENTER_RATIO = 0.3;

export function squareKey(x, y) {
  return `${x},${y}`;
}

/**
 * 在已缓存的屏幕投影里找离指针最近的交叉点, 并给出局部格距,
 * 供调用方按"点击到交叉点的距离 / 局部格距"判断点击意图。
 */
export function nearestNodeOnScreen(projection, pointerX, pointerY) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const entry of projection) {
    if (entry.behind) continue;
    const distance = Math.hypot(entry.px - pointerX, entry.py - pointerY);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = entry;
    }
  }
  if (!nearest) return null;

  let spacing = Infinity;
  for (const entry of projection) {
    if (entry.behind || entry === nearest) continue;
    const distance = Math.hypot(entry.px - nearest.px, entry.py - nearest.py);
    if (distance > 1 && distance < spacing) spacing = distance;
  }

  return {
    entry: nearest,
    square: { x: nearest.x, y: nearest.y },
    distance: nearestDistance,
    spacing,
    // 超出这个半径就认为玩家没在点任何交叉点(沿用旧的兜底半径)。
    reach: Number.isFinite(spacing) ? Math.max(24, spacing * 0.66) : 48,
  };
}

/**
 * 纯函数, 便于单测。
 *
 * @param {object}  args
 * @param {?object} args.raySquare   3D 射线命中的棋子所在格
 * @param {?object} args.aimSquare   屏幕投影最近的交叉点
 * @param {number}  args.aimRatio    点击到 aimSquare 的距离 / 局部格距
 * @param {number}  args.rayRatio    点击到 raySquare 的距离 / 局部格距
 * @param {?Set}    args.legalTargets 当前选中棋子的合法落点集合("x,y")
 * @param {?string} args.aimedPieceSide aimSquare 上棋子的阵营(没有棋子则 null)
 * @param {?string} args.turnSide    当前行棋方
 */
export function resolveSquarePick({
  raySquare = null,
  aimSquare = null,
  aimRatio = Infinity,
  rayRatio = Infinity,
  legalTargets = null,
  aimedPieceSide = null,
  turnSide = null,
} = {}) {
  if (!raySquare) return aimSquare ?? null;
  if (!aimSquare) return raySquare;
  if (aimSquare.x === raySquare.x && aimSquare.y === raySquare.y) return raySquare;

  const aimKey = squareKey(aimSquare.x, aimSquare.y);

  const rayKey = squareKey(raySquare.x, raySquare.y);
  const aimIsLegal = Boolean(legalTargets?.has?.(aimKey));
  const rayIsLegal = Boolean(legalTargets?.has?.(rayKey));

  // 1) 语义仲裁(最可靠): 玩家点的是合法落点, 但被前排高模型挡住 -> 按合法落点走。
  //    这是"规则内走法被报不合规"的直接修复点。
  if (aimIsLegal && !rayIsLegal) return aimSquare;
  //    反向: 点的是要吃的目标子本体 -> 就用它。
  if (rayIsLegal && !aimIsLegal) return raySquare;

  // 2) 点击明确落在射线命中棋子身上: 就是这枚棋子。
  if (Number.isFinite(rayRatio) && rayRatio < PIECE_BODY_RATIO) return raySquare;

  // 3) 点击几乎正中某个交叉点: 就是那个交叉点。
  if (Number.isFinite(aimRatio) && aimRatio <= NODE_CENTER_RATIO) return aimSquare;

  // 4) 该交叉点上站着一枚"己方可选中"的棋子: 玩家是在点它。
  if (aimedPieceSide && turnSide && aimedPieceSide === turnSide) return aimSquare;
  // 5) 兜底: 以看得见的遮挡物为准(所见即所点)。
  return raySquare;
}
