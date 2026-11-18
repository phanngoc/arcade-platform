"""Render một mô hình 3D thành sprite sheet 2.5D — chạy trong Blender headless:

    blender -b --factory-startup -P render_sprites.py -- '<json>'

json: {
  "model":  ".py (script bpy tự dựng mô hình) | .blend | .glb/.gltf | .fbx | .obj",
  "out":    "đường dẫn PNG ra (atlas JSON cạnh nó, cùng tên .json)",
  "size":   128,              # px mỗi khung (vuông)
  "directions": 8,            # 1 | 4 | 8 hướng nhìn (xoay mô hình quanh trục Z)
  "frames": [1, 24, 3],       # [đầu, cuối, bước] của animation; bỏ trống = 1 khung
  "camera": "dimetric",       # dimetric (iso game 2:1) | isometric (đúng 35.26°) | side | top
  "engine": "eevee",          # eevee | cycles | workbench
  "samples": 16,
  "fps": 12
}

Camera trực giao, khung hình tự vừa mọi hướng × mọi khung (không cắt mất tay/chân
lúc xoay), nền trong suốt, đèn cố định (không xoay theo mô hình — bóng đổ nhất quán
giữa các hướng). Atlas ghi "anchor": pixel của điểm gốc (0,0,0) trong khung —
game đặt điểm này lên ô đất để nhân vật đứng đúng chỗ.
"""

import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Euler, Matrix, Vector

args = json.loads(sys.argv[sys.argv.index("--") + 1])
MODEL = os.path.abspath(args["model"])
OUT = os.path.abspath(args["out"])
SIZE = int(args.get("size", 128))
DIRS = int(args.get("directions", 8))
FR = args.get("frames") or None
CAM = args.get("camera", "dimetric")
ENGINE = args.get("engine", "eevee")
SAMPLES = int(args.get("samples", 16))
FPS = int(args.get("fps", 12))

if DIRS not in (1, 4, 8):
    sys.exit("directions phải là 1, 4 hoặc 8")


def log(*a):
    print("[sprites]", *a, flush=True)


# ── nạp mô hình ───────────────────────────────────────────────────────────────
ext = os.path.splitext(MODEL)[1].lower()
if ext == ".blend":
    bpy.ops.wm.open_mainfile(filepath=MODEL)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == ".py":
        code = open(MODEL, encoding="utf-8").read()
        exec(compile(code, MODEL, "exec"), {"__name__": "__model__", "bpy": bpy})
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=MODEL)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=MODEL)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=MODEL)
    else:
        sys.exit(f"không đọc được loại {ext}")

scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}]
if not meshes:
    sys.exit("mô hình không có hình khối nào để render")

# Bỏ camera/đèn đi kèm mô hình: góc nhìn và ánh sáng phải giống nhau cho mọi sprite của game.
for o in list(scene.objects):
    if o.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(o, do_unlink=True)

# Gốc xoay: mọi object gốc làm con của một empty ở (0,0,0) — xoay empty = đổi hướng nhìn.
pivot = bpy.data.objects.new("__pivot", None)
scene.collection.objects.link(pivot)
for o in list(scene.objects):
    if o is not pivot and o.parent is None:
        o.parent = pivot

frames = [scene.frame_current] if not FR else list(range(int(FR[0]), int(FR[1]) + 1, int(FR[2]) if len(FR) > 2 else 1))
angles = [2 * math.pi * i / DIRS for i in range(DIRS)]

# ── camera ───────────────────────────────────────────────────────────────────
ROT = {
    "dimetric": (math.radians(60), 0, math.radians(45)),  # tile 2:1 — "iso" của game pixel
    "isometric": (math.radians(54.7356), 0, math.radians(45)),
    "side": (math.radians(90), 0, 0),
    "top": (0, 0, 0),
}
if CAM not in ROT:
    sys.exit(f"camera phải là một trong {list(ROT)}")
