import { describe, expect, it } from "vitest";
import { buildCadScript } from "./freecad-script-builder";

describe("buildCadScript", () => {
  it("renders STEP templates with normalized paths and original source extension", () => {
    const script = buildCadScript(
      "C:\\vault\\models\\assembly.stp",
      "C:\\vault\\models\\assembly.ai3d-converted.glb",
      ".stp",
    );

    expect(script).toContain('src = r"C:/vault/models/assembly.stp"');
    expect(script).toContain('out = r"C:/vault/models/assembly.ai3d-converted.glb"');
    expect(script).toContain('source_ext = "stp"');
    expect(script).toContain("STEPCAFControl_Reader");
    expect(script).toContain("RWGltf_CafWriter");
    expect(script).not.toContain("__AI3D_SOURCE_PATH__");
  });

  it("selects IGES and BREP templates without STEP-only writer code", () => {
    const igesScript = buildCadScript("/vault/models/bracket.igs", "/vault/models/bracket.glb", "igs");
    const brepScript = buildCadScript("/vault/models/body.brep", "/vault/models/body.glb", "brep");

    expect(igesScript).toContain('source_ext = "igs"');
    expect(igesScript).toContain("IGESControl_Reader");
    expect(igesScript).not.toContain("RWGltf_CafWriter");
    expect(brepScript).toContain('source_ext = "brep"');
    expect(brepScript).toContain("BRepTools.Read_s");
    expect(brepScript).not.toContain("STEPCAFControl_Reader");
  });

  it("rejects paths that cannot be safely embedded in Python raw strings", () => {
    expect(() => buildCadScript('/vault/models/bad"name.step', "/vault/models/out.glb", "step"))
      .toThrow("double-quote character");
  });
});
