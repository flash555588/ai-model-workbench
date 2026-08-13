import { describe, expect, it } from "vitest";
import type { RegisteredPartMatch, RegisteredPartMatchReview } from "../domain/models";
import {
  applyRegisteredPartMatchReviews,
  buildRegisteredPartMatchReviewQueue,
  getBestActionableRegisteredPartMatch,
  normalizeRegisteredPartMatchReviews,
  upsertRegisteredPartMatchReview,
} from "./registered-match-review";

function createMatch(sourcePartId: string, matchScore: number): RegisteredPartMatch {
  return {
    sourceAssetId: "models/source.glb",
    sourcePartId,
    sourcePartName: sourcePartId,
    matchScore,
    confidence: matchScore,
    reasons: ["similar part name"],
  };
}

describe("registered match reviews", () => {
  it("persists one decision per current/source part pair and supports clearing it", () => {
    const identity = {
      currentPartId: "current:part:1",
      sourceAssetId: "models/source.glb",
      sourcePartId: "source:part:1",
    };
    const confirmed = upsertRegisteredPartMatchReview(undefined, identity, "confirmed", "2026-08-04T10:00:00.000Z");
    const rejected = upsertRegisteredPartMatchReview(confirmed, identity, "rejected", "2026-08-04T11:00:00.000Z");

    expect(rejected).toEqual([{ ...identity, decision: "rejected", reviewedAt: "2026-08-04T11:00:00.000Z" }]);
    expect(upsertRegisteredPartMatchReview(rejected, identity, null)).toBeUndefined();
  });

  it("prioritizes confirmed matches, keeps rejected matches reviewable, and excludes them from knowledge selection", () => {
    const reviews: RegisteredPartMatchReview[] = [
      {
        currentPartId: "current:part:1",
        sourceAssetId: "models/source.glb",
        sourcePartId: "lower-confirmed",
        decision: "confirmed",
        reviewedAt: "2026-08-04T10:00:00.000Z",
      },
      {
        currentPartId: "current:part:1",
        sourceAssetId: "models/source.glb",
        sourcePartId: "higher-rejected",
        decision: "rejected",
        reviewedAt: "2026-08-04T11:00:00.000Z",
      },
    ];
    const matches = applyRegisteredPartMatchReviews("current:part:1", [
      createMatch("higher-rejected", 0.96),
      createMatch("pending", 0.9),
      createMatch("lower-confirmed", 0.72),
    ], reviews);

    expect(matches.map((match) => [match.sourcePartId, match.reviewDecision])).toEqual([
      ["lower-confirmed", "confirmed"],
      ["pending", undefined],
      ["higher-rejected", "rejected"],
    ]);
    expect(getBestActionableRegisteredPartMatch(matches)?.sourcePartId).toBe("lower-confirmed");
    expect(getBestActionableRegisteredPartMatch([matches[2]])).toBeUndefined();
  });

  it("drops malformed and duplicate persisted decisions", () => {
    const valid = {
      currentPartId: "current:part:1",
      sourceAssetId: "models/source.glb",
      sourcePartId: "source:part:1",
      decision: "confirmed",
      reviewedAt: "2026-08-04T10:00:00.000Z",
    } as const;
    const normalized = normalizeRegisteredPartMatchReviews([
      valid,
      { ...valid, decision: "rejected" },
      { ...valid, sourcePartId: "", decision: "confirmed" },
    ]);

    expect(normalized).toEqual({ reviews: [valid], changed: true });
  });

  it("keeps every candidate in a reviewed-first workbench queue", () => {
    const queue = buildRegisteredPartMatchReviewQueue([
      {
        partId: "current:part:1",
        name: "Current Part",
        registeredMatches: [
          createMatch("highest-pending", 0.98),
          { ...createMatch("lower-rejected", 0.72), reviewDecision: "rejected" },
        ],
      },
      {
        partId: "current:part:2",
        name: "Other Part",
        registeredMatches: [
          { ...createMatch("confirmed", 0.8), reviewDecision: "confirmed" },
          createMatch("lower-pending", 0.7),
        ],
      },
    ]);

    expect(queue.map((row) => [row.currentPartId, row.match.sourcePartId])).toEqual([
      ["current:part:2", "confirmed"],
      ["current:part:1", "lower-rejected"],
      ["current:part:1", "highest-pending"],
      ["current:part:2", "lower-pending"],
    ]);
  });
});
