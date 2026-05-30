import { requestUrl } from "obsidian";

import type {
  AnalysisDraftingInput,
  PluginSettings,
  RemoteDraftResult,
} from "../../domain/models";

export interface RemoteDraftRequest {
  analysisVersion: string;
  draftingInput: AnalysisDraftingInput;
}

export interface RemoteDraftDecision {
  enabled: boolean;
  reason?: string;
  endpoint?: string;
  request?: RemoteDraftRequest;
}

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function stripPreviewImages(input: AnalysisDraftingInput): AnalysisDraftingInput {
  return {
    ...input,
    evidence: {
      ...input.evidence,
      previewImages: [],
    },
  };
}

function stripGeometrySummary(input: AnalysisDraftingInput): AnalysisDraftingInput {
  return {
    ...input,
    model: {
      ...input.model,
      summary: undefined,
    },
    partCandidates: [],
    annotationLinks: input.annotationLinks.map((link) => ({
      ...link,
      position: [0, 0, 0],
      nearestPartId: undefined,
      nearestPartName: undefined,
      distance: undefined,
      confidence: Math.min(link.confidence, 0.25),
    })),
    knowledgeNodes: input.knowledgeNodes.map((node) => ({
      ...node,
      summary: "Geometry details were withheld by privacy settings.",
      relatedPartIds: [],
    })),
  };
}

function sanitizeDraftingInput(settings: PluginSettings, input: AnalysisDraftingInput): AnalysisDraftingInput {
  let next = input;
  if (!settings.sendPreviewImagesToRemote) {
    next = stripPreviewImages(next);
  }
  if (!settings.sendGeometrySummaryToRemote) {
    next = stripGeometrySummary(next);
  }
  return {
    ...next,
    evidence: {
      ...next.evidence,
      rawModelIncluded: false,
    },
  };
}

export function createRemoteDraftDecision(
  settings: PluginSettings,
  input: AnalysisDraftingInput | undefined,
  analysisVersion: string,
): RemoteDraftDecision {
  if (settings.analysisMode === "local") {
    return { enabled: false, reason: "analysisMode=local" };
  }
  const baseUrl = normalizeBaseUrl(settings.serviceBaseUrl);
  if (baseUrl === "") {
    return { enabled: false, reason: "serviceBaseUrl is empty" };
  }
  if (baseUrl === null) {
    return { enabled: false, reason: "serviceBaseUrl must be a valid http(s) URL" };
  }
  if (settings.sendRawModelToRemote) {
    return { enabled: false, reason: "raw model upload is not supported by this draft client" };
  }
  if (!input) {
    return { enabled: false, reason: "drafting input is unavailable" };
  }

  return {
    enabled: true,
    endpoint: `${baseUrl}/draft-note`,
    request: {
      analysisVersion,
      draftingInput: sanitizeDraftingInput(settings, input),
    },
  };
}

function normalizeRemoteDraftResult(value: unknown): RemoteDraftResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summary) {
    return null;
  }
  const sections = Array.isArray(record.sections)
    ? record.sections.flatMap((section) => {
        if (!section || typeof section !== "object") return [];
        const sectionRecord = section as Record<string, unknown>;
        const heading = typeof sectionRecord.heading === "string" ? sectionRecord.heading.trim() : "";
        const body = typeof sectionRecord.body === "string" ? sectionRecord.body.trim() : "";
        return heading && body ? [{ heading, body }] : [];
      })
    : undefined;
  const suggestedTags = Array.isArray(record.suggestedTags)
    ? record.suggestedTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0)
    : undefined;
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    summary,
    sections,
    suggestedTags,
    warnings,
    model: typeof record.model === "string" ? record.model : undefined,
  };
}

export async function requestRemoteDraft(decision: RemoteDraftDecision): Promise<RemoteDraftResult | null> {
  if (!decision.enabled || !decision.endpoint || !decision.request) {
    return null;
  }
  const response = await requestUrl({
    url: decision.endpoint,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(decision.request),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Remote draft request failed: HTTP ${response.status}`);
  }
  return normalizeRemoteDraftResult(response.json);
}
