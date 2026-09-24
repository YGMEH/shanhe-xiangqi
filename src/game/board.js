import {
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
    return new BoardState(
      clonePieces(this.pieces),
      this.turn,
      Array.isArray(this.history) ? [...this.history] : []
    );
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

    const requestedTarget = captured ?? this.pieceAt(toX, toY);
    // 调用方可能传入从存档/网络反序列化得到的同 id 副本, 不能用
    // Array#indexOf 依赖对象身份, 否则目标棋子会留在原地而和移动棋子重叠。
    const target = requestedTarget?.id
      ? this.pieceById(requestedTarget.id)
      : requestedTarget;
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
    return { piece, captured, fromX, fromY, capturedIndex: targetIndex };
  }

  undoMove(record) {
    if (!record) return;
    record.piece.x = record.fromX;
    record.piece.y = record.fromY;
    if (record.captured) {
      // 被吃子必须放回它原来的下标, 不能 push 到末尾。
      // 规则查询(isInCheck / getLegalMoves)内部就是 moveInPlace + undoMove,
      // push 会让"哪一方先被枚举"随查询次数漂移; AI 排序和胜负判定都
      // 依赖棋子顺序, 于是同一局面会给出不同推荐着法。
      const index = Number.isInteger(record.capturedIndex)
        ? Math.min(record.capturedIndex, this.pieces.length)
        : this.pieces.length;
      this.pieces.splice(index, 0, record.captured);
    }
  }
}

/**
 * 局面指纹, 用于三次重复判和等按局面比对的逻辑。
 *
 * 之前用 `type[0]` 取首字母, 而 chariot / cannon / chariot 都写作 "c",
 * soldier / advisor 都写作 "s" —— "红车在(a,b)" 与 "红炮在(a,b)" 会生成
 * 完全相同的 key。只要双方在同样两个点上轮换车和炮, 就会在十几手内被
 * 误判成"三次相同局面"而提前和棋。这里保留完整棋子名, 保证一一对应。
 */
export function positionKey(pieces, turn) {
  const board = pieces
    .map((piece) => `${piece.side}:${piece.type}@${piece.x},${piece.y}`)
    .sort()
    .join("|");
  return `${turn}:${board}`;
}

export function boardToMap(pieces) {
  const map = new Map();
  pieces.forEach((piece) => map.set(keyOf(piece.x, piece.y), piece));
  return map;
}
