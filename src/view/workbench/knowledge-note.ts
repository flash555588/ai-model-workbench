import type { AnnotationPin, ModelAssetProfile, ModelPreviewSummary } from "../../domain/models";
import { createPreviewSummaryTableLines } from "../../render/preview/report";
import { getPortableBasename } from "../../utils/resolve-path";

export const LOCAL_ANALYSIS_VERSION = "local-preview-v2";

export interface KnowledgeNoteBuildOptions {
  baseName: string;
  notePath: string;
  sourcePath: string;
  profile?: ModelAssetProfile;
  preview: ModelPreviewSummary | null;
}

function inferFormat(sourcePath: string): string {
  const ext = sourcePath.split(".").pop()?.trim().toLowerCase();
  return ext && ext.length > 0 ? ext : "unknown";
}

function formatList(items: readonly string[]): string {
  return items.filter((item) => item.length > 0).join(", ");
}

function formatAnnotationLink(pin: AnnotationPin): string[] {
  const extras: string[] = [];
  if (pin.headingRef) {
    extras.push(`heading: ${pin.headingRef}`);
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
  const format = inferFormat(options.sourcePath);
  const tags = profile?.tags ?? [];
  const annotations = profile?.annotations ?? [];

  const frontmatter = [
    "---",
    `source_model: "${options.sourcePath}"`,
    `format: ${format}`,
    "status: ready",
    "analysis_mode: local",
    `analysis_version: ${LOCAL_ANALYSIS_VERSION}`,
    `report_note_path: "${options.notePath}"`,
    `annotation_count: ${annotations.length}`,
    `updated_at: ${new Date().toISOString()}`,
    ...(tags.length > 0 ? ["knowledge_tags:", ...tags.map((tag) => `  - ${tag}`)] : []),
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
    "## Local Observations",
    "",
    ...buildLocalObservations(summary, profile).map((item) => `- ${item}`),
    "",
    ...buildAnnotationSection(profile),
    ...buildKnowledgeDraftSection(summary, profile),
    "## Review Notes",
    "",
    profile?.notes?.trim() ? profile.notes.trim() : "-",
    "",
  ].join("\n");
}
