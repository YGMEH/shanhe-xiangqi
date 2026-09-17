import {
  PIECE_TYPES,
  PIECE_VALUES,
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
    state.turn = oppositeSide(side);
    const searchScore = -negamax(
      state,
      depth - 1,
      -Infinity,
      -alphaWindow,
      oppositeSide(side),
      1,
      search
    );
    state.turn = side;
    state.undoMove(record);
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
      state.turn = oppositeSide(side);
      const score = -evaluate(state, oppositeSide(side)) * 0.08;
      state.turn = side;
      state.undoMove(record);
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
    state.turn = oppositeSide(side);
    const score = -negamax(
      state,
      depth - 1,
      -beta,
      -alpha,
      oppositeSide(side),
      ply + 1,
      search
    );
    state.turn = side;
    state.undoMove(record);
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
    const positional = table
      ? table[Math.max(0, Math.min(9, 9 - piece.y))][piece.x]
      : CENTRAL_BONUS[Math.max(0, Math.min(9, 9 - piece.y))][piece.x];
    score += sign * (PIECE_VALUES[piece.type] + positional * 0.65);
  }
  return score;
}
