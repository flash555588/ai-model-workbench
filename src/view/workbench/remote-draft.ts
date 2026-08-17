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
  const hasScheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    const loopback = isLoopbackHostname(url.hostname);
    if (!hasScheme && loopback) {
      url.protocol = "http:";
    }
    if (url.protocol === "http:" && !loopback) {
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

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized);
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
      // Data minimization: when geometry is withheld, also withhold the vault
      // path (reduce to basename), user notes, and user tags — none of these
      // are required to draft a note and they leak vault layout and free text.
      path: vaultPathBasename(input.model.path),
      notes: "",
      tags: [],
    },
    partCandidates: [],
    annotationLinks: input.annotationLinks.map((link) => ({
      ...link,
      notePath: undefined,
      headingRef: undefined,
      label: "",
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

function vaultPathBasename(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

function stripPrivateVaultContext(input: AnalysisDraftingInput): AnalysisDraftingInput {
  return {
    ...input,
    model: {
      ...input.model,
      path: vaultPathBasename(input.model.path),
      notes: "",
      tags: [],
    },
    evidence: {
      ...input.evidence,
      previewImages: input.evidence.previewImages.map(vaultPathBasename),
    },
    partCandidates: input.partCandidates.map((candidate) => ({
      ...candidate,
      notePath: undefined,
      registeredMatches: candidate.registeredMatches?.map((match) => ({
        ...match,
        sourceNotePath: undefined,
        sourceModelPath: match.sourceModelPath ? vaultPathBasename(match.sourceModelPath) : undefined,
      })),
    })),
    annotationLinks: input.annotationLinks.map((link) => ({
      ...link,
      notePath: undefined,
      headingRef: undefined,
    })),
    knowledgeNodes: input.knowledgeNodes.map((node) => ({
      ...node,
      relatedAssetIds: [],
    })),
  };
}

function sanitizeDraftingInput(settings: PluginSettings, input: AnalysisDraftingInput): AnalysisDraftingInput {
  let next = stripPrivateVaultContext(input);
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
    return { enabled: false, reason: "serviceBaseUrl must use HTTPS, except HTTP loopback URLs" };
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
