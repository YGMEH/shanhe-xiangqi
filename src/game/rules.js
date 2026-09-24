import {
  PIECE_TYPES,
  SIDES,
  inBoard,
  isRed,
  keyOf,
  oppositeSide,
  ownHalf,
} from "./constants.js";
import { positionKey } from "./board.js";

const ORTHOGONAL_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 标准象棋里, 车/炮/兵过河都不受"桥"的限制, 河流只是地形装饰。
 * 之前的实现强制要求站在 BRIDGE_COLUMNS 上才能跨越第 4/5 行,
 * 导致"炮无法跨河""车无法平移"等非标准行为, 已移除。
 * 保留此函数是为了将来若要开启"桥梁规则"变体时可以一键切回。
 */
function canCrossRiver() {
  return true;
}

export function getPseudoMoves(state, piece) {
  const moves = [];
  const add = (x, y, extra = {}) => {
    if (!inBoard(x, y)) return;
    const target = state.pieceAt(x, y);
    if (target?.side === piece.side) return;
    moves.push({ x, y, piece, captured: target ? { ...target } : null, ...extra });
  };

  switch (piece.type) {
    case PIECE_TYPES.GENERAL:
      ORTHOGONAL_DIRECTIONS.forEach(([dx, dy]) => {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (isInPalaceForSide(x, y, piece.side)) add(x, y);
      });
      addFlyingGeneral(state, piece, moves);
      break;

    case PIECE_TYPES.ADVISOR:
      [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].forEach(([dx, dy]) => {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (isInPalaceForSide(x, y, piece.side)) add(x, y);
      });
      break;

    case PIECE_TYPES.ELEPHANT:
      [
        [2, 2],
        [2, -2],
        [-2, 2],
        [-2, -2],
      ].forEach(([dx, dy]) => {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (
          inBoard(x, y) &&
          ownHalf(y, piece.side) &&
          !state.pieceAt(piece.x + dx / 2, piece.y + dy / 2)
        ) {
          add(x, y, { kind: "elephant" });
        }
      });
      break;

    case PIECE_TYPES.HORSE:
      [
        [1, 2, 0, 1],
        [2, 1, 1, 0],
        [2, -1, 1, 0],
        [1, -2, 0, -1],
        [-1, -2, 0, -1],
        [-2, -1, -1, 0],
        [-2, 1, -1, 0],
        [-1, 2, 0, 1],
      ].forEach(([dx, dy, legX, legY]) => {
        if (!state.pieceAt(piece.x + legX, piece.y + legY)) {
          add(piece.x + dx, piece.y + dy, { kind: "horse" });
        }
      });
      break;

    case PIECE_TYPES.CHARIOT:
      for (const [dx, dy] of ORTHOGONAL_DIRECTIONS) {
        let x = piece.x + dx;
        let y = piece.y + dy;
        while (inBoard(x, y)) {
          const target = state.pieceAt(x, y);
          if (target?.side === piece.side) break;
          if (canCrossRiver(piece, piece.x, piece.y, x, y)) {
            add(x, y, { kind: "chariot" });
          }
          if (target) break;
          x += dx;
          y += dy;
        }
      }
      break;

    case PIECE_TYPES.CANNON:
      for (const [dx, dy] of ORTHOGONAL_DIRECTIONS) {
        let x = piece.x + dx;
        let y = piece.y + dy;
        let screenSeen = false;
        while (inBoard(x, y)) {
          const target = state.pieceAt(x, y);
          if (!screenSeen) {
            if (!target && canCrossRiver(piece, piece.x, piece.y, x, y)) {
              add(x, y);
            } else if (target) {
              screenSeen = true;
            }
          } else if (target) {
            if (target.side !== piece.side) add(x, y, { kind: "cannon" });
            break;
          }
          x += dx;
          y += dy;
        }
      }
      break;

    case PIECE_TYPES.SOLDIER: {
      const forward = piece.side === SIDES.RED ? -1 : 1;
      add(piece.x, piece.y + forward);
      if (
        (piece.side === SIDES.RED && piece.y <= 4) ||
        (piece.side === SIDES.BLACK && piece.y >= 5)
      ) {
        add(piece.x - 1, piece.y);
        add(piece.x + 1, piece.y);
      }
      break;
    }
  }

  // 将帅按规定不能被吃掉, 但残局存档、自定义局面或外部调用仍可能给出
  // 缺少己方将帅的棋盘。这时不能再按常规着法枚举: 否则一个"无路可走"的
  // 残局会被当成无子可动的困毙, 普通棋子也会一本正经地推荐去"吃将"。
  // 直接解析成"将帅已被擒" —— 该方只剩一种可走的着法, 即对方将帅所在格。
  const ownGeneral = state.general(piece.side);
  if (!ownGeneral) {
    return moves.filter((move) => move.captured?.type === PIECE_TYPES.GENERAL);
  }

  return dedupeMoves(moves);
}

function isInPalaceForSide(x, y, side) {
  if (x < 3 || x > 5) return false;
  return isRed(side) ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}

function addFlyingGeneral(state, piece, moves) {
  const enemy = state.general(oppositeSide(piece.side));
  if (!enemy || enemy.x !== piece.x) return;
  const from = Math.min(piece.y, enemy.y) + 1;
  const to = Math.max(piece.y, enemy.y);
  const piecesBetween = state.pieces.filter(
    (candidate) =>
      candidate.x === piece.x && candidate.y >= from && candidate.y < to
  );
  if (piecesBetween.length === 0) {
    moves.push({ x: enemy.x, y: enemy.y, piece, captured: { ...enemy }, flying: true });
  }
}

