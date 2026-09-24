import { PIECE_TYPES, SIDES } from "./constants.js";
import { createInitialBoard, createPiece } from "./board.js";

export const CAMPAIGN_VERSION = 1;

export const CAMPAIGN_CHAPTERS = Object.freeze([
  {
    id: "broken-river",
    title: "断流之章",
    subtitle: "楚河改道，三桥初争",
    accent: "#c5a15c",
    levels: [
      {
        id: "river-crossing",
        number: 1,
        title: "抢渡三桥",
        briefing: "三座石桥是唯一通路。以车马抢占桥头，在不失一子前打开局面。",
        objective: "在 28 手内取得优势",
        objectiveType: "advantage",
        targetScore: 260,
        turnLimit: 28,
        playerSide: SIDES.RED,
        difficulty: 1,
        stars: ["取得优势", "14 手内取得优势", "不失子取得优势"],
        board: createInitialBoard(),
      },
      {
        id: "iron-screen",
        number: 2,
        title: "铁壁炮阵",
        briefing: "敌军双炮据守中路，炮架一旦建立便难以正面突破。",
        objective: "击破敌军双炮",
        objectiveType: "capture-types",
        captureTypes: [PIECE_TYPES.CANNON],
        captureCount: 2,
        turnLimit: 34,
        playerSide: SIDES.RED,
        difficulty: 2,
        stars: ["击破双炮", "损失不超过 2 子", "车马无损"],
        board: createInitialBoard(),
      },
      {
        id: "horse-pass",
        number: 3,
        title: "阴平马道",
        briefing: "山道狭窄，正面强攻会暴露后阵。让骑兵绕行侧翼，迫使敌将离开九宫。",
        objective: "将死或令敌将离开九宫",
        objectiveType: "checkmate-or-general-out",
        turnLimit: 36,
        playerSide: SIDES.RED,
        difficulty: 2,
        stars: ["达成目标", "30 手内达成", "骑兵仍存活"],
        board: createInitialBoard(),
      },
      {
        id: "last-bridge",
        number: 4,
        title: "风雨石桥",
        briefing: "暴雨来袭，桥梁湿滑，敌军在最后一座桥上布下重重炮架。",
        objective: "攻占中央桥头并取胜",
        objectiveType: "bridge-then-win",
        bridgeColumn: 4,
        turnLimit: 40,
        playerSide: SIDES.RED,
        difficulty: 3,
        stars: ["完成目标", "35 手内完成", "主力尚在"],
        board: createInitialBoard(),
      },
    ],
  },
  {
    id: "broken-formations",
    title: "破阵之章",
    subtitle: "残兵险局，以少胜多",
    accent: "#8d6a63",
    levels: [
      {
        id: "lone-elephant",
        number: 5,
        title: "孤象守关",
        briefing: "主力未至，只能以战象与两枚守卒坚守山口，等待反击。",
        objective: "在兵力劣势下坚持 20 手",
        objectiveType: "survive",
        turnLimit: 20,
        playerSide: SIDES.RED,
        difficulty: 2,
        stars: ["坚持到 20 手", "反击取胜", "不丢失战象"],
        board: [
          createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
          createPiece(PIECE_TYPES.ADVISOR, SIDES.RED, 3, 8),
          createPiece(PIECE_TYPES.ELEPHANT, SIDES.RED, 4, 7),
          createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 3, 5),
          createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 5, 5),
          createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0),
          createPiece(PIECE_TYPES.CHARIOT, SIDES.BLACK, 0, 0),
          createPiece(PIECE_TYPES.CHARIOT, SIDES.BLACK, 8, 0),
          createPiece(PIECE_TYPES.HORSE, SIDES.BLACK, 2, 2),
          createPiece(PIECE_TYPES.HORSE, SIDES.BLACK, 6, 2),
          createPiece(PIECE_TYPES.CANNON, SIDES.BLACK, 1, 3),
        ],
      },
      {
        id: "palace-uprising",
        number: 6,
        title: "九宫惊变",
        briefing: "敌军冲破宫墙，将帅身边只剩一士一车。任何一步失误都会立即送掉大局。",
        objective: "守住九宫并伺机反击",
        objectiveType: "survive-then-win",
        turnLimit: 26,
        playerSide: SIDES.RED,
        difficulty: 3,
        stars: ["守住并取胜", "20 手内取胜", "不失九宫守军"],
        board: [
          createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
          createPiece(PIECE_TYPES.ADVISOR, SIDES.RED, 3, 8),
          createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 9),
          createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0),
          createPiece(PIECE_TYPES.CHARIOT, SIDES.BLACK, 4, 3),
          createPiece(PIECE_TYPES.CANNON, SIDES.BLACK, 1, 2),
          createPiece(PIECE_TYPES.HORSE, SIDES.BLACK, 6, 2),
          createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 4, 4),
          createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 3, 4),
        ],
      },
      {
        id: "broken-wave",
        number: 7,
        title: "断潮反攻",
        briefing: "趁敌方阵线尚未合拢，以炮火撕开缺口，再让车马从桥侧突入。",
        objective: "在 24 手内击破敌将",
        objectiveType: "win-in",
        turnLimit: 24,
        playerSide: SIDES.RED,
        difficulty: 3,
        stars: ["24 手内取胜", "18 手内取胜", "保留双车"],
        board: [
          createPiece(PIECE_TYPES.GENERAL, SIDES.RED, 4, 9),
          createPiece(PIECE_TYPES.ADVISOR, SIDES.RED, 3, 8),
          createPiece(PIECE_TYPES.ADVISOR, SIDES.RED, 5, 8),
          createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 0, 7),
          createPiece(PIECE_TYPES.CHARIOT, SIDES.RED, 8, 7),
          createPiece(PIECE_TYPES.CANNON, SIDES.RED, 1, 5),
          createPiece(PIECE_TYPES.HORSE, SIDES.RED, 6, 6),
          createPiece(PIECE_TYPES.SOLDIER, SIDES.RED, 4, 4),
          createPiece(PIECE_TYPES.GENERAL, SIDES.BLACK, 4, 0),
          createPiece(PIECE_TYPES.ADVISOR, SIDES.BLACK, 3, 1),
          createPiece(PIECE_TYPES.ADVISOR, SIDES.BLACK, 5, 1),
          createPiece(PIECE_TYPES.CHARIOT, SIDES.BLACK, 0, 2),
          createPiece(PIECE_TYPES.CANNON, SIDES.BLACK, 7, 3),
          createPiece(PIECE_TYPES.HORSE, SIDES.BLACK, 2, 3),
          createPiece(PIECE_TYPES.SOLDIER, SIDES.BLACK, 4, 5),
        ],
      },
      {
        id: "shanhe-finale",
        number: 8,
        title: "山河定鼎",
        briefing: "决战。楚河水位上涨，只有中间石桥尚可通行。守住河岸，寻找一击定局的机会。",
        objective: "取得最终胜利",
        objectiveType: "win",
        turnLimit: 48,
        playerSide: SIDES.RED,
        difficulty: 3,
        stars: ["取得胜利", "36 手内取胜", "主力损失不超过 2 子"],
        board: createInitialBoard(),
      },
    ],
  },
]);

