# 山河弈阵：可替换资产清单

当前版本完全可运行，所有兵种、地形、桥梁、水面、棋盘纹样已经由引擎实时构建。
如果后续使用 GPT Image 或外部 3D 资产提升细节，推荐按下面的顺序替换。

## 第一优先级：战场氛围

### 1. 山谷远景环境板
- 文件名：`public/assets/art/valley-backdrop.webp`
- 尺寸：**必须 2048×1024（严格 2:1）**，按 equirect 全景贴到 `scene.background`
- 用途：场景天空与远山背景，不参与碰撞
- 风格：**黄昏战场，暖金夕照**，层云与远山剪影，暖橙红调
- 注意：
  - 2:1 是 equirect 的硬要求，比例不对会被拉伸。
  - **水平方向必须无缝**：贴到球面后 u=0 与 u=1 是同一条经线，首尾列要被接上。
    校验方法见 `tmp/fix_seam3.py`——它会统计全图相邻列差，并把接缝旋转到
    差异最小的位置。原始出图接缝差曾高达 28.53（全图中位仅 1.23），旋转后降到 0.68。
  - **不要在接缝上做交叉淡化**：实测会把接缝差从 0.68 抬到 10.17，因为它把
    内容互不相同的首尾两段强行混合。云是低频内容，旋转到最连续位置就够了。
  - 色调必须与 `scene.fog`、远山顶点色同族（暖灰），否则地平线会出现冷暖分界线。

- 生成记录：Grsai `gpt-image-2.5`（`flare`/`sunburst` 上游维护中不可用时），
  16:9 出图后纵向居中裁为 2:1。剧本见 `tmp/process_sky.py`、`tmp/fix_seam3.py`。

### 2. 开场战役插画
- 文件名：`src/assets/art/key-art.webp`
- 尺寸：2560×1440
- 用途：开始界面右侧或加载页
- 风格：山谷俯瞰，楚河贯穿，远处石桥与军旗，人物仅为剪影

### 3. 结算纹章
- 文件名：`src/assets/art/result-seal.webp`
- 尺寸：1024×1024，透明背景
- 用途：胜负面板
- 内容：朱砂与古铜质感印章，不含可读文字

> 这两张图由 `src/styles.css` 引用，因此放在 `src/assets/art/` 走 Vite 资源管线：
> 构建时会被哈希并改写为相对路径，从而在 GitHub Pages 子目录下也能正常加载。
> 若改回以斜杠开头的根绝对资源路径，`npm run check:public` 会直接报错拦截。

## 第二优先级：材质

现有材质路径（均为 1024×1024 WebP，来自 Poly Haven CC0 源）：

```text
public/assets/textures/sandstone/color.webp
public/assets/textures/sandstone/normal.webp
public/assets/textures/sandstone/roughness.webp
public/assets/textures/stone/color.webp
public/assets/textures/stone/normal.webp
public/assets/textures/stone/roughness.webp
public/assets/textures/wood/color.webp
public/assets/textures/wood/normal.webp
public/assets/textures/wood/roughness.webp
```

> ⚠️ **不要把验证截图放进 `public/`。** 逐次调试的 PNG 单张约 2 MB，
> 放进去会被 `vite build` 原样拷进 `dist/` 并提交到仓库。
> 截图一律放 `work/shots/`（`.gitignore` 已忽略 `work/`），
> 需要看时再临时拷到 `public/` 并立即清掉。


全部由 `tmp/upgrade_textures*.py` 从 Poly Haven 2K 源重编码而来（颜色/粗糙 q85、
法线 q90）。**不要改回 JPG**：同一像素下 WebP 比 JPG 小 43%~75%，且从干净源
重编码去掉了原有的二次 JPEG 伪影。替换时请保持文件名不变，必须无缝平铺。

体积基线：整套 2.55 MB（JPG 时期为 5.17 MB）。新增贴图前先确认首屏预算。

### 河床卵石：必须露出水面

`src/render/terrain.js` 的 `riverbed-pebbles` 有一处已经踩过的坑，记录在此避免重犯：

- 水面在 `y = 0`，河床 `bed` 在 `y = -0.72`，水的 `transmission: 0.42`、`opacity: 0.88`。
  这意味着沉在水下的东西**只有约 12% 到达相机**，画面里读到的是水的吸收色，
  不是石头本身的颜色。
- **因此「把卵石材质调亮/调暖」是无效的**——曾把 `color` 从 `0x726c60` 提到
  `0xc9b393`，实测画面几乎无变化。已证否。
- 正确做法是让石头**破水线**：卵石 y 取 `-0.10 + random*0.19`，其中约四成露出水面。
  石头一旦露头，它的明度与暖度才真正进入画面，近景的深色脏斑随之消失。
- 卵石与巨石的 `castShadow` 都要开：露出水面的石头若只收阴影不投影，会像贴纸浮在水上。
- 数量基线 150 颗卵石 + 14 块巨石；材质 `color: 0xb9a480`、`roughness: 0.7`。
### 棋盘格线：抬升量不要等于线宽

`src/render/board-visuals.js` 的 `createGroundRibbon()` 把每个顶点放在
`terrainHeightAtBoardWorld(x, z) + 0.035`，而**线宽也是 0.035** —— 抬升量
等于自身宽度。近景低机位下贴片下方会露出一道阴影缝，观感就是
「线浮在地形上，没咬进去」。

