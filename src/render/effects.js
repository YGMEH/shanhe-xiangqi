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

  impact(position, heavy = false) {
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
    smoke.scale.setScalar(heavy ? 0.45 : 0.28);
    this.scene.add(smoke);

    const sparks = new THREE.Group();
    const velocities = [];
    for (let i = 0; i < (heavy ? 14 : 8); i += 1) {
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
      velocities.push(direction.multiplyScalar(1.6 + Math.random() * 2.2));
      sparks.add(spark);
    }
    this.scene.add(sparks);

    this.add({
      elapsed: 0,
      duration: heavy ? 0.9 : 0.62,
      update: (t) => {
        smoke.scale.setScalar((heavy ? 0.45 : 0.28) + t * (heavy ? 1.15 : 0.7));
        smoke.material.opacity = (1 - t) * 0.82;
        smoke.position.y += 0.006;
        sparks.children.forEach((spark, index) => {
          spark.position.addScaledVector(velocities[index], 0.016);
          velocities[index].y -= 0.08 * 0.016;
          spark.scale.setScalar(1 - t * 0.7);
        });
      },
      dispose: () => {
        this.scene.remove(smoke);
        this.scene.remove(sparks);
        smoke.material.dispose();
      },
    });
  }

  killBurst(position, heavy = false) {
    this.dust(position, heavy ? 0x6f6254 : 0x8a7d67, heavy ? 1.8 : 1.1);
    this.impact(position, heavy);
    const ringGeometry = new THREE.RingGeometry(0.1, heavy ? 0.2 : 0.15, 28);
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: heavy ? 0xffb36a : 0xf0c98a,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(position);
    ring.position.y = Math.max(0.04, position.y - 0.24);
    this.scene.add(ring);
    this.add({
      elapsed: 0,
      duration: 0.52,
      update: (t) => {
        const scale = 1 + t * (heavy ? 5.6 : 4.2);
        ring.scale.setScalar(scale);
        ringMaterial.opacity = (1 - t) * 0.62;
      },
      dispose: () => {
        this.scene.remove(ring);
        ringGeometry.dispose();
        ringMaterial.dispose();
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
          resolve();
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
