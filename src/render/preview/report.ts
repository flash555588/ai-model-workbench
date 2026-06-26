import { escapeHtml } from "../../utils/escape-html";
import type { ModelPartSummary, ModelPreviewSummary } from "../../domain/models";
import { getPreviewSummaryCountLabel, getPreviewSummaryPrimaryCount } from "./summary";
import type { PreviewWorldPoint } from "./types";

export interface PreviewSummaryTableOptions {
  decimals?: number;
  countLabel?: string;
}

export interface PreviewMeshBreakdownRow {
  name: string;
  triangleCount: number | null;
  vertexCount: number;
  materialName?: string | null;
}

export interface PreviewModelInfoMarkdownOptions {
  title: string;
  format: string;
  summary: ModelPreviewSummary;
  countLabel?: string;
  meshBreakdown?: readonly PreviewMeshBreakdownRow[];
  materialNames?: Iterable<string | null | undefined>;
}

export interface PreviewPartInfoMarkdownOptions {
  title?: string;
}

function getDisplayText(value: string | null | undefined, fallback = "-"): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function formatPartSource(source: ModelPartSummary["source"]): string | null {
  if (!source) return null;
  if (source === "detail-cluster") return "Detail cluster";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function formatPartLineage(part: ModelPartSummary): string | null {
  if (!part.sourceFormat && !part.effectiveFormat && !part.loadStrategy) {
    return null;
  }
  const sourceFormat = part.sourceFormat ?? part.effectiveFormat ?? "unknown";
  const effectiveFormat = part.effectiveFormat ?? sourceFormat;
  const strategy = part.loadStrategy ?? (sourceFormat !== effectiveFormat ? "convert" : "direct");
  return `${sourceFormat.toUpperCase()}${effectiveFormat !== sourceFormat ? ` -> ${effectiveFormat.toUpperCase()}` : ""} (${strategy})`;
}

function formatMeshRefs(meshNames: readonly string[] | undefined, limit = 8): string | null {
  if (!meshNames?.length) return null;
  const head = meshNames.slice(0, limit).join(", ");
  const remaining = meshNames.length - limit;
  return remaining > 0 ? `${head}, +${remaining} more` : head;
}

function buildPreviewSummaryRows(
  summary: ModelPreviewSummary,
  options: PreviewSummaryTableOptions = {},
): string[] {
  const countLabel = options.countLabel ?? getPreviewSummaryCountLabel(summary);
  const decimals = options.decimals ?? 3;
  return [
    `| Meshes | ${summary.meshCount} |`,
    `| ${countLabel} | ${getPreviewSummaryPrimaryCount(summary).toLocaleString()} |`,
    `| Vertices | ${summary.vertexCount.toLocaleString()} |`,
    `| Materials | ${summary.materialCount} |`,
    ...(summary.performanceTier ? [`| Performance Tier | ${summary.performanceTier} |`] : []),
    `| Bounding Size | ${formatPreviewWorldPoint(summary.boundingSize, { decimals })} |`,
  ];
}

export function escapePreviewMarkdownTableCell(value: string): string {
  return escapeHtml(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function formatPreviewWorldPoint(
  point: PreviewWorldPoint,
  options: { decimals?: number; separator?: string } = {},
): string {
  const decimals = options.decimals ?? 3;
  const separator = options.separator ?? " x ";
  return `${point.x.toFixed(decimals)}${separator}${point.y.toFixed(decimals)}${separator}${point.z.toFixed(decimals)}`;
}

export function createPreviewSummaryTableLines(
  summary: ModelPreviewSummary,
  options: PreviewSummaryTableOptions = {},
): string[] {
  return [
    "| Metric | Value |",
    "|--------|-------|",
    ...buildPreviewSummaryRows(summary, options),
  ];
}

export function createPreviewModelSummaryTableLines(
  format: string,
  summary: ModelPreviewSummary,
  options: PreviewSummaryTableOptions = {},
): string[] {
  return [
    "| Property | Value |",
    "|----------|-------|",
    `| Format | ${format} |`,
    ...buildPreviewSummaryRows(summary, options),
  ];
}

export function createPreviewModelInfoMarkdown(options: PreviewModelInfoMarkdownOptions): string {
  const lines: string[] = [];
  lines.push(`## ${options.title} - Model Info`);
  lines.push("");
  lines.push(...createPreviewModelSummaryTableLines(options.format, options.summary, {
    countLabel: options.countLabel,
  }));
  lines.push("");

  const meshBreakdown = options.meshBreakdown ?? [];
  if (meshBreakdown.length > 1 && meshBreakdown.length <= 50) {
    lines.push("### Mesh Breakdown");
    lines.push("");
    lines.push("| # | Name | Triangles | Vertices | Material |");
    lines.push("|---|------|-----------|----------|----------|");
    meshBreakdown.forEach((mesh, index) => {
      const triangleCount = mesh.triangleCount === null ? "-" : mesh.triangleCount.toLocaleString();
      lines.push(
        `| ${index + 1} | ${escapePreviewMarkdownTableCell(getDisplayText(mesh.name, `mesh-${index + 1}`))} | ${triangleCount} | ${mesh.vertexCount.toLocaleString()} | ${escapePreviewMarkdownTableCell(getDisplayText(mesh.materialName))} |`,
      );
    });
    lines.push("");
  }

  const materialNames = Array.from(options.materialNames ?? [])
    .map((name) => getDisplayText(name, ""))
    .filter((name) => name.length > 0);
  if (materialNames.length > 0) {
    const uniqueNames = Array.from(new Set(materialNames));
    lines.push("### Materials");
    lines.push("");
    for (const name of uniqueNames) {
      lines.push(`- ${escapeHtml(name)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function createPreviewPartInfoMarkdown(
  part: ModelPartSummary,
  options: PreviewPartInfoMarkdownOptions = {},
): string {
  const title = escapeHtml(getDisplayText(options.title ?? part.name, "Selected Part"));
  const lines: string[] = [];
  lines.push(`## ${title} - Part Info`);
  lines.push("");
  lines.push("| Property | Value |");
  lines.push("|----------|-------|");
  lines.push(`| Mesh | ${escapePreviewMarkdownTableCell(getDisplayText(part.name))} |`);
  const source = formatPartSource(part.source);
  if (source) {
    lines.push(`| Source | ${escapePreviewMarkdownTableCell(source)} |`);
  }
  if (part.childCount !== undefined && part.childCount > 1) {
    lines.push(`| Child Meshes | ${part.childCount.toLocaleString()} |`);
  }
  if (part.componentId) {
    lines.push(`| Component ID | ${escapePreviewMarkdownTableCell(part.componentId)} |`);
  }
  if (part.occurrenceId) {
    lines.push(`| Occurrence ID | ${escapePreviewMarkdownTableCell(part.occurrenceId)} |`);
  }
  if (part.partNumber) {
    lines.push(`| Part Number | ${escapePreviewMarkdownTableCell(part.partNumber)} |`);
  }
  if (part.componentPath) {
    lines.push(`| Component Path | ${escapePreviewMarkdownTableCell(part.componentPath)} |`);
  }
  const lineage = formatPartLineage(part);
  if (lineage) {
    lines.push(`| Format Lineage | ${escapePreviewMarkdownTableCell(lineage)} |`);
  }
  lines.push(`| Triangles | ${part.triangleCount.toLocaleString()} |`);
  lines.push(`| Vertices | ${part.vertexCount.toLocaleString()} |`);
  lines.push(`| Material | ${escapePreviewMarkdownTableCell(getDisplayText(part.materialName))} |`);
  lines.push(`| Bounding Size | ${formatPreviewWorldPoint(part.boundingSize)} |`);
  lines.push(`| Center | ${formatPreviewWorldPoint(part.center, { separator: ", " })} |`);
  const meshRefs = formatMeshRefs(part.meshNames);
  if (meshRefs && part.childCount !== 1) {
    lines.push(`| Mesh Refs | ${escapePreviewMarkdownTableCell(meshRefs)} |`);
  }
  lines.push("");
  return lines.join("\n");
}
