import { describe, expect, it } from "vitest";

import { resolveAxisVisibility } from "./axis-visibility";

describe("axis helper visibility", () => {
  it("shows the helper when either input asks for it", () => {
    expect(resolveAxisVisibility({ gizmoEnabled: true, configAxis: undefined })).toBe(true);
    expect(resolveAxisVisibility({ gizmoEnabled: false, configAxis: true })).toBe(true);
    expect(resolveAxisVisibility({ gizmoEnabled: true, configAxis: true })).toBe(true);
  });

  it("hides the helper only when neither input asks for it", () => {
    expect(resolveAxisVisibility({ gizmoEnabled: false, configAxis: undefined })).toBe(false);
    expect(resolveAxisVisibility({ gizmoEnabled: false, configAxis: false })).toBe(false);
  });

  it("keeps a config axis visible after the gizmo toggle is turned off", () => {
    // The regression this guards: toggling the gizmo off used to clear the
    // shared visible flag, hiding an axis the block config had asked for.
    const configAxis = true;

    expect(resolveAxisVisibility({ gizmoEnabled: true, configAxis })).toBe(true);
    expect(resolveAxisVisibility({ gizmoEnabled: false, configAxis })).toBe(true);
  });

  it("keeps the gizmo visible when the config explicitly disables the axis", () => {
    // Mirror case: `axis: false` must not override a gizmo the user just enabled.
    expect(resolveAxisVisibility({ gizmoEnabled: true, configAxis: false })).toBe(true);
  });

  it("treats an absent config axis as not requesting visibility", () => {
    // `undefined` means "unchanged", so it must not be coerced into `true`.
    expect(resolveAxisVisibility({ gizmoEnabled: false, configAxis: undefined })).toBe(false);
  });
});
