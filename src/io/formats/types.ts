export type ModelFamily = "mesh" | "cad" | "point-cloud";

export type LoadStrategy = "direct" | "convert";

export interface FormatCapability {
  ext: string;
  family: ModelFamily;
  strategy: LoadStrategy;
  /**
   * Loader identifier used by direct routes. Built-ins use `"babylon"`,
   * `"custom-stl"`, or `"custom-ply"`; custom formats may use any string.
   */
  directLoader?: string;
  converterId?: string;
  outputFormat?: "glb";
  /** Optional human-readable label for diagnostics and pickers. */
  displayName?: string;
  enabled: boolean;
}
