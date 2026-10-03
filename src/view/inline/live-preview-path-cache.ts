import type { App } from "obsidian";

export type VaultPathResolver = (app: App, rawPath: string, sourcePath?: string) => string | null;

export type LivePreviewPathResolverCache = {
  resolve: (rawPath: string, sourcePath?: string) => string | null;
  clear: () => void;
};

const DEFAULT_MAX_RESOLVED_EMBED_PATHS = 512;

export function createLivePreviewPathResolverCache(
  app: App,
  resolvePath: VaultPathResolver,
  maxEntries = DEFAULT_MAX_RESOLVED_EMBED_PATHS,
): LivePreviewPathResolverCache {
  const cache = new Map<string, string | null>();

  return {
    resolve(rawPath: string, sourcePath = ""): string | null {
      const key = JSON.stringify([sourcePath, rawPath]);
      if (cache.has(key)) {
        return cache.get(key) ?? null;
      }

      const resolved = resolvePath(app, rawPath, sourcePath);
      cache.set(key, resolved);
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next();
        if (!oldest.done) {
          cache.delete(oldest.value);
        }
      }
      return resolved;
    },
    clear(): void {
      cache.clear();
    },
  };
}
