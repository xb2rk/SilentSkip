import type { ZodType } from "zod";
import { AiError } from "../errors.js";
import type { InseaRunResult } from "../insea/types.js";

/**
 * Parse a workflow result through its pass schema.
 *
 * A drifting model is a loud failure (`invalid-output`), never a silent downgrade: the
 * pipeline's deterministic fallback decides what the user sees when a pass fails. The first
 * few zod issues travel in `details` so logs show the actual drift.
 */
export function parsePassOutput<T>(schema: ZodType<T>, result: InseaRunResult, pass: string): T {
  const parsed = schema.safeParse(result.output);
  if (!parsed.success) {
    throw new AiError("invalid-output", `${pass} output failed schema validation`, {
      details: JSON.stringify(parsed.error.issues.slice(0, 5)).slice(0, 500),
    });
  }
  return parsed.data;
}
