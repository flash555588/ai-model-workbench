/**
 * Axis-helper visibility arbitration.
 *
 * The axis indicator has two independent callers: the `scene.axis` block config
 * and the orientation-gizmo toolbar toggle. They were previously written into a
 * single `visible` flag, so whichever ran last silently discarded the other's
 * request — turning the gizmo off also erased an `axis: true` config.
 *
 * Keeping the two inputs separate and resolving them here means neither caller
 * has to know about the other.
 */

export interface AxisVisibilityInputs {
  /** Orientation-gizmo toolbar toggle. */
  gizmoEnabled: boolean;
  /**
   * `scene.axis` from the block config. `undefined` means the config never set
   * it, which is distinct from an explicit `false`.
   */
  configAxis: boolean | undefined;
}

/** Resolve whether the shared axis helper should be visible. */
export function resolveAxisVisibility(inputs: AxisVisibilityInputs): boolean {
  return inputs.gizmoEnabled || inputs.configAxis === true;
}
