export const BOARD_COLUMNS = 9;
export const BOARD_ROWS = 10;
export const RIVER_ROW = 4.5;
export const BRIDGE_COLUMNS = [0, 4, 8];

export const SIDES = Object.freeze({
  RED: "red",
  BLACK: "black",
});

export const PIECE_TYPES = Object.freeze({
  GENERAL: "general",
  ADVISOR: "advisor",
  ELEPHANT: "elephant",
  HORSE: "horse",
  CHARIOT: "chariot",
  CANNON: "cannon",
  SOLDIER: "soldier",
});

export const PIECE_VALUES = Object.freeze({
  [PIECE_TYPES.GENERAL]: 100000,
  [PIECE_TYPES.CHARIOT]: 900,
  [PIECE_TYPES.CANNON]: 450,
  [PIECE_TYPES.HORSE]: 400,
  [PIECE_TYPES.ELEPHANT]: 200,
  [PIECE_TYPES.ADVISOR]: 200,
  [PIECE_TYPES.SOLDIER]: 100,
});

export const PIECE_LABELS = Object.freeze({
  red: {
    [PIECE_TYPES.GENERAL]: "帅",
    [PIECE_TYPES.ADVISOR]: "仕",
    [PIECE_TYPES.ELEPHANT]: "相",
    [PIECE_TYPES.HORSE]: "马",
    [PIECE_TYPES.CHARIOT]: "车",
    [PIECE_TYPES.CANNON]: "炮",
    [PIECE_TYPES.SOLDIER]: "兵",
  },
  black: {
    [PIECE_TYPES.GENERAL]: "将",
    [PIECE_TYPES.ADVISOR]: "士",
    [PIECE_TYPES.ELEPHANT]: "象",
    [PIECE_TYPES.HORSE]: "马",
    [PIECE_TYPES.CHARIOT]: "车",
    [PIECE_TYPES.CANNON]: "砲",
    [PIECE_TYPES.SOLDIER]: "卒",
  },
});

export const PIECE_NAMES = Object.freeze({
  [PIECE_TYPES.GENERAL]: "将帅",
  [PIECE_TYPES.ADVISOR]: "军师",
  [PIECE_TYPES.ELEPHANT]: "战象",
  [PIECE_TYPES.HORSE]: "骑兵",
  [PIECE_TYPES.CHARIOT]: "战车",
  [PIECE_TYPES.CANNON]: "火炮",
  [PIECE_TYPES.SOLDIER]: "长矛兵",
});

export const PIECE_DESCRIPTIONS = Object.freeze({
  [PIECE_TYPES.GENERAL]: "坐镇九宫，一步一格",
  [PIECE_TYPES.ADVISOR]: "斜守中军，不可出宫",
  [PIECE_TYPES.ELEPHANT]: "斜行田字，不可过河",
  [PIECE_TYPES.HORSE]: "跃马破阵，蹩马腿后受阻",
  [PIECE_TYPES.CHARIOT]: "横冲直撞，直线畅通即可走",
  [PIECE_TYPES.CANNON]: "隔一子炮架，远程轰击",
  [PIECE_TYPES.SOLDIER]: "稳步向前，过河可横击",
});

export const MAX_HISTORY = 120;

export function isRed(side) {
  return side === SIDES.RED;
}

export function oppositeSide(side) {
  return side === SIDES.RED ? SIDES.BLACK : SIDES.RED;
}

export function inBoard(x, y) {
  return x >= 0 && x < BOARD_COLUMNS && y >= 0 && y < BOARD_ROWS;
}

export function inPalace(x, y, side) {
  if (x < 3 || x > 5) return false;
  return side === SIDES.RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}

export function ownHalf(y, side) {
  return side === SIDES.RED ? y >= 5 : y <= 4;
}

export function crossedRiver(y, side) {
  return side === SIDES.RED ? y <= 4 : y >= 5;
}

export function bridgeAt(x) {
  return BRIDGE_COLUMNS.includes(x);
}

export function crossesRiver(fromY, toY) {
  return (fromY <= 4 && toY >= 5) || (fromY >= 5 && toY <= 4);
}

export function keyOf(x, y) {
  return `${x},${y}`;
}

export function parseKey(key) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

export function algebraic(x, y, side = SIDES.RED) {
  const displayY = side === SIDES.RED ? BOARD_ROWS - y : y + 1;
  return `${String.fromCharCode(65 + x)}${displayY}`;
}

export function clonePiece(piece) {
  return piece ? { ...piece } : null;
}
