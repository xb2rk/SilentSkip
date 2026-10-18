import type { DigestBundle } from "@silentskip/contracts";
import { describe, expect, it } from "vitest";
import {
  buildPassManifestJson,
  buildReviewContext,
  serializeContextFiles,
  serializeFactsFile,
  serializeSkeletonFile,
  serializeTaskFile,
  serializeThemesFile,
  serializeUnitFile,
} from "../src/index";
import {
  ANCHOR_A_ATK,
  ANCHOR_A_MOD,
  ANCHOR_B_ATK,
  ANCHOR_B_MOD,
  makeDigest,
  SCRIPT_PATH,
  TABLE_PATH,
} from "./helpers/digest-fixture";

/** 900 synthetic unreferenced anchors — same convention as the engine's anchor ids. */
function syntheticAnchors(): DigestBundle["anchors"] {
  return Array.from({ length: 900 }, (_, index) => ({
    id: `A:file${String(index).padStart(3, "0")}.fcg:1:1:code`,
    ref: "A" as const,
    file: `Assets/f${String(index).padStart(3, "0")}.fcg`,
    blobSha: "0".repeat(40),
    lineStart: 1,
    lineEnd: 1,
    snippet: "x",
    kind: "code" as const,
  }));
}

describe("context assembly v2", () => {
  it("assembles the task pack, plan and fact store deterministically", () => {
    const context = buildReviewContext(makeDigest(), {
      goal: "  Pacing check  ",
      lens: "designer",
    });
    expect(context.taskPack.goal).toBe("Pacing check");
    expect(context.taskPack.lens).toBe("designer");
    expect(context.plan.units).toHaveLength(2);
    expect(context.quantities).toHaveLength(7);
    expect(context.engineFindings).toHaveLength(1);
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
    expect(context.manifest.notes).toContain("reading plan: 2 unit(s) over 2 changed file(s)");
    expect(context.manifest.notes).toContain("engine findings: 1");
    expect(
      buildReviewContext(makeDigest(), { goal: "  Pacing check  ", lens: "designer" }),
    ).toEqual(context);
  });

  it("drops evidence over the count budget with an honest note", () => {
    const digest = makeDigest();
    digest.anchors = syntheticAnchors();
    const context = buildReviewContext(digest);
    expect(context.evidence).toHaveLength(600);
    expect(context.manifest.counts.evidenceDropped).toBe(300);
    expect(
      context.manifest.notes.some((note) => note.includes("evidence anchors dropped: 300")),
    ).toBe(true);
  });

  it("keeps anchors referenced by change facts even beyond the count budget", () => {
    const digest = makeDigest();
    const anchors = syntheticAnchors();
    anchors[899] = {
      id: ANCHOR_B_ATK,
      ref: "B",
      file: TABLE_PATH,
      blobSha: "0".repeat(40),
      lineStart: 2,
      lineEnd: 2,
      snippet: "scout,120",
      kind: "csv",
    };
    digest.anchors = anchors;
    const context = buildReviewContext(digest);
    expect(context.evidence).toHaveLength(600);
    expect(context.evidence[0]?.id).toBe(ANCHOR_B_ATK);
    expect(context.manifest.notes.some((note) => note.includes("referenced anchors dropped"))).toBe(
      false,
    );
  });

  it("spreads the evidence pack across files instead of taking them in order", () => {
    const digest = makeDigest();
    digest.anchors = ["a", "b", "c"].flatMap((name) =>
      Array.from({ length: 300 }, (_, index) => ({
        id: `A:Assets/${name}.fcg:${index + 1}:${index + 1}:code`,
        ref: "A" as const,
        file: `Assets/${name}.fcg`,
        blobSha: "0".repeat(40),
        lineStart: index + 1,
        lineEnd: index + 1,
        snippet: "x",
        kind: "code" as const,
      })),
    );
    const context = buildReviewContext(digest);
    expect(context.evidence).toHaveLength(600);
    const perFile = new Map<string, number>();
    for (const anchor of context.evidence) {
      perFile.set(anchor.file, (perFile.get(anchor.file) ?? 0) + 1);
    }
    expect([...perFile.values()].sort((a, b) => a - b)).toEqual([200, 200, 200]);
  });

  it("serializes the context files, manifest, skeleton, unit and facts attachments", () => {
    const context = buildReviewContext(makeDigest());
    const files = serializeContextFiles(context);
    expect(files.map((file) => file.uploadName)).toEqual([
      "task.json",
      "changes.json",
      "journeys.json",
      "context.json",
      "anchors.jsonl",
    ]);
    const manifest = JSON.parse(buildPassManifestJson("read", context, files)) as {
      stage: string;
      files: { uploadName: string; byteSize: number }[];
    };
    expect(manifest.stage).toBe("read");
    for (const file of manifest.files) {
      const attachment = files.find((item) => item.uploadName === file.uploadName);
      expect(file.byteSize).toBe(Buffer.byteLength(attachment?.content ?? "", "utf8"));
    }
    expect((files[4]?.content ?? "").split("\n")).toHaveLength(4);

    const task = serializeTaskFile(context);
    expect(task.uploadName).toBe("task.json");

    const skeleton = JSON.parse(serializeSkeletonFile(context).content) as {
      files: unknown[];
      engineFindings: unknown[];
    };
    expect(skeleton.files).toHaveLength(2);
    expect(skeleton.engineFindings).toHaveLength(1);

    const unit = JSON.parse(
      serializeUnitFile(context.plan.units[0] ?? { index: 0, files: [], payload: "[]" }).content,
    ) as {
      index: number;
      entries: unknown[];
    };
    expect(unit.index).toBe(0);
    expect(unit.entries).toHaveLength(1);

    const facts = JSON.parse(
      serializeFactsFile(context, context.plan.units[0]?.files ?? [], context.engineFindings)
        .content,
    ) as { quantities: { file: string }[]; engineFindings: unknown[] };
    expect(facts.quantities.every((quantity) => quantity.file === SCRIPT_PATH)).toBe(true);
    expect(facts.quantities).toHaveLength(5);
    expect(facts.engineFindings).toHaveLength(1);

    const tableFacts = JSON.parse(serializeFactsFile(context, [TABLE_PATH], []).content) as {
      quantities: unknown[];
    };
    expect(tableFacts.quantities).toHaveLength(2);

    const themes = JSON.parse(
      serializeThemesFile([{ id: "theme-1", name: "Data", files: [TABLE_PATH] }]).content,
    ) as { id: string }[];
    expect(themes).toEqual([{ id: "theme-1", name: "Data", files: [TABLE_PATH] }]);
  });
});
