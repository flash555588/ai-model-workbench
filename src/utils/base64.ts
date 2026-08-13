/**
 * Convert an ArrayBuffer to a base64 string.
 * Uses chunked processing to avoid call-stack overflow on large buffers.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(""));
}

/**
 * Decode a base64 data URL into an ArrayBuffer without using fetch().
 * Handles both `data:<mime>;base64,<payload>` and the bare payload.
 */
export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const [, base64 = ""] = dataUrl.split(",", 2);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Decode a base64 data URL into a Blob, preserving the declared MIME type. */
export function dataUrlToBlob(dataUrl: string, fallbackMime = "image/png"): Blob {
  const [header] = dataUrl.split(",");
  const mime = header?.match(/:(.*?);/)?.[1] ?? fallbackMime;
  return new Blob([dataUrlToArrayBuffer(dataUrl)], { type: mime });
}
