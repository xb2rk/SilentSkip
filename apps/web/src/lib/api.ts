import { AppError, type ErrorCode, ErrorCodes, ErrorEnvelopeSchema } from "@craftland-qa/contracts";

/**
 * Typed fetch helper. Understands the shared error envelope and rethrows `AppError`,
 * so react-query error states and toasts all consume one consistent error type.
 * Every API call in the web app must go through this helper (direct `fetch` is a bug).
 */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
  });

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new AppError(code as ErrorCode, message, {
        status: response.status,
        ...(details !== undefined ? { details } : {}),
      });
    }
    throw new AppError(ErrorCodes.internal, `Request to ${path} failed (${response.status})`, {
      status: response.status,
    });
  }

  return payload as T;
}
