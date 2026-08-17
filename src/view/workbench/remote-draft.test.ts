import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisDraftingInput } from "../../domain/models";
import {
  createRemoteDraftDecision,
  DEFAULT_REMOTE_DRAFT_TIMEOUT_MS,
  RemoteDraftTimeoutError,
  requestRemoteDraft,
  type RemoteDraftDecision,
} from "./remote-draft";
import { normalizeRemoteDraftResult } from "./remote-draft-normalizer";
import { DEFAULT_SETTINGS } from "../../domain/constants";

interface RequestUrlCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

interface RequestUrlResponse {
  status: number;
  json: unknown;
}

const requestUrlMock = vi.hoisted(() => {
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  return vi.fn<(request: RequestUrlCall) => Promise<RequestUrlResponse>>();
});

vi.mock("obsidian", () => ({
  requestUrl: requestUrlMock,
}));

function createDraftingInput(): AnalysisDraftingInput {
  return {
    task: "Draft",
    model: {
      path: "models/example.glb",
      title: "example",
      format: "glb",
      summary: undefined,
      tags: [],
      notes: "",
    },
    evidence: {
      rawModelIncluded: false,
      previewImages: [],
      warnings: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    partCandidates: [],
    annotationLinks: [],
    knowledgeNodes: [],
  };
}

function createEnabledDecision(): RemoteDraftDecision {
  return {
    enabled: true,
    endpoint: "https://example.invalid/api/draft-note",
    request: {
      analysisVersion: "local-evidence-v1",
      draftingInput: createDraftingInput(),
    },
  };
}

describe("normalizeRemoteDraftResult", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns null for missing summary", () => {
    expect(normalizeRemoteDraftResult({ title: "test" })).toBeNull();
  });

  it("sanitizes HTML in remote draft fields", () => {
    const result = normalizeRemoteDraftResult({
      title: "<img src=x onerror=alert(1)>",
      summary: "Summary with <script>bad()</script>",
      sections: [{ heading: "<b>heading</b>", body: "<p>body</p>" }],
      suggestedTags: ["<tag>"],
      warnings: ["<alert>"],
      model: "<model>",
    });
    expect(result).not.toBeNull();
    expect(result?.title).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(result?.summary).toBe("Summary with &lt;script&gt;bad()&lt;/script&gt;");
    expect(result?.sections?.[0].heading).toBe("&lt;b&gt;heading&lt;/b&gt;");
    expect(result?.sections?.[0].body).toBe("&lt;p&gt;body&lt;/p&gt;");
    expect(result?.suggestedTags?.[0]).toBe("&lt;tag&gt;");
    expect(result?.warnings?.[0]).toBe("&lt;alert&gt;");
    expect(result?.model).toBe("&lt;model&gt;");
  });

  it("caps overly long fields", () => {
    const long = "a".repeat(10_000);
    const result = normalizeRemoteDraftResult({ summary: long });
    expect(result?.summary.length).toBeLessThanOrEqual(8001);
  });

  it("does not call the draft service for disabled decisions", async () => {
    await expect(requestRemoteDraft({ enabled: false, reason: "analysisMode=local" })).resolves.toBeNull();
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("requires HTTPS for public endpoints while preserving loopback development", () => {
    const input = createDraftingInput();
    const publicHttp = createRemoteDraftDecision({
      ...DEFAULT_SETTINGS,
      analysisMode: "hybrid",
      serviceBaseUrl: "http://draft.example.com/api",
    }, input, "local-evidence-v1");
    const publicShorthand = createRemoteDraftDecision({
      ...DEFAULT_SETTINGS,
      analysisMode: "hybrid",
      serviceBaseUrl: "draft.example.com/api",
    }, input, "local-evidence-v1");
    const local = createRemoteDraftDecision({
      ...DEFAULT_SETTINGS,
      analysisMode: "hybrid",
      serviceBaseUrl: "localhost:8787",
    }, input, "local-evidence-v1");
    const ipv4Loopback = createRemoteDraftDecision({
      ...DEFAULT_SETTINGS,
      analysisMode: "hybrid",
      serviceBaseUrl: "http://127.0.0.1:8787",
    }, input, "local-evidence-v1");
    const unspecifiedIpv4 = createRemoteDraftDecision({
      ...DEFAULT_SETTINGS,
      analysisMode: "hybrid",
      serviceBaseUrl: "http://0.0.0.0:8787",
    }, input, "local-evidence-v1");

    expect(publicHttp.enabled).toBe(false);
    expect(publicShorthand.endpoint).toBe("https://draft.example.com/api/draft-note");
    expect(local.endpoint).toBe("http://localhost:8787/draft-note");
    expect(ipv4Loopback.endpoint).toBe("http://127.0.0.1:8787/draft-note");
    expect(unspecifiedIpv4.enabled).toBe(false);
  });

  it("strips private vault context even when geometry sharing is enabled", () => {
    const input = createDraftingInput();
    input.model.path = "Private/Projects/example.glb";
    input.model.notes = "customer note";
    input.model.tags = ["customer-secret"];
    input.evidence.previewImages = ["Private/Previews/example.png"];
    input.annotationLinks = [{
      annotationId: "a1",
      label: "Mount",
      position: [1, 2, 3],
      notePath: "Private/Notes/customer.md",
      headingRef: "Customer",
      confidence: 0.9,
    }];
    input.knowledgeNodes = [{
      id: "k1",
      title: "Geometry",
      domain: "geometry",
      summary: "summary",
      relatedPartIds: [],
      relatedAssetIds: ["Private/Projects/example.glb"],
      confidence: 0.8,
      source: "rule",
    }];

    const decision = createRemoteDraftDecision({
      ...DEFAULT_SETTINGS,
      analysisMode: "hybrid",
      serviceBaseUrl: "https://draft.example.com/api",
      sendGeometrySummaryToRemote: true,
      sendPreviewImagesToRemote: true,
    }, input, "local-evidence-v1");
    const sanitized = decision.request?.draftingInput;

    expect(sanitized?.model).toMatchObject({ path: "example.glb", notes: "", tags: [] });
    expect(sanitized?.evidence.previewImages).toEqual(["example.png"]);
    expect(sanitized?.annotationLinks[0]).toMatchObject({ notePath: undefined, headingRef: undefined });
    expect(sanitized?.knowledgeNodes[0].relatedAssetIds).toEqual([]);
  });

  it("uses the default timeout budget when requesting a remote draft", async () => {
    requestUrlMock.mockResolvedValue({ status: 200, json: { summary: "Remote summary." } });

    const result = await requestRemoteDraft(createEnabledDecision());
    const request = requestUrlMock.mock.calls[0]?.[0];

    expect(result?.summary).toBe("Remote summary.");
    expect(request?.url).toBe("https://example.invalid/api/draft-note");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({ "content-type": "application/json" });
    expect(request?.body).toContain("local-evidence-v1");
    expect(DEFAULT_REMOTE_DRAFT_TIMEOUT_MS).toBe(15_000);
  });

  it("times out a remote draft request that never resolves", async () => {
    vi.useFakeTimers();
    requestUrlMock.mockReturnValue(new Promise<RequestUrlResponse>(() => undefined));

    const promise = requestRemoteDraft(createEnabledDecision(), { timeoutMs: 25 });
    const assertion = expect(promise).rejects.toThrow(RemoteDraftTimeoutError);
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    await expect(promise).rejects.toThrow("Remote draft request timed out after 25ms");
  });
});
