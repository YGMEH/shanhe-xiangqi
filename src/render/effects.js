import * as THREE from "three";

export class EffectsSystem {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.effects = [];
    this.smokeTexture = makeSmokeTexture();
    this.sparkGeometry = new THREE.SphereGeometry(0.035, 6, 4);
  }

  update(delta) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.elapsed += delta;
      const t = effect.elapsed / effect.duration;
      effect.update(Math.min(t, 1), delta);
      if (t >= 1) {
        effect.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  add(effect) {
    this.effects.push(effect);
  }

  dust(position, color = 0xaaa080, scale = 1) {
    const count = 18;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.18;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.random() * 0.15;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      velocities.push(
        new THREE.Vector3(
          Math.cos(angle) * (0.35 + Math.random()),
          0.5 + Math.random() * 0.8,
          Math.sin(angle) * (0.35 + Math.random())
        )
      );
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size: 0.14 * scale,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.position.copy(position);
    this.scene.add(points);

    this.add({
      elapsed: 0,
      duration: 1.1,
      update: (t) => {
        const array = geometry.attributes.position.array;
        for (let i = 0; i < count; i += 1) {
          array[i * 3] += velocities[i].x * 0.016;
          array[i * 3 + 1] += velocities[i].y * 0.016;
          array[i * 3 + 2] += velocities[i].z * 0.016;
          velocities[i].y -= 0.035 * 0.016;
        }
        geometry.attributes.position.needsUpdate = true;
        material.opacity = (1 - t) * 0.48;
        material.size = (0.1 + t * 0.12) * scale;
      },
      dispose: () => {
        this.scene.remove(points);
        geometry.dispose();
        material.dispose();
      },
    });
  }

  /**
   * 命中点的烟尘与火星。
   * scale 决定整体尺寸 —— 由 killBurst 按"一枚棋子的大小"传进来,
   * 不再是写死的 0.28/0.45(那个尺寸在玩家视角下只有 8.6 像素)。
   */
  impact(position, heavy = false, scale = null) {
    // 兼容旧调用: 不传 scale 时退回原来的小尺寸
    const base = scale ?? (heavy ? 0.45 : 0.28);
    // 烟雾比冲击范围再大一圈, 让"炸开"的观感有承载物
    const smokeScale = base * 1.6;
    const smoke = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.smokeTexture,
        color: heavy ? 0x3c3028 : 0x8b7e68,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      })
    );
    smoke.position.copy(position);
    smoke.scale.setScalar(smokeScale);
    this.scene.add(smoke);

    const sparks = new THREE.Group();
    const velocities = [];
    // 火星数量也跟尺寸走: 小特效撒 8 个, 大特效撒 22 个
    const sparkCount = Math.round((heavy ? 18 : 12) * Math.max(0.7, base));
    for (let i = 0; i < sparkCount; i += 1) {
      const spark = new THREE.Mesh(
        this.sparkGeometry,
        this.materials.glowGold
      );
      spark.position.copy(position);
      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.7,
        Math.random() - 0.5
      ).normalize();
      // 初速跟着尺寸走, 大特效的火星要飞得更远才配得上体量
      velocities.push(
        direction.multiplyScalar((1.6 + Math.random() * 2.2) * Math.max(0.8, base))
      );
      // 火星本身也放大, 否则远处看不见。
      // 实测原来只有 2.1 px —— 等于没撒。
      spark.scale.setScalar(Math.max(2.4, base * 3.2));
      sparks.add(spark);
    }
    this.scene.add(sparks);

    this.add({
      elapsed: 0,
      duration: heavy ? 0.9 : 0.62,
      update: (t) => {
        smoke.scale.setScalar(smokeScale + t * smokeScale * 2.4);
        smoke.material.opacity = (1 - t) * 0.82;
        smoke.position.y += 0.006;
        sparks.children.forEach((spark, index) => {
          spark.position.addScaledVector(velocities[index], 0.016);
          velocities[index].y -= 0.08 * 0.016;
          spark.scale.setScalar(
            Math.max(0.4, 1 - t * 0.7) * Math.max(2.4, base * 3.2)
          );
        });
      },
      dispose: () => {
        this.scene.remove(smoke);
        this.scene.remove(sparks);
        smoke.material.dispose();
      },
    });
  }

  /**
   * 吃子冲击。
   *
   * 为什么要重做: 原来这套特效是"贴地的小尺度" —— 烟雾 0.28 世界单位、
   * 光环半径 0.2、尘土最大 1.8。而玩家默认视角在 35.2 米外、FOV 32,
   * 实测投影到屏幕上:
   *     一枚老兵棋子   83.9 px
   *     冲击光环       12.3 px   <- 棋子的 1/7
   *     烟雾(普通吃子)  8.6 px   <- 棋子的 1/10
   * 也就是说玩家根本看不见, 吃子只有"棋子倒下"这一个反馈, 完全没有打击感。
   *
   * 现在按**棋子高度**来定特效尺寸: 一次普通吃子的冲击范围应该有
   * 一枚棋子那么大(视觉上才能盖住被吃的棋子), 重装单位再放大一倍。
   * 这样无论将来镜头拉远拉近, 比例关系都是对的。
   */
  killBurst(position, heavy = false) {
    // 基准半径 = 一枚棋子的高度量级, 保证屏幕上"看得见"
    const base = heavy ? 1.35 : 0.95;
    this.dust(position, heavy ? 0x6f6254 : 0x8a7d67, heavy ? 3.4 : 2.2);
    this.impact(position, heavy, base);

    // 地面冲击波: 一圈快速扩散的亮环。这是"打击感"的核心 ——
    // 它给出了命中的瞬间和方向, 且横向展开在俯视视角下最显眼。
    //
    // 用 40 段的环并把每段顶点半径做随机扰动 —— 一个完美的圆
    // 在特写下看起来像 UI 标记, 不规则的边缘才像炸开的地面。
    const ringGeometry = new THREE.RingGeometry(base * 0.28, base * 0.46, 40, 1);
    const ringPos = ringGeometry.attributes.position;
    for (let i = 0; i < ringPos.count; i += 1) {
      const vx = ringPos.getX(i);
      const vy = ringPos.getY(i);
      const radius = Math.hypot(vx, vy);
      if (radius < 1e-6) continue;
      // 沿半径方向随机推拉, 形成锯齿状的爆裂边
      const jitter = 1 + (Math.random() - 0.5) * 0.42;
      ringPos.setXY(i, (vx / radius) * radius * jitter, (vy / radius) * radius * jitter);
    }
    ringPos.needsUpdate = true;
    ringGeometry.computeVertexNormals();
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: heavy ? 0xffc07a : 0xffe0ac,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(position);
    ring.position.y = Math.max(0.045, position.y - 0.24);
    this.scene.add(ring);

    // 竖直的冲击尘柱: 俯视视角下横向的环容易被棋子和地面吞掉,
    // 竖直方向才是屏幕上"最高"的可用空间, 因此用它来抓住视线。
    //
    // 调过两版:
    //   第一版用 AdditiveBlending + 0xffd9a0, 在 ACES 色调映射下直接顶到
    //   纯白, 形状像一根发光的圆柱, 看起来像 UI 元素而不是战斗特效。
    //   现在改成: 普通混合(不叠加)、颜色压暗到暖灰土色、透明度降低,
    //   并且上细下粗的锥度做得更明显 —— 让它读起来是"被砸起来的尘土"
    //   而不是"一根光柱"。
    const pillarGeometry = new THREE.CylinderGeometry(
      base * 0.18, base * 0.72, base * 2.4, 20, 1, true
    );
    const pillarMaterial = new THREE.MeshBasicMaterial({
      color: heavy ? 0x8a7563 : 0xa08a74,
      transparent: true,
      opacity: 0.30,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
    });
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.copy(position);
    pillar.position.y += base * 1.1;
    this.scene.add(pillar);

    this.add({
      elapsed: 0,
      duration: heavy ? 0.72 : 0.58,
      update: (t) => {
        // 环: 先快后慢地扩散(冲击波的真实衰减), 同时淡出
        const ease = 1 - Math.pow(1 - t, 2.4);
        ring.scale.setScalar(1 + ease * (heavy ? 6.2 : 4.6));
        ringMaterial.opacity = (1 - t) * (1 - t) * 0.9;

        // 尘柱: 向上抽起并扩散, 同时迅速变淡 —— 尘土是"炸开就散",
        // 不像光柱那样需要一直亮着
        pillar.scale.set(1 + t * 0.8, 1 + t * 1.4, 1 + t * 0.8);
        pillar.position.y = position.y + base * (1.0 + t * 1.6);
        pillarMaterial.opacity = (1 - t) * (1 - t) * 0.30;
      },
      dispose: () => {
        this.scene.remove(ring);
        this.scene.remove(pillar);
        ringGeometry.dispose();
        ringMaterial.dispose();
        pillarGeometry.dispose();
        pillarMaterial.dispose();
      },
    });
  }

  cannonTrail(start, end, onImpact = () => {}) {
    const origin = start.clone();
    origin.y += 1.15;
    const target = end.clone();
    target.y += 0.6;
    const control = origin.clone().lerp(target, 0.5);
    control.y += 1.4 + origin.distanceTo(target) * 0.1;
    const curve = new THREE.QuadraticBezierCurve3(origin, control, target);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
    const tracer = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xffd28a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.scene.add(tracer);

    const projectile = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 7),
      new THREE.MeshStandardMaterial({
        color: 0x292a26,
        emissive: 0xff7b35,
        emissiveIntensity: 1.8,
        roughness: 0.38,
        metalness: 0.72,
      })
    );
    this.scene.add(projectile);

    const smokePuffs = [];
    let impacted = false;
    return new Promise((resolve) => {
      // 兜底: 这个 Promise 原本只在 dispose() 里 resolve, 而 dispose 依赖特效
      // 系统的 update 循环跑完。一旦渲染循环被节流/暂停, 或特效队列异常,
      // dispose 就不会被调用, Promise 永远挂住 -> 上游 busy 卡死 ->
      // 整局再也点不动棋子。炮吃子正好走这条分支, 症状特别明显。
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      window.setTimeout(done, 2600);

      this.add({
        elapsed: 0,
        duration: 0.56,
        update: (t) => {
          const eased = t * t * (3 - 2 * t);
          projectile.position.copy(curve.getPoint(eased));
          tracer.material.opacity = Math.max(0, 0.48 - t * 0.46);
          if (t > 0.08 && Math.floor(t * 30) % 2 === 0) {
            const puff = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: this.smokeTexture,
                color: 0x6d6253,
                transparent: true,
                opacity: 0.38,
                depthWrite: false,
              })
            );
            puff.position.copy(projectile.position).add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 0.12,
                (Math.random() - 0.5) * 0.12,
                (Math.random() - 0.5) * 0.12
              )
            );
            puff.scale.setScalar(0.16 + Math.random() * 0.16);
            this.scene.add(puff);
            smokePuffs.push({ sprite: puff, life: 0.5 });
          }
          smokePuffs.forEach(({ sprite }) => {
            sprite.scale.multiplyScalar(1.045);
            sprite.material.opacity *= 0.94;
            sprite.userData.life = (sprite.userData.life ?? 0) + 0.016;
          });
          if (t > 0.97 && !impacted) {
            impacted = true;
            onImpact?.();
            this.impact(target, true);
          }
        },
        dispose: () => {
          this.scene.remove(tracer);
          this.scene.remove(projectile);
          smokePuffs.forEach(({ sprite }) => {
            this.scene.remove(sprite);
            sprite.material.dispose();
          });
          geometry.dispose();
          tracer.material.dispose();
          projectile.geometry.dispose();
          projectile.material.dispose();
          done();
        },
      });
    });
  }

  moveTrail(start, end, color) {
    const points = [start.clone(), end.clone()];
    points[0].y += 0.12;
    points[1].y += 0.12;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.scene.add(line);
    this.add({
      elapsed: 0,
      duration: 0.42,
      update: (t) => {
        line.material.opacity = (1 - t) * 0.58;
      },
      dispose: () => {
        this.scene.remove(line);
        geometry.dispose();
        line.material.dispose();
      },
    });
  }
}

function makeSmokeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 60);
  gradient.addColorStop(0, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.48)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
