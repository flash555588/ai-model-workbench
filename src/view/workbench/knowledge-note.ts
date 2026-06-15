import { Notice, TFile, type App } from "obsidian";
import type {
  AnalysisResult,
  AnnotationPin,
  LocalDraftResult,
  ModelAssetProfile,
  ModelPreviewSummary,
  PartRecord,
  RegisteredPartMatch,
} from "../../domain/models";
import type { PluginStore } from "../../store/plugin-store";
import { createPreviewSummaryTableLines } from "../../render/preview/report";
import type { ModelPreview } from "../../render/preview/types";
import { escapeHtml } from "../../utils/escape-html";
import { getPortableBasename, getPortableStem } from "../../utils/resolve-path";
import { buildLocalAnalysisResult, LOCAL_ANALYSIS_VERSION } from "./analysis-result";
import { createRemoteDraftDecision, requestRemoteDraft } from "./remote-draft";

const MAX_GENERATED_PART_NOTES = 8;
const INDEX_MANAGED_START = "<!-- AI3D_INDEX_START -->";
const INDEX_MANAGED_END = "<!-- AI3D_INDEX_END -->";

export interface KnowledgeNoteBuildOptions {
  baseName: string;
  notePath: string;
  sourcePath: string;
  profile?: ModelAssetProfile;
  preview: ModelPreviewSummary | null;
  analysis?: AnalysisResult;
  analysisSidecarPath?: string;
  knowledgeIndexPath?: string;
}

export interface GenerateKnowledgeNoteOptions {
  preview?: Pick<ModelPreview, "captureSnapshot" | "getModelEvidence"> | null;
}

function inferFormat(sourcePath: string): string {
  const ext = sourcePath.split(".").pop()?.trim().toLowerCase();
  return ext && ext.length > 0 ? ext : "unknown";
}

function formatList(items: readonly string[]): string {
  return items.filter((item) => item.length > 0).join(", ");
}

