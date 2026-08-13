/**
 * Local-first URL guard for the Three.js loader path.
 *
 * Mirrors the Babylon guard in `../babylon/network-guard.ts`: model assets must
 * resolve inside the vault, so any explicitly remote URL is refused instead of
 * being fetched. Without this, an unresolved `.gltf` URI falls through to the
 * default Three loader and triggers a real network request.
 */

/** Blob/data URLs are produced locally by the resource resolver and stay allowed. */
const LOCAL_URL_SCHEME_RE = /^(blob:|data:)/i;
const REMOTE_URL_RE = /^(https?:|wss?:|ftp:)\/\//i;
const PROTOCOL_RELATIVE_RE = /^\/\//;

export function isThreeRemoteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || LOCAL_URL_SCHEME_RE.test(trimmed)) return false;
  return REMOTE_URL_RE.test(trimmed) || PROTOCOL_RELATIVE_RE.test(trimmed);
}

export function createThreeRemoteUrlError(url: string, channel: string): Error {
  return new Error(
    `[AI3D] Three ${channel} is limited to local vault resources. Refused remote URL: ${url}`,
  );
}

/**
 * Throw when `url` points off-device.
 *
 * @param channel Short description of the load channel, used in the error message.
 */
export function guardThreeUrl(url: string, channel: string): string {
  if (isThreeRemoteUrl(url)) {
    throw createThreeRemoteUrlError(url, channel);
  }
  return url;
}