export function flattenCampaignLevels() {
  return CAMPAIGN_CHAPTERS.flatMap((chapter) =>
    chapter.levels.map((level) => ({ ...level, chapterId: chapter.id }))
  );
}

export function getCampaignLevel(levelId) {
  return flattenCampaignLevels().find((level) => level.id === levelId) ?? null;
}

export function getNextCampaignLevel(levelId) {
  const levels = flattenCampaignLevels();
  const index = levels.findIndex((level) => level.id === levelId);
  return index >= 0 ? levels[index + 1] ?? null : null;
}

export function evaluateCampaign(state, controller, level) {
  const history = controller.moveHistory;
  const plies = history.length;
  // captures[side] = 该方俘获的战利品(见 controller.runMove),
  // 所以玩家缴获在 captures[playerSide], 玩家损失在 captures[aiSide]。
  const capturesByPlayer =
    controller.captures[controller.playerSide]?.length ?? 0;
  const losses = controller.captures[controller.aiSide]?.length ?? 0;
  const stars = [];

  switch (level.objectiveType) {
    case "advantage": {
      const advantage = capturesByPlayer * 150 - losses * 120;
      const achieved = advantage >= level.targetScore;
      stars.push(
        achieved,
        achieved && plies <= 28,
        achieved && losses === 0
      );
      return { achieved, stars, progress: Math.max(0, advantage / level.targetScore) };
    }
    case "capture-types": {
      const captured = controller.captures[controller.playerSide] ?? [];
      const count = captured.filter((piece) =>
        level.captureTypes.includes(piece.type)
      ).length;
      const achieved = count >= level.captureCount;
      stars.push(
        achieved,
        achieved && losses <= 2,
        achieved && losses === 0
      );
      return { achieved, stars, progress: count / level.captureCount };
    }
    case "checkmate-or-general-out": {
      const enemyGeneral = state.general(controller.aiSide);
      const outOfPalace =
        enemyGeneral &&
        (enemyGeneral.x < 3 ||
          enemyGeneral.x > 5 ||
          enemyGeneral.y > 2);
      const achieved = controller.gameOver || outOfPalace;
      stars.push(achieved, achieved && plies <= 60, achieved && losses <= 1);
      return { achieved, stars, progress: achieved ? 1 : 0.3 };
    }
    case "bridge-then-win": {
      const crossed = state
        .alive(controller.playerSide)
        .some((piece) => piece.x === level.bridgeColumn && piece.y <= 4);
      const achieved = crossed && controller.gameOver && controller.lastWinner === controller.playerSide;
      stars.push(achieved, achieved && plies <= 70, achieved && losses <= 2);
      return { achieved, stars, progress: crossed ? 0.65 : controller.gameOver ? 0.2 : 0 };
    }
    case "survive": {
      const achieved = plies >= level.turnLimit * 2 || controller.gameOver;
      const elephantAlive = state
        .alive(controller.playerSide)
        .some((piece) => piece.type === PIECE_TYPES.ELEPHANT);
      const won =
        controller.gameOver && controller.lastWinner === controller.playerSide;
      stars.push(achieved, won, achieved && elephantAlive);
      return { achieved, stars, progress: plies / (level.turnLimit * 2) };
    }
    case "survive-then-win": {
      const won =
        controller.gameOver && controller.lastWinner === controller.playerSide;
      stars.push(won, won && plies <= 40, won && losses <= 1);
      return { achieved: won, stars, progress: won ? 1 : 0.25 };
    }
    case "win-in":
    case "win": {
      const won =
        controller.gameOver && controller.lastWinner === controller.playerSide;
      const limit = level.turnLimit * 2;
      stars.push(won, won && plies <= limit, won && losses <= 2);
      return {
        achieved: won,
        stars,
        progress: won ? 1 : controller.gameOver ? 0 : plies / limit,
      };
    }
    default:
      return { achieved: false, stars: [false, false, false], progress: 0 };
  }
}

export function createCampaignProgress() {
  return {
    version: CAMPAIGN_VERSION,
    completed: {},
  };
}
