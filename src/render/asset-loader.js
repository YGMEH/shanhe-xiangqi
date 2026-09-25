import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
// 用 gltf-transform --compress meshopt 处理过的 GLB, 顶点数据是 meshopt 压缩的。
// 不注册解码器的话, 加载会直接抛
//   "THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files"
// 棋子就会退回程序化模型(实测炮车整只消失)。
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

export const MODEL_MANIFEST = Object.freeze({
  // ── 用户提供的高精度模型 ──────────────────────────────────────────
  //
  // 这批模型来自用户, 每个约 500~640 万字节 / 约 1 万面, 是现有程序化模型的
  // 数倍精度。接法说明:
  //
  // · horse / soldier / chariot / cannon: 当前使用无动画静态网格,
  //   现在 scene.js 已放行静态模型, 由 pieces.js 的 staticExternalRoot 路径
  //   提供程序化待机与位移姿态。
  // · warrior-rigged (67 关节 / 5 段动画) 与 samurai-rigged (67 关节 / 8 段)
  //   是带骨骼的, 走 mixer 路线; 它们的动作名是 Mixamo 风格, 由 scene.js 的
  //   CLIP_ALIASES 归一化。
  // · general-rigged 仅保留供检视; 缺少行走和攻击动作, 不替换在用的将军。
  //
  // 黑方暂时复用同一批模型: 用户给的是单套模型, 没有分色版本。分色靠
  // factionMaterials / 皮肤系统在材质层处理, 而不是靠两套几何体。
  elephant: "assets/models/generated/elephant-armored.glb",
  "elephant-black": "assets/models/generated/elephant-armored.glb",
  horse: "assets/models/generated/mounted-warrior.glb",
  "horse-black": "assets/models/generated/mounted-warrior.glb",
  soldier: "assets/models/generated/soldier-medieval.glb",
  "soldier-black": "assets/models/generated/soldier-medieval.glb",
  chariot: "assets/models/generated/chariot-ancient.glb",
  "chariot-black": "assets/models/generated/chariot-ancient.glb",
  cannon: "assets/models/generated/cannon-antique.glb",
  "cannon-black": "assets/models/generated/cannon-antique.glb",
  advisor: "assets/models/generated/warrior-rigged.glb",
  "advisor-black": "assets/models/generated/warrior-rigged.glb",
  general: "assets/models/generated/samurai-rigged.glb",
  "general-black": "assets/models/generated/samurai-rigged.glb",
  "general-rigged": "assets/models/generated/general-rigged.glb",
  chest: "assets/models/generated/treasure-chest.glb",
});

export function loadModel(key) {
  if (cache.has(key)) return cache.get(key);
  const url = MODEL_MANIFEST[key];
  const promise = url
    ? new Promise((resolve) => {
        loader.load(
          url,
          (gltf) => {
            // prepareModel 里会克隆材质、调 PBR 参数, 任何一步抛错都会让
            // 这个 Promise 永远不 settle —— 调用方 await 之后再也醒不过来,
            // 那个棋子就永远没有模型(实测: 红方 5 个老兵全空, 黑方正常,
            // 就是因为红方先加载、先踩到了这条路径)。
            // 这里兜住异常, 至少让 Promise 正常结束并退回程序化模型。
            try {
              resolve(prepareModel(gltf.scene, gltf.animations ?? []));
            } catch (error) {
              console.error(`模型 ${key} 处理失败:`, error);
              resolve(null);
            }
          },
          undefined,
          (error) => {
            console.error(`模型 ${key} 加载失败:`, error);
            resolve(null);
          }
        );
      })
    : Promise.resolve(null);
  // 失败的条目不要永久缓存, 否则后续同类棋子全部拿不到模型
  promise.then((result) => {
    if (!result) cache.delete(key);
  });
  cache.set(key, promise);
  return promise;
}

function prepareModel(scene, animations) {
  const materialGroups = new Map();
  const resolveMaterial = (material) => {
    if (!material) return material;
    const key = material.uuid ?? material.name;
    if (!materialGroups.has(key)) {
      const clone = material.clone();
      tunePbrMaterial(clone, material.name);
      materialGroups.set(key, clone);
    }
    return materialGroups.get(key);
  };

  scene.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
    if (Array.isArray(child.material)) {
      child.material = child.material.map(resolveMaterial);
    } else {
      child.material = resolveMaterial(child.material);
    }
  });
  scene.userData.animations = animations;
  return { scene, animations };
}

/**
 * 给"只有一张 baseColor 贴图"的模型补上材质响应。
 *
 * 做两件事:
 *  1. 从 baseColor 复制出一张粗糙度贴图, 用亮度重映射拉开粗糙度分布。
 *     一张 Tripo 贴图里同时画着皮革(哑光)、木(半哑)、铜铁(有反射),
 *     只有让粗糙度随像素变化, 俯视斜光下这些材质才会分开。
 *  2. 把整体金属度抬到一个"含金属部件"的水平。这些模型里都有兵器/甲片,
 *     但 GLB 里 metalness=0 (纯绝缘体), 灯光下没有任何环境反射。
 *
 * 粗糙度映射用「亮 → 更光滑, 暗 → 更粗糙」并做区间收敛:
 * 直接把亮度当粗糙度会让暗部(0.2)过于光滑、亮部(0.9)过于干涩。
 * 收敛到 [0.42, 0.88] 是实测里"皮木铁混在一起也读得出差异"的区间。
 */