实测数据（修前）：

- 棋盘范围内地形高差 **1.2365 米 / 16 米**，坡度约 7.7%；
- 线横截面宽 0.035，在 5%~20% 坡度上两端高差只有 **0.9~3.5 毫米**。

所以「坡度穿透」从来不是主因，抬太高才是。修法：

- 新增 `const LINE_LIFT = 0.006;`（线宽的 17%），替代原地的 `0.035`。
- 三个线材质（`lineMaterial` / `secondaryLineMaterial` / `nodeMaterial`）
  统一加 `polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2`，
  **深度冲突交给 GPU 抬深度，不靠几何抬升**。

验证：活场景中 `board-visuals` 56 个 mesh 里有 **31 个带 polygonOffset**；
线的世界 y 上界从 0.4695 降到 0.4405，说明整体贴低了。
掠射机位截图见 `tmp/shot_board.py`（相机 `(0.5, 1.35, 6.2)` 看 `(0.5, 0.15, -0.5)`）。

### 军帐：不要用圆锥顶


`src/render/terrain.js` 的 `makeTent()` 曾经是「八角柱身 + 圆锥顶」，近景像现代露营圆顶帐。
根因是几何比例，不是材质：

- `roofH / roofR = 0.85 / 0.86 = 0.99` —— 半顶角恰好 45.3°，一个「完美圆锥」，
  这是数学上的默认形状，人眼一看就归类为「工业/现代」，与中国古战场无关。
- 锥底半径（0.86 size）远大于柱身顶半径（0.62 size），外挑比 1.387，
  形成一圈夸张的悬空檐口；锥底平面又浮在柱身顶面之上，露出一道缝。

**正确做法**（已落地）：
- 攒尖顶改 **4 面**（`ConeGeometry(eaveRadius, roofHeight, 4, 1)`），
  坡面比圆锥陡，且带明确脊线，不再是回转体。
- 檐口半径压到 `0.70 size`，墙顶 `0.64 size`，外挑比降到 **1.094**，屋面贴住墙体。
- **锥底必须落在墙顶**：`ConeGeometry` 原点在几何中心，所以
  `roof.position.y = eaveY + roofHeight / 2`（`eaveY` = 墙顶 y）。
- 加一圈薄八角檐口压边盖住接缝，顶部收成宝顶 + 短旗杆，不留尖刺。

> 教训：给程序化几何调形状时，先算比例（半顶角、外挑比），再改参数。
> 当初只觉得「像倒扣的碗」就去调颜色和尺寸，白费了几轮。

### 截图验证的正确方法

`tmp/shot_piece_mat.py` 与 `tmp/shot_tent.py` 才是可用的模板。要点：

1. 先写 `localStorage` 的 `shanhe-xiangqi-settings-v1`，让启动状态确定；
2. **必须 `document.getElementById('start-button').click()` 进入对局** ——
   停在开始界面拍到的是一层深色遮罩（实测亮度 mean 30、89.6% 像素 < 60），
   会让人误判「场景渲染坏了」；
3. 等 `!window.__SHANHE_DEBUG__.scene.cameraTween` 再动手；
4. 移动相机后**最后**才 `window.requestAnimationFrame = () => 0` 冻结；
   提前冻结会让渲染循环彻底停摆，之后无论怎么改相机，截出的都是同一帧
   （曾连续三张截图 sha256 完全相同而误以为构建没生效）；
5. 用 `tmp/probe_cones.py` 这类脚本直接读活场景的 geometry 参数（如
   `geometry.parameters.radialSegments`）来确认改动是否真的上线，
   比搜压缩产物的字符串可靠 —— 压缩后类名会被改名。

## 第三优先级：3D 兵种替换
当前所有棋子均使用 Three.js 程序化骨骼模型，动作接口已经稳定。若要接入外部
GLB，可保持下列部件命名，动画系统可以直接复用：

```text
general   将帅    cape, weapon, armL, armR
advisor   军师    fan, sleeveL, sleeveR
elephant  战象    trunk, earL, earR, tuskL, tuskR, legs
horse     骑兵    neck, legs, tail, rider, spear
chariot   战车    wheels, horse, horseLegs, driver, spear
cannon    火炮    barrel, wheels, operator
soldier   长矛兵  legs, armL, armR, shield, spear
```

推荐 GLB 规范：

- 三角面：单个棋子 8k–25k
- 贴图：2K PBR，颜色、法线、粗糙度
- 坐标系：Y 向上，正面为 +Z
- 尺寸：以底座直径约 1.6 世界单位为基准
- 必须包含待机、攻击、移动三组骨骼动画，动作名建议使用：
  `Idle`、`Attack`、`Move`

## 第四优先级：音频

当前音频为程序化合成，避免版权问题。替换正式音效时建议使用以下名称：

```text
public/assets/audio/ui-select.wav
public/assets/audio/ui-confirm.wav
public/assets/audio/move-light.wav
public/assets/audio/move-heavy.wav
public/assets/audio/capture.wav
public/assets/audio/cannon-fire.wav
public/assets/audio/cannon-impact.wav
public/assets/audio/check.wav
public/assets/audio/victory.wav
public/assets/audio/defeat.wav
```

推荐 48kHz、单声道、无明显响度差。接入后只需在 `src/audio/audio-engine.js`
对应方法中替换合成声源，不需要改动对局逻辑。
