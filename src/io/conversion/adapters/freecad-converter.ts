import type { ConversionRequest, ConversionResult, ModelConverter } from "../types";
import { F_OK, access, mkdir, readFile, rm, writeFile } from "../../../utils/node-shim";
import { pathJoin as join, pathDirname as dirname, pathBasename as basename, pathExtname as extname, pathIsAbsolute as isAbsolute } from "../../../utils/node-shim";
import { osTmpdir as tmpdir } from "../../../utils/node-shim";
import { execFile } from "../../../utils/node-shim";
import { createLogger } from "../../../utils/log";
import { resolveConverterInvocation } from "../command-discovery";
import { toPythonPathLiteral } from "../python-path";

const log = createLogger("freecad-converter");

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, F_OK);
    return true;
  } catch {
    return false;
  }
}

function execFileAsync(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }

      const stdoutText = (stdout ?? "").toString().trim();
      const stderrText = (stderr ?? "").toString().trim();
      const parts = [
        `CAD conversion failed: ${error.message}`,
        stdoutText ? `stdout: ${stdoutText}` : "",
        stderrText ? `stderr: ${stderrText}` : "",
      ].filter(Boolean);

      reject(new Error(parts.join(" | ")));
    });
  });
}

function buildCadScript(sourcePath: string, outputPath: string, sourceExt: string): string {
  const src = toPythonPathLiteral(sourcePath);
  const out = toPythonPathLiteral(outputPath);
  const ext = sourceExt.toLowerCase().replace(/^\./, "");
  const isStep = ext === "step" || ext === "stp";
  const isIges = ext === "iges" || ext === "igs";
  // brep is handled separately

  // Common imports
  const lines: string[] = [
    "import cadquery as cq",
    "import trimesh",
    "import trimesh.visual",
    "import numpy as np",
    "import sys",
    "import os",
    "import re",
    "import json",
    "import struct",
    "import shutil",
    "import tempfile",
    "",
    `src = r"${src}"`,
    `out = r"${out}"`,
    `source_ext = "${ext}"`,
    "src_occt = src",
    "try:",
    "    src.encode('ascii')",
    "except UnicodeEncodeError:",
    "    safe_src = os.path.join(tempfile.gettempdir(), f'ai3d-occt-source-{os.getpid()}.{source_ext}')",
    "    shutil.copyfile(src, safe_src)",
    "    src_occt = safe_src",
    "",
  ];

  // Format-specific imports
  if (isStep) {
    lines.push(
      "from OCP.STEPCAFControl import STEPCAFControl_Reader",
      "from OCP.STEPControl import STEPControl_Reader",
      "from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType, XCAFDoc_ShapeTool",
      "from OCP.TDocStd import TDocStd_Document",
      "from OCP.TCollection import TCollection_ExtendedString",
      "from OCP.Quantity import Quantity_Color",
      "from OCP.TDF import TDF_ChildIterator, TDF_LabelSequence",
      "from OCP.TDataStd import TDataStd_Name",
    );
  } else if (isIges) {
    lines.push(
      "from OCP.IGESControl import IGESControl_Reader",
    );
  }
  // brep: no special reader import needed (uses BRepTools from OCP.TopoDS/BRep)

  lines.push(
    "from OCP.TopoDS import TopoDS",
    "from OCP.TopAbs import TopAbs_FACE",
    "from OCP.TopExp import TopExp_Explorer",
    "from OCP.BRep import BRep_Tool",
    "from OCP.BRepMesh import BRepMesh_IncrementalMesh",
    "from OCP.TopLoc import TopLoc_Location",
    "from OCP.IFSelect import IFSelect_RetDone",
  );

  if (!isStep) {
    // BREP and IGES don't use XDE for colors
    lines.push("from OCP.BRepTools import BRepTools");
  }

  lines.push(
    "",
    "DEFAULT_COLOR = [180, 180, 180, 255]",
    "",
    "def triangulate_face(face, linear=0.5, angular=1.0):",
    "    BRepMesh_IncrementalMesh(face, linear, False, angular, True)",
    "    loc = TopLoc_Location()",
    "    tri = BRep_Tool.Triangulation_s(face, loc)",
    "    if tri is None:",
    "        return None, None",
    "    n = tri.NbNodes()",
    "    verts = []",
    "    for i in range(1, n + 1):",
    "        p = tri.Node(i)",
    "        if not loc.IsIdentity():",
    "            p = p.Transformed(loc.Transformation())",
    "        verts.append([p.X(), p.Y(), p.Z()])",
    "    ntri = tri.NbTriangles()",
    "    faces = []",
    "    for i in range(1, ntri + 1):",
    "        t = tri.Triangle(i)",
    "        n1, n2, n3 = t.Get()",
    "        faces.append([n1 - 1, n2 - 1, n3 - 1])",
    "    return verts, faces",
  );

  // XDE color extraction only for STEP
  if (isStep) {
    lines.push(
      "",
      "def build_xde_color_lookup(step_path):",
      '    """Load XDE with STEPCAFControl, extract per-face colors via surface signature."""',
      "    from OCP.BRepAdaptor import BRepAdaptor_Surface",
      "    lookup = {}",
      "    try:",
      "        reader = STEPCAFControl_Reader()",
      "        reader.SetColorMode(True)",
      "        reader.SetNameMode(True)",
      "        status = reader.ReadFile(step_path)",
      "        if status != IFSelect_RetDone:",
      "            return lookup",
      "        doc = TDocStd_Document(TCollection_ExtendedString('XmlOcaf'))",
      "        reader.Transfer(doc)",
      "        shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())",
      "        color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())",
      "",
      "        def walk(label):",
      "            if XCAFDoc_ShapeTool.IsShape_s(label):",
      "                s = XCAFDoc_ShapeTool.GetShape_s(label)",
      "                if s is not None and s.ShapeType() == TopAbs_FACE:",
      "                    c = Quantity_Color()",
      "                    if color_tool.GetColor(s, XCAFDoc_ColorType.XCAFDoc_ColorSurf, c):",
      "                        face = TopoDS.Face_s(s)",
      "                        try:",
      "                            adaptor = BRepAdaptor_Surface(face)",
      "                            u_r = (adaptor.FirstUParameter(), adaptor.LastUParameter())",
      "                            v_r = (adaptor.FirstVParameter(), adaptor.LastVParameter())",
      "                            key = (adaptor.GetType(), tuple(round(x, 4) for x in u_r), tuple(round(x, 4) for x in v_r))",
      "                            color = (c.Red(), c.Green(), c.Blue())",
      "                            if key not in lookup:",
      "                                lookup[key] = color",
      "                        except Exception:",
      "                            pass",
      "            children = TDF_ChildIterator(label)",
      "            while children.More():",
      "                walk(children.Value())",
      "                children.Next()",
      "",
      "        walk(doc.Main())",
      "    except Exception as e:",
      '        print(f"XDE color extraction failed: {e}", file=sys.stderr)',
      "    return lookup",
      "",
      "def get_face_color(face, color_lookup):",
      '    """Match a geometry face to an XDE face via surface signature, return color."""',
      "    from OCP.BRepAdaptor import BRepAdaptor_Surface",
      "    try:",
      "        adaptor = BRepAdaptor_Surface(face)",
      "        u_r = (adaptor.FirstUParameter(), adaptor.LastUParameter())",
      "        v_r = (adaptor.FirstVParameter(), adaptor.LastVParameter())",
      "        key = (adaptor.GetType(), tuple(round(x, 4) for x in u_r), tuple(round(x, 4) for x in v_r))",
      "        return color_lookup.get(key)",
      "    except Exception:",
      "        return None",
      "",
      "def label_name(label):",
      "    name_attr = TDataStd_Name()",
      "    try:",
      "        if label.FindAttribute(TDataStd_Name.GetID_s(), name_attr):",
      "            return name_attr.Get().ToExtString()",
      "    except Exception:",
      "        pass",
      "    return ''",
      "",
      "def clean_component_name(value, fallback):",
      "    text = re.sub(r'\\s+', ' ', str(value or '')).strip()",
      "    if not text or text.startswith('=>'):",
      "        text = fallback",
      "    return text[:96]",
      "",
      "def count_shape_faces(shape):",
      "    count = 0",
      "    exp = TopExp_Explorer(shape, TopAbs_FACE)",
      "    while exp.More():",
      "        count += 1",
      "        exp.Next()",
      "    return count",
      "",
      "def unique_component_name(name, used):",
      "    base = clean_component_name(name, f'component-{len(used) + 1:03d}')",
      "    candidate = base",
      "    suffix = 2",
      "    while candidate in used:",
      "        candidate = f'{base}-{suffix}'",
      "        suffix += 1",
      "    used.add(candidate)",
      "    return candidate",
      "",
      "def collect_xde_components(step_path):",
      "    components = []",
      "    try:",
      "        reader = STEPCAFControl_Reader()",
      "        reader.SetColorMode(True)",
      "        reader.SetNameMode(True)",
      "        status = reader.ReadFile(step_path)",
      "        if status != IFSelect_RetDone:",
      "            return components",
      "        doc = TDocStd_Document(TCollection_ExtendedString('XmlOcaf'))",
      "        if not reader.Transfer(doc):",
      "            return components",
      "        shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())",
      "        free = TDF_LabelSequence()",
      "        shape_tool.GetFreeShapes(free)",
      "        used_names = set()",
      "",
      "        def walk(label, path_parts):",
      "            if not XCAFDoc_ShapeTool.IsShape_s(label):",
      "                child = TDF_ChildIterator(label)",
      "                while child.More():",
      "                    walk(child.Value(), path_parts)",
      "                    child.Next()",
      "                return",
      "            raw_name = label_name(label)",
      "            next_path = path_parts + ([raw_name] if raw_name and not raw_name.startswith('=>') else [])",
      "            shape = XCAFDoc_ShapeTool.GetShape_s(label)",
      "            face_count = 0 if shape is None or shape.IsNull() else count_shape_faces(shape)",
      "            try:",
      "                is_assembly = XCAFDoc_ShapeTool.IsAssembly_s(label)",
      "            except Exception:",
      "                is_assembly = False",
      "            try:",
      "                is_component = XCAFDoc_ShapeTool.IsComponent_s(label)",
      "            except Exception:",
      "                is_component = False",
      "            if face_count > 0 and not is_assembly:",
      "                name = unique_component_name(raw_name, used_names)",
      "                component_path = '/'.join([part for part in next_path if part]) or name",
      "                components.append({",
      "                    'name': name,",
      "                    'path': component_path,",
      "                    'shape': shape,",
      "                    'face_count': face_count,",
      "                    'is_component': is_component,",
      "                })",
      "                return",
      "            child = TDF_ChildIterator(label)",
      "            while child.More():",
      "                walk(child.Value(), next_path)",
      "                child.Next()",
      "",
      "        for index in range(1, free.Length() + 1):",
      "            walk(free.Value(index), [])",
      "    except Exception as e:",
      "        print(f'XDE component extraction failed: {e}', file=sys.stderr)",
      "    return components",
      "",
      "def mesh_from_shape(shape, color_lookup, name, component_path):",
      "    try:",
      "        BRepMesh_IncrementalMesh(shape, 0.5, False, 1.0, True)",
      "    except Exception:",
      "        pass",
      "    verts_acc = []",
      "    faces_acc = []",
      "    colors_acc = []",
      "    matched = 0",
      "    total = 0",
      "    exp = TopExp_Explorer(shape, TopAbs_FACE)",
      "    while exp.More():",
      "        face = TopoDS.Face_s(exp.Current())",
      "        total += 1",
      "        verts, faces = triangulate_face(face)",
      "        if verts and faces:",
      "            offset = len(verts_acc)",
      "            verts_acc.extend(verts)",
      "            for tri in faces:",
      "                faces_acc.append([tri[0] + offset, tri[1] + offset, tri[2] + offset])",
      "            color = get_face_color(face, color_lookup)",
      "            if color:",
      "                matched += 1",
      "                r, g, b = color",
      "                rgba = [int(r * 255), int(g * 255), int(b * 255), 255]",
      "            else:",
      "                rgba = DEFAULT_COLOR",
      "            colors_acc.extend([rgba] * len(verts))",
      "        exp.Next()",
      "    if not verts_acc or not faces_acc:",
      "        return None, total, matched",
      "    mesh = trimesh.Trimesh(",
      "        vertices=np.array(verts_acc, dtype=float),",
      "        faces=np.array(faces_acc, dtype=int),",
      "        visual=trimesh.visual.ColorVisuals(vertex_colors=np.array(colors_acc, dtype=np.uint8)),",
      "        process=True,",
      "    )",
      "    mesh.fix_normals()",
      "    mesh.metadata.update({",
      "        'name': name,",
      "        'ai3d': {",
      "            'partId': name,",
      "            'componentId': name,",
      "            'occurrenceId': component_path,",
      "            'componentPath': component_path,",
      "            'displayName': name,",
      "        },",
      "    })",
      "    return mesh, total, matched",
      "",
      "def read_step_xde(step_path):",
      '    """Read STEP into an XDE document with colors and names preserved."""',
      "    reader = STEPCAFControl_Reader()",
      "    reader.SetColorMode(True)",
      "    reader.SetNameMode(True)",
      "    status = reader.ReadFile(step_path)",
      "    if status != IFSelect_RetDone:",
      "        return None",
      "    doc = TDocStd_Document(TCollection_ExtendedString('XmlOcaf'))",
      "    if not reader.Transfer(doc):",
      "        return None",
      "    return doc",
      "",
      "def triangulate_document(doc, linear=1.0, angular=2.0):",
      '    """Triangulate all free shapes in the XDE document."""',
      "    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())",
      "    free = TDF_LabelSequence()",
      "    shape_tool.GetFreeShapes(free)",
      "    for i in range(1, free.Length() + 1):",
      "        shape = XCAFDoc_ShapeTool.GetShape_s(free.Value(i))",
      "        if shape is not None and not shape.IsNull():",
      "            BRepMesh_IncrementalMesh(shape, linear, False, angular, True)",
      "",
      "def write_gltf_from_xde(doc, out_path, binary=True):",
      '    """Use OCCT RWGltf_CafWriter to preserve colors and hierarchy."""',
      "    try:",
      "        from OCP.RWGltf import RWGltf_CafWriter, RWGltf_WriterTrsfFormat",
      "        from OCP.Message import Message_ProgressRange",
      "        from OCP.TColStd import TColStd_IndexedDataMapOfStringString",
      "        from OCP.TCollection import TCollection_AsciiString",
      "        writer = RWGltf_CafWriter(TCollection_AsciiString(out_path), binary)",
      "        writer.SetTransformationFormat(RWGltf_WriterTrsfFormat.RWGltf_WriterTrsfFormat_Compact)",
      "        info = TColStd_IndexedDataMapOfStringString()",
      "        return bool(writer.Perform(doc, info, Message_ProgressRange()))",
      "    except Exception as e:",
      "        print(f'OCCT glTF writer unavailable: {e}', file=sys.stderr)",
      "        return False",
      "",
      "def clean_node_name(value, fallback='node'):",
      "    text = re.sub(r'\\s+', ' ', str(value or '')).strip()",
      "    if not text or text.startswith('=>'):",
      "        text = fallback",
      "    return re.sub(r'[^\\w\\-_.]', '_', text)[:96]",
      "",
      "def postprocess_occt_glb(raw_glb, out_path):",
      '    """Force opaque/double-sided materials and add ai3d metadata without altering colors."""',
      "    if len(raw_glb) < 20:",
      "        raise ValueError('GLB file is too small')",
      "    magic, version, _total = struct.unpack('<III', raw_glb[:12])",
      "    if magic != 0x46546C67 or version != 2:",
      "        raise ValueError('Expected GLB v2 output from OCCT writer')",
      "    json_len, json_type = struct.unpack('<II', raw_glb[12:20])",
      "    if json_type != 0x4E4F534A:",
      "        raise ValueError('GLB JSON chunk missing')",
      "    json_start = 20",
      "    json_end = json_start + json_len",
      "    gltf = json.loads(raw_glb[json_start:json_end].decode('utf-8'))",
      "    chunks = []",
      "    offset = json_end",
      "    while offset + 8 <= len(raw_glb):",
      "        chunk_len, chunk_type = struct.unpack('<II', raw_glb[offset:offset + 8])",
      "        start = offset + 8",
      "        end = start + chunk_len",
      "        if end > len(raw_glb):",
      "            raise ValueError('GLB chunk length exceeds file size')",
      "        chunks.append((chunk_type, raw_glb[start:end]))",
      "        offset = end",
      "",
      "    nodes = gltf.setdefault('nodes', [])",
      "    meshes = gltf.setdefault('meshes', [])",
      "    materials = gltf.setdefault('materials', [])",
      "",
      "    if materials:",
      "        for material in materials:",
      "            material['alphaMode'] = 'OPAQUE'",
      "            material['doubleSided'] = True",
      "    else:",
      "        materials.append({",
      "            'pbrMetallicRoughness': {",
      "                'baseColorFactor': [0.7, 0.7, 0.7, 1.0],",
      "                'metallicFactor': 0.0,",
      "                'roughnessFactor': 0.8,",
      "            },",
      "            'alphaMode': 'OPAQUE',",
      "            'doubleSided': True,",
      "        })",
      "        for mesh in meshes:",
      "            for primitive in mesh.get('primitives', []):",
      "                primitive['material'] = 0",
      "",
      "    for i, node in enumerate(nodes):",
      "        name = clean_node_name(node.get('name'), f'node_{i}')",
      "        if 'name' not in node:",
      "            node['name'] = name",
      "        extras = node.setdefault('extras', {})",
      "        ai3d = extras.setdefault('ai3d', {})",
      "        ai3d.update({",
      "            'partId': name,",
      "            'componentId': name,",
      "            'occurrenceId': name,",
      "            'componentPath': name,",
      "            'displayName': name,",
      "        })",
      "",
      "    for i, mesh in enumerate(meshes):",
      "        name = clean_node_name(mesh.get('name'), f'mesh_{i}')",
      "        if 'name' not in mesh:",
      "            mesh['name'] = name",
      "        extras = mesh.setdefault('extras', {})",
      "        ai3d = extras.setdefault('ai3d', {})",
      "        ai3d.update({",
      "            'partId': name,",
      "            'componentId': name,",
      "            'occurrenceId': name,",
      "            'componentPath': name,",
      "            'displayName': name,",
      "        })",
      "",
      "    new_json = json.dumps(gltf, separators=(',', ':')).encode('utf-8')",
      "    new_json_padded = new_json + b' ' * ((4 - (len(new_json) % 4)) % 4)",
      "    new_total = 12 + 8 + len(new_json_padded) + sum(8 + len(payload) for _chunk_type, payload in chunks)",
      "    with open(out_path, 'wb') as f:",
      "        f.write(struct.pack('<III', 0x46546C67, 2, new_total))",
      "        f.write(struct.pack('<II', len(new_json_padded), 0x4E4F534A))",
      "        f.write(new_json_padded)",
      "        for chunk_type, payload in chunks:",
      "            f.write(struct.pack('<II', len(payload), chunk_type))",
      "            f.write(payload)",
      "",
      "def convert_step_to_glb(step_path, out_path):",
      "    try:",
      "        doc = read_step_xde(step_path)",
      "        if doc is None:",
      "            return False",
      "        triangulate_document(doc)",
      "        glb_tmp = os.path.join(tempfile.gettempdir(), f'ai3d-occt-{os.getpid()}.glb')",
      "        if not write_gltf_from_xde(doc, glb_tmp, binary=True):",
      "            return False",
      "        try:",
      "            with open(glb_tmp, 'rb') as f:",
      "                raw = f.read()",
      "            postprocess_occt_glb(raw, out_path)",
      "            print(f'Converted {step_path} -> {out_path} ({os.path.getsize(out_path)} bytes, OCCT glTF writer)')",
      "            return True",
      "        finally:",
      "            try:",
      "                os.remove(glb_tmp)",
      "            except Exception:",
      "                pass",
      "    except Exception as e:",
      "        print(f'OCCT glTF writer failed: {e}', file=sys.stderr)",
      "        return False",
    );
  }

  // Load geometry — format-specific
  lines.push("");

  if (isStep) {
    lines.push(
      "# STEP: use OCCT glTF writer first, then fall back to XDE component meshes",
      "if convert_step_to_glb(src_occt, out):",
      "    sys.exit(0)",
      "",
      "# STEP: build XDE color lookup + load geometry",
      "color_lookup = build_xde_color_lookup(src_occt)",
      'print(f"XDE color lookup: {len(color_lookup)} surface signatures")',
      "xde_components = collect_xde_components(src_occt)",
      "component_meshes = []",
      "component_faces = 0",
      "component_matched = 0",
      "for component in xde_components:",
      "    mesh_result, total, matched = mesh_from_shape(component['shape'], color_lookup, component['name'], component['path'])",
      "    component_faces += total",
      "    component_matched += matched",
      "    if mesh_result is not None:",
      "        component_meshes.append((component, mesh_result))",
      "if len(component_meshes) > 1:",
      "    scene = trimesh.Scene()",
      "    for component, mesh_result in component_meshes:",
      "        scene.add_geometry(mesh_result, node_name=component['name'], geom_name=component['name'])",
      "    result = scene.export(file_type='glb')",
      "    if isinstance(result, bytes):",
      "        data = result",
      "    elif isinstance(result, str):",
      "        with open(result, 'rb') as f:",
      "            data = f.read()",
      "    else:",
      "        data = bytes(result)",
      "    with open(out, 'wb') as f:",
      "        f.write(data)",
      "    print(f'Converted {src} -> {out} ({len(data)} bytes, {len(component_meshes)} XDE components, {component_matched}/{component_faces} colored faces)')",
      "    sys.exit(0)",
      'print(f"XDE component export unavailable: {len(component_meshes)} usable components from {len(xde_components)} labels; falling back to whole-shape mesh")',
      "",
      "sr = STEPControl_Reader()",
      "status = sr.ReadFile(src_occt)",
      "if status != IFSelect_RetDone:",
      '    print(f"Failed to read STEP file: {src}", file=sys.stderr)',
      "    sys.exit(1)",
      "sr.TransferRoots()",
      "shape = sr.OneShape()",
    );
  } else if (isIges) {
    lines.push(
      "# IGES: load geometry (no XDE color support for IGES)",
      "ir = IGESControl_Reader()",
      "status = ir.ReadFile(src_occt)",
      "if status != IFSelect_RetDone:",
      '    print(f"Failed to read IGES file: {src}", file=sys.stderr)',
      "    sys.exit(1)",
      "ir.TransferRoots()",
      "shape = ir.OneShape()",
    );
  } else {
    // brep
    lines.push(
      "# BREP: load geometry from native OpenCascade format",
      "from OCP.TopoDS import TopoDS_Shape",
      "from OCP.BRep import BRep_Builder",
      "shape = TopoDS_Shape()",
      "builder = BRep_Builder()",
      "success = BRepTools.Read_s(shape, src_occt, builder)",
      "if not success:",
      '    print(f"Failed to read BREP file: {src}", file=sys.stderr)',
      "    sys.exit(1)",
    );
  }

  // Triangulate + color (same for all formats)
  lines.push(
    "",
    "all_verts = []",
    "all_faces = []",
    "all_colors = []",
    "matched_count = 0",
    "total_faces = 0",
    "",
    "exp = TopExp_Explorer(shape, TopAbs_FACE)",
    "while exp.More():",
    "    face = TopoDS.Face_s(exp.Current())",
    "    total_faces += 1",
    "    verts, faces = triangulate_face(face)",
    "    if verts and faces:",
    "        offset = len(all_verts)",
    "        all_verts.extend(verts)",
    "        for tri in faces:",
    "            all_faces.append([tri[0] + offset, tri[1] + offset, tri[2] + offset])",
  );

  if (isStep) {
    lines.push(
      "        color = get_face_color(face, color_lookup)",
      "        if color:",
      "            matched_count += 1",
      "            r, g, b = color",
      "            rgba = [int(r * 255), int(g * 255), int(b * 255), 255]",
      "        else:",
      "            rgba = DEFAULT_COLOR",
    );
  } else {
    lines.push(
      "        rgba = DEFAULT_COLOR",
    );
  }

  lines.push(
    "        n = len(verts)",
    "        all_colors.extend([rgba] * n)",
    "    exp.Next()",
    "",
    'print(f"Triangulated: {total_faces} faces, {len(all_verts)} verts, {matched_count} colored ({matched_count*100//max(total_faces,1)}%)")',
    "",
    "if not all_verts or not all_faces:",
    "    # Fallback: use CadQuery import (works for STEP/IGES, not BREP)",
  );

  if (isStep) {
    lines.push("    cq_shape = cq.importers.importStep(src_occt)");
  } else if (isIges) {
    lines.push("    cq_shape = cq.importers.importStep(src_occt)  # CadQuery reads IGES via importStep");
  } else {
    lines.push("    cq_shape = cq.importers.importStep(src_occt)  # CadQuery BREP import");
  }

  lines.push(
    "    cq.exporters.export(cq_shape, out, exportType='STL')",
    "    mesh = trimesh.load(out)",
    "    data = mesh.export(file_type='glb')",
    "    if isinstance(data, str):",
    "        with open(data, 'rb') as f:",
    "            data = f.read()",
    "    with open(out, 'wb') as f:",
    "        f.write(data)",
    '    print(f"Fallback CadQuery STL->GLB: {out} ({len(data)} bytes)")',
    "    sys.exit(0)",
    "",
    "verts_arr = np.array(all_verts, dtype=float)",
    "faces_arr = np.array(all_faces, dtype=int)",
    "colors_arr = np.array(all_colors, dtype=np.uint8)",
    "",
    "mesh = trimesh.Trimesh(",
    "    vertices=verts_arr,",
    "    faces=faces_arr,",
    "    visual=trimesh.visual.ColorVisuals(vertex_colors=colors_arr),",
    "    process=True,",
    ")",
    "mesh.fix_normals()",
    "scene = trimesh.Scene([mesh])",
    "",
    "result = scene.export(file_type='glb')",
    "if isinstance(result, bytes):",
    "    data = result",
    "elif isinstance(result, str):",
    "    with open(result, 'rb') as f:",
    "        data = f.read()",
    "else:",
    "    data = bytes(result)",
    "",
    "with open(out, 'wb') as f:",
    "    f.write(data)",
    "",
    "print(f'Converted {src} -> {out} ({len(data)} bytes, {matched_count}/{total_faces} colored faces)')",
  );

  return lines.join("\n");
}

