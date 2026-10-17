import { DigestBundleSchema } from "@craftland-qa/contracts";
import { buildDigest } from "@craftland-qa/engine";
import { describe, expect, it } from "vitest";

/**
 * Digest v2 gate: one integration pass over the engine core — engine findings appear in the
 * digest with registry-resolvable anchors, quantities carry the numbers the flow may cite,
 * and the reading plan covers exactly the change facts. Parsed through the contracts schema,
 * so a shape drift fails here before it ever reaches the API.
 */

const SCRIPT_PATH = "Assets/Scripts/Config.fcg";
const TABLE_PATH = "Assets/CSV/T.csv";
const SCRIPT_BASE = "static graph Config {\n  _MOD int = 104729\n}\n";
const SCRIPT_AFTER = "static graph Config {\n  _MOD int = 999983\n}\n";
const TABLE_BASE = "id,atk\nscout,100\n";
const TABLE_AFTER = "id,atk\nscout,120\nguard\n";

const INPUT = {
  base: {
    ref: "HEAD~1",
    commitHash: "a".repeat(40),
    sources: [
      { path: SCRIPT_PATH, source: SCRIPT_BASE },
      { path: TABLE_PATH, source: TABLE_BASE },
    ],
  },
  current: {
    ref: "WORKTREE",
    commitHash: "b".repeat(40),
    sources: [
      { path: SCRIPT_PATH, source: SCRIPT_AFTER },
      { path: TABLE_PATH, source: TABLE_AFTER },
    ],
  },
};

describe("digest v2", () => {
  it("parses through the contracts schema and carries engine findings with resolvable anchors", () => {
    const digest = DigestBundleSchema.parse(buildDigest(INPUT));

    expect(digest.schemaVersion).toBe(2);
    const struct01 = digest.findings.filter((finding) => finding.ruleId === "STRUCT-01");
    expect(struct01).toHaveLength(1);
    const finding = struct01[0];
    if (finding === undefined) throw new Error("expected a STRUCT-01 finding");
    expect(finding.ruleId).toBe("STRUCT-01");
    expect(finding.confidence).toBe("exact");
    // Channel ③: the changed table has no code reference — surfaced as an exact info finding.
    expect(digest.findings.some((item) => item.ruleId === "BIND-04")).toBe(true);
    if (finding.anchors.length === 0) throw new Error("expected witness anchors");

    const anchorIds = new Set(digest.anchors.map((anchor) => anchor.id));
    for (const anchorId of finding.anchors) {
      expect(anchorIds.has(anchorId)).toBe(true);
    }
  });

  it("exposes quantities for the numbers the flow may cite", () => {
    const digest = buildDigest(INPUT);

    expect(
      digest.quantities.some(
        (quantity) => quantity.kind === "column-count" && quantity.value === "2",
      ),
    ).toBe(true);
    expect(
      digest.quantities.some(
        (quantity) =>
          quantity.kind === "value" && quantity.value === "999983" && quantity.ref === "B",
      ),
    ).toBe(true);
    expect(
      digest.quantities.some(
        (quantity) =>
          quantity.kind === "symbol-count" && quantity.value === "1" && quantity.ref === null,
      ),
    ).toBe(true);
  });

  it("covers exactly the change facts with the reading plan", () => {
    const digest = buildDigest(INPUT);

    const changedPaths = digest.changeFacts.map((fact) => fact.path).sort();
    const unitPaths = digest.plan.units.flatMap((unit) => unit.files).sort();
    const clusterPaths = digest.plan.partition.clusters.flatMap((cluster) => cluster.files).sort();

    expect(unitPaths).toEqual(changedPaths);
    expect(clusterPaths).toEqual(changedPaths);
    expect(digest.plan.skeleton.files.map((file) => file.path)).toEqual(changedPaths);
  });

  it("is deterministic", () => {
    expect(buildDigest(INPUT)).toEqual(buildDigest(INPUT));
  });
});
