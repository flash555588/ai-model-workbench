import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";

// Deterministic, synthetic fixtures; no network downloads or external CAD tools.
const fixtureDir = fileURLToPath(new URL("../models/resource-fixtures/three-direct/", import.meta.url));
await mkdir(fixtureDir, { recursive: true });
const vertices = [[-1, -1, -1], [1, -1, 1], [-1, 1, 1], [1, 1, -1]];
const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
const points = [];
for (const [left, right] of [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]) {
  for (let step = 0; step <= 60; step++) {
    points.push(vertices[left].map((value, axis) => value + (vertices[right][axis] - value) * step / 60).join(" "));
  }
}
await writeFile(join(fixtureDir, "tetrahedron.xyz"), `${points.join("\n")}\n`);
await writeFile(join(fixtureDir, "tetrahedron.pcd"), [
  "# Synthetic PCD fixture", "VERSION .7", "FIELDS x y z", "SIZE 4 4 4", "TYPE F F F",
  "COUNT 1 1 1", `WIDTH ${points.length}`, "HEIGHT 1", "VIEWPOINT 0 0 0 1 0 0 0",
  `POINTS ${points.length}`, "DATA ascii", ...points, "",
].join("\n"));
const model = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
  <resources><object id="1" type="model" name="Tetrahedron"><mesh>
    <vertices>${vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices>
    <triangles>${faces.map(([v1, v2, v3]) => `<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`).join("")}</triangles>
  </mesh></object></resources><build><item objectid="1"/></build>
</model>`;
const archive = {
  "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
  "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
  "3D/3dmodel.model": strToU8(model),
};
await writeFile(join(fixtureDir, "tetrahedron.3mf"), zipSync(archive, { mtime: new Date("2026-10-01T00:00:00Z") }));
console.log("Generated Three direct-format fixtures.");
