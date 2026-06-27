import type { App } from "obsidian";

export type VaultPathResolver = (app: App, rawPath: string) => string | null;

export type LivePreviewPathResolverCache = {
  resolve: (rawPath: string) => string | null;
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
    resolve(rawPath: string): string | null {
      if (cache.has(rawPath)) {
        return cache.get(rawPath) ?? null;
      }

      const resolved = resolvePath(app, rawPath);
      cache.set(rawPath, resolved);
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
        }
      }
      return resolved;
    },
    clear(): void {
      cache.clear();
    },
  };
}
