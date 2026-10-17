import type { DigestBundle } from "@craftland-qa/contracts";
import { describe, expect, it } from "vitest";
import {
  buildPassManifestJson,
  buildReviewContext,
  serializeAnchorsJsonl,
  serializeContextFiles,
  serializeTaskFile,
} from "../src/index";
import {
  ANCHOR_A_ATK,
  ANCHOR_A_MOD,
  ANCHOR_B_ATK,
  ANCHOR_B_MOD,
  makeDigest,
} from "./helpers/digest-fixture";

describe("buildReviewContext", () => {
  it("assembles the task pack with tier/spread selection and is deterministic", () => {
    const context = buildReviewContext(makeDigest(), {
      goal: "  Pacing check  ",
      lens: "designer",
    });
    expect(context.taskPack).toEqual({
      baseRef: "HEAD~1",
      currentRef: "WORKTREE",
      baseCommit: "aaaa1111",
      currentCommit: null,
      stats: makeDigest().stats,
      goal: "Pacing check",
      lens: "designer",
    });
    // All four anchors are tier 0 (changed values); round-robin picks CSV file first (path order).
    expect(context.evidence.map((anchor) => anchor.id)).toEqual([
      ANCHOR_A_ATK,
      ANCHOR_A_MOD,
      ANCHOR_B_ATK,
      ANCHOR_B_MOD,
    ]);
    expect(context.manifest.counts).toEqual({
      changeFacts: 2,
      linked: 1,
      contextItems: 1,
      evidence: 4,
      evidenceDropped: 0,
    });
    expect(buildReviewContext(makeDigest(), { goal: "Pacing check", lens: "designer" })).toEqual(
      context,
    );
  });

  it("drops evidence beyond the count budget and records it honestly", () => {
    const anchors: DigestBundle["anchors"] = Array.from({ length: 900 }, (_, index) => ({
      id: `A:file${index}.fcg:1:1:code`,
      ref: "A" as const,
      file: `file${index}.fcg`,
      blobSha: "0".repeat(40),
      lineStart: 1,
      lineEnd: 1,
      snippet: `x${index}`,
      kind: "code" as const,
    }));
    const context = buildReviewContext({ ...makeDigest(), anchors });
    expect(context.evidence).toHaveLength(600);
    expect(context.manifest.counts.evidenceDropped).toBe(300);
    expect(context.manifest.notes.join(" ")).toContain("evidence anchors dropped: 300");
  });

  it("prioritizes anchors referenced by change facts and journeys beyond the cap", () => {
    const anchors: DigestBundle["anchors"] = Array.from({ length: 900 }, (_, index) => ({
      id: `A:file${index}.fcg:1:1:code`,
      ref: "A" as const,
      file: `file${index}.fcg`,
      blobSha: "0".repeat(40),
      lineStart: 1,
      lineEnd: 1,
      snippet: `x${index}`,
      kind: "code" as const,
    }));
    // The last anchor (would be dropped by position) is the one change facts reference.
    anchors[899] = {
      id: ANCHOR_B_ATK,
      ref: "B",
      file: "Assets/CSV/UnitData.csv",
      blobSha: "0".repeat(40),
      lineStart: 2,
      lineEnd: 2,
      snippet: "scout,120",
      kind: "csv",
    };
    const context = buildReviewContext({ ...makeDigest(), anchors });
    expect(context.evidence).toHaveLength(600);
    expect(context.evidence[0]?.id).toBe(ANCHOR_B_ATK);
    expect(context.manifest.notes.join(" ")).not.toContain("referenced anchors dropped");
  });

  it("spreads the evidence pack across files instead of taking them in order", () => {
    const anchors: DigestBundle["anchors"] = [];
    for (const file of ["a.fcg", "b.fcg", "c.fcg"]) {
      for (let index = 0; index < 300; index++) {
        anchors.push({
          id: `A:${file}:${index + 1}:${index + 1}:code`,
          ref: "A",
          file,
          blobSha: "0".repeat(40),
          lineStart: index + 1,
          lineEnd: index + 1,
          snippet: `x${index}`,
          kind: "code",
        });
      }
    }
    const context = buildReviewContext({ ...makeDigest(), anchors });
    expect(context.evidence).toHaveLength(600);
    const perFile = new Map<string, number>();
    for (const anchor of context.evidence) {
      perFile.set(anchor.file, (perFile.get(anchor.file) ?? 0) + 1);
    }
    expect([...perFile.values()].sort()).toEqual([200, 200, 200]);
  });

  it("serializes context files with real byte sizes in the manifest", () => {
    const context = buildReviewContext(makeDigest());
    const files = serializeContextFiles(context);
    expect(files.map((file) => file.uploadName)).toEqual([
      "task.json",
      "changes.json",
      "journeys.json",
      "context.json",
      "anchors.jsonl",
    ]);
    const manifest = JSON.parse(buildPassManifestJson("digest_read", context, files)) as {
      stage: string;
      files: { uploadName: string; byteSize: number }[];
    };
    expect(manifest.stage).toBe("digest_read");
    for (const item of manifest.files) {
      const attachment = files.find((file) => file.uploadName === item.uploadName);
      expect(attachment).toBeDefined();
      if (attachment !== undefined) {
        expect(item.byteSize).toBe(Buffer.byteLength(attachment.content, "utf8"));
      }
    }
    expect(serializeAnchorsJsonl(context.evidence).split("\n")).toHaveLength(4);
    expect(serializeTaskFile(context).uploadName).toBe("task.json");
  });
});
