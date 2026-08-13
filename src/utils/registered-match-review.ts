import type {
  RegisteredPartMatch,
  RegisteredPartMatchReview,
  RegisteredPartMatchReviewDecision,
  PartRecord,
} from "../domain/models";

export const MAX_REGISTERED_MATCH_REVIEWS_PER_PROFILE = 256;

type RegisteredPartMatchIdentity = Pick<
  RegisteredPartMatchReview,
  "currentPartId" | "sourceAssetId" | "sourcePartId"
>;

export interface RegisteredPartMatchReviewQueueRow {
  currentPartId: string;
  currentPartName: string;
  match: RegisteredPartMatch;
}

function getReviewKey(review: RegisteredPartMatchIdentity): string {
  return JSON.stringify([review.currentPartId, review.sourceAssetId, review.sourcePartId]);
}

function isReviewDecision(value: unknown): value is RegisteredPartMatchReviewDecision {
  return value === "confirmed" || value === "rejected";
}

function isRegisteredPartMatchReview(value: unknown): value is RegisteredPartMatchReview {
  if (!value || typeof value !== "object") return false;
  const review = value as Partial<RegisteredPartMatchReview>;
  return typeof review.currentPartId === "string" && review.currentPartId.length > 0 &&
    typeof review.sourceAssetId === "string" && review.sourceAssetId.length > 0 &&
    typeof review.sourcePartId === "string" && review.sourcePartId.length > 0 &&
    isReviewDecision(review.decision) &&
    typeof review.reviewedAt === "string" && review.reviewedAt.length > 0;
}

export function isReusableRegisteredPartMatchReviews(value: unknown): value is RegisteredPartMatchReview[] {
  if (!Array.isArray(value) || value.length > MAX_REGISTERED_MATCH_REVIEWS_PER_PROFILE) return false;
  const seen = new Set<string>();
  return value.every((entry) => {
    if (!isRegisteredPartMatchReview(entry)) return false;
    const key = getReviewKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeRegisteredPartMatchReviews(
  value: unknown,
): { reviews: RegisteredPartMatchReview[] | undefined; changed: boolean } {
  if (value === undefined) return { reviews: undefined, changed: false };
  if (isReusableRegisteredPartMatchReviews(value)) {
    return { reviews: value, changed: false };
  }
  if (!Array.isArray(value)) return { reviews: undefined, changed: true };

  const reviews: RegisteredPartMatchReview[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRegisteredPartMatchReview(entry)) continue;
    const key = getReviewKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    reviews.push({ ...entry });
    if (reviews.length >= MAX_REGISTERED_MATCH_REVIEWS_PER_PROFILE) break;
  }
  return {
    reviews: reviews.length > 0 ? reviews : undefined,
    changed: true,
  };
}

export function upsertRegisteredPartMatchReview(
  reviews: readonly RegisteredPartMatchReview[] | undefined,
  identity: RegisteredPartMatchIdentity,
  decision: RegisteredPartMatchReviewDecision | null,
  reviewedAt = new Date().toISOString(),
): RegisteredPartMatchReview[] | undefined {
  const key = getReviewKey(identity);
  const remaining = (reviews ?? []).filter((review) => getReviewKey(review) !== key);
  if (decision === null) return remaining.length > 0 ? remaining : undefined;
  return [{ ...identity, decision, reviewedAt }, ...remaining]
    .slice(0, MAX_REGISTERED_MATCH_REVIEWS_PER_PROFILE);
}

export function applyRegisteredPartMatchReviews(
  currentPartId: string,
  matches: readonly RegisteredPartMatch[],
  reviews: readonly RegisteredPartMatchReview[] | undefined,
): RegisteredPartMatch[] {
  const decisions = new Map(
    (reviews ?? [])
      .filter((review) => review.currentPartId === currentPartId)
      .map((review) => [getReviewKey(review), review.decision] as const),
  );
  const rank: Record<RegisteredPartMatchReviewDecision | "pending", number> = {
    confirmed: 0,
    pending: 1,
    rejected: 2,
  };
  return matches
    .map((match) => ({
      ...match,
      reasons: [...match.reasons],
      reviewDecision: decisions.get(getReviewKey({
        currentPartId,
        sourceAssetId: match.sourceAssetId,
        sourcePartId: match.sourcePartId,
      })),
    }))
    .sort((left, right) => {
      const leftRank = rank[left.reviewDecision ?? "pending"];
      const rightRank = rank[right.reviewDecision ?? "pending"];
      return leftRank - rightRank || right.matchScore - left.matchScore;
    });
}

export function getBestActionableRegisteredPartMatch(
  matches: readonly RegisteredPartMatch[] | undefined,
): RegisteredPartMatch | undefined {
  return matches?.find((match) => match.reviewDecision !== "rejected");
}

export function hasActionableRegisteredPartMatch(
  matches: readonly RegisteredPartMatch[] | undefined,
): boolean {
  return getBestActionableRegisteredPartMatch(matches) !== undefined;
}

export function buildRegisteredPartMatchReviewQueue(
  parts: readonly Pick<PartRecord, "partId" | "name" | "registeredMatches">[],
): RegisteredPartMatchReviewQueueRow[] {
  return parts
    .flatMap((part) => (part.registeredMatches ?? []).map((match) => ({
      currentPartId: part.partId,
      currentPartName: part.name,
      match,
    })))
    .sort((left, right) => {
      const leftPending = left.match.reviewDecision === undefined ? 1 : 0;
      const rightPending = right.match.reviewDecision === undefined ? 1 : 0;
      if (leftPending !== rightPending) return leftPending - rightPending;
      const scoreDelta = right.match.matchScore - left.match.matchScore;
      if (scoreDelta !== 0) return scoreDelta;
      const partDelta = left.currentPartName.localeCompare(right.currentPartName);
      if (partDelta !== 0) return partDelta;
      return left.match.sourcePartId.localeCompare(right.match.sourcePartId);
    });
}
