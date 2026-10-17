import { describe, expect, it } from "vitest";
import {
  ReviewStreamEventSchema,
  RunDetailResponseSchema,
  RunSummarySchema,
  StartReviewRequestSchema,
} from "../src/index";

const SUMMARY = {
  id: "run-1",
  projectId: "proj-1",
  baseRef: "HEAD~1",
  currentRef: "WORKTREE",
  goal: "Check pacing",
  lens: "designer",
  status: "completed",
  verdict: "needs_review",
  qualityScore: 82,
  error: null,
  durationMs: 24497,
  createdAt: "2026-10-17T02:00:00.000Z",
  completedAt: "2026-10-17T02:00:25.000Z",
};

const ZERO_STATS = {
  findingsChecked: 0,
  findingsStripped: 0,
  anchorsChecked: 0,
  anchorsStripped: 0,
  numbersChecked: 0,
  numbersUnverified: 0,
  quotesChecked: 0,
  quotesUnverified: 0,
  confidenceDowngraded: 0,
};

const RESULT = {
  report: {
    verdict: "needs_review",
    qualityScore: 82,
    executiveSummary: "One change.",
    topConcerns: ["atk spike"],
    themes: [],
    findings: [],
    recommendedTests: [],
    unknowns: [],
  },
  passes: [
    { pass: "map", promptVersion: "2.0.0", latencyMs: 400, salvage: "clean" },
    { pass: "read", promptVersion: "2.0.0", latencyMs: 900, salvage: "clean", unit: 1, round: 1 },
    { pass: "synthesize", promptVersion: "2.0.0", latencyMs: 1200, salvage: "clean" },
  ],
  verification: { read: ZERO_STATS, dig: null, synthesize: ZERO_STATS, issues: [] },
  contextManifest: {
    counts: { changeFacts: 1, linked: 1, contextItems: 1, evidence: 4, evidenceDropped: 0 },
    notes: [],
  },
  fallbackReason: null,
};

describe("review schemas", () => {
  it("roundtrips a run summary and rejects bad statuses", () => {
    expect(RunSummarySchema.parse(SUMMARY)).toEqual(SUMMARY);
    expect(RunSummarySchema.safeParse({ ...SUMMARY, status: "exploded" }).success).toBe(false);
    expect(RunSummarySchema.safeParse({ ...SUMMARY, qualityScore: -1 }).success).toBe(false);
  });

  it("roundtrips a run detail with a full result", () => {
    const detail = { ...SUMMARY, result: RESULT };
    expect(RunDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(RunDetailResponseSchema.parse({ ...SUMMARY, result: null }).result).toBeNull();
  });

  it("accepts every stream event shape and rejects unknown types", () => {
    const events = [
      { type: "stage", stage: "digest", state: "started" },
      { type: "stage", stage: "map", state: "started" },
      { type: "stage", stage: "read", state: "started", unit: 3, units: 8 },
      { type: "stage", stage: "synthesize", state: "completed", latencyMs: 12, salvage: "fence" },
      {
        type: "stage",
        stage: "read",
        state: "completed",
        latencyMs: 900,
        salvage: "clean",
        unit: 2,
        units: 8,
        round: 1,
      },
      { type: "completed", verdict: "pass", qualityScore: 90, findings: 3, fallbackReason: null },
      { type: "failed", error: "boom" },
      { type: "cancelled" },
    ];
    for (const event of events) {
      expect(ReviewStreamEventSchema.parse(event)).toEqual(event);
    }
    expect(ReviewStreamEventSchema.safeParse({ type: "exploded" }).success).toBe(false);
    expect(
      ReviewStreamEventSchema.safeParse({ type: "stage", stage: "digest_read", state: "started" })
        .success,
    ).toBe(false);
  });

  it("trims the start request and requires both refs", () => {
    const parsed = StartReviewRequestSchema.parse({
      projectId: " proj-1 ",
      baseRef: " main ",
      currentRef: "WORKTREE",
      goal: "  ",
    });
    expect(parsed.projectId).toBe("proj-1");
    expect(parsed.baseRef).toBe("main");
    expect(parsed.goal).toBeUndefined();
    expect(StartReviewRequestSchema.safeParse({ projectId: "p", baseRef: "" }).success).toBe(false);
  });
});
