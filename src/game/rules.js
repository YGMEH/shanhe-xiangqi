import {
  BOARD_COLUMNS,
  BOARD_ROWS,
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

function pathIsClear(state, fromX, fromY, toX, toY) {
  if (fromX === toX) {
    const step = Math.sign(toY - fromY);
    for (let y = fromY + step; y !== toY; y += step) {
      if (state.pieceAt(fromX, y)) return false;
    }
    return true;
  }

  if (fromY === toY) {
    const step = Math.sign(toX - fromX);
    for (let x = fromX + step; x !== toX; x += step) {
      if (state.pieceAt(x, fromY)) return false;
    }
    return true;
  }

  return false;
}

function countBetween(state, fromX, fromY, toX, toY) {
  let count = 0;
  if (fromX === toX) {
    const step = Math.sign(toY - fromY);
    for (let y = fromY + step; y !== toY; y += step) {
      if (state.pieceAt(fromX, y)) count += 1;
    }
    return count;
  }

  const step = Math.sign(toX - fromX);
  for (let x = fromX + step; x !== toX; x += step) {
    if (state.pieceAt(x, fromY)) count += 1;
  }
  return count;
}

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
  const avoidCheck = options.avoidCheck !== false;
  const pseudoMoves = getPseudoMoves(state, piece);
  if (!avoidCheck) return pseudoMoves;

  return pseudoMoves.filter((move) => {
    const record = state.moveInPlace(piece.id, move.x, move.y);
    const inCheck = record ? isInCheck(state, piece.side) : true;
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

export function isMoveLegal(state, pieceId, toX, toY) {
  const piece = state.pieceById(pieceId);
  if (!piece) return null;
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
