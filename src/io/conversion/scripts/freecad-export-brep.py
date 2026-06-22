import cadquery as cq
import trimesh
import trimesh.visual
import numpy as np
import sys
import os
import re
import json
import struct
import shutil
import tempfile

src = r"__AI3D_SOURCE_PATH__"
out = r"__AI3D_OUTPUT_PATH__"
source_ext = "__AI3D_SOURCE_EXT__"
src_occt = src
try:
    src.encode('ascii')
except UnicodeEncodeError:
    safe_src = os.path.join(tempfile.gettempdir(), f'ai3d-occt-source-{os.getpid()}.{source_ext}')
    shutil.copyfile(src, safe_src)
    src_occt = safe_src

from OCP.TopoDS import TopoDS
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopLoc import TopLoc_Location
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepTools import BRepTools

DEFAULT_COLOR = [180, 180, 180, 255]

def triangulate_face(face, linear=0.5, angular=1.0):
    BRepMesh_IncrementalMesh(face, linear, False, angular, True)
    loc = TopLoc_Location()
    tri = BRep_Tool.Triangulation_s(face, loc)
    if tri is None:
        return None, None
    n = tri.NbNodes()
    verts = []
    for i in range(1, n + 1):
        p = tri.Node(i)
        if not loc.IsIdentity():
            p = p.Transformed(loc.Transformation())
        verts.append([p.X(), p.Y(), p.Z()])
    ntri = tri.NbTriangles()
    faces = []
    for i in range(1, ntri + 1):
        t = tri.Triangle(i)
        n1, n2, n3 = t.Get()
        faces.append([n1 - 1, n2 - 1, n3 - 1])
    return verts, faces

# BREP: load geometry from native OpenCascade format
from OCP.TopoDS import TopoDS_Shape
from OCP.BRep import BRep_Builder
shape = TopoDS_Shape()
builder = BRep_Builder()
success = BRepTools.Read_s(shape, src_occt, builder)
if not success:
    print(f"Failed to read BREP file: {src}", file=sys.stderr)
    sys.exit(1)

all_verts = []
all_faces = []
all_colors = []
matched_count = 0
total_faces = 0

exp = TopExp_Explorer(shape, TopAbs_FACE)
while exp.More():
    face = TopoDS.Face_s(exp.Current())
    total_faces += 1
    verts, faces = triangulate_face(face)
    if verts and faces:
        offset = len(all_verts)
        all_verts.extend(verts)
        for tri in faces:
            all_faces.append([tri[0] + offset, tri[1] + offset, tri[2] + offset])
        rgba = DEFAULT_COLOR
        n = len(verts)
        all_colors.extend([rgba] * n)
    exp.Next()

print(f"Triangulated: {total_faces} faces, {len(all_verts)} verts, {matched_count} colored ({matched_count*100//max(total_faces,1)}%)")

if not all_verts or not all_faces:
    # Fallback: use CadQuery import (works for STEP/IGES, not BREP)
    cq_shape = cq.importers.importStep(src_occt)  # CadQuery BREP import
    cq.exporters.export(cq_shape, out, exportType='STL')
    mesh = trimesh.load(out)
    data = mesh.export(file_type='glb')
    if isinstance(data, str):
        with open(data, 'rb') as f:
            data = f.read()
    with open(out, 'wb') as f:
        f.write(data)
    print(f"Fallback CadQuery STL->GLB: {out} ({len(data)} bytes)")
    sys.exit(0)

verts_arr = np.array(all_verts, dtype=float)
faces_arr = np.array(all_faces, dtype=int)
colors_arr = np.array(all_colors, dtype=np.uint8)

mesh = trimesh.Trimesh(
    vertices=verts_arr,
    faces=faces_arr,
    visual=trimesh.visual.ColorVisuals(vertex_colors=colors_arr),
    process=True,
)
mesh.fix_normals()
scene = trimesh.Scene([mesh])

result = scene.export(file_type='glb')
if isinstance(result, bytes):
    data = result
elif isinstance(result, str):
    with open(result, 'rb') as f:
        data = f.read()
else:
    data = bytes(result)

with open(out, 'wb') as f:
    f.write(data)

print(f'Converted {src} -> {out} ({len(data)} bytes, {matched_count}/{total_faces} colored faces)')