export function getLegalMoves(state, piece, options = {}) {
  const livePiece = piece?.id ? state.pieceById(piece.id) : null;
  if (!livePiece) return [];
  const avoidCheck = options.avoidCheck !== false;
  const pseudoMoves = getPseudoMoves(state, livePiece);
  if (!avoidCheck) return pseudoMoves;

  const ownGeneral = state.general(livePiece.side);
  if (!ownGeneral) {
    // 己方将帅已经不在棋盘上时, 这盘棋已经结束, 不应再枚举任何着法。
    return [];
  }

  const enemyGeneral = state.general(oppositeSide(livePiece.side));

  return pseudoMoves.filter((move) => {
    // 象棋以"将死"结束, 真正的合法着法不能把棋子走到将帅所在格,
    // 更不能让普通棋子直接吃将。飞将同理: 它是攻击关系, 不是跨整条
    // 棋盘的移动着法。
    if (move.captured?.type === PIECE_TYPES.GENERAL || move.flying) {
      return false;
    }
    const record = state.moveInPlace(livePiece.id, move.x, move.y);
    const inCheck = record ? isInCheck(state, livePiece.side) : true;
    state.undoMove(record);
    return !inCheck;
  });
}

export function simulateMove(state, pieceId, toX, toY) {
  const next = state.clone();
  next.move(pieceId, toX, toY);
  return next;
}

export function withMove(state, pieceId, toX, toY, callback) {
  const record = state.moveInPlace(pieceId, toX, toY);
  if (!record) return undefined;
  try {
    return callback(state);
  } finally {
    state.undoMove(record);
  }
}

export function isInCheck(state, side) {
  const general = state.general(side);
  if (!general) return true;
  const enemySide = oppositeSide(side);
  return state
    .alive(enemySide)
    .some((piece) =>
      getPseudoMoves(state, piece).some(
        (move) => move.x === general.x && move.y === general.y
      )
    );
}

export function hasAnyLegalMove(state, side = state.turn) {
  const clone = state.clone();
  clone.turn = side;
  return clone
    .alive(side)
    .some((piece) => getLegalMoves(clone, piece).length > 0);
}

export function gameStatus(state) {
  const checkedSide = state.turn;
  // 一方将帅已经不在棋盘上(例如残局存档损坏/外部直接调用)时,
  // 比赛其实已经结束了。旧实现会让 hasAnyLegalMove 返回 false,
  // 再把这种局面误报成"困毙", 玩家会看到"敌军已无任何合法着法"
  // 而不是"将帅被擒"。这里先把缺失主帅结算清楚。
  for (const side of [SIDES.RED, SIDES.BLACK]) {
    if (!state.general(side)) {
      return {
        over: true,
        winner: oppositeSide(side),
        reason: "checkmate",
        inCheck: true,
      };
    }
  }
  const inCheck = isInCheck(state, checkedSide);
  if (!hasAnyLegalMove(state, checkedSide)) {
    return {
      over: true,
      winner: oppositeSide(checkedSide),
      reason: inCheck ? "checkmate" : "stalemate",
      inCheck,
    };
  }
  return { over: false, winner: null, reason: inCheck ? "check" : null, inCheck };
}

export function repetitionStatus(state, history = []) {
  if (history.length < 12) return { draw: false, repeats: 0 };
  const currentKey = positionKey(state.pieces, state.turn);
  let repeats = 0;
  for (let i = Math.max(0, history.length - 24); i < history.length; i += 2) {
    const pieces = history[i]?.pieces;
    if (!Array.isArray(pieces)) continue;
    if (positionKey(pieces, state.turn) === currentKey) repeats += 1;
  }
  return { draw: repeats >= 2, repeats };
}

export function getAllLegalMoves(state, side = state.turn) {
  const moves = [];
  state
    .alive(side)
    .forEach((piece) => {
      getLegalMoves(state, piece).forEach((move) => {
        moves.push({ ...move, pieceId: piece.id, side });
      });
    });
  return moves;
}

export function isMoveLegal(
  state,
  pieceId,
  toX,
  toY,
  { requireTurn = true } = {}
) {
  const piece = state.pieceById(pieceId);
  if (!piece) return null;
  if (requireTurn && piece.side !== state.turn) return null;
  return getLegalMoves(state, piece).find(
    (move) => move.x === toX && move.y === toY
  ) ?? null;
}

export function isSquareAttacked(state, x, y, bySide) {
  return state
    .alive(bySide)
    .some((piece) =>
      getPseudoMoves(state, piece).some((move) => move.x === x && move.y === y)
    );
}

export function isGeneralExposed(state, side) {
  const general = state.general(side);
  if (!general) return true;
  const enemy = state.general(oppositeSide(side));
  if (!enemy || enemy.x !== general.x) return false;
  const from = Math.min(general.y, enemy.y) + 1;
  const to = Math.max(general.y, enemy.y);
  return !state.pieces.some(
    (piece) => piece.x === general.x && piece.y >= from && piece.y < to
  );
}

function dedupeMoves(moves) {
  const seen = new Set();
  return moves.filter((move) => {
    const key = keyOf(move.x, move.y);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
