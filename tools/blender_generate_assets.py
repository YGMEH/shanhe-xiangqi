"""Generate the full Shanhe Xiangqi army as rigged, animated GLB assets.

Run:
  blender --background --python tools/blender_generate_assets.py -- --all

Design notes
------------
* Every mesh part is bound to a single bone through a full-weight vertex group
  plus an Armature modifier. That keeps parts rigid (correct for armour plates,
  wheels, weapons) while letting the animation mixer drive the whole rig.
* Models are built facing Blender +Y. glTF export with Y-up maps Blender +Y to
  glTF -Z, so the runtime adds a 180 degree yaw to make them face +Z, matching
  the procedural rigs in src/render/pieces.js.
* Each character exports red and black faction variants with identical rigs.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "assets" / "models" / "generated"


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--only", action="append", default=[])
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------


def make_material(name, color, metallic=0.0, roughness=0.62):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = to_linear(color)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return material


def srgb_to_linear(channel: float) -> float:
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def to_linear(color):
    """glTF baseColorFactor is linear, so author colours in sRGB then convert."""
    r, g, b, a = color
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), a)


def palette(side):
    if side == "black":
        faction = (0.13, 0.17, 0.20, 1)
        accent = (0.62, 0.68, 0.70, 1)
        silk = (0.19, 0.28, 0.31, 1)
    else:
        faction = (0.62, 0.13, 0.10, 1)
        accent = (0.83, 0.62, 0.26, 1)
        silk = (0.74, 0.19, 0.15, 1)
    return {
        "faction": make_material("faction", faction, 0.06, 0.46),
        "accent": make_material("accent", accent, 0.5, 0.4),
        "steel": make_material("steel", (0.41, 0.44, 0.45, 1), 0.58, 0.42),
        "steel-dark": make_material("steel-dark", (0.20, 0.22, 0.24, 1), 0.48, 0.54),
        "leather": make_material("leather", (0.34, 0.23, 0.15, 1), 0.0, 0.8),
        "skin": make_material("skin", (0.78, 0.61, 0.47, 1), 0.0, 0.72),
        "wood": make_material("wood", (0.52, 0.36, 0.20, 1), 0.0, 0.7),
        "silk": make_material("silk", silk, 0.0, 0.72),
        "ivory": make_material("ivory", (0.90, 0.87, 0.78, 1), 0.0, 0.5),
        "hide": make_material("hide", (0.56, 0.55, 0.52, 1), 0.0, 0.86),
        "hide-dark": make_material("hide-dark", (0.30, 0.28, 0.26, 1), 0.0, 0.84),
        "bronze": make_material("bronze", (0.52, 0.38, 0.21, 1), 0.52, 0.46),
    }


# --------------------------------------------------------------------------
# primitive helpers
# --------------------------------------------------------------------------


def _finish(obj, name, material, bevel=0.0):
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def cube(name, location, half, material, bevel=0.0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=2, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = half
    return _finish(obj, name, material, bevel)


def sphere(name, location, scale, material, segments=18, rings=10, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=1, location=location, rotation=rotation
    )
    obj = bpy.context.object
    obj.scale = scale
    return _finish(obj, name, material)


def cylinder(name, location, radius, depth, material, vertices=16, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    return _finish(bpy.context.object, name, material)


def cone(name, location, radius, depth, material, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=radius, radius2=0, depth=depth,
        location=location, rotation=rotation,
    )
    return _finish(bpy.context.object, name, material)


def torus(name, location, major, minor, material, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=24, minor_segments=8,
        location=location, rotation=rotation,
    )
    return _finish(bpy.context.object, name, material)


def taper(name, location, radius_top, radius_bottom, depth, material, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=radius_bottom, radius2=radius_top, depth=depth,
        location=location, rotation=rotation,
    )
    return _finish(bpy.context.object, name, material)


def ring_band(name, location, major, minor, material, rotation=(0, 0, 0)):
    return torus(name, location, major, minor, material, rotation)


def rivet_row(prefix, count, start, step, radius, material, axis="y"):
    """Small studs along a plate; adds read-at-a-glance armour detail cheaply."""
    objects = []
    for index in range(count):
        x = start[0] + step[0] * index
        y = start[1] + step[1] * index
        z = start[2] + step[2] * index
        objects.append(sphere(f"{prefix}-{index}", (x, y, z), (radius, radius, radius), material, 8, 6))
    return objects


def lamellar_plate(prefix, rows, columns, origin, spacing, half, material, depth_material=None):
    """Overlapping armour scales to break up flat chest and skirt blocks."""
    objects = []
    for row in range(rows):
        for column in range(columns):
            x = origin[0] + (column - (columns - 1) / 2) * spacing[0]
            y = origin[1] + row * spacing[1]
            z = origin[2] + row * spacing[2]
            plate = cube(
                f"{prefix}-{row}-{column}",
                (x, y, z),
                (half[0], half[1], half[2]),
                depth_material if depth_material and (row + column) % 4 == 0 else material,
                0.008,
            )
            objects.append(plate)
    return objects


# --------------------------------------------------------------------------
# rig
# --------------------------------------------------------------------------


def create_armature(name, bones):
    data = bpy.data.armatures.new(f"{name}-rig")
    armature = bpy.data.objects.new(f"{name}-rig", data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for bone_name, head, tail, parent in bones:
        edit_bone = data.edit_bones.new(bone_name)
        edit_bone.head = Vector(head)
        edit_bone.tail = Vector(tail)
        edit_bone.use_connect = False
        if parent:
            edit_bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)
    return armature


def assign_weights(parts):
    """Give every part a full-weight vertex group named after its driving bone."""
    for bone_name, objects in parts.items():
        for obj in objects:
            group = obj.vertex_groups.new(name=bone_name)
            group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")


def join_parts(parts, name):
    """Merge the whole character into one skinned mesh with deduplicated slots.

    A single mesh with a handful of material slots keeps the shipped GLB to a
    low draw-call budget while preserving the per-bone vertex weights.
    """
    objects = [obj for group in parts.values() for obj in group]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = f"{name}-mesh"
    merged.data.name = f"{name}-mesh-data"

    # Blender already merges duplicate slots during join; clearing the material
    # list here would reset every polygon to slot 0 and flatten the palette.
    if not merged.data.materials:
        raise RuntimeError(f"{name}: merged mesh has no materials")
    return merged


def bind_mesh(mesh, armature):
    modifier = mesh.modifiers.new("armature", "ARMATURE")
    modifier.object = armature
    mesh.parent = armature


# --------------------------------------------------------------------------
# animation
# --------------------------------------------------------------------------


R = 0.017453292519943295


def pose(armature, frame, rotations=None, offsets=None):
    rotations = rotations or {}
    offsets = offsets or {}
    for bone_name, (rx, ry, rz) in rotations.items():
        bone = armature.pose.bones.get(bone_name)
        if not bone:
            continue
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (rx * R, ry * R, rz * R)
        bone.keyframe_insert("rotation_euler", frame=frame)
    for bone_name, (x, y, z) in offsets.items():
        bone = armature.pose.bones.get(bone_name)
        if not bone:
            continue
        bone.location = (x, y, z)
        bone.keyframe_insert("location", frame=frame)


def make_action(armature, name, frames, keys):
    action = bpy.data.actions.new(name)
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action
    if hasattr(armature.animation_data, "action_slot"):
        for slot in action.slots:
            armature.animation_data.action_slot = slot
            break
    for frame, rotations, offsets in keys:
        pose(armature, frame, rotations, offsets)
    action.use_fake_user = True
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = frames
    return action


def standard_actions(armature, extras=()):
    """Idle / Move / Attack / Defeat built from shared biped bones plus extras."""

    def merge(base, *overrides):
        result = dict(base)
        for override in overrides:
            result.update(override)
        return result

    idle_base = {"spine": (0, 0, 0), "head": (0, 0, 0)}
    make_action(
        armature,
        "Idle",
        40,
        [
            (1, merge(idle_base, {"arm.R": (2, 0, 2), "arm.L": (-2, 0, -2)}), {"root": (0, 0, 0)}),
            (20, merge(idle_base, {"spine": (1, 0, 2), "arm.R": (5, 0, 3), "arm.L": (-5, 0, -3)}), {"root": (0, 0, 0.025)}),
            (40, merge(idle_base, {"arm.R": (2, 0, 2), "arm.L": (-2, 0, -2)}), {"root": (0, 0, 0)}),
        ],
    )

    make_action(
        armature,
        "Move",
        32,
        [
            (1, {"arm.R": (6, 0, 0), "arm.L": (-6, 0, 0), "leg.R": (16, 0, 0), "leg.L": (-16, 0, 0)}, {"root": (0, 0, 0)}),
            (8, {"arm.R": (22, 0, 0), "arm.L": (-22, 0, 0), "leg.R": (-16, 0, 0), "leg.L": (16, 0, 0), "spine": (0, 0, 3)}, {"root": (0, 0, 0.05)}),
            (16, {"arm.R": (6, 0, 0), "arm.L": (-6, 0, 0), "leg.R": (16, 0, 0), "leg.L": (-16, 0, 0)}, {"root": (0, 0, 0)}),
            (24, {"arm.R": (-14, 0, 0), "arm.L": (14, 0, 0), "leg.R": (-16, 0, 0), "leg.L": (16, 0, 0), "spine": (0, 0, -3)}, {"root": (0, 0, 0.05)}),
            (32, {"arm.R": (6, 0, 0), "arm.L": (-6, 0, 0), "leg.R": (16, 0, 0), "leg.L": (-16, 0, 0)}, {"root": (0, 0, 0)}),
        ],
    )

    make_action(
        armature,
        "Attack",
        22,
        [
            (1, {"spine": (0, 0, 0), "arm.R": (0, 0, 0), "arm.L": (0, 0, 0)}, {"root": (0, 0, 0)}),
            (7, {"spine": (-6, 0, -6), "arm.R": (-16, 12, 0), "arm.L": (10, 0, 0), "head": (-4, 0, 0)}, {"root": (0, 0, -0.03)}),
            (11, {"spine": (5, 0, 8), "arm.R": (-62, 6, 0), "arm.L": (-24, 0, 0), "head": (6, 0, 0), "leg.R": (14, 0, 0)}, {"root": (0, 0, 0.10)}),
            (16, {"spine": (3, 0, 5), "arm.R": (-42, 4, 0), "arm.L": (-16, 0, 0)}, {"root": (0, 0, 0.05)}),
            (22, {"spine": (0, 0, 0), "arm.R": (0, 0, 0), "arm.L": (0, 0, 0)}, {"root": (0, 0, 0)}),
        ],
    )

    make_action(
        armature,
        "Defeat",
        26,
        [
            (1, {"spine": (0, 0, 0)}, {"root": (0, 0, 0)}),
            (8, {"spine": (20, 0, 14), "head": (12, 0, 0), "arm.R": (24, 0, 20), "arm.L": (-18, 0, -20)}, {"root": (0, 0, -0.12)}),
            (18, {"spine": (58, 0, 30), "head": (34, 0, 0), "arm.R": (40, 0, 30), "arm.L": (-30, 0, -30)}, {"root": (0, 0, -0.46)}),
            (26, {"spine": (72, 0, 38), "head": (40, 0, 0), "arm.R": (44, 0, 34), "arm.L": (-34, 0, -34)}, {"root": (0, 0, -0.66)}),
        ],
    )

    for extra_name, extra_frames, extra_keys in extras:
        make_action(armature, extra_name, extra_frames, extra_keys)


# --------------------------------------------------------------------------
# rigs
# --------------------------------------------------------------------------


def biped_bones(hip=0.46, shoulder=1.30, head=1.44, head_top=1.95):
    return [
        ("root", (0, 0, 0.02), (0, 0, 0.34), None),
        ("spine", (0, 0, hip), (0, 0, shoulder), "root"),
        ("head", (0, 0, head), (0, 0, head_top), "spine"),
        ("arm.R", (0.34, 0, shoulder - 0.06), (0.46, 0.05, shoulder - 0.7), "spine"),
        ("arm.L", (-0.34, 0, shoulder - 0.06), (-0.46, 0.05, shoulder - 0.7), "spine"),
        ("leg.R", (0.18, 0, hip - 0.06), (0.18, 0, 0.06), "root"),
        ("leg.L", (-0.18, 0, hip - 0.06), (-0.18, 0, 0.06), "root"),
    ]


def quadruped_bones(shoulder=1.05, neck=1.28):
    return [
        ("root", (0, 0, 0.02), (0, 0, 0.36), None),
        ("spine", (0, 0, 0.72), (0, 0, shoulder), "root"),
        ("neck", (0, 0, shoulder), (0, 0.46, neck), "spine"),
        ("head", (0, 0.46, neck), (0, 0.86, neck + 0.12), "neck"),
        ("leg.FL", (-0.34, 0.5, 0.72), (-0.34, 0.5, 0.06), "spine"),
        ("leg.FR", (0.34, 0.5, 0.72), (0.34, 0.5, 0.06), "spine"),
        ("leg.BL", (-0.34, -0.5, 0.72), (-0.34, -0.5, 0.06), "spine"),
        ("leg.BR", (0.34, -0.5, 0.72), (0.34, -0.5, 0.06), "spine"),
        ("tail", (0, -0.72, 1.12), (0, -1.0, 0.78), "spine"),
        ("rider", (0, -0.16, 1.30), (0, -0.16, 2.1), "spine"),
        ("arm.R", (0.24, -0.16, 1.7), (0.34, -0.1, 1.16), "rider"),
    ]


def elephant_bones():
    bones = quadruped_bones(shoulder=1.42, neck=1.62)
    bones += [
        ("trunk.1", (0, 0.78, 1.58), (0, 0.96, 1.18), "head"),
        ("trunk.2", (0, 0.96, 1.18), (0, 1.0, 0.86), "trunk.1"),
        ("trunk.3", (0, 1.0, 0.86), (0, 0.96, 0.6), "trunk.2"),
    ]
    return bones


def cart_bones():
    return [
        ("root", (0, 0, 0.02), (0, 0, 0.4), None),
        ("body", (0, 0, 0.4), (0, 0, 1.5), "root"),
        ("wheel.L", (-0.86, -0.34, 0.5), (-0.86, -0.34, 0.86), "body"),
        ("wheel.R", (0.86, -0.34, 0.5), (0.86, -0.34, 0.86), "body"),
        ("horse", (0, 1.5, 0.2), (0, 1.5, 0.9), "root"),
        ("driver", (0, 0.05, 1.1), (0, 0.05, 1.9), "body"),
        ("arm.R", (0.24, 0.05, 1.6), (0.34, 0.1, 1.05), "driver"),
        ("arm.L", (-0.24, 0.05, 1.6), (-0.34, 0.1, 1.05), "driver"),
    ]


# --------------------------------------------------------------------------
# characters
# --------------------------------------------------------------------------


def build_soldier(pal):
    parts = {
        "root": [], "spine": [], "head": [], "arm.R": [], "arm.L": [],
        "leg.R": [], "leg.L": [],
    }
    parts["root"].append(cylinder("base", (0, 0, 0.055), 0.56, 0.11, pal["steel-dark"], 36))
    parts["root"].append(torus("base-ring", (0, 0, 0.13), 0.5, 0.028, pal["accent"], (0, 0, 0)))
    parts["root"].append(torus("base-ring-inner", (0, 0, 0.145), 0.4, 0.018, pal["bronze"], (0, 0, 0)))
    for index in range(8):
        angle = index * math.radians(45)
        parts["root"].append(
            cube(
                f"base-stud-{index}",
                (math.sin(angle) * 0.445, math.cos(angle) * 0.445, 0.145),
                (0.026, 0.026, 0.02),
                pal["accent"],
                0.006,
            )
        )

    parts["leg.R"].append(cube("leg.R", (0.17, 0, 0.36), (0.11, 0.13, 0.32), pal["leather"], 0.035))
    parts["leg.L"].append(cube("leg.L", (-0.17, 0, 0.36), (0.11, 0.13, 0.32), pal["leather"], 0.035))
    parts["leg.R"].append(cube("boot.R", (0.17, 0.05, 0.07), (0.13, 0.19, 0.06), pal["steel-dark"], 0.03))
    parts["leg.L"].append(cube("boot.L", (-0.17, 0.05, 0.07), (0.13, 0.19, 0.06), pal["steel-dark"], 0.03))
    parts["leg.R"].append(cylinder("greave.R", (0.17, 0.02, 0.36), 0.115, 0.42, pal["steel"], 10))
    parts["leg.L"].append(cylinder("greave.L", (-0.17, 0.02, 0.36), 0.115, 0.42, pal["steel"], 10))
    parts["leg.R"].append(torus("knee.R", (0.17, 0.04, 0.53), 0.115, 0.026, pal["accent"], (math.radians(90), 0, 0)))
    parts["leg.L"].append(torus("knee.L", (-0.17, 0.04, 0.53), 0.115, 0.026, pal["accent"], (math.radians(90), 0, 0)))

    parts["spine"].append(cube("skirt", (0, 0, 0.72), (0.30, 0.21, 0.20), pal["leather"], 0.035))
    parts["spine"].extend(
        lamellar_plate(
            "skirt-plate", 2, 4, (0, -0.215, 0.66), (0.15, 0, 0.17), (0.072, 0.022, 0.085), pal["steel"], pal["accent"]
        )
    )
    parts["spine"].append(taper("torso", (0, 0, 1.04), 0.26, 0.30, 0.62, pal["faction"], 14))
    parts["spine"].append(cube("chest", (0, 0.03, 1.16), (0.30, 0.20, 0.20), pal["steel"], 0.03))
    parts["spine"].extend(
        lamellar_plate(
            "chest-plate", 3, 5, (0, 0.215, 1.06), (0.115, 0, 0.105), (0.055, 0.018, 0.052), pal["steel-dark"], pal["accent"]
        )
    )
    parts["spine"].append(cube("belt", (0, 0, 0.80), (0.31, 0.22, 0.055), pal["accent"], 0.02))
    parts["spine"].append(cube("shoulder.R", (0.30, 0, 1.30), (0.12, 0.15, 0.07), pal["steel"], 0.025))
    parts["spine"].append(cube("shoulder.L", (-0.30, 0, 1.30), (0.12, 0.15, 0.07), pal["steel"], 0.025))
    parts["spine"].append(cube("backpack", (0, -0.24, 1.12), (0.24, 0.10, 0.20), pal["leather"], 0.03))
    parts["spine"].append(cylinder("bedroll", (0, -0.31, 0.92), 0.09, 0.62, pal["silk"], 10, (0, math.radians(90), 0)))

    parts["head"].append(sphere("head", (0, 0.015, 1.50), (0.15, 0.15, 0.17), pal["skin"], 16, 10))
    parts["head"].append(sphere("helmet", (0, 0, 1.60), (0.20, 0.19, 0.15), pal["steel"], 16, 10))
    parts["head"].append(cone("plume", (0, -0.01, 1.85), 0.07, 0.34, pal["faction"], 10))
    parts["head"].append(cube("nose-guard", (0, 0.16, 1.55), (0.035, 0.045, 0.10), pal["steel-dark"], 0.008))
    parts["head"].append(cube("brow-guard", (0, 0.13, 1.66), (0.17, 0.05, 0.035), pal["steel-dark"], 0.008))
    parts["head"].append(sphere("beard", (0, 0.11, 1.40), (0.10, 0.06, 0.10), pal["hide-dark"], 10, 8))
    parts["head"].append(torus("helmet-band", (0, 0, 1.60), 0.195, 0.022, pal["accent"], (math.radians(90), 0, 0)))

    parts["arm.R"].append(cylinder("upper-arm.R", (0.38, 0, 1.06), 0.085, 0.42, pal["leather"], 10))
    parts["arm.R"].append(sphere("hand.R", (0.40, 0.04, 0.84), (0.085, 0.085, 0.085), pal["skin"], 10, 8))
    parts["arm.L"].append(cylinder("upper-arm.L", (-0.38, 0, 1.06), 0.085, 0.42, pal["leather"], 10))
    parts["arm.L"].append(sphere("hand.L", (-0.40, 0.04, 0.84), (0.085, 0.085, 0.085), pal["skin"], 10, 8))
    parts["arm.R"].append(cylinder("bracer.R", (0.38, 0.02, 0.92), 0.10, 0.16, pal["steel"], 10))
    parts["arm.L"].append(cylinder("bracer.L", (-0.38, 0.02, 0.92), 0.10, 0.16, pal["steel"], 10))

    parts["arm.L"].append(cylinder("shield", (-0.52, 0.16, 1.0), 0.42, 0.07, pal["faction"], 26, (math.radians(90), 0, 0)))
    parts["arm.L"].append(cylinder("shield-rim", (-0.52, 0.20, 1.0), 0.30, 0.05, pal["accent"], 24, (math.radians(90), 0, 0)))
    parts["arm.L"].append(cylinder("shield-boss", (-0.52, 0.235, 1.0), 0.12, 0.06, pal["bronze"], 18, (math.radians(90), 0, 0)))
    for index in range(8):
        angle = index * math.radians(45)
        parts["arm.L"].append(
            sphere(
                f"shield-rivet-{index}",
                (
                    -0.52 + math.cos(angle) * 0.25,
                    0.225,
                    1.0 + math.sin(angle) * 0.25,
                ),
                (0.022, 0.022, 0.022),
                pal["accent"],
                8,
                6,
            )
        )
    parts["arm.R"].append(cylinder("spear", (0.52, 0.05, 1.5), 0.028, 2.9, pal["wood"], 8))
    parts["arm.R"].append(cone("spear-tip", (0.52, 0.05, 3.02), 0.075, 0.32, pal["steel"], 8))
    parts["arm.R"].append(cube("spear-collar", (0.52, 0.05, 2.82), (0.06, 0.06, 0.05), pal["accent"], 0.02))
    parts["arm.R"].append(cone("spear-butt", (0.52, 0.05, 0.22), 0.05, 0.16, pal["steel-dark"], 8, (math.pi, 0, 0)))
    parts["arm.R"].append(cube("spear-tassel", (0.52, 0.09, 2.62), (0.05, 0.05, 0.10), pal["silk"], 0.01))
    return parts


def build_general(pal):
    parts = {
        "root": [], "spine": [], "head": [], "arm.R": [], "arm.L": [],
        "leg.R": [], "leg.L": [],
    }
    parts["root"].append(cylinder("base", (0, 0, 0.055), 0.56, 0.11, pal["steel-dark"], 30))
    parts["root"].append(torus("base-ring", (0, 0, 0.13), 0.5, 0.028, pal["accent"]))

    parts["leg.R"].append(cube("leg.R", (0.17, 0, 0.38), (0.12, 0.14, 0.34), pal["steel-dark"], 0.035))
    parts["leg.L"].append(cube("leg.L", (-0.17, 0, 0.38), (0.12, 0.14, 0.34), pal["steel-dark"], 0.035))

    parts["spine"].append(taper("robe", (0, 0, 0.86), 0.30, 0.36, 0.60, pal["silk"], 14))
    parts["spine"].append(cube("torso", (0, 0, 1.20), (0.31, 0.22, 0.24), pal["faction"], 0.04))
    parts["spine"].append(cube("lamellar", (0, 0.02, 1.22), (0.33, 0.24, 0.20), pal["steel"], 0.03))
    parts["spine"].append(cube("belt", (0, 0, 0.98), (0.34, 0.24, 0.06), pal["accent"], 0.02))
    parts["spine"].append(cube("shoulder.R", (0.34, 0, 1.42), (0.14, 0.17, 0.08), pal["accent"], 0.03))
    parts["spine"].append(cube("shoulder.L", (-0.34, 0, 1.42), (0.14, 0.17, 0.08), pal["accent"], 0.03))
    parts["spine"].append(cube("cape", (0, -0.26, 1.05), (0.34, 0.03, 0.42), pal["silk"], 0.02))
    parts["spine"].append(cube("cape-lining", (0, -0.235, 1.05), (0.29, 0.012, 0.36), pal["accent"], 0.008))
    parts["spine"].extend(
        lamellar_plate(
            "general-lamellar", 3, 5, (0, 0.245, 1.06), (0.125, 0, 0.105), (0.06, 0.016, 0.05), pal["steel"], pal["accent"]
        )
    )
    parts["spine"].append(cube("sash", (0.24, 0.18, 1.06), (0.04, 0.03, 0.30), pal["accent"], 0.01, (0, 0, 0.2)))

    parts["head"].append(sphere("head", (0, 0.015, 1.58), (0.15, 0.15, 0.17), pal["skin"], 16, 10))
    parts["head"].append(sphere("helmet", (0, 0, 1.70), (0.21, 0.20, 0.16), pal["accent"], 16, 10))
    parts["head"].append(cone("crest", (0, -0.02, 2.02), 0.09, 0.42, pal["silk"], 10))
    parts["head"].append(cone("horn.R", (0.20, -0.02, 1.82), 0.045, 0.30, pal["accent"], 8, (0, math.radians(50), 0)))
    parts["head"].append(cone("horn.L", (-0.20, -0.02, 1.82), 0.045, 0.30, pal["accent"], 8, (0, math.radians(-50), 0)))
    parts["head"].append(cube("general-nose-guard", (0, 0.165, 1.64), (0.035, 0.05, 0.11), pal["steel-dark"], 0.008))
    parts["head"].append(cube("general-brow", (0, 0.135, 1.76), (0.18, 0.055, 0.035), pal["accent"], 0.008))
    parts["head"].append(sphere("general-beard", (0, 0.12, 1.46), (0.11, 0.07, 0.13), pal["hide-dark"], 10, 8))
    parts["head"].append(torus("helmet-band", (0, 0, 1.70), 0.205, 0.024, pal["silk"], (math.radians(90), 0, 0)))

    parts["arm.R"].append(cylinder("arm.R", (0.40, 0, 1.16), 0.09, 0.46, pal["faction"], 10))
    parts["arm.R"].append(sphere("hand.R", (0.42, 0.04, 0.92), (0.09, 0.09, 0.09), pal["skin"], 10, 8))
    parts["arm.L"].append(cylinder("arm.L", (-0.40, 0, 1.16), 0.09, 0.46, pal["faction"], 10))
    parts["arm.L"].append(sphere("hand.L", (-0.42, 0.04, 0.92), (0.09, 0.09, 0.09), pal["skin"], 10, 8))

    parts["arm.R"].append(cylinder("glaive-shaft", (0.54, 0.04, 1.42), 0.032, 2.7, pal["wood"], 8))
    parts["arm.R"].append(cube("glaive-blade", (0.54, 0.04, 2.86), (0.05, 0.16, 0.30), pal["steel"], 0.02))
    parts["arm.R"].append(cone("glaive-tip", (0.54, 0.04, 3.24), 0.06, 0.30, pal["steel"], 8))
    parts["arm.R"].append(cube("glaive-collar", (0.54, 0.04, 2.52), (0.07, 0.07, 0.06), pal["accent"], 0.02))
    return parts


def build_advisor(pal):
    parts = {
        "root": [], "spine": [], "head": [], "arm.R": [], "arm.L": [],
        "leg.R": [], "leg.L": [],
    }
    parts["root"].append(cylinder("base", (0, 0, 0.055), 0.56, 0.11, pal["steel-dark"], 30))
    parts["root"].append(torus("base-ring", (0, 0, 0.13), 0.5, 0.028, pal["accent"]))

    parts["spine"].append(taper("robe", (0, 0, 0.92), 0.28, 0.42, 0.76, pal["silk"], 16))
    parts["spine"].append(cube("sash", (0, 0, 1.14), (0.30, 0.23, 0.07), pal["accent"], 0.03))
    parts["spine"].append(cube("collar", (0, 0.02, 1.42), (0.24, 0.20, 0.10), pal["faction"], 0.03))
    parts["spine"].append(cube("sleeve.inner", (0, 0, 1.28), (0.26, 0.20, 0.20), pal["silk"], 0.03))

    parts["head"].append(sphere("head", (0, 0.015, 1.60), (0.15, 0.15, 0.17), pal["skin"], 16, 10))
    parts["head"].append(cylinder("cap", (0, 0, 1.79), 0.20, 0.14, pal["steel-dark"], 16))
    parts["head"].append(cube("cap-band", (0, 0, 1.71), (0.21, 0.20, 0.03), pal["accent"], 0.02))
    parts["head"].append(cube("cap-top", (0, 0.02, 1.90), (0.14, 0.12, 0.06), pal["steel-dark"], 0.02))
    parts["head"].append(cube("beard", (0, 0.13, 1.44), (0.09, 0.05, 0.14), pal["hide-dark"], 0.02))

    parts["arm.R"].append(taper("sleeve.R", (0.36, 0, 1.18), 0.09, 0.22, 0.52, pal["silk"], 12))
    parts["arm.R"].append(sphere("hand.R", (0.40, 0.05, 0.92), (0.085, 0.085, 0.085), pal["skin"], 10, 8))
    parts["arm.L"].append(taper("sleeve.L", (-0.36, 0, 1.18), 0.09, 0.22, 0.52, pal["silk"], 12))
    parts["arm.L"].append(sphere("hand.L", (-0.40, 0.05, 0.92), (0.085, 0.085, 0.085), pal["skin"], 10, 8))

    for index in range(7):
        angle = math.radians(-54 + index * 18)
        parts["arm.R"].append(
            cube(
                f"fan-rib-{index}",
                (0.56 + math.sin(angle) * 0.22, 0.08, 1.16 + math.cos(angle) * 0.22),
                (0.022, 0.012, 0.16),
                pal["accent"] if index == 3 else pal["silk"],
                0.008,
                (0, angle, 0),
            )
        )
    parts["arm.R"].append(cylinder("fan-handle", (0.56, 0.08, 0.94), 0.028, 0.30, pal["steel-dark"], 8))
    return parts


def build_elephant(pal):
    parts = {
        "root": [], "spine": [], "neck": [], "head": [],
        "leg.FL": [], "leg.FR": [], "leg.BL": [], "leg.BR": [],
        "tail": [], "rider": [], "arm.R": [],
        "trunk.1": [], "trunk.2": [], "trunk.3": [],
    }
    parts["root"].append(cylinder("base", (0, 0, 0.055), 0.68, 0.12, pal["steel-dark"], 30))
    parts["root"].append(torus("base-ring", (0, 0, 0.14), 0.6, 0.03, pal["accent"]))

    for bone, x, y in (("leg.FL", -0.36, 0.52), ("leg.FR", 0.36, 0.52), ("leg.BL", -0.36, -0.52), ("leg.BR", 0.36, -0.52)):
        parts[bone].append(cylinder(f"leg-{bone}", (x, y, 0.44), 0.20, 0.78, pal["hide"], 14))
        parts[bone].append(cylinder(f"foot-{bone}", (x, y - 0.02, 0.09), 0.24, 0.14, pal["hide-dark"], 14))

    parts["spine"].append(sphere("body", (0, 0, 1.12), (0.86, 1.02, 0.72), pal["hide"], 20, 14))
    parts["spine"].append(cube("saddle-blanket", (0, 0, 1.62), (0.72, 0.86, 0.10), pal["silk"], 0.04))
    parts["spine"].append(cube("saddle-frame", (0, 0, 1.78), (0.56, 0.62, 0.14), pal["wood"], 0.04))
    parts["spine"].append(cube("armour-front", (0, 0.84, 1.24), (0.66, 0.14, 0.46), pal["faction"], 0.04))
    parts["spine"].append(cube("armour-side.R", (0.80, 0, 1.22), (0.10, 0.72, 0.40), pal["faction"], 0.04))
    parts["spine"].append(cube("armour-side.L", (-0.80, 0, 1.22), (0.10, 0.72, 0.40), pal["faction"], 0.04))
    parts["spine"].append(torus("armour-band", (0, 0.84, 1.24), 0.36, 0.05, pal["accent"], (math.radians(90), 0, 0)))
    parts["spine"].extend(
        lamellar_plate(
            "elephant-plate", 2, 5, (0, 0.985, 1.09), (0.28, 0, 0.19), (0.13, 0.02, 0.09), pal["steel"], pal["accent"]
        )
    )
    for side in (-1, 1):
        parts["spine"].append(cube(f"elephant-skirt-{side}", (side * 0.86, -0.1, 1.16), (0.035, 0.62, 0.34), pal["silk"], 0.015))
        parts["spine"].append(torus(f"elephant-medallion-{side}", (side * 0.9, 0.15, 1.24), 0.15, 0.035, pal["accent"], (0, math.radians(90), 0)))

    parts["neck"].append(sphere("neck", (0, 0.62, 1.52), (0.54, 0.58, 0.54), pal["hide"], 18, 12))
    parts["head"].append(sphere("head", (0, 0.86, 1.54), (0.44, 0.48, 0.44), pal["hide"], 18, 12))
    parts["head"].append(sphere("forehead-plate", (0, 0.94, 1.72), (0.40, 0.36, 0.22), pal["faction"], 16, 10))
    parts["head"].append(cube("ear.R", (0.54, 0.66, 1.56), (0.05, 0.30, 0.36), pal["hide"], 0.03, (0, 0.2, 0)))
    parts["head"].append(cube("ear.L", (-0.54, 0.66, 1.56), (0.05, 0.30, 0.36), pal["hide"], 0.03, (0, -0.2, 0)))
    parts["head"].append(cube("ear-armour.R", (0.585, 0.64, 1.56), (0.02, 0.24, 0.28), pal["faction"], 0.015, (0, 0.2, 0)))
    parts["head"].append(cube("ear-armour.L", (-0.585, 0.64, 1.56), (0.02, 0.24, 0.28), pal["faction"], 0.015, (0, -0.2, 0)))
    parts["head"].append(cone("tusk.R", (0.24, 1.06, 1.28), 0.055, 0.62, pal["ivory"], 10, (math.radians(112), 0, -0.22)))
    parts["head"].append(cone("tusk.L", (-0.24, 1.06, 1.28), 0.055, 0.62, pal["ivory"], 10, (math.radians(112), 0, 0.22)))
    parts["head"].append(sphere("eye.R", (0.30, 1.14, 1.66), (0.055, 0.04, 0.055), pal["hide-dark"], 10, 8))
    parts["head"].append(sphere("eye.L", (-0.30, 1.14, 1.66), (0.055, 0.04, 0.055), pal["hide-dark"], 10, 8))

    parts["trunk.1"].append(cylinder("trunk-1", (0, 0.98, 1.38), 0.15, 0.44, pal["hide"], 12))
    parts["trunk.2"].append(cylinder("trunk-2", (0, 1.0, 1.02), 0.125, 0.36, pal["hide"], 12))
    parts["trunk.3"].append(cylinder("trunk-3", (0, 0.96, 0.74), 0.10, 0.30, pal["hide"], 12))

    parts["tail"].append(cylinder("tail", (0, -1.0, 1.04), 0.045, 0.62, pal["hide"], 8, (math.radians(20), 0, 0)))

    parts["rider"].append(taper("rider-body", (0, -0.10, 2.06), 0.20, 0.26, 0.46, pal["faction"], 12))
    parts["rider"].append(sphere("rider-head", (0, -0.10, 2.44), (0.14, 0.14, 0.16), pal["skin"], 14, 10))
    parts["rider"].append(sphere("rider-helmet", (0, -0.10, 2.54), (0.18, 0.17, 0.13), pal["steel"], 14, 10))
    parts["rider"].append(cone("rider-plume", (0, -0.10, 2.76), 0.06, 0.28, pal["faction"], 8))
    parts["rider"].append(cylinder("rider-banner-pole", (0.42, -0.30, 2.36), 0.032, 1.5, pal["wood"], 8))
    parts["rider"].append(cube("rider-banner", (0.42, -0.30, 3.10), (0.02, 0.26, 0.34), pal["silk"], 0.01))
    return parts


def build_horse(pal):
    parts = {
        "root": [], "spine": [], "neck": [], "head": [],
        "leg.FL": [], "leg.FR": [], "leg.BL": [], "leg.BR": [],
        "tail": [], "rider": [], "arm.R": [],
    }
    parts["root"].append(cylinder("base", (0, 0, 0.055), 0.6, 0.11, pal["steel-dark"], 30))
    parts["root"].append(torus("base-ring", (0, 0, 0.13), 0.54, 0.028, pal["accent"]))

    for bone, x, y in (("leg.FL", -0.30, 0.46), ("leg.FR", 0.30, 0.46), ("leg.BL", -0.30, -0.48), ("leg.BR", 0.30, -0.48)):
        parts[bone].append(cylinder(f"leg-{bone}", (x, y, 0.42), 0.085, 0.74, pal["hide-dark"], 10))
        parts[bone].append(cylinder(f"hoof-{bone}", (x, y, 0.07), 0.11, 0.10, pal["steel-dark"], 10))

    parts["spine"].append(sphere("body", (0, 0, 1.02), (0.44, 0.74, 0.44), pal["hide-dark"], 18, 12))
    parts["spine"].append(cube("saddle", (0, -0.06, 1.40), (0.34, 0.42, 0.10), pal["leather"], 0.04))
    parts["spine"].append(cube("saddle-cloth", (0, -0.06, 1.32), (0.38, 0.48, 0.04), pal["silk"], 0.02))
    parts["spine"].append(cube("chest-plate", (0, 0.58, 1.06), (0.36, 0.10, 0.34), pal["faction"], 0.03))
    parts["spine"].append(cube("horse-flank-armour.R", (0.455, -0.02, 1.06), (0.03, 0.52, 0.32), pal["faction"], 0.02))
    parts["spine"].append(cube("horse-flank-armour.L", (-0.455, -0.02, 1.06), (0.03, 0.52, 0.32), pal["faction"], 0.02))
    parts["spine"].append(cube("horse-crupper", (0, -0.72, 1.10), (0.36, 0.06, 0.34), pal["silk"], 0.02))
    parts["spine"].append(torus("girth", (0, -0.02, 1.02), 0.42, 0.028, pal["leather"], (0, 0, math.radians(90))))
    for side in (-1, 1):
        parts["spine"].append(cube(f"stirrup-leather-{side}", (side * 0.42, 0.05, 1.02), (0.025, 0.12, 0.30), pal["leather"], 0.008))
        parts["spine"].append(torus(f"stirrup-{side}", (side * 0.44, 0.26, 0.76), 0.085, 0.022, pal["steel-dark"], (math.radians(90), 0, 0)))

    parts["neck"].append(taper("neck", (0, 0.50, 1.44), 0.17, 0.24, 0.62, pal["hide-dark"], 12, (math.radians(-28), 0, 0)))
    parts["head"].append(sphere("head", (0, 0.80, 1.72), (0.19, 0.30, 0.21), pal["hide-dark"], 16, 10, (math.radians(-16), 0, 0)))
    parts["head"].append(cone("ear.R", (0.14, 0.68, 1.92), 0.055, 0.24, pal["hide-dark"], 8, (0, 0, -0.2)))
    parts["head"].append(cone("ear.L", (-0.14, 0.68, 1.92), 0.055, 0.24, pal["hide-dark"], 8, (0, 0, 0.2)))
    parts["head"].append(cube("chamfron", (0, 0.88, 1.82), (0.14, 0.10, 0.20), pal["steel"], 0.02, (math.radians(-16), 0, 0)))
    parts["head"].append(cone("chamfron-spike", (0, 0.92, 2.08), 0.05, 0.26, pal["accent"], 8, (math.radians(-16), 0, 0)))
    parts["head"].append(cylinder("muzzle-band", (0, 0.98, 1.63), 0.10, 0.05, pal["steel-dark"], 10, (math.radians(90), 0, 0)))

    parts["tail"].append(taper("tail", (0, -0.84, 1.06), 0.09, 0.13, 0.72, pal["hide-dark"], 8, (math.radians(-28), 0, 0)))

    parts["rider"].append(taper("rider-body", (0, -0.08, 1.76), 0.20, 0.26, 0.50, pal["faction"], 12))
    parts["rider"].append(cube("rider-armour", (0, -0.04, 1.84), (0.26, 0.20, 0.20), pal["steel"], 0.03))
    parts["rider"].append(sphere("rider-head", (0, -0.08, 2.17), (0.14, 0.14, 0.16), pal["skin"], 14, 10))
    parts["rider"].append(sphere("rider-helmet", (0, -0.08, 2.27), (0.19, 0.18, 0.14), pal["steel"], 14, 10))
    parts["rider"].append(cone("rider-plume", (0, -0.08, 2.50), 0.065, 0.30, pal["faction"], 8))
    parts["rider"].append(cube("rider-cape", (0, -0.26, 1.62), (0.24, 0.03, 0.30), pal["silk"], 0.02))
    parts["rider"].append(cube("rider-cape-lining", (0, -0.235, 1.62), (0.20, 0.012, 0.26), pal["accent"], 0.008))
    parts["rider"].append(cube("rider-shoulder.R", (0.24, -0.04, 2.0), (0.09, 0.13, 0.06), pal["steel"], 0.02))
    parts["rider"].append(cube("rider-shoulder.L", (-0.24, -0.04, 2.0), (0.09, 0.13, 0.06), pal["steel"], 0.02))

    parts["arm.R"].append(cylinder("rider-arm.R", (0.26, 0, 1.86), 0.075, 0.44, pal["faction"], 10))
    parts["arm.R"].append(cylinder("rider-spear", (0.36, 0.05, 1.96), 0.026, 2.6, pal["wood"], 8, (0, math.radians(-8), 0)))
    parts["arm.R"].append(cone("rider-spear-tip", (0.54, 0.05, 3.24), 0.07, 0.30, pal["steel"], 8, (0, math.radians(-8), 0)))
    return parts


def build_chariot(pal):
    parts = {
        "root": [], "body": [], "wheel.L": [], "wheel.R": [],
        "horse": [], "driver": [], "arm.R": [], "arm.L": [],
    }
    parts["root"].append(cylinder("base", (0, 0, 0.055), 0.68, 0.12, pal["steel-dark"], 30))
    parts["root"].append(torus("base-ring", (0, 0, 0.14), 0.6, 0.03, pal["accent"]))

    parts["body"].append(cube("cart-floor", (0, -0.30, 0.72), (0.68, 0.86, 0.09), pal["wood"], 0.04))
    parts["body"].append(cube("cart-side.R", (0.62, -0.30, 1.06), (0.07, 0.80, 0.30), pal["faction"], 0.03))
    parts["body"].append(cube("cart-side.L", (-0.62, -0.30, 1.06), (0.07, 0.80, 0.30), pal["faction"], 0.03))
    parts["body"].append(cube("cart-back", (0, -1.12, 1.06), (0.66, 0.07, 0.34), pal["faction"], 0.03))
    parts["body"].append(cube("cart-rail.R", (0.64, -0.30, 1.38), (0.06, 0.82, 0.05), pal["accent"], 0.02))
    parts["body"].append(cube("cart-rail.L", (-0.64, -0.30, 1.38), (0.06, 0.82, 0.05), pal["accent"], 0.02))
    parts["body"].append(cube("draft-pole", (0, 0.90, 0.62), (0.05, 0.70, 0.05), pal["wood"], 0.02))
    parts["body"].append(cube("cart-floor-plank-1", (0, -0.30, 0.80), (0.60, 0.78, 0.018), pal["silk"], 0.006))
    parts["body"].append(cube("cart-floor-plank-2", (0, -0.30, 0.825), (0.52, 0.70, 0.016), pal["accent"], 0.006))
    for index, (x, y) in enumerate(((-0.28, 0.98), (0.28, 0.98), (0, 0.62))):
        parts["body"].append(cylinder(f"harness-ring-{index}", (x, y, 0.66), 0.055, 0.045, pal["accent"], 10, (math.radians(90), 0, 0)))
    parts["body"].append(cylinder("banner-pole", (0.60, -0.34, 1.86), 0.032, 1.5, pal["wood"], 8))
    parts["body"].append(cube("banner", (0.60, -0.34, 2.50), (0.02, 0.24, 0.32), pal["silk"], 0.01))

    for bone, x in (("wheel.L", -0.86), ("wheel.R", 0.86)):
        parts[bone].append(torus(f"wheel-rim-{bone}", (x, -0.34, 0.52), 0.50, 0.06, pal["wood"], (0, math.radians(90), 0)))
        parts[bone].append(torus(f"wheel-iron-{bone}", (x, -0.34, 0.52), 0.52, 0.022, pal["steel-dark"], (0, math.radians(90), 0)))
        parts[bone].append(cylinder(f"wheel-hub-{bone}", (x, -0.34, 0.52), 0.10, 0.14, pal["steel-dark"], 12, (0, math.radians(90), 0)))
        for index in range(8):
            angle = index * math.radians(22.5)
            parts[bone].append(
                cube(
                    f"spoke-{bone}-{index}",
                    (x, -0.34 + math.sin(angle) * 0.25, 0.52 + math.cos(angle) * 0.25),
                    (0.03, 0.24, 0.03),
                    pal["wood"],
                    0.0,
                    (angle, 0, 0),
                )
            )

    parts["horse"].append(sphere("cart-horse-body", (0, 1.52, 0.86), (0.34, 0.56, 0.34), pal["hide-dark"], 16, 10))
    parts["horse"].append(taper("cart-horse-neck", (0, 2.02, 1.14), 0.14, 0.20, 0.48, pal["hide-dark"], 10, (math.radians(-30), 0, 0)))
    parts["horse"].append(sphere("cart-horse-head", (0, 2.26, 1.34), (0.15, 0.24, 0.17), pal["hide-dark"], 14, 10))
    for index, (x, y) in enumerate(((-0.22, 1.22), (0.22, 1.22), (-0.22, 1.80), (0.22, 1.80))):
        parts["horse"].append(cylinder(f"cart-horse-leg-{index}", (x, y, 0.38), 0.07, 0.62, pal["hide-dark"], 8))
    parts["horse"].append(cube("cart-horse-armour", (0, 1.52, 1.06), (0.30, 0.38, 0.20), pal["silk"], 0.03))

    parts["driver"].append(taper("driver-body", (0, -0.34, 1.34), 0.20, 0.26, 0.48, pal["faction"], 12))
    parts["driver"].append(sphere("driver-head", (0, -0.34, 1.72), (0.14, 0.14, 0.16), pal["skin"], 14, 10))
    parts["driver"].append(sphere("driver-helmet", (0, -0.34, 1.82), (0.18, 0.17, 0.13), pal["steel"], 14, 10))
    parts["driver"].append(cone("driver-plume", (0, -0.34, 2.04), 0.06, 0.28, pal["faction"], 8))

    parts["arm.R"].append(cylinder("driver-arm.R", (0.26, -0.34, 1.42), 0.07, 0.42, pal["faction"], 10))
    parts["arm.R"].append(cylinder("driver-spear", (0.38, -0.28, 1.52), 0.026, 2.5, pal["wood"], 8))
    parts["arm.R"].append(cone("driver-spear-tip", (0.38, -0.28, 2.72), 0.07, 0.30, pal["steel"], 8))
    parts["arm.L"].append(cylinder("driver-arm.L", (-0.26, -0.34, 1.42), 0.07, 0.42, pal["faction"], 10))
    return parts


def build_cannon(pal):
    parts = {
        "root": [], "body": [], "barrel": [], "wheel.L": [], "wheel.R": [],
        "operator.L": [], "operator.R": [], "arm.R": [],
    }
    parts["root"].append(cylinder("base", (0, 0, 0.055), 0.62, 0.11, pal["steel-dark"], 30))
    parts["root"].append(torus("base-ring", (0, 0, 0.13), 0.56, 0.028, pal["accent"]))

    parts["body"].append(cube("carriage", (0, -0.10, 0.56), (0.34, 0.70, 0.14), pal["wood"], 0.04))
    parts["body"].append(cube("carriage-front", (0, 0.52, 0.44), (0.52, 0.10, 0.10), pal["steel-dark"], 0.03))
    parts["body"].append(cube("powder-chest", (0, -0.78, 0.46), (0.32, 0.26, 0.20), pal["wood"], 0.03))
    parts["body"].append(cube("powder-band-1", (0, -0.78, 0.46), (0.34, 0.05, 0.21), pal["accent"], 0.01))
    parts["body"].append(cube("powder-band-2", (0, -0.78, 0.46), (0.05, 0.27, 0.21), pal["accent"], 0.01))
    parts["body"].append(cube("carriage-side.R", (0.36, -0.08, 0.62), (0.05, 0.6, 0.13), pal["faction"], 0.015))
    parts["body"].append(cube("carriage-side.L", (-0.36, -0.08, 0.62), (0.05, 0.6, 0.13), pal["faction"], 0.015))
    parts["body"].append(cylinder("elevation-screw", (0, -0.34, 0.74), 0.065, 0.34, pal["bronze"], 12))
    parts["body"].append(torus("elevation-wheel", (0, -0.34, 0.92), 0.09, 0.022, pal["accent"], (0, math.radians(90), 0)))

    for bone, x in (("wheel.L", -0.54), ("wheel.R", 0.54)):
        parts[bone].append(torus(f"cannon-wheel-{bone}", (x, -0.06, 0.48), 0.42, 0.07, pal["wood"], (0, math.radians(90), 0)))
        parts[bone].append(torus(f"cannon-wheel-iron-{bone}", (x, -0.06, 0.48), 0.445, 0.022, pal["steel-dark"], (0, math.radians(90), 0)))
        parts[bone].append(cylinder(f"cannon-hub-{bone}", (x, -0.06, 0.48), 0.10, 0.16, pal["steel-dark"], 12, (0, math.radians(90), 0)))
        for index in range(6):
            angle = index * math.radians(30)
            parts[bone].append(
                cube(
                    f"cannon-spoke-{bone}-{index}",
                    (x, -0.06 + math.sin(angle) * 0.21, 0.48 + math.cos(angle) * 0.21),
                    (0.03, 0.20, 0.03),
                    pal["wood"],
                    0.0,
                    (angle, 0, 0),
                )
            )

    parts["barrel"].append(taper("gun-barrel", (0, 0.30, 0.98), 0.15, 0.20, 1.50, pal["steel"], 20, (math.radians(-12), 0, 0)))
    parts["barrel"].append(cylinder("muzzle", (0, 0.98, 1.12), 0.215, 0.14, pal["accent"], 20, (math.radians(-12), 0, 0)))
    parts["barrel"].append(cylinder("breech", (0, -0.36, 0.96), 0.225, 0.16, pal["accent"], 20, (math.radians(-12), 0, 0)))
    parts["barrel"].append(cylinder("band-1", (0, 0.06, 1.03), 0.185, 0.07, pal["steel-dark"], 18, (math.radians(-12), 0, 0)))
    parts["barrel"].append(cylinder("band-2", (0, 0.62, 1.07), 0.175, 0.07, pal["steel-dark"], 18, (math.radians(-12), 0, 0)))

    for bone, x in (("operator.L", -0.56), ("operator.R", 0.56)):
        parts[bone].append(taper(f"{bone}-body", (x, -0.64, 0.92), 0.15, 0.19, 0.42, pal["faction"], 10))
        parts[bone].append(sphere(f"{bone}-head", (x, -0.64, 1.22), (0.115, 0.115, 0.13), pal["skin"], 12, 8))
        parts[bone].append(cylinder(f"{bone}-cap", (x, -0.64, 1.33), 0.145, 0.10, pal["steel-dark"], 12))
        parts[bone].append(cone(f"{bone}-plume", (x, -0.64, 1.46), 0.05, 0.20, pal["faction"], 8))

    parts["arm.R"].append(cylinder("rammer", (0.34, -0.10, 1.02), 0.03, 1.9, pal["wood"], 8, (math.radians(-68), 0, 0)))
    return parts


# --------------------------------------------------------------------------
# per-character rig specs and animation extras
# --------------------------------------------------------------------------


def build_cannon_rig():
    return [
        ("root", (0, 0, 0.02), (0, 0, 0.36), None),
        ("body", (0, 0, 0.36), (0, 0, 1.0), "root"),
        ("barrel", (0, -0.30, 0.96), (0, 0.90, 1.10), "body"),
        ("wheel.L", (-0.54, -0.06, 0.48), (-0.54, -0.06, 0.84), "body"),
        ("wheel.R", (0.54, -0.06, 0.48), (0.54, -0.06, 0.84), "body"),
        ("operator.L", (-0.56, -0.64, 0.70), (-0.56, -0.64, 1.36), "root"),
        ("operator.R", (0.56, -0.64, 0.70), (0.56, -0.64, 1.36), "root"),
        ("arm.R", (0.34, -0.10, 1.0), (0.34, 0.80, 1.0), "body"),
    ]


BUILDERS = {
    "soldier": (build_soldier, lambda: biped_bones(), "biped"),
    "general": (build_general, lambda: biped_bones(), "biped"),
    "advisor": (build_advisor, lambda: biped_bones(), "biped"),
    "elephant": (build_elephant, elephant_bones, "elephant"),
    "horse": (build_horse, quadruped_bones, "quadruped"),
    "chariot": (build_chariot, cart_bones, "cart"),
    "cannon": (build_cannon, build_cannon_rig, "cannon"),
}


def animation_extras(kind, armature):
    if kind == "quadruped":
        return [
            (
                "Idle-Gait",
                32,
                [
                    (1, {"leg.FL": (6, 0, 0), "leg.BR": (6, 0, 0), "neck": (0, 0, 0), "tail": (0, 0, 4)}, {}),
                    (16, {"leg.FL": (-6, 0, 0), "leg.BR": (-6, 0, 0), "neck": (2, 0, 2), "tail": (0, 0, -4)}, {}),
                    (32, {"leg.FL": (6, 0, 0), "leg.BR": (6, 0, 0), "neck": (0, 0, 0), "tail": (0, 0, 4)}, {}),
                ],
            )
        ]
    if kind == "elephant":
        return [
            (
                "Trunk-Sway",
                48,
                [
                    (1, {"trunk.1": (0, 0, 6), "trunk.2": (0, 0, 8), "trunk.3": (0, 0, 10), "tail": (0, 0, 8)}, {}),
                    (24, {"trunk.1": (-14, 0, -6), "trunk.2": (-18, 0, -8), "trunk.3": (-20, 0, -10), "tail": (0, 0, -8)}, {}),
                    (48, {"trunk.1": (0, 0, 6), "trunk.2": (0, 0, 8), "trunk.3": (0, 0, 10), "tail": (0, 0, 8)}, {}),
                ],
            )
        ]
    return []


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------


def export_glb(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_nla_strips=False,
        export_force_sampling=True,
        export_frame_range=False,
        export_yup=True,
        export_skins=True,
    )


def build_character(key, side):
    builder, rig_factory, kind = BUILDERS[key]
    clear_scene()
    pal = palette(side)
    parts = builder(pal)
    armature = create_armature(key, rig_factory())
    assign_weights(parts)
    mesh = join_parts(parts, key)
    bind_mesh(mesh, armature)
    standard_actions(armature, animation_extras(kind, armature))
    suffix = "" if side == "red" else "-black"
    export_glb(OUTPUT_DIR / f"{key}{suffix}.glb")
    part_count = sum(len(value) for value in parts.values())
    print(
        f"generated {key}{suffix}: {part_count} parts merged into 1 mesh, "
        f"{len(armature.pose.bones)} bones, {len(mesh.data.materials)} materials"
    )


def main():
    args = parse_args()
    requested = set(args.only)
    for key in BUILDERS:
        if args.all or not requested or key in requested:
            build_character(key, "red")
            build_character(key, "black")
    print(f"Generated assets in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
