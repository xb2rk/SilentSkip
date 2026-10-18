import { AppError, type ErrorCode, ErrorCodes, ErrorEnvelopeSchema } from "@silentskip/contracts";
import i18n from "@/i18n";

/**
 * Typed fetch helper. Understands the shared error envelope and rethrows `AppError`,
 * so react-query error states and toasts all consume one consistent error type.
 * Every API call in the web app must go through this helper (direct `fetch` is a bug).
 *
 * Transport failures are normalized here too: network errors become a friendly `AppError`
 * (the server may simply not be running), while aborts are rethrown untouched so
 * react-query keeps ownership of cancellation.
 */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { accept: "application/json", ...init?.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AppError(ErrorCodes.internal, i18n.t("errors.network"), { cause: error });
  }

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
