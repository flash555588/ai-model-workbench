import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSettings } from "../../domain/models";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";

const runtime = vi.hoisted(() => ({ mount: vi.fn<() => { remove(): void }>(), dispose: vi.fn() }));
vi.mock("obsidian", () => ({ editorInfoField: {}, editorLivePreviewField: {} }));
vi.mock("../../utils/resolve-path", () => ({ resolveVaultPath: vi.fn() }));
vi.mock("./live-preview", () => ({ ModelEmbedWidget: class {
  toDOM() { return runtime.mount(); }
  destroy() { runtime.dispose(); }
} }));
vi.mock("../../utils/dom", () => ({ createStagedEl: () => ({
  className: "", isConnected: true, children: [] as unknown[],
  ownerDocument: { body: {} },
  style: { width: "", setProperty: vi.fn(), removeProperty: vi.fn() },
  setAttribute: vi.fn(),
  replaceChildren(...children: unknown[]) { this.children = children; },
}) }));

import { createImageEmbedWidget } from "./lazy-live-preview";

const observers: Array<{ enter(): void }> = [];
const removalObservers: Array<{ check(): void; disconnect: ReturnType<typeof vi.fn> }> = [];
beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0;
  removalObservers.length = 0;
  runtime.mount.mockImplementation(() => ({ remove: vi.fn() }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: unknown[]) => void) {
      observers.push({ enter: () => callback([{ isIntersecting: true }]) });
    }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("MutationObserver", class {
    disconnect = vi.fn();
    constructor(callback: () => void) { removalObservers.push({ check: callback, disconnect: this.disconnect }); }
    observe() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

function widget() {
  return createImageEmbedWidget({} as App, { enabledConverterIds: [] } as unknown as PluginSettings,
    {} as ConvertedAssetCache, "cube.glb", { width: 160, height: 100 });
}

describe("lazy embed viewport lifecycle", () => {
  it("releases the preview when its note root disappears without an unload callback", async () => {
    const embed = widget();
    const root = embed.toDOM();
    observers[0].enter();
    await vi.waitFor(() => expect(root.children.length).toBe(1));
    removalObservers[0].check();
    expect(runtime.dispose).not.toHaveBeenCalled();
    Object.defineProperty(root, "isConnected", { value: false });
    removalObservers[0].check();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(removalObservers[0].disconnect).toHaveBeenCalledTimes(1);
    removalObservers[0].check();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });
  it("renders again when CodeMirror reuses a disposed decoration", async () => {
    const embed = widget();
    embed.toDOM();
    observers[0].enter();
    await vi.waitFor(() => expect(runtime.mount).toHaveBeenCalledTimes(1));
    embed.destroy();
    const returningRoot = embed.toDOM();
    observers[1].enter();
    await vi.waitFor(() => expect(returningRoot.children.length).toBe(1));
    expect(runtime.mount).toHaveBeenCalledTimes(2);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    embed.destroy();
  });

  it("does not attach an obsolete async mount after the same widget returns", async () => {
    const embed = widget();
    const staleRoot = embed.toDOM();
    observers[0].enter();
    embed.destroy();
    const currentRoot = embed.toDOM();
    observers[1].enter();
    await vi.waitFor(() => expect(currentRoot.children.length).toBe(1));
    expect(staleRoot.children.length).toBe(0);
    expect(runtime.mount).toHaveBeenCalledTimes(1);
    embed.destroy();
  });

  it("releases a pending mount without creating preview DOM after removal", async () => {
    const embed = widget();
    const root = embed.toDOM();
    observers[0].enter();
    embed.destroy();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(root.children.length).toBe(0);
    expect(runtime.mount).not.toHaveBeenCalled();
  });
});
