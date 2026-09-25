# 山河弈阵 Codex 接续说明

## 项目位置

`C:\Users\Administrator\Documents\Codex\2026-09-16\wo-2`

进入 Codex 后，将工作目录设为上述项目目录。不要把项目复制到另一个目录，避免模型资源、`dist` 和报告分叉。

## 当前状态

- 2026-09-25 源码已把红黑骑兵改为 `mounted-warrior.glb`（旧 `horse-armored.glb` 只有马体）；古炮改为 `cannon-antique.glb`，两侧营地各挂载一个 `treasure-chest.glb`。`general-rigged.glb` 没有可用的走/攻动画，仅保留检视入口。
- 已在 4301 源码预览验证 32/32 外部棋子、4/4 骑兵、4/4 古炮、2/2 宝箱加载，三个新 GLB 返回 200 且类型为 `model/gltf-binary`。`npm.cmd test` 57/57 通过，`npm.cmd run check:public` 通过。
- **4173 正式预览仍是旧版**：遵照 `docs/ART_UPGRADE_EXECUTION.md` 的预览保护规则，未运行 build、未覆盖 dist；请用 4301 查看本次源码改动。

- Three.js `0.180`、Vite `7.3.6`、原生 JavaScript ES modules。
- 正式预览地址：`http://127.0.0.1:4173/`
- 访问正式版后使用 `Ctrl+F5`。
- 源码实时预览工具：`node tmp\\live-preview.mjs`
  - 源码页面：`http://127.0.0.1:4301/`
  - 资源服务：`http://127.0.0.1:4300/`
  - 每次修改 `src` 后必须重启该工具。
- `4180` 是 `public` 静态文件服务器，主要用于查看截图：`http://127.0.0.1:4180/`。

## 最近完成的修复

用户反馈模型比例不对、马模型扭曲。已修改：

- `src/render/scene.js`
  - 外部 GLB 不再使用固定 `rawHeight`，改为读取实际包围盒高度后按兵种目标高度缩放。
  - 静态蒙皮模型通过 `isSkinnedMesh` 识别。
  - 静态蒙皮模型只允许外层根节点整体运动，保持绑定姿态。
- `src/render/pieces.js`
  - 静态蒙皮模型不再叠加程序化扭转或姿态变化，重点解决战马扭曲。

最近构建产物：

- `dist/assets/index-DRTBsEov.js`
- 用户模型位于 `dist/assets/models/generated/`

## 最近验证结果

- `npm.cmd test`：54/54 通过。
- `npm.cmd run check:public`：通过。
- 源码预览稳定加载：32/32 棋子成功挂载外部模型。
- `4173` 实测：
  - `index-DRTBsEov.js`：200 `text/javascript`
  - `horse-armored.glb`：200 `model/gltf-binary`
  - `elephant-armored.glb`：200 `model/gltf-binary`
- 源码预览截图报告：`work/reports/AU-90-overview.json`
- 模型加载时间报告：`work/reports/AU-42f-load-timing.json`

## 模型加载验证规则

SwiftShader 下约 2300 个 draw call，GLB 下载只需几百毫秒，但解析、蒙皮和 GPU 上传很慢。不要固定等待 9 秒后判定失败；必须每 5 秒采样，连续至少两轮挂载数量不变化后再判定稳定，完整加载通常需要 35–40 秒。

three.js `FileLoader` 使用 XMLHttpRequest，不是 `fetch`。检查资源请求应使用：

- `performance.getEntriesByType('resource')`
- 直接读取 `window.__SHANHE_DEBUG__.scene.actors`

## 音频现状（重要，勿误判为丢失）

**音效：已全部就位，不需要再生成。**

35 个 `.ogg` 在版本库 `public/assets/audio/` 下，分两组：

- `impact/` — 11 个，Kenney CC0（见同目录 `LICENSE-Kenney.txt`），已按兵种分成七套音色（走子轻重、吃子金属/板甲、脚步草地/木地）
- `kenney-rpg/` — 24 个，Kenney CC0（见同目录 `License.txt`）

映射表在 `src/audio/audio-engine.js:618` 的 `SAMPLE_LIBRARY`。已随构建进入 `dist/assets/audio/`。

**BGM：已交付并接线完成（2026-09-25）。**

用户在会话中提供了四个 MP3 附件，已按 `docs/AUDIO_BRIEF.md` 的曲目清单落到 `public/assets/audio/bgm/`：

