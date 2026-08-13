/**
 * Renderer-agnostic tuning constants shared by the Three.js and Babylon.js
 * backends.
 *
 * These previously lived as private constants in each `scene.ts`, hand-synced
 * through comments ("Matches the Three path's …"). They must stay identical so
 * both backends agree on frame-budget thresholds, focus-animation duration,
 * and environment intensity — keeping them here removes the drift risk.
 */

/** Frame duration (ms) at or above which a frame is counted as "slow". */
export const FRAME_BUDGET_SLOW_MS = 28;

/** Duration (ms) of the focus-point camera animation, identical across backends. */
export const FOCUS_ANIMATION_MS = 320;

/** Environment (IBL) intensity applied when image-based lighting is enabled. */
export const ENVIRONMENT_INTENSITY = 0.48;
