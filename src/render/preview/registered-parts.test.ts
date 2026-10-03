import { describe, expect, it, vi } from "vitest";
import type { PartRecord } from "../../domain/models";
import { createRegisteredPartDisplay, resolveRegisteredParts, type RegisteredPartGeometry } from "./registered-parts";

const part = (id: string, refs: string[], extra: Partial<PartRecord> = {}): PartRecord => ({
  partId: id, assetId: "current-model", name: id, meshRefs: refs, materialRefs: [], confidence: 1, reviewed: false, observations: [], inferredFunctions: [], knowledgeTags: [], ...extra,
});
const geometries = [{ key: "a", names: ["shell"] }, { key: "b", names: ["pin"] }, { key: "c", names: ["other"] }];

describe("registered part resolution", () => {
  it("uses this model's exact mesh references and reports missing/partial records", () => {
    const rows = resolveRegisteredParts([part("one", ["shell"]), part("two", ["pin", "lost"]), part("three", ["Shell"])], geometries, []);
    expect(rows.map(row => [row.status, row.meshKeys])).toEqual([["matched", ["a"]], ["partial", ["b"]], ["missing", []]]);
  });
  it("does not use a different occurrence when a saved identity is stale", () => {
    expect(resolveRegisteredParts([part("one", ["pin"], { componentPath: "old/pin" })], geometries,
      [{ identity: { componentPath: "new/pin" }, meshKeys: ["b"] }])[0].status).toBe("missing");
  });
  it("matches the generated Babylon import wrapper to the same Three component path", () => {
    const candidates = [{ identity: { componentPath: "world/pin" }, meshKeys: ["b"] }];
    expect(resolveRegisteredParts([part("one", ["pin"], { componentPath: "__root__/world/pin" })], geometries, candidates)[0].status).toBe("matched");
    expect(resolveRegisteredParts([part("one", ["pin"], { componentPath: "assembly/world/pin" })], geometries, candidates)[0].status).toBe("missing");
  });
  it("rejects ambiguous mesh names but resolves an exact occurrence scope", () => {
    const repeated = [{ key: "a", names: ["bolt"] }, { key: "b", names: ["bolt"] }];
    expect(resolveRegisteredParts([part("one", ["bolt"])], repeated, [])[0].status).toBe("ambiguous");
    expect(resolveRegisteredParts([part("one", ["bolt"], { occurrenceId: "bolt-2" })], repeated,
      [{ identity: { occurrenceId: "bolt-2" }, meshKeys: ["b"] }])[0].meshKeys).toEqual(["b"]);
  });
  it("uses a unique group for capped references only when its count agrees", () => {
    const candidates = [{ identity: { componentPath: "body" }, meshKeys: ["a", "b"] }];
    const row = resolveRegisteredParts([part("one", ["shell"], { componentPath: "body", childCount: 2 })], geometries, candidates)[0];
    expect(row.meshKeys).toEqual(["a", "b"]);
    expect(resolveRegisteredParts([part("one", ["shell"], { childCount: 2 })], geometries, [])[0].status).toBe("partial");
  });
  it("keeps duplicate mesh names together when an exact group's registered count agrees", () => {
    const repeated = [{ key: "a", names: ["bolt"] }, { key: "b", names: ["bolt"] }];
    const candidates = [{ identity: { componentPath: "fasteners" }, meshKeys: ["a", "b"] }];
    const row = resolveRegisteredParts([part("one", ["bolt"], { componentPath: "fasteners", childCount: 2 })], repeated, candidates)[0];
    expect(row.status).toBe("matched"); expect(row.meshKeys).toEqual(["a", "b"]);
    expect(resolveRegisteredParts([part("one", ["bolt"], { componentPath: "fasteners", childCount: 1 })], repeated, candidates)[0].status).toBe("ambiguous");
  });
  it("rejects overlapping ownership and duplicate registration IDs", () => {
    expect(resolveRegisteredParts([part("one", ["shell"]), part("two", ["shell"])], geometries, []).map(row => row.status)).toEqual(["ambiguous", "ambiguous"]);
    expect(resolveRegisteredParts([part("one", ["shell"]), part("one", ["pin"])], geometries, []).map(row => row.status)).toEqual(["ambiguous", "ambiguous"]);
  });
  it("does not guess among repeated component identities", () => {
    const candidates = [{ identity: { componentId: "bolt" }, meshKeys: ["a"] }, { identity: { componentId: "bolt" }, meshKeys: ["b"] }];
    expect(resolveRegisteredParts([part("one", [], { componentId: "bolt" })], geometries, candidates)[0].status).toBe("ambiguous");
  });
});

describe("registered part display", () => {
  it("keeps group geometry together, isolates parts, retains unregistered geometry and restores on dispose", () => {
    const targets = geometries.map((geometry, index): RegisteredPartGeometry => ({
      ...geometry, bounds: { min: { x: index, y: 0, z: 0 }, max: { x: index + 1, y: 1, z: 1 } },
      visible: true, setOffset: vi.fn(), setVisible: vi.fn(), restore: vi.fn(),
    }));
    const changed = vi.fn(); const released = vi.fn(); const fit = vi.fn();
    const display = createRegisteredPartDisplay([part("one", ["shell", "pin"])], targets, [], changed, fit, released);
    display.setSpread(1);
    expect(targets[0].setOffset).toHaveBeenLastCalledWith({ x: -1, y: -0.5, z: -0.5 });
    expect(targets[1].setOffset).toHaveBeenLastCalledWith({ x: -1, y: -0.5, z: -0.5 });
    expect(targets[2].setVisible).toHaveBeenLastCalledWith(false);
    expect(display.unregisteredMeshCount).toBe(1);
    display.setAllVisible(false);
    expect(targets[0].setVisible).toHaveBeenLastCalledWith(false);
    expect(targets[1].setVisible).toHaveBeenLastCalledWith(false);
    display.setAllVisible(true);
    expect(targets[0].setVisible).toHaveBeenLastCalledWith(true);
    expect(targets[2].setVisible).toHaveBeenLastCalledWith(false);
    display.setVisible("one", false);
    expect(targets[0].setVisible).toHaveBeenLastCalledWith(false);
    display.isolate("one");
    expect(targets[0].setVisible).toHaveBeenLastCalledWith(true);
    display.reset();
    for (const target of targets) expect(target.restore).toHaveBeenCalledTimes(1);
    expect(targets[2].setVisible).toHaveBeenLastCalledWith(true);
    display.dispose(); display.dispose(); display.setSpread(1);
    for (const target of targets) expect(target.restore).toHaveBeenCalledTimes(2);
    expect(released).toHaveBeenCalledTimes(1);
  });
});
