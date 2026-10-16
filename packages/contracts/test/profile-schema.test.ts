import { describe, expect, it } from "vitest";
import { emptyProjectProfile, ProjectProfileSchema } from "../src/index";

describe("ProjectProfileSchema", () => {
  it("accepts an empty profile from the factory", () => {
    const profile = emptyProjectProfile("project-1", "2026-10-16T09:00:00.000Z");
    expect(ProjectProfileSchema.parse(profile)).toEqual(profile);
  });

  it("accepts a full profile with conventions, overrides and coverage", () => {
    const profile = {
      ...emptyProjectProfile("project-1", "2026-10-16T09:00:00.000Z"),
      conventions: [
        {
          id: "c1",
          kind: "binding" as const,
          statement: "CSV tables are read via CSVIndex enums",
          evidence: [{ file: "Contracts/CSVIndex.fcc" }],
          source: "discovery" as const,
          createdAt: "2026-10-16T09:00:00.000Z",
        },
      ],
      readApiFamily: ["Strings"],
      overrides: [
        {
          id: "o1",
          kind: "pin-binding" as const,
          target: { csvPath: "Assets/CSV/UnitData.csv", rowKey: "scout" },
          value: "Assets/Scripts/Data/UnitData.fcg",
          createdAt: "2026-10-16T09:00:00.000Z",
        },
      ],
      coverage: { scriptFiles: 245, csvFiles: 33, generatedAt: "2026-10-16T09:00:00.000Z" },
      editorGenIndex: true,
    };
    expect(ProjectProfileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects malformed conventions and wrong coverage types", () => {
    const base = emptyProjectProfile("project-1", "2026-10-16T09:00:00.000Z");
    expect(
      ProjectProfileSchema.safeParse({ ...base, conventions: [{ id: "", kind: "nope" }] }).success,
    ).toBe(false);
    expect(
      ProjectProfileSchema.safeParse({
        ...base,
        coverage: { scriptFiles: -1, csvFiles: 0, generatedAt: "t" },
      }).success,
    ).toBe(false);
  });
});