cam_data = bpy.data.cameras.new("__cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("__cam", cam_data)
scene.collection.objects.link(cam)
cam.rotation_euler = Euler(ROT[CAM])
scene.camera = cam


def corners_world():
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        oe = o.evaluated_get(dg)
        pts += [oe.matrix_world @ Vector(c) for c in oe.bound_box]
    return pts


# Vừa khung với MỌI hướng × MỌI khung hình: đo bound box trong hệ toạ độ camera.
view = cam.rotation_euler.to_matrix().transposed()  # world → camera (chỉ phần xoay)
xs, ys, zs = [], [], []
for f in frames:
    scene.frame_set(f)
    for a in angles:
        pivot.rotation_euler = (0, 0, a)
        bpy.context.view_layer.update()
        for p in corners_world():
            v = view @ p
            xs.append(v.x)
            ys.append(v.y)
            zs.append(v.z)
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
span = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.08  # chừa 4% mỗi bên
cam_data.ortho_scale = span
back = view.transposed()  # camera → world
cam.location = back @ Vector((cx, cy, max(zs) + 10))
cam_data.clip_start, cam_data.clip_end = 0.01, (max(zs) - min(zs)) + 20

# ── ánh sáng cố định ──────────────────────────────────────────────────────────
sun_data = bpy.data.lights.new("__sun", "SUN")
sun_data.energy = 3.0
sun = bpy.data.objects.new("__sun", sun_data)
sun.rotation_euler = Euler((math.radians(50), 0, math.radians(-30)))  # đèn từ trên-trái màn hình
scene.collection.objects.link(sun)
fill_data = bpy.data.lights.new("__fill", "SUN")
fill_data.energy = 0.8
fill = bpy.data.objects.new("__fill", fill_data)
fill.rotation_euler = Euler((math.radians(70), 0, math.radians(150)))
scene.collection.objects.link(fill)
if scene.world is None:
    scene.world = bpy.data.worlds.new("__world")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.6, 0.65, 0.75, 1)
    bg.inputs[1].default_value = 0.6

# ── render ───────────────────────────────────────────────────────────────────
r = scene.render
r.resolution_x = r.resolution_y = SIZE
r.resolution_percentage = 100
r.film_transparent = True
r.image_settings.file_format = "PNG"
r.image_settings.color_mode = "RGBA"
if ENGINE == "cycles":
    r.engine = "CYCLES"
    scene.cycles.samples = SAMPLES
    scene.cycles.device = "CPU"
elif ENGINE == "workbench":
    r.engine = "BLENDER_WORKBENCH"
else:
    for name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            r.engine = name
            break
        except TypeError:
            continue
    try:
        scene.eevee.taa_render_samples = SAMPLES
    except AttributeError:
        pass
scene.view_settings.view_transform = "Standard"  # màu đúng như vật liệu, không bị Filmic/AgX làm nhạt

tmp = tempfile.mkdtemp(prefix="sprites-")
sheet = np.zeros((SIZE * DIRS, SIZE * len(frames), 4), dtype=np.float32)
for di, a in enumerate(angles):
    pivot.rotation_euler = (0, 0, a)
    for fi, f in enumerate(frames):
        scene.frame_set(f)
        path = os.path.join(tmp, f"d{di}_f{fi}.png")
        r.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)[::-1]  # Blender lưu từ dưới lên
        sheet[di * SIZE:(di + 1) * SIZE, fi * SIZE:(fi + 1) * SIZE] = px
        bpy.data.images.remove(img)
    log(f"hướng {di + 1}/{DIRS} xong")

# Điểm neo: (0,0,0) — chân mô hình — chiếu vào khung, pixel tính từ góc trên-trái.
pivot.rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()
nd = world_to_camera_view(scene, cam, Vector((0, 0, 0)))
anchor = [round(nd.x * SIZE, 2), round((1 - nd.y) * SIZE, 2)]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
out_img = bpy.data.images.new("__sheet", width=SIZE * len(frames), height=SIZE * DIRS, alpha=True)
out_img.pixels = sheet[::-1].ravel()
out_img.filepath_raw = OUT
out_img.file_format = "PNG"
out_img.save()

atlas = {
    "image": os.path.basename(OUT),
    "frameW": SIZE,
    "frameH": SIZE,
    "directions": DIRS,
    "frames": len(frames),
    "fps": FPS,
    "camera": CAM,
    # Hàng = hướng nhìn: 0 là mô hình chưa xoay, mỗi hàng sau xoay thêm 360/directions độ quanh Z.
    "rows": [{"dir": i, "degrees": round(math.degrees(a), 2)} for i, a in enumerate(angles)],
    "anchor": anchor,
    "unitsPerPixel": round(span / SIZE, 6),
}
with open(os.path.splitext(OUT)[0] + ".json", "w", encoding="utf-8") as fh:
    json.dump(atlas, fh, indent=2, ensure_ascii=False)
log("OK", json.dumps({"out": OUT, "frames": len(frames), "directions": DIRS, "anchor": anchor}))
