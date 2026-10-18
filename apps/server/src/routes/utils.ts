import { AppError, ErrorCodes } from "@silentskip/contracts";

/**
 * Minimal structural view of a Zod-like schema — keeps `apps/server` from depending on zod
 * directly (the contracts package owns it) while still validating every request body.
 */
interface BodySchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: unknown[] } };
}

/**
 * Parse a JSON request body through its contract schema.
 * Malformed JSON and schema violations both become BAD_REQUEST envelopes — handlers never
 * see raw `unknown` payloads.
 */
export async function readJsonBody<T>(request: Request, schema: BodySchema<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = undefined;
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.badRequest, "Dữ liệu gửi lên không hợp lệ", {
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}
