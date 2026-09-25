import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MODEL_MANIFEST } from "../src/render/asset-loader.js";

test("骑兵加载带骑手的战马而非裸马", () => {
  for (const key of ["horse", "horse-black"]) {
    assert.equal(MODEL_MANIFEST[key], "assets/models/generated/mounted-warrior.glb");
  }
});

test("新古炮与营地储物箱均有独立资源入口", () => {
  for (const key of ["cannon", "cannon-black"]) {
    assert.equal(MODEL_MANIFEST[key], "assets/models/generated/cannon-antique.glb");
  }
  assert.equal(MODEL_MANIFEST.chest, "assets/models/generated/treasure-chest.glb");
});

test("模型清单中的每个文件确实存在", () => {
  for (const [key, path] of Object.entries(MODEL_MANIFEST)) {
    assert.ok(existsSync(fileURLToPath(new URL('../public/' + path, import.meta.url))), key);
  }
});
