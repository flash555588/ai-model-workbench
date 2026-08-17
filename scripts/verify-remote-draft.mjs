import esbuild from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(rootDir, ".tmp", "remote-draft");
const entryPath = join(outDir, "entry.ts");
const bundlePath = join(outDir, "bundle.mjs");
const obsidianShimPath = join(outDir, "obsidian-shim.ts");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(obsidianShimPath, `
  export async function requestUrl(request) {
    globalThis.__remoteDraftRequests = [...(globalThis.__remoteDraftRequests ?? []), request];
    if (globalThis.__remoteDraftNeverResolve) {
      return new Promise(() => {});
    }
    return globalThis.__remoteDraftResponse ?? {
      status: 200,
      json: {
        title: "Generated draft",
        summary: "Grounded remote summary.",
        sections: [{ heading: "Evidence", body: "Uses the sanitized payload." }],
        suggestedTags: ["remote-draft"],
        warnings: ["review before publishing"],
        model: "test-model",
      },
    };
  }
`, "utf8");

await writeFile(entryPath, `
  import { createRemoteDraftDecision, requestRemoteDraft } from "../../src/view/workbench/remote-draft";
  import { DEFAULT_SETTINGS } from "../../src/domain/constants";

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  const input = {
    task: "Draft",
    model: {
      path: "models/example.glb",
      title: "example",
      format: "glb",
      summary: {
        meshCount: 2,
        triangleCount: 100,
        vertexCount: 80,
        materialCount: 1,
        boundingSize: { x: 1, y: 2, z: 3 },
        rootName: "__root__",
      },
      tags: ["demo"],
      notes: "local note",
    },
    evidence: {
      rawModelIncluded: false,
      previewImages: ["Media/3D Previews/example.png"],
      warnings: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    partCandidates: [{ partId: "p1", name: "Part", triangleCount: 100, observations: ["Observed"] }],
    annotationLinks: [{ annotationId: "a1", label: "Pin", position: [1, 2, 3], nearestPartId: "p1", nearestPartName: "Part", confidence: 0.8 }],
    knowledgeNodes: [{ id: "k1", title: "Node", domain: "geometry", summary: "Summary", relatedPartIds: ["p1"], relatedAssetIds: ["models/example.glb"], confidence: 0.7, source: "rule" }],
  };

  const local = createRemoteDraftDecision(DEFAULT_SETTINGS, input, "local-evidence-v1");
  assert(local.enabled === false && local.reason === "analysisMode=local", "Local mode should not enable remote draft");

  const emptyUrl = createRemoteDraftDecision({ ...DEFAULT_SETTINGS, analysisMode: "hybrid" }, input, "local-evidence-v1");
  assert(emptyUrl.enabled === false, "Remote draft should require serviceBaseUrl");

  const badUrl = createRemoteDraftDecision({ ...DEFAULT_SETTINGS, analysisMode: "hybrid", serviceBaseUrl: "file:///tmp/draft" }, input, "local-evidence-v1");
  assert(badUrl.enabled === false, "Remote draft should reject non-http URLs");

  const badQueryUrl = createRemoteDraftDecision({ ...DEFAULT_SETTINGS, analysisMode: "hybrid", serviceBaseUrl: "https://example.invalid/api?token=bad" }, input, "local-evidence-v1");
  assert(badQueryUrl.enabled === false, "Remote draft should reject base URLs with query strings");

  const publicHttp = createRemoteDraftDecision({ ...DEFAULT_SETTINGS, analysisMode: "hybrid", serviceBaseUrl: "http://example.invalid/api" }, input, "local-evidence-v1");
  assert(publicHttp.enabled === false, "Remote draft should reject plaintext public endpoints");

  const publicShorthand = createRemoteDraftDecision({ ...DEFAULT_SETTINGS, analysisMode: "hybrid", serviceBaseUrl: "example.invalid/api" }, input, "local-evidence-v1");
  assert(publicShorthand.enabled === true && publicShorthand.endpoint === "https://example.invalid/api/draft-note", "Public shorthand URL should default to HTTPS");

  const localPort = createRemoteDraftDecision({ ...DEFAULT_SETTINGS, analysisMode: "hybrid", serviceBaseUrl: "localhost:8787" }, input, "local-evidence-v1");
  assert(localPort.enabled === true && localPort.endpoint === "http://localhost:8787/draft-note", "Localhost shorthand URL failed");

  const rawModel = createRemoteDraftDecision({
    ...DEFAULT_SETTINGS,
    analysisMode: "hybrid",
    serviceBaseUrl: "https://example.invalid/",
    sendRawModelToRemote: true,
  }, input, "local-evidence-v1");
  assert(rawModel.enabled === false, "Remote draft must refuse raw model upload");

  const stripped = createRemoteDraftDecision({
    ...DEFAULT_SETTINGS,
    analysisMode: "hybrid",
    serviceBaseUrl: "https://example.invalid/",
    sendGeometrySummaryToRemote: false,
    sendPreviewImagesToRemote: false,
  }, input, "local-evidence-v1");
  assert(stripped.enabled === true, "Hybrid mode with URL should enable remote draft");
  assert(stripped.endpoint === "https://example.invalid/draft-note", "Endpoint normalization failed");
  assert(stripped.request.draftingInput.evidence.previewImages.length === 0, "Preview images were not stripped");
  assert(stripped.request.draftingInput.model.summary === undefined, "Geometry summary was not stripped");
  assert(stripped.request.draftingInput.partCandidates.length === 0, "Part candidates were not stripped");
  assert(stripped.request.draftingInput.annotationLinks[0].nearestPartName === undefined, "Annotation nearest part was not stripped");
  assert(stripped.request.draftingInput.annotationLinks[0].position.every((value) => value === 0), "Annotation coordinates were not stripped");
  assert(stripped.request.draftingInput.annotationLinks[0].confidence <= 0.25, "Geometry confidence was not reduced");
  assert(stripped.request.draftingInput.knowledgeNodes[0].summary === "Geometry details were withheld by privacy settings.", "Knowledge node geometry summary was not stripped");
  assert(stripped.request.draftingInput.knowledgeNodes[0].relatedPartIds.length === 0, "Knowledge node part links were not stripped");
  assert(stripped.request.draftingInput.evidence.rawModelIncluded === false, "Raw model flag must stay false");
  assert(stripped.request.draftingInput.model.path === "example.glb", "Vault path was not reduced to basename");
  assert(stripped.request.draftingInput.model.notes === "", "User notes were not stripped");
  assert(stripped.request.draftingInput.model.tags.length === 0, "User tags were not stripped");
  assert(stripped.request.draftingInput.annotationLinks[0].label === "", "Annotation label was not stripped");
  assert(stripped.request.draftingInput.annotationLinks[0].headingRef === undefined, "Annotation heading reference was not stripped");

  const included = createRemoteDraftDecision({
    ...DEFAULT_SETTINGS,
    analysisMode: "remote",
    serviceBaseUrl: "https://example.invalid/api",
    sendGeometrySummaryToRemote: true,
    sendPreviewImagesToRemote: true,
  }, input, "local-evidence-v1");
  assert(included.enabled === true, "Remote mode with URL should enable remote draft");
  assert(included.endpoint === "https://example.invalid/api/draft-note", "Remote endpoint failed");
  assert(included.request.draftingInput.evidence.previewImages.length === 1, "Preview images should be included when allowed");
  assert(included.request.draftingInput.model.summary.meshCount === 2, "Geometry summary should be included when allowed");
  assert(included.request.draftingInput.model.path === "example.glb", "Geometry consent must not expose the vault path");
  assert(included.request.draftingInput.model.notes === "", "Geometry consent must not expose user notes");
  assert(included.request.draftingInput.model.tags.length === 0, "Geometry consent must not expose user tags");
  assert(included.request.draftingInput.evidence.previewImages[0] === "example.png", "Preview image references must not expose vault folders");
  assert(included.request.draftingInput.knowledgeNodes[0].relatedAssetIds.length === 0, "Knowledge nodes must not expose vault asset paths");

  globalThis.__remoteDraftRequests = [];
  const draft = await requestRemoteDraft(included);
  assert(draft.summary === "Grounded remote summary.", "Remote draft response was not normalized");
  assert(draft.sections.length === 1, "Remote draft sections were not normalized");
  assert(globalThis.__remoteDraftRequests.length === 1, "Remote draft request was not sent");
  assert(globalThis.__remoteDraftRequests[0].url === "https://example.invalid/api/draft-note", "Remote draft request URL mismatch");
  assert(JSON.parse(globalThis.__remoteDraftRequests[0].body).draftingInput.evidence.rawModelIncluded === false, "Posted payload should not include raw model data");

  globalThis.__remoteDraftResponse = { status: 503, json: { summary: "unavailable" } };
  let failed = false;
  try {
    await requestRemoteDraft(included);
  } catch (error) {
    failed = String(error).includes("HTTP 503");
  }
  assert(failed, "Remote draft HTTP failure was not surfaced");

  globalThis.__remoteDraftNeverResolve = true;
  let timedOut = false;
  try {
    await requestRemoteDraft(included, { timeoutMs: 5 });
  } catch (error) {
    timedOut = String(error).includes("timed out after 5ms");
  } finally {
    globalThis.__remoteDraftNeverResolve = false;
  }
  assert(timedOut, "Remote draft timeout was not surfaced");

  console.log("Remote draft privacy verification passed");
`, "utf8");

await esbuild.build({
  entryPoints: [entryPath],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundlePath,
  banner: { js: "globalThis.window = globalThis; globalThis.activeWindow = globalThis;" },
  logLevel: "silent",
  plugins: [
    {
      name: "obsidian-shim",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidianShimPath }));
      },
    },
  ],
});

await import(`file://${bundlePath}`);
