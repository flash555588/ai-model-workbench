/**
 * Procedural studio-environment pixel data.
 *
 * Kept free of Babylon imports so the gradient math can be tested without a
 * WebGL context. `environment.ts` wraps this into a `RawCubeTexture`.
 *
 * The gradient mirrors the intent of the Three path's `RoomEnvironment`: a
 * bright soft ceiling, neutral mid-tone walls, and a darker floor.
 */

/** Cube face order expected by Babylon: +X, -X, +Y, -Y, +Z, -Z. */
const FACE_COUNT = 6;
export const ENVIRONMENT_FACE_SIZE = 32;
const CHANNELS = 4;

const CEILING = { r: 250, g: 250, b: 252 };
const UPPER_WALL = { r: 214, g: 218, b: 226 };
const LOWER_WALL = { r: 150, g: 155, b: 166 };
const FLOOR = { r: 74, g: 77, b: 86 };

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(amount, 1));
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

/**
 * Sample the environment gradient for a direction.
 *
 * @param upness Vertical component of the sample direction, -1 (down) to 1 (up).
 */
function sampleGradient(upness: number): Rgb {
  if (upness >= 0) {
    return mix(UPPER_WALL, CEILING, upness);
  }
  return mix(LOWER_WALL, FLOOR, -upness);
}

/**
 * Vertical component of the direction vector for a texel on one cube face.
 *
 * Faces are indexed in Babylon order; u and v run 0..1 across the face.
 */
function faceUpness(face: number, u: number, v: number): number {
  // +Y is fully up, -Y fully down; the four side faces interpolate vertically.
  if (face === 2) return 1;
  if (face === 3) return -1;
  // Cube-face coordinates map to [-1, 1]; v grows downward in texture space.
  const y = 1 - 2 * v;
  const axis = 1;
  return y / Math.sqrt(y * y + axis * axis + (2 * u - 1) * (2 * u - 1));
}

function createFaceData(face: number): Uint8Array {
  const data = new Uint8Array(ENVIRONMENT_FACE_SIZE * ENVIRONMENT_FACE_SIZE * CHANNELS);
  for (let y = 0; y < ENVIRONMENT_FACE_SIZE; y++) {
    for (let x = 0; x < ENVIRONMENT_FACE_SIZE; x++) {
      const color = sampleGradient(faceUpness(
        face,
        (x + 0.5) / ENVIRONMENT_FACE_SIZE,
        (y + 0.5) / ENVIRONMENT_FACE_SIZE,
      ));
      const offset = (y * ENVIRONMENT_FACE_SIZE + x) * CHANNELS;
      data[offset] = Math.round(color.r);
      data[offset + 1] = Math.round(color.g);
      data[offset + 2] = Math.round(color.b);
      data[offset + 3] = 255;
    }
  }
  return data;
}

/** Generate the raw cube-face pixel data, one `Uint8Array` per face. */
export function createBabylonStudioEnvironmentFaces(): Uint8Array[] {
  return Array.from({ length: FACE_COUNT }, (_, face) => createFaceData(face));
}