function uniqueStrings(items: readonly string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function normalizeVaultFolder(folder: string): string {
  return folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

function sanitizeVaultSegment(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[\\/:*?"<>|#[\]^]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return sanitized || fallback;
}

function formatVectorTuple(values: readonly number[] | undefined): string {
  return values?.map((value) => value.toFixed(2)).join(", ") ?? "-";
}

function formatMeshRefs(meshRefs: readonly string[], limit = 12): string {
  if (meshRefs.length === 0) {
    return "-";
  }
  const head = meshRefs.slice(0, limit).join(", ");
  const remaining = meshRefs.length - limit;
  return remaining > 0 ? `${head}, +${remaining.toLocaleString()} more` : head;
}

function formatPartSource(part: PartRecord): string {
  if (part.source === "component") {
    return part.childCount && part.childCount > 1 ? `component (${part.childCount})` : "component";
  }
  if (part.source === "group") {
    return `group (${part.childCount ?? part.meshRefs.length})`;
  }
  return "mesh";
}

function formatRegisteredMatch(match: RegisteredPartMatch): string {
  const target = match.sourceNotePath
    ? `[[${match.sourceNotePath}|${match.sourcePartName}]]`
    : match.sourcePartName;
  const reasons = match.reasons.length > 0 ? ` - ${match.reasons.join(", ")}` : "";
  return `${target} (${Math.round(match.confidence * 100)}%${reasons})`;
}

function formatAnnotationLink(pin: AnnotationPin): string[] {
  const extras: string[] = [];
  if (pin.headingRef) {
    extras.push(`heading: ${escapeHtml(pin.headingRef)}`);
  }
  if (pin.notePath) {
    const label = getPortableBasename(pin.notePath) ?? pin.notePath;
    extras.push(`note: [[${pin.notePath}|${label}]]`);
  }
  return extras;
}

function getAxisEntries(summary: ModelPreviewSummary): Array<{ axis: "x" | "y" | "z"; value: number }> {
  return [
    { axis: "x" as const, value: Math.max(0, summary.boundingSize.x) },
    { axis: "y" as const, value: Math.max(0, summary.boundingSize.y) },
    { axis: "z" as const, value: Math.max(0, summary.boundingSize.z) },
  ].sort((left, right) => right.value - left.value);
}

function buildShapeObservation(summary: ModelPreviewSummary): string {
  const [longest, middle, shortest] = getAxisEntries(summary);
  if (!longest || longest.value <= 0) {
    return "Bounding information is incomplete, so scale and orientation still need manual review.";
  }

  const longestToShortest = shortest.value > 0 ? longest.value / shortest.value : Number.POSITIVE_INFINITY;
  const middleToLongest = longest.value > 0 ? middle.value / longest.value : 0;
  const shortestToLongest = longest.value > 0 ? shortest.value / longest.value : 0;

  if (shortestToLongest <= 0.18 && middleToLongest >= 0.45) {
    return `The bounding box is strongly planar, with a thin ${shortest.axis.toUpperCase()} dimension compared with ${longest.axis.toUpperCase()}.`;
  }

  if (longestToShortest >= 3 && middleToLongest <= 0.55) {
    return `The model is strongly elongated along ${longest.axis.toUpperCase()}, which suggests a directional or axial structure.`;
  }

  return "The overall bounding volume is fairly balanced, so semantic grouping is more likely to come from mesh and material boundaries than from one dominant axis.";
}

function buildComplexityObservation(summary: ModelPreviewSummary): string {
  if (summary.splatCount !== undefined) {
    return `This is a splat-based asset with ${summary.splatCount.toLocaleString()} splats; review should focus on capture coverage, density, and viewpoint clarity instead of triangle topology.`;
  }

  let score = 0;
  if (summary.triangleCount >= 500_000) score += 3;
  else if (summary.triangleCount >= 100_000) score += 2;
  else if (summary.triangleCount >= 20_000) score += 1;

  if (summary.meshCount >= 100) score += 2;
  else if (summary.meshCount >= 25) score += 1;

  if (summary.materialCount >= 8) score += 1;

  if (score >= 5) {
    return "The mesh and material counts point to a high-complexity asset; expect semantic cleanup, regrouping, or naming review before turning it into stable knowledge notes.";
  }
  if (score >= 3) {
    return "The asset sits in a medium-complexity range: it already contains useful structure, but some meshes or materials may still reflect export convenience rather than real-world parts.";
  }
  return "The asset is structurally compact, so a lightweight local pass can usually produce usable first-draft notes without a heavier analysis pipeline.";
}

function buildTagObservation(profile?: ModelAssetProfile): string | null {
  const tags = profile?.tags ?? [];
  if (tags.length === 0) {
    return "No knowledge tags are stored yet, so the note should establish the first stable vocabulary for this model.";
  }
  return `Current tags already suggest a working taxonomy: ${formatList(tags)}.`;
}

function buildAnnotationObservation(profile?: ModelAssetProfile): string {
  const annotations = profile?.annotations ?? [];
  if (annotations.length === 0) {
    return "No annotation pins are stored yet, so the next useful pass is to mark semantically important regions before splitting the model into part notes.";
  }
  if (annotations.length === 1) {
    return "There is 1 saved annotation pin, which already gives this report a concrete user-selected focus area.";
  }
  return `There are ${annotations.length} saved annotation pins, which provide a useful first-pass map of user-relevant regions.`;
}

function buildLocalObservations(summary: ModelPreviewSummary | null, profile?: ModelAssetProfile): string[] {
  if (!summary) {
    return [
      "Preview statistics were not available when this note was generated, so the next step is to reload the model and regenerate the report.",
      buildAnnotationObservation(profile),
    ];
  }

  const observations = [
    `${summary.meshCount.toLocaleString()} mesh(es), ${(summary.splatCount ?? summary.triangleCount).toLocaleString()} ${summary.splatCount !== undefined ? "splats" : "triangles"}, and ${summary.materialCount.toLocaleString()} material slot(s) are currently visible in the preview pipeline.`,
    buildComplexityObservation(summary),
    buildShapeObservation(summary),
    buildAnnotationObservation(profile),
  ];
  const tagObservation = buildTagObservation(profile);
  if (tagObservation) {
    observations.push(tagObservation);
  }
  return observations;
}

function buildAnnotationSection(profile?: ModelAssetProfile): string[] {
  const annotations = profile?.annotations ?? [];
  if (annotations.length === 0) {
    return [
      "## Focus Areas",
      "",
      "- No focus areas have been pinned yet.",
      "",
    ];
  }

  const lines = [
    "## Focus Areas",
    "",
  ];

  for (const pin of annotations) {
    const extras = formatAnnotationLink(pin);
    const extraText = extras.length > 0 ? ` (${extras.join("; ")})` : "";
    lines.push(`- **${pin.label || "Untitled pin"}**${extraText}`);
  }

  lines.push("");
  return lines;
}

function buildAnnotationLinkSection(analysis?: AnalysisResult): string[] {
  const links = analysis?.annotationLinks ?? [];
  if (links.length === 0) {
    return [
      "## Annotation Links",
      "",
      "- No annotation-to-part links were produced in this pass.",
      "",
    ];
  }

  const lines = [
    "## Annotation Links",
    "",
    "| Annotation | Nearest Part | Linked Note | Distance | Confidence |",
    "|------------|--------------|-------------|----------|------------|",
  ];
  for (const link of links) {
    const linkedNote = link.notePath ? `[[${link.notePath}]]` : "-";
    lines.push(`| ${escapeTableCell(link.label)} | ${escapeTableCell(link.nearestPartName ?? "-")} | ${escapeTableCell(linkedNote)} | ${link.distance === undefined ? "-" : link.distance.toFixed(3)} | ${Math.round(link.confidence * 100)}% |`);
  }
  lines.push("");
  return lines;
}

function buildSuggestedPartNotesSection(analysis?: AnalysisResult): string[] {
  const linkedParts = (analysis?.parts ?? []).filter((part) => part.notePath);
  if (linkedParts.length === 0) {
    return [
      "## Suggested Part Notes",
      "",
      "- No part note drafts were created in this pass.",
      "",
    ];
  }

  const lines = [
    "## Suggested Part Notes",
    "",
  ];
  for (const part of linkedParts.slice(0, MAX_GENERATED_PART_NOTES)) {
    const label = escapeHtml(getPortableBasename(part.notePath ?? "") ?? part.name);
    const details = [
      part.category ?? "unclassified",
      formatMetricCount(part.triangleCount, "triangle"),
      part.materialName ? `material ${escapeHtml(part.materialName)}` : "",
    ].filter(Boolean).join(", ");
    lines.push(`- [[${part.notePath}|${label}]] - ${escapeHtml(part.name)} (${details})`);
  }
  lines.push("");
  return lines;
}

function formatMetricCount(value: number | undefined, label: string): string {
  return `${(value ?? 0).toLocaleString()} ${label}${value === 1 ? "" : "s"}`;
}

function summarizeTopParts(parts: readonly PartRecord[]): string {
  if (parts.length === 0) {
    return "No per-part evidence was captured yet, so the first useful editing pass is to reload the model and regenerate this note from the workbench.";
  }
  return parts
    .slice(0, 6)
    .map((part, index) => {
      const material = part.materialName ? `, material ${escapeHtml(part.materialName)}` : "";
      return `${index + 1}. ${escapeHtml(part.name)} (${part.category ?? "unclassified"}, ${formatMetricCount(part.triangleCount, "triangle")}${material})`;
    })
    .join("\n");
}

function summarizeRegisteredPartMatches(parts: readonly PartRecord[]): string {
  const matchedParts = parts.filter((part) => part.registeredMatches?.length);
  if (matchedParts.length === 0) {
    return "No previously registered parts were matched across other analyzed models in this pass.";
  }
  return matchedParts
    .slice(0, 6)
    .map((part) => {
      const best = part.registeredMatches?.[0];
      return best
        ? `- ${escapeHtml(part.name)}: possible reuse of ${escapeHtml(best.sourcePartName)} from ${escapeHtml(best.sourceAssetId)} (${Math.round(best.confidence * 100)}% confidence).`
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

function createLocalDraftResult(options: {
  baseName: string;
  sourcePath: string;
  profile?: ModelAssetProfile;
  preview: ModelPreviewSummary | null;
  analysis?: AnalysisResult;
}): LocalDraftResult {
  const format = inferFormat(options.sourcePath).toUpperCase();
  const summary = options.preview;
  const parts = [...(options.analysis?.parts ?? [])].sort((left, right) => (right.triangleCount ?? 0) - (left.triangleCount ?? 0));
  const annotations = options.profile?.annotations ?? [];
  const links = options.analysis?.annotationLinks ?? [];
  const categories = uniqueStrings(parts.map((part) => part.category ?? "unclassified")).slice(0, 6);
  const materials = uniqueStrings(parts.flatMap((part) => part.materialName ? [escapeHtml(part.materialName)] : [])).slice(0, 6);
  const topParts = summarizeTopParts(parts);
  const registeredMatches = summarizeRegisteredPartMatches(parts);
  const shapeLine = summary ? buildShapeObservation(summary) : "Geometry statistics are not available yet, so this draft should stay provisional.";
  const complexityLine = summary ? buildComplexityObservation(summary) : "Reload the preview to capture mesh, triangle, vertex, and material evidence.";
  const userNotes = options.profile?.notes.trim();
  const summaryLine = summary
    ? `${options.baseName} is a ${format} asset with ${formatMetricCount(summary.meshCount, "mesh")}, ${formatMetricCount(summary.triangleCount, "triangle")}, ${formatMetricCount(summary.vertexCount, "vertex")}, and ${formatMetricCount(summary.materialCount, "material slot")}.`
    : `${options.baseName} is a ${format} asset that still needs a refreshed preview pass before its geometry can be summarized confidently.`;
  const focusBody = annotations.length > 0
    ? annotations.map((pin) => {
        const link = links.find((candidate) => candidate.annotationId === pin.id);
        const nearest = link?.nearestPartName ? ` Nearest captured part: ${escapeHtml(link.nearestPartName)}.` : "";
        const heading = pin.headingRef ? ` Linked heading: ${escapeHtml(pin.headingRef)}.` : "";
        return `- ${escapeHtml(pin.label || "Untitled pin")}.${nearest}${heading}`;
      }).join("\n")
    : "- No pins are saved yet. Add pins for the regions that should become standalone notes, questions, or review checkpoints.";

  const nextActions = [
    parts.length > 0 ? "Rename the strongest part candidates so their mesh names match real semantic parts." : "Regenerate after the model preview has captured per-part evidence.",
    annotations.length > 0 ? "Turn each saved pin into a short linked note or heading-level review item." : "Place at least one pin on the most important region before treating this as a finished note.",
    "Review scale, orientation, materials, and whether mesh boundaries represent real assembly boundaries.",
  ];

  return {
    title: `${options.baseName} local knowledge draft`,
    summary: [
      summaryLine,
      shapeLine,
      userNotes ? `User notes add this context: ${userNotes}` : "No user notes are stored yet, so the draft stays grounded in renderer evidence and saved pins.",
    ].join(" "),
    sections: [
      {
        heading: "Evidence-backed description",
        body: [
          complexityLine,
          categories.length > 0 ? `Detected part categories: ${formatList(categories)}.` : "No part categories were inferred yet.",
          materials.length > 0 ? `Visible materials include ${formatList(materials)}.` : "No material names were captured from the renderer evidence.",
        ].join(" "),
      },
      {
        heading: "Candidate structure",
        body: topParts,
      },
      {
        heading: "Registered part reuse",
        body: registeredMatches,
      },
      {
        heading: "Focus areas",
        body: focusBody,
      },
      {
        heading: "Suggested note shape",
        body: [
          `Start with a short purpose paragraph for ${options.baseName}.`,
          "Then split the note into geometry evidence, meaningful part candidates, saved focus areas, and unresolved review questions.",
          "Only promote a mesh into a standalone part note after a human confirms its function or assembly role.",
        ].join(" "),
      },
    ],
    suggestedTags: uniqueStrings([
      ...(options.profile?.tags ?? []),
      `format/${format.toLowerCase()}`,
      ...categories.map((category) => `part/${category}`),
    ]).slice(0, 12),
    nextActions,
    generatedAt: new Date().toISOString(),
  };
}

function buildLocalDraftSection(options: KnowledgeNoteBuildOptions): string[] {
  const draft = options.analysis?.localDraft ?? createLocalDraftResult(options);
  const lines = [
    "## Local Draft Metadata",
    "",
    `- Generated at: ${draft.generatedAt}`,
    `- Sections: ${draft.sections.length.toLocaleString()}`,
  ];

  if (draft.suggestedTags.length > 0) {
    lines.push("Suggested tags:", "", ...draft.suggestedTags.map((tag) => `- ${tag}`), "");
  }

  if (draft.nextActions.length > 0) {
    lines.push("Next actions:", "", ...draft.nextActions.map((action) => `- ${action}`), "");
  }

  return lines;
}

function markdownQuote(value: string): string {
  return JSON.stringify(value);
}

function buildAiDraftingInputSection(analysis?: AnalysisResult): string[] {
  if (!analysis?.draftingInput) {
    return [
      "## AI Drafting Input",
      "",
      "- No drafting input was prepared in this pass.",
      "",
    ];
  }

  return [
    "## AI Drafting Input",
    "",
    "- Grounded drafting input is available in the sidecar JSON under `draftingInput`.",
    `- Part candidates included: ${analysis.draftingInput.partCandidates.length.toLocaleString()}`,
    `- Annotation links included: ${analysis.draftingInput.annotationLinks.length.toLocaleString()}`,
    "- Raw model included: false",
    "",
  ];
}

function buildRemoteDraftSection(analysis?: AnalysisResult): string[] {
  const draft = analysis?.remoteDraft;
  if (!draft) {
    return [
      "## Remote Draft",
      "",
      "- No remote draft was requested or returned for this pass.",
      "",
    ];
  }

  const lines = [
    "## Remote Draft",
    "",
    draft.title ? `### ${draft.title}` : "### Draft Summary",
    "",
    draft.summary,
    "",
  ];
  for (const section of draft.sections ?? []) {
    lines.push(`### ${section.heading}`, "", section.body, "");
  }
  if (draft.suggestedTags?.length) {
    lines.push("Suggested tags:", "", ...draft.suggestedTags.map((tag) => `- ${tag}`), "");
  }
  for (const warning of draft.warnings ?? []) {
    lines.push(`- Remote warning: ${warning}`);
  }
  if (draft.warnings?.length) lines.push("");
  return lines;
}

function buildEditableDraftSection(analysis?: AnalysisResult): string[] {
  const draft = analysis?.remoteDraft ?? analysis?.localDraft;
  if (!draft) {
    return [
      "## Editable Draft",
      "",
      "- No draft body was produced in this pass.",
      "",
    ];
  }

  const lines = [
    "## Editable Draft",
    "",
    analysis?.remoteDraft
      ? "- Source: optional remote draft, grounded by the local evidence sidecar."
      : "- Source: local evidence draft, generated without a remote service.",
    "",
    draft.summary,
    "",
  ];

  for (const section of draft.sections ?? []) {
    lines.push(`### ${section.heading}`, "", section.body, "");
  }

  return lines;
}

function buildPreviewImageSection(analysis?: AnalysisResult): string[] {
  const images = analysis?.previewImages ?? [];
  if (images.length === 0) {
    return [
      "## Evidence Snapshots",
      "",
      "- No preview snapshot was captured for this generation pass.",
      "",
    ];
  }

  return [
    "## Evidence Snapshots",
    "",
    ...images.map((path) => `![[${path}]]`),
    "",
  ];
}

function buildPartCandidateSection(analysis?: AnalysisResult): string[] {
  const parts = analysis?.parts ?? [];
  if (parts.length === 0) {
    return [
      "## Part Candidates",
      "",
      "- No per-mesh evidence was available. Reload the model in the workbench and regenerate the note to capture part candidates.",
      "",
    ];
  }

  const lines = [
    "## Part Candidates",
    "",
    "| # | Part | Part Note | Source | Category | Triangles | Material | Center | Evidence |",
    "|---|------|-----------|--------|----------|-----------|----------|--------|----------|",
  ];
  for (const [index, part] of parts.slice(0, 32).entries()) {
    const center = formatVectorTuple(part.center);
    const observations = part.observations.slice(0, 2).join(" ");
    const partNote = part.notePath ? `[[${part.notePath}]]` : "-";
    const source = formatPartSource(part);
    lines.push(`| ${index + 1} | ${escapeTableCell(part.name)} | ${escapeTableCell(partNote)} | ${escapeTableCell(source)} | ${escapeTableCell(part.category ?? "unclassified")} | ${(part.triangleCount ?? 0).toLocaleString()} | ${escapeTableCell(part.materialName ?? "-")} | ${center} | ${escapeTableCell(observations)} |`);
  }
  if (parts.length > 32) {
    lines.push(`| ... | ${parts.length - 32} more candidate parts omitted from this note | - | - | - | - | - | - | See sidecar JSON |`);
  }
  lines.push("");
  return lines;
}

function buildRegisteredPartMatchSection(analysis?: AnalysisResult): string[] {
  const matchedParts = (analysis?.parts ?? []).filter((part) => part.registeredMatches?.length);
  if (matchedParts.length === 0) {
    return [
      "## Registered Part Matches",
      "",
      "- No previously registered parts were matched across other analyzed models in this pass.",
      "",
    ];
  }

  const lines = [
    "## Registered Part Matches",
    "",
    "| Current Part | Best Existing Part | Source Model | Confidence | Reasons |",
    "|--------------|--------------------|--------------|------------|---------|",
  ];
  for (const part of matchedParts.slice(0, 32)) {
    const match = part.registeredMatches?.[0];
    if (!match) continue;
    const existing = match.sourceNotePath
      ? `[[${match.sourceNotePath}|${match.sourcePartName}]]`
      : match.sourcePartName;
    lines.push(`| ${escapeTableCell(part.name)} | ${escapeTableCell(existing)} | ${escapeTableCell(match.sourceAssetId)} | ${Math.round(match.confidence * 100)}% | ${escapeTableCell(match.reasons.join(", "))} |`);
  }
  if (matchedParts.length > 32) {
    lines.push(`| ... | ${matchedParts.length - 32} more matched parts omitted | - | - | See sidecar JSON |`);
  }
  lines.push("");
  return lines;
}

function buildKnowledgeNodeSection(analysis?: AnalysisResult): string[] {
  const nodes = analysis?.knowledgeNodes ?? [];
  if (nodes.length === 0) {
    return [
      "## Knowledge Nodes",
      "",
      "- No knowledge nodes were produced in this pass.",
      "",
    ];
  }

  const lines = [
    "## Knowledge Nodes",
    "",
  ];
  for (const node of nodes) {
    lines.push(`- **${node.title}** (${node.domain}, ${Math.round(node.confidence * 100)}%, ${node.source}): ${node.summary}`);
  }
  lines.push("");
  return lines;
}

function buildEvidenceHealthSection(analysis?: AnalysisResult, sidecarPath?: string): string[] {
  const lines = [
    "## Evidence Health",
    "",
    `- Analysis version: ${LOCAL_ANALYSIS_VERSION}`,
    sidecarPath ? `- Sidecar: [[${sidecarPath}|Analysis JSON]]` : "- Sidecar: not written",
    analysis?.knowledgeIndexPath ? `- Knowledge index: [[${analysis.knowledgeIndexPath}|Model index]]` : "- Knowledge index: not written",
  ];
  for (const warning of analysis?.warnings ?? []) {
    lines.push(`- Warning: ${warning}`);
  }
  if ((analysis?.warnings ?? []).length === 0) {
    lines.push("- Warnings: none");
  }
  lines.push("");
  return lines;
}

function buildKnowledgeDraftSection(summary: ModelPreviewSummary | null, profile?: ModelAssetProfile): string[] {
  const annotations = profile?.annotations ?? [];
  const lines = [
    "## Draft Knowledge Points",
    "",
  ];

  if (summary) {
    lines.push(`- Geometry overview: explain how ${summary.meshCount.toLocaleString()} mesh(es) and ${summary.materialCount.toLocaleString()} material slot(s) map to real semantic parts instead of export-only fragments.`);
    if (summary.splatCount !== undefined) {
      lines.push(`- Capture quality: review whether the ${summary.splatCount.toLocaleString()} splats preserve enough silhouette and depth detail for note-taking from multiple angles.`);
    } else {
      lines.push(`- Structural density: verify whether ${(summary.triangleCount / Math.max(summary.meshCount, 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })} average triangles per mesh reflects deliberate detail or accidental over-segmentation.`);
    }
  } else {
    lines.push("- Geometry overview: reload the model and capture preview statistics before turning this into a stable knowledge note.");
  }

  if (annotations.length > 0) {
    for (const pin of annotations.slice(0, 8)) {
      const extras = formatAnnotationLink(pin);
      const extraText = extras.length > 0 ? ` (${extras.join("; ")})` : "";
      lines.push(`- **${pin.label || "Untitled pin"}**${extraText}: describe what this region does, why it matters, and whether it deserves its own linked part note.`);
    }
  } else {
    lines.push("- Focus mapping: add pins for the regions that should become standalone part notes or review checkpoints.");
  }

  lines.push("- Review pass: confirm scale, orientation, and whether material boundaries reflect actual function, assembly, or simply renderer setup.");
  lines.push("");
  return lines;
}

export function buildKnowledgeNoteContent(options: KnowledgeNoteBuildOptions): string {
  const profile = options.profile;
  const summary = options.preview;
  const analysis = options.analysis;
  const format = inferFormat(options.sourcePath);
  const tags = profile?.tags ?? [];
  const annotations = profile?.annotations ?? [];
  const previewImages = analysis?.previewImages ?? [];

  const frontmatter = [
    "---",
    `source_model: ${markdownQuote(options.sourcePath)}`,
    `format: ${format}`,
    "status: ready",
    "analysis_mode: local",
    `analysis_version: ${LOCAL_ANALYSIS_VERSION}`,
    `report_note_path: ${markdownQuote(options.notePath)}`,
    ...(options.analysisSidecarPath ? [`analysis_sidecar_path: ${markdownQuote(options.analysisSidecarPath)}`] : []),
    ...(options.knowledgeIndexPath ? [`knowledge_index_path: ${markdownQuote(options.knowledgeIndexPath)}`] : []),
    `annotation_count: ${annotations.length}`,
    `updated_at: ${new Date().toISOString()}`,
    ...(previewImages.length > 0 ? ["preview_images:", ...previewImages.map((path) => `  - ${markdownQuote(path)}`)] : []),
    ...(tags.length > 0 ? ["knowledge_tags:", ...tags.map((tag) => `  - ${markdownQuote(tag)}`)] : []),
    "---",
  ].join("\n");

  return [
    frontmatter,
    "",
    `# ${options.baseName}`,
    "",
    "## Summary",
    "",
    ...(summary
      ? [
          ...createPreviewSummaryTableLines(summary, { decimals: 2 }),
          "",
        ]
      : ["(No preview data available)", ""]),
    ...buildEditableDraftSection(analysis),
    ...buildLocalDraftSection(options),
    ...(options.knowledgeIndexPath
      ? ["## Knowledge Index", "", `- [[${options.knowledgeIndexPath}|Open model knowledge index]]`, ""]
      : []),
    "## Local Observations",
    "",
    ...buildLocalObservations(summary, profile).map((item) => `- ${item}`),
    "",
    ...buildEvidenceHealthSection(analysis, options.analysisSidecarPath),
    ...buildPreviewImageSection(analysis),
    ...buildAnnotationSection(profile),
    ...buildAnnotationLinkSection(analysis),
    ...buildSuggestedPartNotesSection(analysis),
    ...buildPartCandidateSection(analysis),
    ...buildRegisteredPartMatchSection(analysis),
    ...buildKnowledgeNodeSection(analysis),
    ...buildAiDraftingInputSection(analysis),
    ...buildRemoteDraftSection(analysis),
    ...buildKnowledgeDraftSection(summary, profile),
    "## Review Notes",
    "",
    profile?.notes?.trim() ? profile.notes.trim() : "-",
    "",
  ].join("\n");
}

function normalizeModelAssetProfile(profile: Partial<ModelAssetProfile> | null | undefined, modelPath: string): ModelAssetProfile {
  const now = new Date().toISOString();
  return {
    tags: Array.isArray(profile?.tags) ? profile.tags : [],
    notes: typeof profile?.notes === "string" ? profile.notes : "",
    annotations: Array.isArray(profile?.annotations) ? profile.annotations : [],
    registeredParts: Array.isArray(profile?.registeredParts)
      ? profile.registeredParts
          .map((part) => normalizeRegisteredPartRecord(part, modelPath))
          .filter((part): part is PartRecord => !!part)
      : undefined,
    analysisVersion: typeof profile?.analysisVersion === "string" ? profile.analysisVersion : undefined,
    reportNotePath: typeof profile?.reportNotePath === "string" ? profile.reportNotePath : undefined,
    analysisSidecarPath: typeof profile?.analysisSidecarPath === "string" ? profile.analysisSidecarPath : undefined,
    knowledgeIndexPath: typeof profile?.knowledgeIndexPath === "string" ? profile.knowledgeIndexPath : undefined,
    previewImagePaths: Array.isArray(profile?.previewImagePaths) ? profile.previewImagePaths.filter((path): path is string => typeof path === "string") : undefined,
    createdAt: typeof profile?.createdAt === "string" ? profile.createdAt : now,
    updatedAt: typeof profile?.updatedAt === "string" ? profile.updatedAt : now,
  };
}

let noteGenerationLock: Promise<void> | null = null;

function escapeTableCell(value: string): string {
  return escapeHtml(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const [, base64 = ""] = dataUrl.split(",", 2);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  const normalized = normalizeVaultFolder(folder);
  if (!normalized) {
    return;
  }
  let current = "";
  for (const part of normalized.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current).catch(() => {});
    }
  }
}

async function createTextFileIfMissing(app: App, path: string, content: string): Promise<TFile | null> {
  const existingFile = app.vault.getAbstractFileByPath(path);
  if (existingFile instanceof TFile) {
    return existingFile;
  }

  try {
    return await app.vault.create(path, content);
  } catch {
    const file = app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }
}

async function upsertTextFile(app: App, path: string, content: string): Promise<TFile | null> {
  const existingFile = app.vault.getAbstractFileByPath(path);
  if (existingFile instanceof TFile) {
    await app.vault.modify(existingFile, content);
    return existingFile;
  }

  try {
    return await app.vault.create(path, content);
  } catch {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await app.vault.modify(file, content);
      return file;
    }
  }
  return null;
}

async function captureEvidenceSnapshot(
  app: App,
  preview: GenerateKnowledgeNoteOptions["preview"],
  folder: string,
  baseName: string,
): Promise<{ paths: string[]; warning?: string }> {
  const dataUrl = preview?.captureSnapshot?.();
  if (!dataUrl?.startsWith("data:image/png;base64,")) {
    return { paths: [] };
  }

  try {
    await ensureFolder(app, folder);
    const filePath = `${folder}/${baseName}_evidence_${Date.now()}.png`;
    await app.vault.createBinary(filePath, dataUrlToArrayBuffer(dataUrl));
    return { paths: [filePath] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { paths: [], warning: `Evidence snapshot failed: ${message}` };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeNumberTuple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const tuple = value.slice(0, 3).map((entry) => Number(entry));
  return tuple.every(Number.isFinite) ? [tuple[0], tuple[1], tuple[2]] : undefined;
}

function normalizeRegisteredPartRecord(value: unknown, fallbackAssetId: string): PartRecord | null {
  if (!isRecord(value)) return null;
  const partId = typeof value.partId === "string" ? value.partId : "";
  const name = typeof value.name === "string" ? value.name : "";
  if (!partId || !name) return null;
  const assetId = typeof value.assetId === "string" && value.assetId ? value.assetId : fallbackAssetId;
  return {
    partId,
    assetId,
    parentPartId: typeof value.parentPartId === "string" ? value.parentPartId : undefined,
    name,
    source: value.source === "group" || value.source === "mesh" || value.source === "component" ? value.source : undefined,
    componentId: typeof value.componentId === "string" ? value.componentId : undefined,
    occurrenceId: typeof value.occurrenceId === "string" ? value.occurrenceId : undefined,
    partNumber: typeof value.partNumber === "string" ? value.partNumber : undefined,
    componentPath: typeof value.componentPath === "string" ? value.componentPath : undefined,
    category: typeof value.category === "string" ? value.category : undefined,
    meshRefs: normalizeStringArray(value.meshRefs),
    childCount: Number.isFinite(value.childCount) ? Number(value.childCount) : undefined,
    materialRefs: normalizeStringArray(value.materialRefs),
    bbox: normalizeNumberTuple(value.bbox),
    center: normalizeNumberTuple(value.center),
    triangleCount: Number.isFinite(value.triangleCount) ? Number(value.triangleCount) : undefined,
    vertexCount: Number.isFinite(value.vertexCount) ? Number(value.vertexCount) : undefined,
    materialName: typeof value.materialName === "string" ? value.materialName : null,
    confidence: Number.isFinite(value.confidence) ? Number(value.confidence) : 0.5,
    observations: normalizeStringArray(value.observations),
    inferredFunctions: normalizeStringArray(value.inferredFunctions),
    knowledgeTags: normalizeStringArray(value.knowledgeTags),
    notePath: typeof value.notePath === "string" ? value.notePath : undefined,
    reviewed: value.reviewed === true,
  };
}

export async function collectRegisteredPartsFromProfiles(
  app: App,
  profiles: Record<string, ModelAssetProfile>,
  currentModelPath: string,
): Promise<PartRecord[]> {
  const parts: PartRecord[] = [];
  const seen = new Set<string>();
  const pushPart = (value: unknown, fallbackAssetId: string): void => {
    const part = normalizeRegisteredPartRecord(value, fallbackAssetId);
    if (!part) return;
    const key = `${part.assetId}:${part.partId}`;
    if (seen.has(key)) return;
    seen.add(key);
    parts.push(part);
  };

  for (const [modelPath, profile] of Object.entries(profiles)) {
    if (modelPath === currentModelPath) continue;

    if (profile.analysisSidecarPath) {
      const sidecarFile = app.vault.getAbstractFileByPath(profile.analysisSidecarPath);
      if (sidecarFile instanceof TFile) {
        try {
          const raw = await app.vault.read(sidecarFile);
          const parsed = JSON.parse(raw) as unknown;
          if (isRecord(parsed) && Array.isArray(parsed.parts)) {
            for (const value of parsed.parts) {
              pushPart(value, modelPath);
            }
          }
        } catch (error) {
          console.warn("[AI3D] Failed to read registered part sidecar:", profile.analysisSidecarPath, error);
        }
      }
    }

    for (const value of profile.registeredParts ?? []) {
      pushPart(value, modelPath);
    }
  }
  return parts;
}

function getPartNoteCandidateIds(analysis: AnalysisResult): Set<string> {
  const linkedPartIds = new Set((analysis.annotationLinks ?? []).flatMap((link) => link.nearestPartId ? [link.nearestPartId] : []));
  return new Set(
    [...analysis.parts]
      .sort((left, right) => {
        const leftLinked = linkedPartIds.has(left.partId) ? 1 : 0;
        const rightLinked = linkedPartIds.has(right.partId) ? 1 : 0;
        if (leftLinked !== rightLinked) {
          return rightLinked - leftLinked;
        }
        const leftRegistered = left.registeredMatches?.length ? 1 : 0;
        const rightRegistered = right.registeredMatches?.length ? 1 : 0;
        if (leftRegistered !== rightRegistered) {
          return rightRegistered - leftRegistered;
        }
        return (right.triangleCount ?? 0) - (left.triangleCount ?? 0);
      })
      .slice(0, MAX_GENERATED_PART_NOTES)
      .map((part) => part.partId),
  );
}

function createPartNotePath(partFolder: string, baseName: string, part: PartRecord, index: number): string {
  const folder = normalizeVaultFolder(partFolder) || "Parts/3D Components";
  const modelSegment = sanitizeVaultSegment(baseName, "model");
  const partSegment = sanitizeVaultSegment(part.name, `Part ${index + 1}`);
  return `${folder}/${modelSegment}/${String(index + 1).padStart(2, "0")} ${partSegment}.md`;
}

function buildPartNoteContent(options: {
  baseName: string;
  notePath: string;
  sourcePath: string;
  part: PartRecord;
  analysis: AnalysisResult;
}): string {
  const annotationLinks = (options.analysis.annotationLinks ?? []).filter((link) => link.nearestPartId === options.part.partId);
  const frontmatter = [
    "---",
    `source_model: ${markdownQuote(options.sourcePath)}`,
    `parent_report: ${markdownQuote(options.notePath)}`,
    `part_id: ${markdownQuote(options.part.partId)}`,
    `asset_id: ${markdownQuote(options.part.assetId)}`,
    ...(options.part.componentId ? [`component_id: ${markdownQuote(options.part.componentId)}`] : []),
    ...(options.part.occurrenceId ? [`occurrence_id: ${markdownQuote(options.part.occurrenceId)}`] : []),
    ...(options.part.partNumber ? [`part_number: ${markdownQuote(options.part.partNumber)}`] : []),
    `category: ${markdownQuote(options.part.category ?? "unclassified")}`,
    `status: draft`,
    `generated_by: ai-model-workbench`,
    `updated_at: ${new Date().toISOString()}`,
    "---",
  ].join("\n");

  return [
    frontmatter,
    "",
    `# ${escapeHtml(options.part.name)}`,
    "",
    "## Evidence",
    "",
    `- Source model: [[${options.sourcePath}|${options.baseName}]]`,
    `- Parent report: [[${options.notePath}|${options.baseName} Report]]`,
    `- Source: ${formatPartSource(options.part)}`,
    `- Category: ${options.part.category ?? "unclassified"}`,
    ...(options.part.componentId ? [`- Component ID: ${options.part.componentId}`] : []),
    ...(options.part.occurrenceId ? [`- Occurrence ID: ${options.part.occurrenceId}`] : []),
    ...(options.part.partNumber ? [`- Part number: ${options.part.partNumber}`] : []),
    ...(options.part.componentPath ? [`- Component path: ${options.part.componentPath}`] : []),
    ...(options.part.source === "group" || options.part.source === "component" ? [`- Child meshes: ${formatMeshRefs(options.part.meshRefs)}`] : []),
    `- Triangles: ${(options.part.triangleCount ?? 0).toLocaleString()}`,
    `- Vertices: ${(options.part.vertexCount ?? 0).toLocaleString()}`,
    `- Material: ${options.part.materialName ? escapeHtml(options.part.materialName) : "-"}`,
    `- Bounding size: ${formatVectorTuple(options.part.bbox)}`,
    `- Center: ${formatVectorTuple(options.part.center)}`,
    ...(options.part.registeredMatches?.length
      ? [`- Possible registered match: ${formatRegisteredMatch(options.part.registeredMatches[0])}`]
      : []),
    "",
    "## Renderer Observations",
    "",
    ...(options.part.observations.length > 0 ? options.part.observations.map((observation) => `- ${observation}`) : ["- No renderer observations were captured for this part."]),
    "",
    "## Linked Focus Areas",
    "",
    ...(annotationLinks.length > 0
      ? annotationLinks.map((link) => `- ${link.label} (${Math.round(link.confidence * 100)}% confidence, distance ${link.distance === undefined ? "-" : link.distance.toFixed(3)})`)
      : ["- No saved annotation pin is linked to this part yet."]),
    "",
    "## Working Notes",
    "",
    "- ",
    "",
  ].join("\n");
}

async function createPartNoteDrafts(options: {
  app: App;
  partFolder: string;
  baseName: string;
  notePath: string;
  sourcePath: string;
  analysis: AnalysisResult;
}): Promise<string[]> {
  const candidateIds = getPartNoteCandidateIds(options.analysis);
  if (candidateIds.size === 0) {
    options.analysis.pipeline.push({ stage: "partNotes", durationMs: 0, status: "skipped" });
    return [];
  }

  const notePaths: string[] = [];
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const folder = normalizeVaultFolder(options.partFolder) || "Parts/3D Components";
  const modelFolder = `${folder}/${sanitizeVaultSegment(options.baseName, "model")}`;
  await ensureFolder(options.app, modelFolder);

  for (const [index, part] of options.analysis.parts.entries()) {
    if (!candidateIds.has(part.partId)) {
      continue;
    }
    const partNotePath = createPartNotePath(options.partFolder, options.baseName, part, index);
    const draftPart = { ...part, notePath: partNotePath };
    const content = buildPartNoteContent({
      baseName: options.baseName,
      notePath: options.notePath,
      sourcePath: options.sourcePath,
      part: draftPart,
      analysis: options.analysis,
    });
    const file = await createTextFileIfMissing(options.app, partNotePath, content);
    if (file) {
      part.notePath = file.path;
      notePaths.push(file.path);
    }
  }

  options.analysis.partNotePaths = notePaths;
  for (const link of options.analysis.annotationLinks ?? []) {
    const linkedPart = options.analysis.parts.find((part) => part.partId === link.nearestPartId);
    if (linkedPart?.notePath && !link.notePath) {
      link.notePath = linkedPart.notePath;
    }
  }
  options.analysis.pipeline.push({
    stage: "partNotes",
    durationMs: Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)),
    status: notePaths.length > 0 ? "success" : "skipped",
  });
  return notePaths;
}

export function buildKnowledgeIndexManagedSection(options: {
  baseName: string;
  notePath: string;
  sourcePath: string;
  analysisSidecarPath: string;
  analysis: AnalysisResult;
  preview: ModelPreviewSummary | null;
  profile?: ModelAssetProfile;
}): string {
  const partNotes = (options.analysis.parts ?? []).filter((part) => part.notePath);
  const annotations = options.profile?.annotations ?? [];
  const nextActions = options.analysis.localDraft?.nextActions ?? [];
  return [
    INDEX_MANAGED_START,
    "",
    "## Entry Points",
    "",
    `- Model report: [[${options.notePath}|${options.baseName} Report]]`,
    `- Analysis sidecar: [[${options.analysisSidecarPath}|Analysis JSON]]`,
    `- Source model: [[${options.sourcePath}|${options.baseName}]]`,
    "",
    "## Model Snapshot",
    "",
    options.preview
      ? `- ${formatMetricCount(options.preview.meshCount, "mesh")}, ${formatMetricCount(options.preview.triangleCount, "triangle")}, ${formatMetricCount(options.preview.vertexCount, "vertex")}, ${formatMetricCount(options.preview.materialCount, "material slot")}.`
      : "- No preview statistics were available for this index.",
    `- Evidence images: ${(options.analysis.previewImages ?? []).length.toLocaleString()}`,
    `- Part drafts: ${partNotes.length.toLocaleString()}`,
    `- Saved annotations: ${annotations.length.toLocaleString()}`,
    "",
    "## Part Notes",
    "",
    ...(partNotes.length > 0
      ? partNotes.map((part) => {
          const match = part.registeredMatches?.[0];
          const matchText = match ? `, matches ${escapeHtml(match.sourcePartName)} (${Math.round(match.confidence * 100)}%)` : "";
          return `- [[${part.notePath}|${escapeHtml(part.name)}]] - ${part.category ?? "unclassified"}, ${formatMetricCount(part.triangleCount, "triangle")}${matchText}`;
        })
      : ["- No part note drafts were created in this pass."]),
    "",
    "## Evidence Images",
    "",
    ...(options.analysis.previewImages.length > 0
      ? options.analysis.previewImages.map((path) => `- ![[${path}]]`)
      : ["- No evidence image was captured in this pass."]),
    "",
    "## Focus Areas",
    "",
    ...(annotations.length > 0
      ? annotations.map((pin) => {
          const link = options.analysis.annotationLinks?.find((candidate) => candidate.annotationId === pin.id);
          const target = link?.notePath ? ` -> [[${link.notePath}|part note]]` : "";
          return `- ${pin.label || "Untitled pin"}${target}`;
        })
      : ["- No saved annotation pins yet."]),
    "",
    "## Next Actions",
    "",
    ...(nextActions.length ? nextActions.map((action) => `- ${action}`) : ["- Review generated part drafts and promote confirmed components into stable notes."]),
    "",
    INDEX_MANAGED_END,
    "",
  ].join("\n");
}

export function replaceManagedSection(existingContent: string, managedSection: string): string {
  const startIndex = existingContent.indexOf(INDEX_MANAGED_START);
  const endIndex = existingContent.indexOf(INDEX_MANAGED_END);
  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex).replace(/\s+$/, "");
    const after = existingContent.slice(endIndex + INDEX_MANAGED_END.length).replace(/^\s+/, "");
    return [before, managedSection.trim(), after].filter(Boolean).join("\n\n") + "\n";
  }
  return `${existingContent.replace(/\s+$/, "")}\n\n${managedSection.trim()}\n`;
}

export function buildKnowledgeIndexContent(options: {
  baseName: string;
  notePath: string;
  sourcePath: string;
  analysisSidecarPath: string;
  analysis: AnalysisResult;
  preview: ModelPreviewSummary | null;
  profile?: ModelAssetProfile;
}): string {
  const managedSection = buildKnowledgeIndexManagedSection(options);
  const partNoteCount = (options.analysis.parts ?? []).filter((part) => part.notePath).length;
  const frontmatter = [
    "---",
    `source_model: ${markdownQuote(options.sourcePath)}`,
    `report_note_path: ${markdownQuote(options.notePath)}`,
    `analysis_sidecar_path: ${markdownQuote(options.analysisSidecarPath)}`,
    `part_note_count: ${partNoteCount}`,
    `status: index`,
    `generated_by: ai-model-workbench`,
    `updated_at: ${new Date().toISOString()}`,
    "---",
  ].join("\n");

  return [
    frontmatter,
    "",
    `# ${options.baseName} Knowledge Index`,
    "",
    "## User Notes",
    "",
    "- ",
    "",
    managedSection,
  ].join("\n");
}

async function createKnowledgeIndex(options: {
  app: App;
  baseName: string;
  notePath: string;
  sourcePath: string;
  analysisSidecarPath: string;
  indexPath: string;
  analysis: AnalysisResult;
  preview: ModelPreviewSummary | null;
  profile?: ModelAssetProfile;
}): Promise<TFile | null> {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const existingFile = options.app.vault.getAbstractFileByPath(options.indexPath);
  let file: TFile | null = null;
  if (existingFile instanceof TFile) {
    const existingContent = await options.app.vault.read(existingFile);
    const managedSection = buildKnowledgeIndexManagedSection(options);
    await options.app.vault.modify(existingFile, replaceManagedSection(existingContent, managedSection));
    file = existingFile;
  } else {
    file = await createTextFileIfMissing(options.app, options.indexPath, buildKnowledgeIndexContent(options));
  }
  if (file) {
    options.analysis.knowledgeIndexPath = file.path;
  }
  options.analysis.pipeline.push({
    stage: "index",
    durationMs: Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)),
    status: file ? "success" : "failed",
  });
  return file;
}

