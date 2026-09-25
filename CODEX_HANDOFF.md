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

**BGM：尚未生成，是待交付项，不是丢失资产。**

项目里**没有任何背景音乐文件**，`public/assets/audio/bgm/` 目录也还不存在。当前对局音乐是 `src/audio/audio-engine.js:510` `startMusic()` 用 Web Audio 实时合成的：古筝式拨弦（五声音阶宫商角徵羽，随机游走）+ 每 2.4s 一记低音鼓 + 82.41/123.47Hz drone + 带通噪声风声。

强度跟随战况：`src/game/controller.js:367` 每次吃子 `setMusicIntensity(0.6 + eaten * 0.045)`，`controller.js:449` 将军时拉到 `1`；强度影响旋律间隔与是否打鼓。

需生成的 4–5 首曲目、风格定位、逐曲要求、技术规格（.ogg / 44.1kHz / 峰值 ≤ -6 dBFS / 无缝 loop / 禁止头部静音）与接线步骤，**已完整写在 `docs/AUDIO_BRIEF.md`**（用户在更早的会话中明确表示"我去给你生成"，等的是这份清单）。

接线计划（`docs/AUDIO_BRIEF.md` 第六节）：拿到素材后新增 `BGM_LIBRARY` 与 `startBgm()/switchBgm()`，复用 `loadSamples()` 的 `decodeAudioData` 路径，`controller.js` 的 `check()`/`victory()`/`defeat()` 三处改为切曲，**程序化合成保留为素材缺失时的 fallback**。

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
```
