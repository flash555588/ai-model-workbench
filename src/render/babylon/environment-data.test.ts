import { describe, expect, it } from "vitest";

import { createBabylonStudioEnvironmentFaces, ENVIRONMENT_FACE_SIZE } from "./environment-data";

function averageLuminance(face: Uint8Array): number {
  let total = 0;
  const pixels = face.length / 4;
  for (let i = 0; i < face.length; i += 4) {
    total += (face[i] + face[i + 1] + face[i + 2]) / 3;
  }
  return total / pixels;
}

describe("babylon studio environment data", () => {
  const faces = createBabylonStudioEnvironmentFaces();

  it("builds six opaque cube faces of the expected size", () => {
    expect(faces).toHaveLength(6);
    for (const face of faces) {
      expect(face).toHaveLength(ENVIRONMENT_FACE_SIZE * ENVIRONMENT_FACE_SIZE * 4);
      for (let i = 3; i < face.length; i += 4) {
        expect(face[i]).toBe(255);
      }
    }
  });

  it("makes the ceiling brighter than the floor", () => {
    // Faces are in Babylon order: +X, -X, +Y, -Y, +Z, -Z.
    const ceiling = averageLuminance(faces[2]);
    const floor = averageLuminance(faces[3]);

    expect(ceiling).toBeGreaterThan(floor);
  });

  it("keeps side faces between floor and ceiling brightness", () => {
    const ceiling = averageLuminance(faces[2]);
    const floor = averageLuminance(faces[3]);

    for (const index of [0, 1, 4, 5]) {
      const side = averageLuminance(faces[index]);
      expect(side).toBeLessThan(ceiling);
      expect(side).toBeGreaterThan(floor);
    }
  });

  it("produces a neutral gradient with no color cast", () => {
    for (const face of faces) {
      for (let i = 0; i < face.length; i += 4) {
        // Channels stay within a few units of each other across the gradient.
        const spread = Math.max(face[i], face[i + 1], face[i + 2])
          - Math.min(face[i], face[i + 1], face[i + 2]);
        expect(spread).toBeLessThanOrEqual(16);
      }
    }
  });
});
