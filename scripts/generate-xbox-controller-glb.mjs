import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Shape,
  TorusGeometry,
  Vector2,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

globalThis.FileReader = class FileReader {
  result = null;
  onloadend = null;

  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }

  async readAsDataURL(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type || "application/octet-stream"};base64,${buffer.toString("base64")}`;
    this.onloadend?.();
  }
};

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outPath = resolve(rootDir, "models", "xbox-controller-cubies.glb");
const fontPath = resolve(rootDir, "node_modules", "three", "examples", "fonts", "helvetiker_bold.typeface.json");

const materials = {
  shell: new MeshStandardMaterial({ color: 0x20252c, roughness: 0.58, metalness: 0.05 }),
  shellAlt: new MeshStandardMaterial({ color: 0x2d343d, roughness: 0.55, metalness: 0.04 }),
  seam: new MeshStandardMaterial({ color: 0x0e1115, roughness: 0.72, metalness: 0.0 }),
  rubber: new MeshStandardMaterial({ color: 0x111418, roughness: 0.88, metalness: 0.0 }),
  darkRubber: new MeshStandardMaterial({ color: 0x07090b, roughness: 0.92, metalness: 0.0 }),
  metal: new MeshStandardMaterial({ color: 0x939aa3, roughness: 0.36, metalness: 0.45 }),
  green: new MeshStandardMaterial({ color: 0x4cd964, roughness: 0.42, metalness: 0.05 }),
  red: new MeshStandardMaterial({ color: 0xff453a, roughness: 0.42, metalness: 0.05 }),
  blue: new MeshStandardMaterial({ color: 0x0a84ff, roughness: 0.42, metalness: 0.05 }),
  yellow: new MeshStandardMaterial({ color: 0xffcc00, roughness: 0.42, metalness: 0.05 }),
  white: new MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.44, metalness: 0.0 }),
  accent: new MeshStandardMaterial({ color: 0x8ef28d, roughness: 0.4, metalness: 0.0 }),
};

const scene = new Scene();
scene.name = "xbox_controller_cubies_scene";
const controller = new Group();
controller.name = "xbox_controller_cubies_root";
scene.add(controller);

let cubieIndex = 0;

function nextName(label) {
  return `cubie_${String(cubieIndex++).padStart(4, "0")}_${label}`;
}

function addMesh(label, geometry, material, transform = {}, parent = controller) {
  const mesh = new Mesh(geometry, material);
  mesh.name = nextName(label);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (transform.position) mesh.position.set(...transform.position);
  if (transform.rotation) mesh.rotation.set(...transform.rotation);
  if (transform.scale) mesh.scale.set(...transform.scale);
  parent.add(mesh);
  return mesh;
}

function roundedBox(label, size, radius, material, transform = {}, segments = 6) {
  return addMesh(label, new RoundedBoxGeometry(size[0], size[1], size[2], segments, radius), material, transform);
}

function cylinder(label, radiusTop, radiusBottom, depth, material, transform = {}, radialSegments = 48) {
  return addMesh(label, new CylinderGeometry(radiusTop, radiusBottom, depth, radialSegments, 1, false), material, transform);
}

function torus(label, radius, tube, material, transform = {}, radialSegments = 72, tubularSegments = 12) {
  return addMesh(label, new TorusGeometry(radius, tube, radialSegments, tubularSegments), material, transform);
}

function addBodyTile(x, y, width, height, z = 0, depth = 0.36) {
  const distance = Math.hypot(x / 3.4, (y + 0.08) / 1.55);
  const crown = 0.16 * Math.max(0, 1 - distance);
  const scaleY = 1 - 0.1 * Math.abs(x) / 3.7;
  return roundedBox(
    "body_shell_tile",
    [width, height * scaleY, depth],
    Math.min(width, height) * 0.22,
    Math.abs(x) > 2.8 ? materials.shellAlt : materials.shell,
    { position: [x, y, z + crown], rotation: [0.03 * y, 0.02 * x, 0] },
  );
}

function addText(label, text, material, transform, size = 0.14, depth = 0.012) {
  const geometry = new TextGeometry(text, {
    font,
    size,
    depth,
    curveSegments: 5,
    bevelEnabled: false,
  });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) {
    const dx = -0.5 * (box.max.x - box.min.x);
    const dy = -0.5 * (box.max.y - box.min.y);
    geometry.translate(dx, dy, 0);
  }
  return addMesh(label, geometry, material, transform);
}

function addPlusBlade(label, position, rotationZ, length, width, height, material) {
  return roundedBox(label, [length, width, height], width * 0.22, material, {
    position,
    rotation: [Math.PI / 2, 0, rotationZ],
  });
}

function addGrip(side) {
  const sx = side === "left" ? -1 : 1;
  for (let row = 0; row < 5; row++) {
    const y = -1.38 - row * 0.38;
    const width = 0.88 - row * 0.04;
    const height = 0.44;
    const x = sx * (2.18 + row * 0.17);
    const z = 0.02 - row * 0.018;
    roundedBox("grip_shell_segment", [width, height, 0.58], 0.18, materials.shellAlt, {
      position: [x, y, z],
      rotation: [-0.06 * row, sx * 0.12, sx * 0.08],
    });
    roundedBox("grip_side_bevel", [0.16, height * 0.85, 0.62], 0.06, materials.seam, {
      position: [x + sx * (width * 0.5 + 0.04), y, z - 0.01],
      rotation: [-0.06 * row, sx * 0.18, sx * 0.08],
    });
  }

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 3; col++) {
      const x = sx * (2.22 + col * 0.16 + row * 0.055);
      const y = -1.0 - row * 0.22;
      const z = 0.36;
      roundedBox("grip_texture_pip", [0.075, 0.035, 0.035], 0.012, materials.rubber, {
        position: [x, y, z],
        rotation: [0.0, sx * 0.1, sx * 0.1],
      }, 3);
    }
  }
}

function addThumbstick(label, x, y) {
  cylinder(`${label}_outer_socket`, 0.52, 0.52, 0.12, materials.seam, {
    position: [x, y, 0.42],
    rotation: [Math.PI / 2, 0, 0],
  });
  cylinder(`${label}_metal_ring`, 0.44, 0.44, 0.055, materials.metal, {
    position: [x, y, 0.5],
    rotation: [Math.PI / 2, 0, 0],
  });
  cylinder(`${label}_rubber_wall`, 0.34, 0.42, 0.25, materials.darkRubber, {
    position: [x, y, 0.62],
    rotation: [Math.PI / 2, 0, 0],
  });
  cylinder(`${label}_concave_top`, 0.31, 0.24, 0.08, materials.rubber, {
    position: [x, y, 0.78],
    rotation: [Math.PI / 2, 0, 0],
  });
  torus(`${label}_knurled_outer_ridge`, 0.31, 0.025, materials.seam, {
    position: [x, y, 0.84],
    rotation: [Math.PI / 2, 0, 0],
  }, 64, 8);

  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    roundedBox(`${label}_rim_grip_tooth`, [0.035, 0.08, 0.035], 0.008, materials.seam, {
      position: [x + Math.cos(angle) * 0.31, y + Math.sin(angle) * 0.31, 0.87],
      rotation: [Math.PI / 2, 0, angle],
    }, 2);
  }
}

function addFaceButton(label, letter, x, y, material) {
  cylinder(`${label}_button_well`, 0.23, 0.23, 0.07, materials.seam, {
    position: [x, y, 0.48],
    rotation: [Math.PI / 2, 0, 0],
  });
  cylinder(`${label}_colored_cap`, 0.18, 0.17, 0.13, material, {
    position: [x, y, 0.61],
    rotation: [Math.PI / 2, 0, 0],
  });
  addText(`${label}_letter`, letter, materials.white, {
    position: [x, y - 0.01, 0.685],
    rotation: [0, 0, 0],
  }, 0.13, 0.008);
}

function addDpad() {
  cylinder("dpad_center_disc", 0.31, 0.31, 0.08, materials.seam, {
    position: [-0.92, -0.54, 0.5],
    rotation: [Math.PI / 2, 0, 0],
  }, 40);
  addPlusBlade("dpad_horizontal", [-0.92, -0.54, 0.61], 0, 0.78, 0.24, 0.12, materials.darkRubber);
  addPlusBlade("dpad_vertical", [-0.92, -0.54, 0.62], Math.PI / 2, 0.78, 0.24, 0.12, materials.darkRubber);
  for (const [label, x, y, rotation] of [
    ["dpad_up_bevel", -0.92, -0.17, 0],
    ["dpad_down_bevel", -0.92, -0.91, Math.PI],
    ["dpad_left_bevel", -1.29, -0.54, Math.PI / 2],
    ["dpad_right_bevel", -0.55, -0.54, -Math.PI / 2],
  ]) {
    roundedBox(label, [0.22, 0.06, 0.05], 0.018, materials.metal, {
      position: [x, y, 0.7],
      rotation: [Math.PI / 2, 0, rotation],
    }, 3);
  }
}

function addShoulders() {
  for (const side of ["left", "right"]) {
    const sx = side === "left" ? -1 : 1;
    roundedBox(`${side}_bumper_outer`, [1.6, 0.36, 0.42], 0.16, materials.shellAlt, {
      position: [sx * 1.68, 1.12, 0.1],
      rotation: [0.15, sx * 0.08, sx * 0.04],
    });
    roundedBox(`${side}_bumper_seam`, [1.46, 0.08, 0.45], 0.035, materials.seam, {
      position: [sx * 1.68, 0.88, 0.2],
      rotation: [0.15, sx * 0.08, sx * 0.04],
    });
    roundedBox(`${side}_trigger_back_plate`, [1.46, 0.45, 0.36], 0.18, materials.darkRubber, {
      position: [sx * 1.68, 1.48, -0.24],
      rotation: [-0.2, sx * 0.12, sx * 0.04],
    });
  }
}

function addPortsAndDetails() {
  roundedBox("usb_c_recess", [0.66, 0.16, 0.08], 0.05, materials.seam, {
    position: [0, 1.2, 0.38],
    rotation: [0.08, 0, 0],
  });
  roundedBox("usb_c_inner_tongue", [0.42, 0.045, 0.035], 0.015, materials.metal, {
    position: [0, 1.115, 0.43],
    rotation: [0.08, 0, 0],
  });
  torus("guide_button_ring", 0.28, 0.035, materials.metal, {
    position: [0, 0.3, 0.58],
    rotation: [Math.PI / 2, 0, 0],
  }, 64, 8);
  cylinder("guide_button_dome", 0.2, 0.18, 0.09, materials.accent, {
    position: [0, 0.3, 0.66],
    rotation: [Math.PI / 2, 0, 0],
  });
  addText("guide_button_x_mark", "X", materials.seam, {
    position: [0, 0.29, 0.72],
    rotation: [0, 0, 0],
  }, 0.13, 0.006);

  for (const [label, x] of [["view_button", -0.45], ["menu_button", 0.45]]) {
    cylinder(`${label}_well`, 0.15, 0.15, 0.05, materials.seam, {
      position: [x, 0.12, 0.51],
      rotation: [Math.PI / 2, 0, 0],
    }, 32);
    roundedBox(`${label}_cap`, [0.24, 0.16, 0.06], 0.05, materials.rubber, {
      position: [x, 0.12, 0.59],
      rotation: [Math.PI / 2, 0, 0],
    }, 4);
  }

  for (let i = 0; i < 10; i++) {
    const x = -0.45 + i * 0.1;
    roundedBox("speaker_status_slot", [0.04, 0.18, 0.025], 0.01, materials.seam, {
      position: [x, -1.0, 0.45],
      rotation: [Math.PI / 2, 0, 0],
    }, 2);
  }
}

function addShellSeams() {
  const seamShape = new Shape();
  seamShape.absellipse(0, 0, 2.72, 1.32, 0.08 * Math.PI, 0.92 * Math.PI, false, 0);
  const points = seamShape.getPoints(60);
  for (let i = 0; i < points.length; i += 2) {
    const point = points[i];
    roundedBox("upper_faceplate_seam_tick", [0.08, 0.025, 0.022], 0.008, materials.seam, {
      position: [point.x, point.y + 0.06, 0.5],
      rotation: [0, 0, Math.atan2(point.y, point.x) + Math.PI / 2],
    }, 2);
  }
}

function addBatteryDoor() {
  roundedBox("rear_battery_door_panel", [1.15, 0.62, 0.06], 0.08, materials.shellAlt, {
    position: [0, -1.14, -0.18],
    rotation: [0.12, 0, 0],
  });
  roundedBox("rear_battery_door_latch", [0.34, 0.06, 0.04], 0.02, materials.seam, {
    position: [0, -0.8, -0.1],
    rotation: [0.12, 0, 0],
  });
}

function addWireframeGuideLines() {
  for (let i = 0; i < 15; i++) {
    const t = i / 14;
    const x = -2.9 + t * 5.8;
    const y = 0.74 - Math.abs(t - 0.5) * 0.55;
    roundedBox("subtle_shell_contour_tick", [0.06, 0.018, 0.018], 0.006, materials.metal, {
      position: [x, y, 0.54],
      rotation: [0, 0, -0.2 + t * 0.4],
    }, 2);
  }
}

function addBodyShell() {
  const rows = [
    { y: 0.74, xs: [-2.2, -1.55, -0.88, -0.22, 0.44, 1.1, 1.78, 2.43], w: 0.72, h: 0.42 },
    { y: 0.36, xs: [-2.75, -2.05, -1.35, -0.65, 0.05, 0.75, 1.45, 2.15, 2.85], w: 0.74, h: 0.5 },
    { y: -0.06, xs: [-3.0, -2.28, -1.56, -0.84, -0.12, 0.6, 1.32, 2.04, 2.76], w: 0.76, h: 0.52 },
    { y: -0.48, xs: [-2.78, -2.08, -1.38, -0.68, 0.02, 0.72, 1.42, 2.12, 2.82], w: 0.72, h: 0.48 },
    { y: -0.88, xs: [-2.26, -1.6, -0.94, -0.28, 0.38, 1.04, 1.7, 2.36], w: 0.7, h: 0.44 },
  ];

  for (const row of rows) {
    for (const x of row.xs) {
      const edgeScale = 1 - Math.max(0, Math.abs(x) - 2.1) * 0.08;
      addBodyTile(x, row.y, row.w * edgeScale, row.h);
    }
  }

  roundedBox("central_faceplate", [1.45, 1.55, 0.28], 0.24, materials.shell, {
    position: [0.05, -0.12, 0.36],
    rotation: [0.02, 0, 0],
  });
  addShellSeams();
  addBatteryDoor();
  addWireframeGuideLines();
}

function addDecorativeScrews() {
  for (const [x, y] of [
    [-2.82, 0.44],
    [2.82, 0.44],
    [-2.16, -0.98],
    [2.16, -0.98],
    [-0.72, 0.72],
    [0.86, 0.72],
  ]) {
    cylinder("torx_screw_head", 0.085, 0.085, 0.025, materials.metal, {
      position: [x, y, 0.6],
      rotation: [Math.PI / 2, 0, 0],
    }, 24);
    roundedBox("torx_screw_slot", [0.11, 0.018, 0.012], 0.004, materials.seam, {
      position: [x, y, 0.622],
      rotation: [Math.PI / 2, 0, 0.4],
    }, 1);
  }
}

function addSupportFeet() {
  for (const [x, y] of [
    [-1.65, -2.64],
    [1.65, -2.64],
    [-2.78, -1.18],
    [2.78, -1.18],
  ]) {
    roundedBox("rear_rubber_foot", [0.42, 0.13, 0.05], 0.04, materials.darkRubber, {
      position: [x, y, -0.36],
      rotation: [0.04, 0, 0],
    }, 4);
  }
}

function addCablePortInterior() {
  const points = [
    new Vector2(0.04, -0.08),
    new Vector2(0.09, -0.06),
    new Vector2(0.11, 0.0),
    new Vector2(0.09, 0.06),
    new Vector2(0.04, 0.08),
  ];
  const geometry = new LatheGeometry(points, 32);
  addMesh("usb_port_rounded_inner_wall", geometry, materials.seam, {
    position: [0, 1.08, 0.47],
    rotation: [Math.PI / 2, 0, Math.PI / 2],
    scale: [1.7, 0.62, 0.62],
  });
}

const font = new FontLoader().parse(JSON.parse(await readFile(fontPath, "utf8")));

addBodyShell();
addGrip("left");
addGrip("right");
addShoulders();
addPortsAndDetails();
addCablePortInterior();
addThumbstick("left_thumbstick", -1.55, 0.14);
addThumbstick("right_thumbstick", 1.2, -0.66);
addDpad();
addFaceButton("button_a", "A", 2.1, -0.42, materials.green);
addFaceButton("button_b", "B", 2.5, -0.06, materials.red);
addFaceButton("button_x", "X", 1.7, -0.06, materials.blue);
addFaceButton("button_y", "Y", 2.1, 0.3, materials.yellow);
addDecorativeScrews();
addSupportFeet();

roundedBox("bottom_headset_jack_recess", [0.58, 0.13, 0.06], 0.045, materials.seam, {
  position: [0, -1.7, 0.34],
  rotation: [0.04, 0, 0],
});
cylinder("bottom_headset_jack_inner", 0.08, 0.08, 0.045, materials.metal, {
  position: [0, -1.72, 0.39],
  rotation: [Math.PI / 2, 0, 0],
}, 32);

controller.rotation.x = -0.08;
controller.position.y = 0.18;
controller.updateMatrixWorld(true);

const exporter = new GLTFExporter();
const glb = await exporter.parseAsync(scene, {
  binary: true,
  onlyVisible: true,
  trs: false,
});
await writeFile(outPath, Buffer.from(glb));

let meshCount = 0;
let triangleCount = 0;
scene.traverse((object) => {
  if (!object.isMesh) return;
  meshCount++;
  const geometry = object.geometry;
  const position = geometry.getAttribute("position");
  triangleCount += geometry.index ? geometry.index.count / 3 : position.count / 3;
});

console.log(JSON.stringify({
  output: outPath,
  meshCount,
  cubieCount: cubieIndex,
  triangleCount: Math.round(triangleCount),
  sizeBytes: Buffer.byteLength(Buffer.from(glb)),
}, null, 2));
