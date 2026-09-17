const SAVE_KEY = "shanhe-xiangqi-save-v1";

export function saveGame(controller) {
  if (!controller || controller.moveHistory.length === 0) return;
  try {
    window.localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        pieces: controller.state.serialize(),
        turn: controller.state.turn,
        playerSide: controller.playerSide,
        aiSide: controller.aiSide,
        difficulty: controller.difficulty,
        mode: controller.mode,
        captures: controller.captures,
        history: controller.moveHistory,
        lastMove: controller.lastMove,
        positionKeys: controller.positionKeys,
        campaign: controller.campaign,
        lastWinner: controller.lastWinner,
        savedAt: Date.now(),
      })
    );
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function loadGame() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SAVE_KEY) ?? "null");
    if (!value || value.version !== 1 || !Array.isArray(value.pieces)) return null;
    return value;
  } catch {
    return null;
  }
}

export function clearGame() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function hasSavedGame() {
  return Boolean(loadGame());
}
