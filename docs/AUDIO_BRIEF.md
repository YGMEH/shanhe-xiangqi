# 山河弈阵 · 音频规格书（背景音乐）

> 用途：交给音乐生成工具/作曲者，产出可直接替换 `src/audio/audio-engine.js` 中程序化音乐的四首 BGM。
> 状态：**已交付并接线完成（2026-09-25）**。四首素材位于 `public/assets/audio/bgm/`，接线落点与验证方法见 `CODEX_HANDOFF.md` 的「音频现状」一节。下方规格保持原样，作为后续替换为符合技术规格（`.ogg` Vorbis / 峰值 ≤ -6 dBFS / 无缝 loop）版本时的验收依据。

---

## 一、为什么需要这些曲子

当前项目**没有任何背景音乐文件**。`src/audio/audio-engine.js:500` 的 `startMusic()` 用 Web Audio 实时合成：

- 古筝式拨弦：三角波 + 4 音分失谐，低通滤波从 `frequency * 7` 扫到 `frequency * 1.6`，衰减 2.4s
- 五声音阶 `C3 D3 E3 G3 A3 / C4 D4 E4 G4 A4 / C5 D5 E5 G5 A5`，随机游走，相邻音最多跳两级，18% 概率跳三级
- 每 2.4s 一记低音鼓（正弦 96Hz → 42Hz 下滑）
- 持续 drone：82.41Hz (E2) + 123.47Hz (B2)，低通 230Hz
- 带通噪声风声：中心 520Hz，Q=0.45，增益 0.012
- 音乐总线增益 0.16，淡入时间常数 2.5s

强度跟随战况：`controller.js:367` 每次吃子 `setMusicIntensity(0.6 + eaten * 0.045)`，`controller.js:449` 将军时拉到 `1`。强度影响旋律间隔（`2600 - intensity * 1100` ms）与是否打鼓（阈值 0.42）。

**结论：这不是"补一段 BGM"，而是替换整套合成器。** 现有合成器保留为素材缺失时的 fallback。

---

## 二、曲目清单

| # | 文件名 | 用途 | 触发点 | 时长 | 播放方式 |
|---|---|---|---|---|---|
| 1 | `bgm_battle.ogg` | 对局中（默认） | `startMusic()` | 90–120s | 无缝 loop |
| 2 | `bgm_check.ogg` | 将军告急 | `controller.js:447` `audio.check()` | 20–30s | 一次性（可 loop） |
| 3 | `bgm_victory.ogg` | 胜利结算 | `controller.js:418` / `:439` | 12–20s | 一次性 |
| 4 | `bgm_defeat.ogg` | 败北 | `controller.js:419` | 12–20s | 一次性 |
| 5 | `bgm_menu.ogg` | 主菜单/开场（可选） | 开场主视觉 | 40–60s | 无缝 loop |

**优先级**：如果只做一首，做 `bgm_battle`。第 5 首可砍，砍掉后开场维持现状（静音 + 环境声）。

---

## 三、风格定位

**一句话：古战场 · 静态压迫感。**

不是《王者荣耀》式史诗管弦，也不是武侠片的潇洒飘逸。参考坐标：

- 《三国志》系列的地图 BGM
- 谭盾《英雄》的极简弦乐
- 《全面战争：三国》的战前静谧段

关键词：**克制、留白、低沉、有尘土感**。

**最重要的约束：玩家要在这首曲子里思考几分钟一步棋，旋律不能有强记忆点，不能抢注意力。** 宁可是"氛围"而不是"歌曲"。

### 配器（按重要性排序）

1. **低音战鼓** —— 军鼓/大鼓，慢，每 2–4 拍一记。是"远处有人在敲"，不是战阵冲锋的密鼓
2. **古琴 或 古筝** —— 单音拨弦为主。**禁止**轮指、快板、连续音阶跑动
3. **埙 / 箫 / 低音笛** —— 空旷的长音线条，承担旋律。气声重一点更好
4. **二胡 / 中胡** —— 只在情绪转折处进来一两句，**不担任主旋律**
5. **弦乐低音铺底** —— 大提琴/低音提琴或合成 pad，撑和声
6. **环境层** —— 风声、沙尘、极远处金属碰撞余韵

### 调性与节奏

| 项 | 要求 |
|---|---|
| 调式 | 五声音阶，**羽调式**（A 小调感）或**角调式**（偏冷偏悲） |
| 主音 | A2 / D3 附近，整曲音域**压在低中音**，不上明亮高音区 |
| BPM | battle 56–64；check 76–84（只加鼓，不加快旋律）；victory/defeat 自由 |
| 和声 | 避免大调明亮终止式；羽调式 v–i 或角调式 ii–i 这类悬而未决的收束更好 |

