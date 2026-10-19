import { describe, expect, it } from "vitest";
import {
  applyPayloadVariant,
  fillerAttachment,
  type InseaRunRequest,
  rebuildManifest,
} from "../src/index";

/** A captured read request: two attachments and a manifest that describes both. */
function request(): InseaRunRequest {
  return {
    url: "https://example.test/run",
    apiKey: "k",
    prompt: "read this unit",
    manifestJson: JSON.stringify({
      version: "1.0.0",
      stage: "read",
      goal: "Check pacing",
      files: [
        { uploadName: "unit.json", relativePath: "unit.json", kind: "other", byteSize: 12 },
        {
          uploadName: "skeleton.json",
          relativePath: "skeleton.json",
          kind: "summary",
          byteSize: 9,
        },
      ],
    }),
    attachments: [
      { uploadName: "unit.json", mimeType: "application/json", content: "u".repeat(12) },
      { uploadName: "skeleton.json", mimeType: "application/json", content: "s".repeat(9) },
    ],
  };
}

function manifestOf(entry: InseaRunRequest): {
  readonly stage?: unknown;
  readonly goal?: unknown;
  readonly files: readonly { uploadName: string; kind: string; byteSize: number }[];
} {
  return JSON.parse(entry.manifestJson);
}

describe("payload probe variants", () => {
  it("drops an attachment and the manifest entry that described it", () => {
    const measured = applyPayloadVariant(request(), {
      name: "no-skeleton",
      drop: ["skeleton.json"],
    });
    expect(measured.attachments.map((attachment) => attachment.uploadName)).toEqual(["unit.json"]);
    const manifest = manifestOf(measured);
    expect(manifest.files.map((file) => file.uploadName)).toEqual(["unit.json"]);
    expect(manifest.files[0]?.kind).toBe("other");
    expect(manifest.files[0]?.byteSize).toBe(12);
    // Keys other than `files` are the production manifest's and stay untouched.
    expect(manifest.stage).toBe("read");
    expect(manifest.goal).toBe("Check pacing");
    expect(measured.prompt).toBe("read this unit");
  });

  it("keeps only the essential attachments", () => {
    const measured = applyPayloadVariant(request(), {
      name: "essential",
      keep: ["unit.json"],
    });
    expect(measured.attachments).toHaveLength(1);
    expect(manifestOf(measured).files).toHaveLength(1);
  });

  it("sends no DataList at all, and says so in the manifest", () => {
    const measured = applyPayloadVariant(request(), {
      name: "no-datalist",
      emptyAttachments: true,
    });
    expect(measured.attachments).toEqual([]);
    expect(manifestOf(measured).files).toEqual([]);
  });

  it("pads with filler that the manifest reports at its real size", () => {
    const measured = applyPayloadVariant(request(), { name: "padded", padBytes: 1000 });
    expect(measured.attachments).toHaveLength(3);
    const filler = measured.attachments[2];
    expect(filler?.uploadName).toBe("probe-filler.txt");
    const entry = manifestOf(measured).files.find((file) => file.uploadName === "probe-filler.txt");
    expect(entry?.byteSize).toBe(1000);
    expect(entry?.kind).toBe("other");
  });

  it("replaces the prompt and appends one attachment for the token hunt", () => {
    const measured = applyPayloadVariant(request(), {
      name: "token-hunt",
      prompt: 'reply {"token":"<value>"}',
      extraAttachment: {
        uploadName: "probe-token.txt",
        mimeType: "text/plain",
        content: "TOKEN=x",
      },
    });
    expect(measured.prompt).toBe('reply {"token":"<value>"}');
    expect(measured.attachments.map((attachment) => attachment.uploadName)).toEqual([
      "unit.json",
      "skeleton.json",
      "probe-token.txt",
    ]);
    expect(manifestOf(measured).files.some((file) => file.uploadName === "probe-token.txt")).toBe(
      true,
    );
  });

  it("sends an unusable Manifest without touching the attachments", () => {
    const original = request();
    const measured = applyPayloadVariant(original, { name: "empty-manifest", emptyManifest: true });
    expect(measured.manifestJson).toBe("{}");
    expect(measured.attachments).toEqual(original.attachments);
  });

  it("leaves an unparseable manifest alone instead of inventing file entries", () => {
    expect(rebuildManifest("not json", [])).toBe("not json");
  });

  it("builds filler of exactly the requested size", () => {
    expect(fillerAttachment(500).content).toHaveLength(500);
  });

  it("builds a ladder step: no production attachments, just filler plus the token file", () => {
    const measured = applyPayloadVariant(request(), {
      name: "pad-350k",
      emptyAttachments: true,
      padBytes: 350 * 1024,
      extraAttachment: {
        uploadName: "probe-token.txt",
        mimeType: "text/plain",
        content: "TOKEN=x",
      },
    });
    expect(measured.attachments.map((attachment) => attachment.uploadName)).toEqual([
      "probe-filler.txt",
      "probe-token.txt",
    ]);
    expect(manifestOf(measured).files.map((file) => file.uploadName)).toEqual([
      "probe-filler.txt",
      "probe-token.txt",
    ]);
  });
});