export class FreecadConverter implements ModelConverter {
  readonly id = "freecad";
  readonly sourceExts = ["step", "stp", "iges", "igs", "brep"] as const;
  readonly targetExt = "glb" as const;

  constructor(private configuredCommand?: string) {}

  async getCacheKey(): Promise<string> {
    const invocation = await resolveConverterInvocation(this.id, this.configuredCommand);
    return `${this.id}:${invocation.command} ${invocation.args.join(" ")}`.trim();
  }

  async convert(req: ConversionRequest): Promise<ConversionResult> {
    if (!isAbsolute(req.sourcePath)) {
      throw new Error(
        `Converter '${this.id}' requires an absolute source path, got '${req.sourcePath}'. ` +
        "Pass a file-system path to the conversion pipeline when invoking CAD conversion.",
      );
    }

    const invocation = await resolveConverterInvocation(this.id, this.configuredCommand);
    const sourceDir = dirname(req.sourcePath);
    const name = basename(req.sourcePath, extname(req.sourcePath));
    const outputPath = join(sourceDir, `${name}.ai3d-converted.glb`);
    const scriptDir = join(tmpdir(), "ai3d-freecad");
    const scriptPath = join(scriptDir, `${name}-${Date.now()}.py`);

    await mkdir(scriptDir, { recursive: true });
    await writeFile(scriptPath, buildCadScript(req.sourcePath, outputPath, req.sourceExt), "utf8");

    log.info("run CAD conversion (CadQuery/OCCT)", {
      sourcePath: req.sourcePath,
      outputPath,
      command: invocation.command,
      args: invocation.args,
    });

    try {
      await execFileAsync(invocation.command, [...invocation.args, scriptPath], DEFAULT_TIMEOUT_MS);
    } catch (error) {
      throw new Error(
        `CAD conversion failed for '${req.sourcePath}'. ` +
        `Ensure Python with cadquery is installed: pip install cadquery trimesh. ` +
        `Set Python command path in plugin settings or AI3D_FREECAD_CMD if Python is not discoverable. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      void rm(scriptPath, { force: true });
    }

    if (!(await fileExists(outputPath))) {
      throw new Error(
        `CAD conversion finished but output was not found: '${outputPath}'. ` +
        "Check that CadQuery supports this CAD format.",
      );
    }

    const outputBuffer = await readFile(outputPath);
    if (outputBuffer.byteLength === 0) {
      throw new Error(`CAD conversion output is empty: '${outputPath}'.`);
    }

    return {
      outputPath,
      outputExt: "glb",
      fromCache: false,
      warnings: ["Converted by local Python/CadQuery(OCCT) bridge."],
    };
  }
}