---

## 四、逐曲要求

### `bgm_battle`（核心）

层进结构，因为要跟战况强度挂钩：

| 时间 | 内容 | 对应游戏状态 |
|---|---|---|
| 0:00–0:30 | drone + 风声 + 偶发单音拨弦 | 开局，强度 0.6 |
| 0:30–1:00 | 加入低音鼓 | 进入中局 |
| 1:00+ | 埙/箫旋律线进入，弦乐铺底变厚 | 中后盘 |
| 高潮 | **靠增加声部而不是增加音量** | 吃子累积、将军 |

- 结尾必须能接回开头，**无缝 loop**
- 高强度段也不要"爆发"，保持同一个情绪平面

### `bgm_check`（将军）

- 鼓点密度加倍
- 加入不谐和音程（小二度或增四度）制造紧张
- 弦乐用 tremolo
- 要有"倒计时"的紧迫感，但**长度短、不铺满**，因为它会在对局中途插进来

### `bgm_victory`（胜利）

- **不要欢庆号角**
- 渐强的鼓 + 一句上扬的埙/箫旋律收尾
- 气质是"**惨胜**"，不是"狂欢"。10 秒左右足够

### `bgm_defeat`（败北）

- 最简编制
- 古琴单音下行，鼓声渐远消散
- 末尾留 2 秒纯风声

---

## 五、技术规格（生成时就要设好）

| 项 | 要求 |
|---|---|
| 格式 | **`.ogg` (Vorbis) 优先**，`.mp3` 次之（项目现有 11 个音效全是 ogg） |
| 采样率 | 44100 Hz |
| 声道 | 立体声，但**不要把乐器硬摆到左右极端**——游戏里用 `StereoPanner` 做方位，素材本身要宽 |
| 响度 | 峰值 ≤ **-6 dBFS**，整体 ≈ **-20 LUFS**。留足动态余量：音乐总线增益只有 0.16，成品太响会盖掉音效 |
| 循环点 | 首尾无缝衔接。做不到时**生成比需要长 4 秒的版本并告知循环点**，由代码做交叉淡化 |
| 开头 | **禁止 1 秒静音/淡入**——淡入由代码做，素材带头部静音会破坏循环点 |
| 文件命名 | `bgm_battle.ogg` / `bgm_check.ogg` / `bgm_victory.ogg` / `bgm_defeat.ogg`( / `bgm_menu.ogg`) |
| 存放路径 | `public/assets/audio/bgm/` |

### 交付时请一并提供

- 调式与主音
- BPM
- 精确时长
- 循环点时间戳（能 loop 的曲子）
- 是否使用生成式 AI 工具，以及该工具的商用授权状态

---

## 六、接线计划（拿到素材后执行）

1. `src/audio/audio-engine.js` 新增 `BGM_LIBRARY` 映射，与现有 `SAMPLE_LIBRARY`（`audio-engine.js:618`）并列
2. 新增 `startBgm(key)` / `switchBgm(key)`：用 `AudioBufferSourceNode` + `loop = true` 播放，通过 `musicGain` 节点进出
3. 复用 `loadSamples()` 的 `decodeAudioData` 路径加载 BGM
4. `controller.js` 的三个调用点改为切曲：`check()` → `bgm_check`，`victory()` → `bgm_victory`，`defeat()` → `bgm_defeat`
5. 对局结束时 `bgm_battle` 淡出，结算曲结束后按现状停住
6. **保留程序化合成作为 fallback**：素材缺失时不能哑
7. 音量继续走现有 `master` 增益，静音按钮（`main.js:205`）与 `visibilitychange` 自动静音（`main.js:434`）逻辑不改

---

## 七、现有音效清单（不要重复生成）

已在 `public/assets/audio/impact/`，来源 Kenney（CC0，见同目录 `LICENSE-Kenney.txt`），近期已按兵种区分成七套独立音色：

```
move-wood-light-1.ogg          move-wood-heavy-1.ogg
capture-metal-heavy-1.ogg      capture-metal-medium-1.ogg
capture-plate-heavy-1.ogg      capture-plate-medium-1.ogg
impact-soft-heavy-1.ogg        impact-mining-1.ogg
bell-heavy-1.ogg
footstep-grass-1.ogg           footstep-wood-1.ogg
```

映射表在 `src/audio/audio-engine.js:618` 的 `SAMPLE_LIBRARY`。**本次只需产出 BGM，不需要动这些音效。**
