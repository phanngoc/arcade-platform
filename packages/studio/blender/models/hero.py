"""Nhân vật mẫu low-poly dựng bằng bpy: thân, đầu, mắt, mũ — có animation nhún (bob)
24 khung. Mẫu cho agent: dựng mô hình bằng code, gốc (0,0,0) là chân, mặt nhìn -Y."""
import bpy, math

def mat(name, rgb, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m

def add(op, name, m, **kw):
    op(**kw)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth() if name in ("head", "eyeL", "eyeR") else None
    return o

skin, body, hat, eye = mat("skin", (0.98, 0.78, 0.6)), mat("body", (0.16, 0.47, 0.84)), mat("hat", (0.92, 0.35, 0.2)), mat("eye", (0.05, 0.05, 0.08), 0.2)
root = bpy.data.objects.new("hero", None); bpy.context.scene.collection.objects.link(root)
parts = [
    add(bpy.ops.mesh.primitive_cylinder_add, "body", body, vertices=10, radius=0.42, depth=0.9, location=(0, 0, 0.45)),
    add(bpy.ops.mesh.primitive_uv_sphere_add, "head", skin, segments=16, ring_count=10, radius=0.38, location=(0, 0, 1.22)),
    add(bpy.ops.mesh.primitive_cone_add, "hat", hat, vertices=10, radius1=0.42, depth=0.5, location=(0, 0, 1.68)),
    add(bpy.ops.mesh.primitive_uv_sphere_add, "eyeL", eye, segments=8, ring_count=6, radius=0.07, location=(-0.14, -0.33, 1.27)),
    add(bpy.ops.mesh.primitive_uv_sphere_add, "eyeR", eye, segments=8, ring_count=6, radius=0.07, location=(0.14, -0.33, 1.27)),
]
for p in parts: p.parent = root
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 1, 24
for f, z, sx in ((1, 0, 1.0), (7, 0.12, 0.95), (13, 0, 1.0), (19, -0.04, 1.06), (24, 0, 1.0)):
    root.location.z = z; root.scale = (sx, sx, 2 - sx)
    root.keyframe_insert("location", frame=f); root.keyframe_insert("scale", frame=f)
