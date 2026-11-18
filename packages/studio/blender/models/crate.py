"""Item mẫu: rương gỗ low-poly có nắp vát cạnh và đai kim loại, xoay chậm 1 vòng
(animation 24 khung) — mẫu cho đồ vật nhặt được. Gốc (0,0,0) là đáy."""
import bpy, math

def mat(name, rgb, metal=0.0, rough=0.7):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Metallic"].default_value = metal; b.inputs["Roughness"].default_value = rough
    return m

wood, band, gem = mat("wood", (0.55, 0.32, 0.15)), mat("band", (0.85, 0.7, 0.25), 0.9, 0.35), mat("gem", (0.2, 0.85, 0.7), 0.0, 0.15)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.35)); box = bpy.context.active_object; box.scale = (0.9, 0.6, 0.7)
bpy.ops.object.modifier_add(type="BEVEL"); box.modifiers["Bevel"].width = 0.05; box.modifiers["Bevel"].segments = 2
box.data.materials.append(wood)
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.31, depth=0.9, location=(0, 0, 0.7), rotation=(0, math.pi / 2, 0)); lid = bpy.context.active_object
lid.scale = (1, 1, 1); lid.data.materials.append(wood)
for x in (-0.3, 0.3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0, 0.5)); s = bpy.context.active_object; s.scale = (0.08, 0.64, 1.05); s.data.materials.append(band)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.09, location=(0, -0.32, 0.55)); g = bpy.context.active_object; g.data.materials.append(gem)
root = bpy.data.objects.new("crate", None); bpy.context.scene.collection.objects.link(root)
for o in list(bpy.context.scene.objects):
    if o is not root and o.parent is None: o.parent = root
sc = bpy.context.scene; sc.frame_start, sc.frame_end = 1, 24
root.rotation_euler.z = 0; root.keyframe_insert("rotation_euler", frame=1)
root.rotation_euler.z = 2 * math.pi; root.keyframe_insert("rotation_euler", frame=25)
for fc in root.animation_data.action.fcurves if hasattr(root.animation_data.action, "fcurves") else []:
    for k in fc.keyframe_points: k.interpolation = "LINEAR"
