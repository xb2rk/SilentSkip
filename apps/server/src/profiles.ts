import {
  EMPTY_READER_PROFILE,
  emptyProjectProfile,
  type ProjectProfile,
  ProjectProfileSchema,
  type ProjectProfileUpdate,
} from "@craftland-qa/contracts";
import { type AppDatabase, projectProfiles } from "@craftland-qa/db";
import { eq } from "drizzle-orm";
import { getProject } from "./projects";

/**
 * Project profile persistence (E8.2).
 *
 * The profile is plain data: conventions, read API families, pins/overrides and the
 * editor-generated-index flag. The engine only reads it through the digest input; no project
 * convention is ever hardcoded. A project with no row gets the honest empty profile.
 */

/** Load the stored profile, creating an in-memory empty one when the project has none. */
export function loadProjectProfile(db: AppDatabase, projectId: string): ProjectProfile {
  const project = getProject(db, projectId);
  const row = db
    .select()
    .from(projectProfiles)
    .where(eq(projectProfiles.projectId, projectId))
    .get();
  if (row === undefined) {
    return emptyProjectProfile(projectId, project.createdAt);
  }
  return ProjectProfileSchema.parse({
    projectId,
    conventions: parseJson(row.conventionsJson, []),
    readApiFamily: parseJson(row.readApiFamilyJson, []),
    overrides: parseJson(row.overridesJson, []),
    readerProfile: parseJson(row.readerProfileJson, EMPTY_READER_PROFILE),
    coverage: parseJson(row.coverageJson, null),
    editorGenIndex: row.editorGenIndex,
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Store the writable fields and return the profile with server-owned metadata. */
export function saveProjectProfile(
  db: AppDatabase,
  projectId: string,
  input: ProjectProfileUpdate,
): ProjectProfile {
  getProject(db, projectId);
  const updatedAt = new Date();
  const values = {
    projectId,
    conventionsJson: JSON.stringify(input.conventions),
    readApiFamilyJson: JSON.stringify(input.readApiFamily),
    overridesJson: JSON.stringify(input.overrides),
    readerProfileJson: JSON.stringify(input.readerProfile),
    coverageJson: input.coverage === null ? null : JSON.stringify(input.coverage),
    editorGenIndex: input.editorGenIndex,
    updatedAt,
  };
  db.insert(projectProfiles)
    .values(values)
    .onConflictDoUpdate({ target: projectProfiles.projectId, set: values })
    .run();
  return ProjectProfileSchema.parse({
    ...input,
    projectId,
    updatedAt: updatedAt.toISOString(),
  });
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("Stored project profile JSON is invalid — rerun the profile save");
  }
}
