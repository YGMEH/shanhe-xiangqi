import {
  PIECE_TYPES,
  PIECE_VALUES,
  SIDES,
  crossedRiver,
  oppositeSide,
} from "./constants.js";
import { getAllLegalMoves } from "./rules.js";

const CENTRAL_BONUS = [
  [0, 1, 2, 3, 3, 3, 2, 1, 0],
  [1, 2, 4, 5, 5, 5, 4, 2, 1],
  [2, 4, 6, 8, 8, 8, 6, 4, 2],
  [3, 5, 7, 10, 10, 10, 7, 5, 3],
  [4, 6, 8, 12, 14, 12, 8, 6, 4],
  [4, 6, 8, 12, 14, 12, 8, 6, 4],
  [3, 5, 7, 10, 10, 10, 7, 5, 3],
  [2, 4, 6, 8, 8, 8, 6, 4, 2],
  [1, 2, 4, 5, 5, 5, 4, 2, 1],
  [0, 1, 2, 3, 3, 3, 2, 1, 0],
];

const PIECE_POSITION = {
  [PIECE_TYPES.HORSE]: [
    [0, 2, 4, 4, 4, 4, 4, 2, 0],
    [2, 4, 6, 8, 8, 8, 6, 4, 2],
    [4, 6, 8, 10, 12, 10, 8, 6, 4],
    [4, 8, 12, 14, 16, 14, 12, 8, 4],
    [6, 10, 14, 18, 20, 18, 14, 10, 6],
    [6, 10, 14, 18, 20, 18, 14, 10, 6],
    [4, 8, 12, 14, 16, 14, 12, 8, 4],
    [4, 6, 8, 10, 12, 10, 8, 6, 4],
    [2, 4, 6, 8, 8, 8, 6, 4, 2],
    [0, 2, 4, 4, 4, 4, 4, 2, 0],
  ],
  [PIECE_TYPES.CANNON]: [
    [2, 2, 3, 5, 5, 5, 3, 2, 2],
    [2, 4, 6, 8, 8, 8, 6, 4, 2],
    [4, 6, 8, 10, 11, 10, 8, 6, 4],
    [6, 8, 10, 12, 13, 12, 10, 8, 6],
    [8, 10, 12, 14, 15, 14, 12, 10, 8],
    [8, 10, 12, 14, 15, 14, 12, 10, 8],
    [6, 8, 10, 12, 13, 12, 10, 8, 6],
    [4, 6, 8, 10, 11, 10, 8, 6, 4],
    [2, 4, 6, 8, 8, 8, 6, 4, 2],
    [2, 2, 3, 5, 5, 5, 3, 2, 2],
  ],
  [PIECE_TYPES.SOLDIER]: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 4, 6, 8, 10, 8, 6, 4, 4],
    [8, 10, 12, 14, 16, 14, 12, 10, 8],
    [10, 12, 14, 18, 22, 18, 14, 12, 10],
    [14, 16, 18, 20, 24, 20, 18, 16, 14],
    [18, 20, 22, 24, 26, 24, 22, 20, 18],
    [20, 22, 24, 26, 30, 26, 24, 22, 20],
  ],
};

export function chooseAiMove(state, side, difficulty = 2) {
  const moves = getAllLegalMoves(state, side);
  if (!moves.length) return null;

  const maxDepth = difficulty >= 3 ? 4 : difficulty >= 2 ? 3 : 2;
  const timeBudget = difficulty >= 3 ? 1050 : difficulty >= 2 ? 520 : 160;
  const noise = difficulty >= 2 ? 0 : 22;
  const ordered = [...moves].sort(
    (a, b) => scoreMoveShallow(state, b, side) - scoreMoveShallow(state, a, side)
  );
  const deadline = performance.now() + timeBudget;
  let best = ordered[0];
  let bestScore = -Infinity;
  const search = { nodes: 0, deadline };

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    try {
      const result = searchRoot(state, side, ordered, depth, search, noise);
      best = result.move;
      bestScore = result.score;
      if (Math.abs(bestScore) > 800000) break;
    } catch (error) {
      if (!(error instanceof SearchTimeout)) throw error;
      break;
    }
  }

  return best;
}

