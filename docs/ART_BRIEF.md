# 山河弈阵：可替换资产清单

当前版本完全可运行，所有兵种、地形、桥梁、水面、棋盘纹样已经由引擎实时构建。
如果后续使用 GPT Image 或外部 3D 资产提升细节，推荐按下面的顺序替换。

## 第一优先级：战场氛围

### 1. 山谷远景环境板
- 文件名：`public/assets/art/valley-backdrop.webp`
- 尺寸：4096×2048，16:8 横版
- 用途：场景天空与远山背景，不参与碰撞
- 风格：中国古代山地军阵，清晨薄雾，深青与石灰色，避免卡通和现代元素
- 注意：画面中央留出低对比区域，棋盘会覆盖在上面

### 2. 开场战役插画
- 文件名：`public/assets/art/key-art.webp`
- 尺寸：2560×1440
- 用途：开始界面右侧或加载页
- 风格：山谷俯瞰，楚河贯穿，远处石桥与军旗，人物仅为剪影

### 3. 结算纹章
- 文件名：`public/assets/art/result-seal.webp`
- 尺寸：1024×1024，透明背景
- 用途：胜负面板
- 内容：朱砂与古铜质感印章，不含可读文字

## 第二优先级：材质

现有材质路径：

```text
public/assets/textures/sandstone/color.jpg
public/assets/textures/sandstone/normal.jpg
public/assets/textures/sandstone/roughness.jpg
public/assets/textures/stone/color.jpg
public/assets/textures/stone/normal.jpg
public/assets/textures/stone/roughness.jpg
public/assets/textures/wood/color.jpg
public/assets/textures/wood/normal.jpg
public/assets/textures/wood/roughness.jpg
```

替换时请保持文件名不变，建议 1K 或 2K，JPG/PNG 均可，必须无缝平铺。

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