| 文件 | 用途 | 原始素材名 |
| --- | --- | --- |
| `bgm_battle.mp3` (3.70 MB) | 山河对弈（对局默认） | `cold_earth_heavy_sky.mp3` |
| `bgm_check.mp3` (3.85 MB) | 将军危局 | `before_the_first_arrow.mp3` |
| `bgm_victory.mp3` (3.60 MB) | 惨胜收阵 | `weight_of_the_iron_sky.mp3` |
| `bgm_defeat.mp3` (3.46 MB) | 败局余烬 | `where_the_banners_fell.mp3` |

接线落点：

- `src/audio/audio-engine.js` — 新增 `BGM_LIBRARY`（含素材来源注释）、`loadBgm()`、`switchBgm(key)`、`stopBgm(fadeSeconds = 1.5)`；构造函数新增 `bgm`/`bgmLoadPromise`/`bgmSource`/`bgmGain`/`bgmKey`/`bgmErrors` 六个字段。`switchBgm()` 用 `AudioBufferSourceNode` + `loop = true`，经独立 gain 节点淡入（`setTargetAtTime(0.16, now, 1.2)`），并**先 `stopBgm()` 再把程序化 `stopMusic()`**，素材存在时合成器必须让位。
- `src/main.js` — `startGame()` 里 `audio.unlock()` 之后设 `audio.bgmRequested = "battle"`；`__SHANHE_DEBUG__` 新增 `audio` 与 `audioBgmErrors()`，便于以后直接查音频运行时而不必翻内部字段。
- `src/game/controller.js` — 三个调用点改为切曲：`check()` → `switchBgm("check")`、`victory()` → `switchBgm("victory")`、`defeat()` → `switchBgm("defeat")`（`switchBgm` 内部先 `stopBgm()`，因此对局结束时 `bgm_battle` 自动淡出）。
- **程序化合成完整保留为 fallback**：素材缺失或解码失败时 `switchBgm()` 返回 `false` 并回落到 `startMusic()`，不会哑。

验证方式：`py -3 tmp\verify_bgm.py --url http://127.0.0.1:4302/ --wait 16`。三个判据缺一不可 —— 网络层（四个 mp3 均 200）、解码层（`audio.bgm` 出现四键）、播放层（`bgmKey === "battle"`、`bgmSource` 非空、`context.state === "running"`）。**已知时序陷阱：3.6 MB 的 MP3 解码明显慢于音效，取样早于约 15 秒会看到空的 `bgm` Map，不代表接线失败。**

排查记录：过程中一度出现 `bgmKeys: []`，真因是解码未完成而非代码错误；同时把原先的静默 `catch {}` 改为记录到 `bgmErrors`，避免"BGM 没响"变成无法排查的现象。

**占位素材：当前四首是用户提供的 MP3；`docs/AUDIO_BRIEF.md` 的技术规格要求 `.ogg` Vorbis / 峰值 ≤ -6 dBFS / 整体 ≈ -20 LUFS / 首尾无缝，如后续拿到符合规格的版本直接覆盖同名文件即可，代码无需改动。**
## 保护性约束
- 不删除任何用户模型、截图、报告或 `work/tmp` 产物。
- 修改源码后先 `node --check`，再重启 `tmp/live-preview.mjs`。
- 正式构建前先运行 `npm.cmd test` 和 `npm.cmd run check:public`。
- 使用 PowerShell 时调用 `npm.cmd` / `npx.cmd`，不要调用裸 `npm` / `npx`。
- 4173 是给用户看的正式 Vite preview，不要用另一个服务器替换它。
- `tmp/live-preview.mjs` 已支持 `public` 覆盖层：源码预览可读取尚未进入 `dist` 的新 GLB。

## 下一步候选

1. 让用户确认马模型当前画面是否恢复正常。
2. 如仍有比例问题，先读取每种模型的运行时包围盒和 `scene.scale`，不要盲目改系数。
3. 继续艺术升级计划：AU-24 河岸黑斑、AU-30 光照环境、AU-31 全局皮肤系统、AU-33 河流完整度。

## 推荐接续命令

```powershell
Set-Location 'C:\Users\Administrator\Documents\Codex\2026-09-16\wo-2'
node --check src\render\scene.js
node --check src\render\pieces.js
npm.cmd test
npm.cmd run check:public
npm.cmd run check:public
py -3 tmp\verify_bgm.py --url http://127.0.0.1:4302/ --wait 16
```