function searchRoot(state, side, ordered, depth, search, noise) {
  let best = ordered[0];
  let bestScore = -Infinity;
  const alphaWindow = depth >= 3 ? -Infinity : -180;

  for (const move of ordered) {
    checkSearchDeadline(search);
    const record = state.moveInPlace(move.pieceId, move.x, move.y);
    // 记录进入这一步之前的真实回合, 还原时要用它, 不能硬写回 side ——
    // 调用方传入的 state.turn 未必等于正在搜索的一方。
    const turnBefore = state.turn;
    state.turn = oppositeSide(side);
    // 搜索超时是抛异常退出的。以前这里直接让 SearchTimeout 冒出去,
    // undoMove 被跳过, 棋盘被永久留在搜索的中间状态:
    // 之后 AI 自己的着法会被 isMoveLegal 判为非法(提示"该落点不符合行棋规则"),
    // 玩家一方的点击也会因为 turn/棋子坐标错乱而全部失效。
    // 用 try/finally 保证无论正常返回还是超时中断, 都把这一步还原干净。
    let searchScore;
    try {
      searchScore = -negamax(
        state,
        depth - 1,
        -Infinity,
        -alphaWindow,
        oppositeSide(side),
        1,
        search
      );
    } finally {
      state.turn = turnBefore;
      state.undoMove(record);
    }
    const score =
      searchScore +
      scoreMoveShallow(state, move, side) * 0.08 +
      (noise ? (Math.random() - 0.5) * noise : 0);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  return { move: best, score: bestScore };
}

export function reviewPosition(state, side) {
  const moves = getAllLegalMoves(state, side);
  if (!moves.length) return { score: -Infinity, bestMove: null, moves: [] };
  const scored = moves
    .map((move) => {
      const record = state.moveInPlace(move.pieceId, move.x, move.y);
      const turnBefore = state.turn;
      state.turn = oppositeSide(side);
      let score;
      try {
        score = -evaluate(state, oppositeSide(side)) * 0.08;
      } finally {
        state.turn = turnBefore;
        state.undoMove(record);
      }
      return {
        move,
        score: score + scoreMoveShallow(state, move, side),
      };
    })
    .sort((a, b) => b.score - a.score);
  return {
    score: scored[0].score,
    bestMove: scored[0].move,
    moves: scored.slice(0, 3),
  };
}

function negamax(state, depth, alpha, beta, side, ply, search) {
  checkSearchDeadline(search);
  search.nodes += 1;
  const statusMoves = getAllLegalMoves(state, side);
  if (!statusMoves.length) {
    return -900000 + ply * 1000;
  }
  if (depth <= 0) {
    return evaluate(state, side);
  }

  let best = -Infinity;
  const ordered = [...statusMoves].sort(
    (a, b) => scoreMoveShallow(state, b, side) - scoreMoveShallow(state, a, side)
  );

  for (const move of ordered.slice(0, depth >= 2 ? 24 : 16)) {
    const record = state.moveInPlace(move.pieceId, move.x, move.y);
    const turnBefore = state.turn;
    state.turn = oppositeSide(side);
    // 同 searchRoot: 超时必须走 finally 还原, 否则棋盘会被搜索污染。
    let score;
    try {
      score = -negamax(
        state,
        depth - 1,
        -beta,
        -alpha,
        oppositeSide(side),
        ply + 1,
        search
      );
    } finally {
      state.turn = turnBefore;
      state.undoMove(record);
    }
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }

  return best;
}

class SearchTimeout extends Error {}

function checkSearchDeadline(search) {
  if ((search.nodes & 127) !== 0) return;
  if (performance.now() > search.deadline) throw new SearchTimeout();
}

function scoreMoveShallow(state, move, side) {
  let score = 0;
  const captured = move.captured;
  if (captured) score += PIECE_VALUES[captured.type] * 1.35;
  if (captured?.type === PIECE_TYPES.GENERAL) score += 1000000;
  const fromCentral =
    CENTRAL_BONUS[Math.max(0, Math.min(9, 9 - move.piece.y))]?.[move.x] ?? 0;
  const toCentral =
    CENTRAL_BONUS[Math.max(0, Math.min(9, 9 - move.y))]?.[move.x] ?? 0;
  score += toCentral - fromCentral;
  if (move.kind === "cannon") score += 45;
  if (move.kind === "horse") score += 30;
  if (move.kind === "chariot") score += 18;
  if (crossedRiver(move.y, side)) score += 24;
  return score;
}

export function evaluate(state, perspective) {
  const score = materialScore(state, perspective);
  const mobility = getAllLegalMoves(state, perspective).length * 0.8;
  return score + mobility;
}

function materialScore(state, perspective) {
  let score = 0;
  for (const piece of state.pieces) {
    const sign = piece.side === perspective ? 1 : -1;
    const table = PIECE_POSITION[piece.type];
    // 位置表是按红方视角编写的(红方底线在 y=9, 表中第一行对应红方底线)。
    // 黑方必须沿河镜像, 否则黑兵的"向前推进"会被当成后退而扣分 ——
    // 实测 AI 会把过河卒往回开, 也会让黑方车马炮往自家底线缩。
    const row = piece.side === SIDES.RED ? 9 - piece.y : piece.y;
    const safeRow = Math.max(0, Math.min(9, row));
    const safeX = Math.max(0, Math.min(8, piece.x));
    const positional = table
      ? table[safeRow][safeX]
      : CENTRAL_BONUS[safeRow][safeX];
    score += sign * (PIECE_VALUES[piece.type] + positional * 0.65);
  }
  return score;
}
