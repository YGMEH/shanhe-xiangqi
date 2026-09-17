import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  PIECE_TYPES,
  SIDES,
  inBoard,
  keyOf,
} from "./constants.js";

export function createInitialBoard() {
  const pieces = [];
  const backRank = [
    PIECE_TYPES.CHARIOT,
    PIECE_TYPES.HORSE,
    PIECE_TYPES.ELEPHANT,
    PIECE_TYPES.ADVISOR,
    PIECE_TYPES.GENERAL,
    PIECE_TYPES.ADVISOR,
    PIECE_TYPES.ELEPHANT,
    PIECE_TYPES.HORSE,
    PIECE_TYPES.CHARIOT,
  ];

  backRank.forEach((type, x) => {
    pieces.push(createPiece(type, SIDES.BLACK, x, 0));
  });
  pieces.push(createPiece(PIECE_TYPES.CANNON, SIDES.BLACK, 1, 2));
  pieces.push(createPiece(PIECE_TYPES.CANNON, SIDES.BLACK, 7, 2));
  [0, 2, 4, 6, 8].forEach((x) => {
    pieces.push(createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, x, 3));
  });

  backRank.forEach((type, x) => {
    pieces.push(createPiece(type, SIDES.RED, x, 9));
  });
  pieces.push(createPiece(PIECE_TYPES.CANNON, SIDES.RED, 1, 7));
  pieces.push(createPiece(PIECE_TYPES.CANNON, SIDES.RED, 7, 7));
  [0, 2, 4, 6, 8].forEach((x) => {
    pieces.push(createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, x, 6));
  });

  return pieces;
}

export function createPiece(type, side, x, y, extra = {}) {
  return {
    id: `${side}-${type}-${x}-${y}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    side,
    x,
    y,
    ...extra,
  };
}

const pieceKey = (piece) => `${piece.side[0]}${piece.type[0]}${piece.x}${piece.y}`;

export function clonePieces(pieces) {
  return pieces.map((piece) => ({ ...piece }));
}

export class BoardState {
  constructor(pieces = createInitialBoard(), turn = SIDES.RED, history = []) {
    this.pieces = pieces.map((piece) => ({ ...piece }));
    this.turn = turn;
    this.history = history;
  }

  clone() {
    return new BoardState(clonePieces(this.pieces), this.turn, this.history);
  }

  pieceAt(x, y) {
    return this.pieces.find((piece) => piece.x === x && piece.y === y) ?? null;
  }

  pieceById(id) {
    return this.pieces.find((piece) => piece.id === id) ?? null;
  }

  alive(side) {
    return this.pieces.filter((piece) => piece.side === side);
  }

  general(side) {
    return this.pieces.find(
      (piece) => piece.side === side && piece.type === PIECE_TYPES.GENERAL
    ) ?? null;
  }

  occupiedKeys() {
    return new Set(this.pieces.map((piece) => keyOf(piece.x, piece.y)));
  }

  serialize() {
    return this.pieces.map(({ id, type, side, x, y }) => ({
      id,
      type,
      side,
      x,
      y,
    }));
  }

  move(pieceId, toX, toY, captured = null) {
    const piece = this.pieceById(pieceId);
    if (!piece || !inBoard(toX, toY)) return null;

    const target = captured ?? this.pieceAt(toX, toY);
    const fromX = piece.x;
    const fromY = piece.y;
    if (target) {
      const index = this.pieces.indexOf(target);
      if (index >= 0) this.pieces.splice(index, 1);
    }
    piece.x = toX;
    piece.y = toY;
    return { piece, fromX, fromY, toX, toY, captured: target ? { ...target } : null };
  }

  /**
   * Fast move used by the search tree. It records enough state to be undone
   * without cloning the whole board on every node.
   */
  moveInPlace(pieceId, toX, toY) {
    const piece = this.pieceById(pieceId);
    if (!piece || !inBoard(toX, toY)) return null;
    const fromX = piece.x;
    const fromY = piece.y;
    const targetIndex = this.pieces.findIndex(
      (candidate) =>
        candidate !== piece && candidate.x === toX && candidate.y === toY
    );
    const captured = targetIndex >= 0 ? this.pieces[targetIndex] : null;
    if (captured) this.pieces.splice(targetIndex, 1);
    piece.x = toX;
    piece.y = toY;
    return { piece, captured, fromX, fromY };
  }

  undoMove(record) {
    if (!record) return;
    record.piece.x = record.fromX;
    record.piece.y = record.fromY;
    if (record.captured) this.pieces.push(record.captured);
  }
}

export function positionKey(pieces, turn) {
  const board = pieces
    .map((piece) => `${piece.side[0]}${piece.type[0]}${piece.x}${piece.y}`)
    .sort()
    .join("|");
  return `${turn}:${board}`;
}

export function boardToMap(pieces) {
  const map = new Map();
  pieces.forEach((piece) => map.set(keyOf(piece.x, piece.y), piece));
  return map;
}
