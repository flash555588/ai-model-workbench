import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { readFile } from "./node-shim";
import { pathIsAbsolute as isAbsolute, pathJoin as join, pathNormalize as normalize } from "./node-shim";

export function normalizePortablePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function normalizePortableRelativePath(path: string): string {
  const normalized = normalizePortablePath(path);
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function decodePortableUri(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

export function joinPortablePath(basePath: string, relativePath: string): string {
  const decoded = decodePortableUri(relativePath.split(/[?#]/, 1)[0] ?? relativePath);
  if (!basePath) {
    return normalizePortableRelativePath(decoded);
  }
  return normalizePortableRelativePath(`${basePath}/${decoded}`);
}

export function getPortableDirname(path: string): string {
  const normalized = normalizePortablePath(path).replace(/\/+$/, "");
  const sepIdx = normalized.lastIndexOf("/");
  return sepIdx > 0 ? normalized.slice(0, sepIdx) : "";
}

export function getPortableBasename(path: string): string {
  const normalized = normalizePortablePath(path).replace(/\/+$/, "");
  const sepIdx = normalized.lastIndexOf("/");
  return sepIdx >= 0 ? normalized.slice(sepIdx + 1) : normalized;
}

export function getPortableStem(path: string): string {
  return getPortableBasename(path).replace(/\.[^.]+$/, "");
}

async function resolveCaseInsensitiveVaultPath(app: App, rawPath: string): Promise<string | null> {
  const portable = normalizePortableRelativePath(rawPath);
  if (!portable) {
    return null;
  }

  const parts = portable.split("/");
  let folderPath = "";
  let children = app.vault.getRoot().children;
  for (const part of parts) {
    const exact = children.find((child) => child.name === part);
    const match = exact ?? children.find((child) => child.name.toLowerCase() === part.toLowerCase());
    if (!match) {
      return null;
    }
    folderPath = folderPath ? `${folderPath}/${match.name}` : match.name;
    if (match instanceof TFile) {
      return folderPath;
    }
    if (!(match instanceof TFolder)) {
      return null;
    }
    children = match.children;
  }

  return null;
}

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
    return buf.buffer as ArrayBuffer;
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function getVaultBasePath(app: App): string | null {
  const adapter = app.vault.adapter as {
    getBasePath?: () => string;
    basePath?: string;
  };

  if (typeof adapter.getBasePath === "function") {
    return adapter.getBasePath();
  }

  if (typeof adapter.basePath === "string" && adapter.basePath.length > 0) {
    return adapter.basePath;
  }

  return null;
}

/**
 * Resolve a model path using Obsidian's vault and metadata cache.
 * Returns the canonical vault path, or null if not found.
 */
export function resolveVaultPath(app: App, rawPath: string): string | null {
  const exact = app.vault.getAbstractFileByPath(rawPath);
  if (exact) return exact.path;

  const resolved = app.metadataCache?.getFirstLinkpathDest?.(rawPath, "");
  if (resolved) return resolved.path;

  return null;
}

export function resolveVaultAbsolutePath(app: App, vaultPath: string): string | null {
  if (isAbsolute(vaultPath)) {
    return normalize(vaultPath);
  }

  const basePath = getVaultBasePath(app);
  if (!basePath) {
    return null;
  }

  return normalize(join(basePath, vaultPath));
}

export async function readBinaryPath(app: App, path: string): Promise<ArrayBuffer> {
  if (isAbsolute(path)) {
    const buf = await readFile(path);
    return toArrayBuffer(buf);
  }

  const normalizedPath = normalizePortableRelativePath(decodePortableUri(path));
  const file = app.vault.getAbstractFileByPath(normalizedPath);
  if (!(file instanceof TFile)) {
    const caseInsensitivePath = await resolveCaseInsensitiveVaultPath(app, normalizedPath);
    if (caseInsensitivePath) {
      const caseInsensitiveFile = app.vault.getAbstractFileByPath(caseInsensitivePath);
      if (caseInsensitiveFile instanceof TFile) {
        return app.vault.readBinary(caseInsensitiveFile);
      }
    }
    throw new Error(`File not found: ${normalizedPath}`);
  }

  return app.vault.readBinary(file);
}
