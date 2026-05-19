import { BabylonModelPreview } from "../src/render/babylon/scene";

declare global {
  interface Window {
    __ai3dPreview?: BabylonModelPreview;
    __ai3dPreviewVerify?: {
      status: "loading" | "ready" | "error";
      summary?: unknown;
      error?: string;
    };
  }
}

async function main() {
  window.__ai3dPreviewVerify = { status: "loading" };

  const shell = document.createElement("main");
  shell.id = "preview-shell";
  shell.innerHTML = `
    <section class="scroll-sentinel">scroll sentinel before canvas</section>
    <section class="preview-card">
      <canvas id="preview-canvas" width="960" height="640"></canvas>
    </section>
    <section class="scroll-sentinel">scroll sentinel after canvas</section>
  `;
  document.body.appendChild(shell);

  const canvas = document.getElementById("preview-canvas") as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error("Preview canvas was not created");
  }

  const response = await fetch("/models/rubiks-cube-3x3.glb");
  if (!response.ok) {
    throw new Error(`Failed to load sample model: HTTP ${response.status}`);
  }

  const preview = new BabylonModelPreview(canvas);
  const summary = await preview.loadModel(await response.arrayBuffer(), "glb");
  preview.toggleOrientationGizmo();
  window.__ai3dPreview = preview;

  window.__ai3dPreviewVerify = { status: "ready", summary };
}

main().catch((error: unknown) => {
  window.__ai3dPreviewVerify = {
    status: "error",
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  };
});