export async function generateKnowledgeNote(
  app: App,
  ps: PluginStore,
  options: GenerateKnowledgeNoteOptions = {},
): Promise<void> {
  if (noteGenerationLock !== null) return;
  let resolveLock!: () => void;
  noteGenerationLock = new Promise<void>((resolve) => { resolveLock = resolve; });

  try {
    const state = ps.store.getState();
    const path = state.currentModelPath;
    if (!path) return;

    const profile = state.modelAssetProfiles[path];
    const preview = state.modelPreview;
    const baseName = getPortableStem(path) || "model";
    const reportFolder = state.settings.reportFolder;
    const notePath = `${reportFolder}/${baseName} Report.md`;
    const analysisSidecarPath = `${reportFolder}/${baseName} Analysis.json`;
    const knowledgeIndexPath = `${reportFolder}/${baseName} Index.md`;
    const evidence = options.preview?.getModelEvidence?.() ?? null;
    const snapshot = await captureEvidenceSnapshot(app, options.preview, state.settings.previewFolder, baseName);
    const registeredParts = await collectRegisteredPartsFromProfiles(app, state.modelAssetProfiles, path);
    const analysis = buildLocalAnalysisResult({
      modelPath: path,
      profile,
      preview,
      evidence,
      previewImages: snapshot.paths,
      registeredParts,
    });
    if (snapshot.warning) {
      analysis.warnings = [...analysis.warnings, snapshot.warning];
      if (analysis.draftingInput) {
        analysis.draftingInput = {
          ...analysis.draftingInput,
          evidence: {
            ...analysis.draftingInput.evidence,
            warnings: [...analysis.draftingInput.evidence.warnings, snapshot.warning],
          },
        };
      }
    }
    analysis.localDraft = createLocalDraftResult({
      baseName,
      sourcePath: path,
      profile,
      preview,
      analysis,
    });
    analysis.pipeline.push({ stage: "draft", durationMs: 0, status: "success" });
    await createPartNoteDrafts({
      app,
      partFolder: state.settings.partFolder,
      baseName,
      notePath,
      sourcePath: path,
      analysis,
    });
    if (analysis.draftingInput) {
      analysis.draftingInput = {
        ...analysis.draftingInput,
        partCandidates: analysis.draftingInput.partCandidates.map((candidate) => {
          const linkedPart = analysis.parts.find((part) => part.partId === candidate.partId);
          return linkedPart?.notePath ? { ...candidate, notePath: linkedPart.notePath } : candidate;
        }),
        annotationLinks: [...(analysis.annotationLinks ?? [])],
      };
    }
    const remoteDecision = createRemoteDraftDecision(state.settings, analysis.draftingInput, LOCAL_ANALYSIS_VERSION);
    if (remoteDecision.enabled) {
      try {
        const remoteDraft = await requestRemoteDraft(remoteDecision);
        if (remoteDraft) {
          analysis.remoteDraft = remoteDraft;
          analysis.pipeline.push({ stage: "remoteDraft", durationMs: 0, status: "success" });
        } else {
          analysis.pipeline.push({ stage: "remoteDraft", durationMs: 0, status: "skipped" });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        analysis.warnings = [...analysis.warnings, `Remote draft failed: ${message}`];
        analysis.pipeline.push({ stage: "remoteDraft", durationMs: 0, status: "failed" });
      }
    } else {
      analysis.pipeline.push({ stage: "remoteDraft", durationMs: 0, status: "skipped" });
    }
    await ensureFolder(app, reportFolder);
    await createKnowledgeIndex({
      app,
      baseName,
      notePath,
      sourcePath: path,
      analysisSidecarPath,
      indexPath: knowledgeIndexPath,
      analysis,
      preview,
      profile,
    });
    const content = buildKnowledgeNoteContent({
      baseName,
      notePath,
      sourcePath: path,
      profile,
      preview,
      analysis,
      analysisSidecarPath,
      knowledgeIndexPath: analysis.knowledgeIndexPath,
    });

    await upsertTextFile(app, analysisSidecarPath, `${JSON.stringify(analysis, null, 2)}\n`);
    const outputFile = await upsertTextFile(app, notePath, content);

    if (!outputFile) return;

    const currentProfiles = ps.store.getState().modelAssetProfiles;
    const existingProfile = normalizeModelAssetProfile(currentProfiles[path], path);
    ps.store.setState({
      modelAssetProfiles: {
        ...currentProfiles,
        [path]: {
          ...existingProfile,
          analysisVersion: LOCAL_ANALYSIS_VERSION,
          registeredParts: analysis.parts,
          reportNotePath: outputFile.path,
          analysisSidecarPath,
          knowledgeIndexPath: analysis.knowledgeIndexPath,
          previewImagePaths: snapshot.paths,
          updatedAt: new Date().toISOString(),
        },
      },
      lastKnowledgeGeneration: {
        modelPath: path,
        reportNotePath: outputFile.path,
        analysisSidecarPath,
        knowledgeIndexPath: analysis.knowledgeIndexPath,
        partNoteCount: analysis.partNotePaths?.length ?? 0,
        previewImageCount: analysis.previewImages.length,
        generatedAt: new Date().toISOString(),
        status: "success",
        warningCount: analysis.warnings.length,
      },
    });
    await app.workspace.getLeaf(true).openFile(outputFile, { active: true });
    new Notice(`Knowledge note updated: ${outputFile.path}`);
  } finally {
    resolveLock();
    noteGenerationLock = null;
  }
}
