import { escapeHtml } from "../../utils/escape-html";
import type { RemoteDraftResult } from "../../domain/models";

const MAX_REMOTE_DRAFT_FIELD_LENGTH = 8000;

function sanitizeRemoteDraftString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_REMOTE_DRAFT_FIELD_LENGTH) {
    return escapeHtml(trimmed.slice(0, MAX_REMOTE_DRAFT_FIELD_LENGTH)) + "…";
  }
  return escapeHtml(trimmed);
}

export function normalizeRemoteDraftResult(value: unknown): RemoteDraftResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const summaryRaw = typeof record.summary === "string" ? record.summary.trim() : "";
  const summary = sanitizeRemoteDraftString(summaryRaw);
  if (!summary) {
    return null;
  }
  const sections = Array.isArray(record.sections)
    ? record.sections.flatMap((section) => {
        if (!section || typeof section !== "object") return [];
        const sectionRecord = section as Record<string, unknown>;
        const headingRaw = typeof sectionRecord.heading === "string" ? sectionRecord.heading.trim() : "";
        const bodyRaw = typeof sectionRecord.body === "string" ? sectionRecord.body.trim() : "";
        const heading = sanitizeRemoteDraftString(headingRaw);
        const body = sanitizeRemoteDraftString(bodyRaw);
        return heading && body ? [{ heading, body }] : [];
      })
    : undefined;
  const suggestedTags = Array.isArray(record.suggestedTags)
    ? record.suggestedTags
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .map((tag) => sanitizeRemoteDraftString(tag))
    : undefined;
  const warnings = Array.isArray(record.warnings)
    ? record.warnings
        .filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0)
        .map((warning) => sanitizeRemoteDraftString(warning))
    : undefined;
  return {
    title: typeof record.title === "string" ? sanitizeRemoteDraftString(record.title) : undefined,
    summary,
    sections,
    suggestedTags,
    warnings,
    model: typeof record.model === "string" ? sanitizeRemoteDraftString(record.model) : undefined,
  };
}
