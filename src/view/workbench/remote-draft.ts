import { requestUrl } from "obsidian";

import { normalizeRemoteDraftResult } from "./remote-draft-normalizer";
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

export interface RequestRemoteDraftOptions {
  timeoutMs?: number;
}

export const DEFAULT_REMOTE_DRAFT_TIMEOUT_MS = 15_000;

export class RemoteDraftTimeoutError extends Error {
  constructor(timeoutMs: number, endpoint: string) {
    super(`Remote draft request timed out after ${timeoutMs}ms: ${endpoint}`);
    this.name = "RemoteDraftTimeoutError";
  }
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
      notePath: undefined,
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

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  return Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
    ? Math.floor(Number(timeoutMs))
    : DEFAULT_REMOTE_DRAFT_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, endpoint: string): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new RemoteDraftTimeoutError(timeoutMs, endpoint));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function requestRemoteDraft(
  decision: RemoteDraftDecision,
  options: RequestRemoteDraftOptions = {},
): Promise<RemoteDraftResult | null> {
  if (!decision.enabled || !decision.endpoint || !decision.request) {
    return null;
  }
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const response = await withTimeout(
    requestUrl({
      url: decision.endpoint,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision.request),
    }),
    timeoutMs,
    decision.endpoint,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Remote draft request failed: HTTP ${response.status}`);
  }
  return normalizeRemoteDraftResult(response.json);
}