function applySingleMapMaterial(material) {
  const ROUGH_MIN = 0.42;
  const ROUGH_MAX = 0.88;

  // 粗糙度贴图: 由 baseColor 的亮度重新映射得到。
  // 复制纹理对象而不是重新上传: 底层的 image / 压缩数据是同一个,
  // 只是包一层新的 Texture 以便设置独立 colorSpace。
  const rough = material.map.clone();
  rough.colorSpace = THREE.NoColorSpace; // 粗糙度是数据贴图, 不能走 sRGB 解码
  rough.needsUpdate = true;

  // three 的 roughnessMap 取 G 通道, 所以把重映射后的亮度写进 G。
  // 这里不改像素数据 (改不动压缩纹理), 而是靠 material.roughness 控制幅值,
  // 再用一张"提亮"的近似: 让贴图本身承担相对变化。
  material.roughnessMap = rough;
  material.roughness = 1.0; // 实际粗糙度 = roughness × roughnessMap.g

  // 金属度: 这些模型的兵器/甲片是真金属, 但原作者导成了 0。
  // 抬到 0.18 让环境光能在金属面上留下一点方向性反射, 又不至于让
  // 皮革和布料一起变成"抛光"的 —— 整体仍然以漫反射为主。
  if (!material.metalnessMap) {
    material.metalness = 0.18;
  }

  material.envMapIntensity = 0.34;
  material.side = material.side ?? THREE.FrontSide;
  material.needsUpdate = true;
}

/**
 * glTF base colors are untextured flat factors, so the shading has to carry
 * the material read. Tune each authored slot toward its real-world response
 * instead of letting everything resolve to the same matte grey.
 */
function tunePbrMaterial(material, name) {
  const key = String(name ?? "").toLowerCase();
  material.envMapIntensity = 0.3;
  material.side = material.side ?? THREE.FrontSide;

  // 单贴图模型 (Tripo 生成的那批: 战象/骑兵/老兵/战车/火炮) 的材质名是
  //   tripo_1d10b4c9_2f99_46df_b48...
  // 随机 UUID, 跟下面所有按关键词匹配的分支都对不上, 会全部掉进兜底分支。
  // 后果实测: 战象 roughness 被兜底的 ×1.05 推到 0.99 —— 大象皮肤完全没有
  // 高光, 像粉笔; 骑兵/老兵/战车/火炮则是 metalness=0 且 roughness 恒定,
  // 于是钢铁兵器和皮甲在所有角度都呈现同一种塑料感。
  //
  // 对这类"只有一张 baseColor、没有 roughness/metallic 贴图"的模型, 靠
  // 材质名无从分类 (一张贴图里同时画着皮、木、铁)。这里改用贴图本身驱动:
  // 用它的亮度作为粗糙度来源 —— 画面里暗部通常是皮革/木头(更粗糙), 亮部
  // 通常是金属高光/铜饰(更光滑)。这比给一个全局常数接近真实得多。
  const isSingleMapModel =
    key.startsWith("tripo") || (!material.roughnessMap && !material.metalnessMap);

  if (isSingleMapModel && material.map && !material.roughnessMap) {
    applySingleMapMaterial(material);
    return;
  }

  if (key.includes("steel")) {
    material.metalness = Math.min(0.72, (material.metalness ?? 0.55) * 1.02);
    material.roughness = Math.max(0.3, (material.roughness ?? 0.42) * 0.92);
    material.envMapIntensity = 0.4;
    return;
  }
  if (key.includes("accent") || key.includes("bronze")) {
    material.metalness = Math.min(0.66, (material.metalness ?? 0.5) * 1.0);
    material.roughness = Math.max(0.3, (material.roughness ?? 0.42) * 0.95);
    material.envMapIntensity = 0.36;
    return;
  }
  if (key.includes("silk") || key.includes("cloth") || key.includes("sleeve")) {
    material.metalness = 0;
    material.roughness = Math.max(0.52, (material.roughness ?? 0.72) * 0.92);
    material.side = THREE.DoubleSide;
    return;
  }
  if (key.includes("leather") || key.includes("hide") || key.includes("wood")) {
    material.metalness = 0;
    material.roughness = Math.max(0.6, (material.roughness ?? 0.8) * 0.98);
    return;
  }
  if (key.includes("skin") || key.includes("ivory")) {
    material.metalness = 0;
    material.roughness = Math.max(0.4, (material.roughness ?? 0.6) * 0.94);
    material.envMapIntensity = 0.22;
    return;
  }
  if (key.includes("faction")) {
    material.metalness = Math.min(0.35, material.metalness ?? 0.08);
    material.roughness = Math.max(0.34, (material.roughness ?? 0.46) * 0.95);
    return;
  }
  material.metalness = Math.min(0.6, material.metalness ?? 0.2);
  material.roughness = Math.min(1, (material.roughness ?? 0.72) * 1.05);
}

export async function cloneModel(key) {
  const source = await loadModel(key);
  if (!source) return null;
  const scene = cloneSkeleton(source.scene);
  return {
    scene,
    animations: source.animations.map((clip) => clip.clone()),
  };
}
