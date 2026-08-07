export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly fields?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const apiHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

export function ok(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(apiHeaders);
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify({ ok: true, data }), { status, headers });
}

export function fail(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(apiHeaders);
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify({
    ok: false,
    error: { code, message, ...(fields ? { fields } : {}) },
  }), { status, headers });
}

export async function readJson<T extends Record<string, unknown>>(request: Request): Promise<T> {
  const maxBytes = 1_000_000;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json for this request.");
  }
  try {
    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let serialized = "";
    if (reader) {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        received += chunk.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
        }
        serialized += decoder.decode(chunk, { stream: true });
      }
      serialized += decoder.decode();
    }
    const value = JSON.parse(serialized);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "The request body must be valid JSON.");
  }
}

export function requiredString(
  value: unknown,
  field: string,
  { min = 1, max = 500 }: { min?: number; max?: number } = {},
): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Please review the highlighted fields.", {
      [field]: `Must contain between ${min} and ${max} characters.`,
    });
  }
  return value.trim();
}

export function optionalString(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Please review the highlighted fields.", {
      [field]: `Must not exceed ${max} characters.`,
    });
  }
  return value.trim();
}

export function integerField(
  value: unknown,
  field: string,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Please review the highlighted fields.", {
      [field]: `Must be a whole number between ${min} and ${max}.`,
    });
  }
  return Number(value);
}

export function booleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiError(403, "ORIGIN_REJECTED", "This request did not come from the store.");
  }
}

export function apiExceptionResponse(error: unknown): Response {
  if (error instanceof ApiError) return fail(error.status, error.code, error.message, error.fields);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("INSUFFICIENT_STOCK")) {
    return fail(409, "OUT_OF_STOCK", "One or more products no longer have enough stock.");
  }
  if (message.includes("INVENTORY_CHANGED")) {
    return fail(409, "INVENTORY_CHANGED", "Stock changed in another session. Refresh before saving.");
  }
  if (message.includes("STOCK_RESERVED")) {
    return fail(409, "STOCK_RESERVED", "Open orders reserve more stock than this value.");
  }
  if (message.includes("INVALID_INVENTORY_BALANCE") || message.includes("INSUFFICIENT_RESERVED_STOCK")) {
    return fail(409, "STOCK_RESERVED", "Stock changed while reserved orders were open. Refresh and try again.");
  }
  if (message.includes("INVALID_ORDER_TRANSITION")) {
    return fail(409, "INVALID_ORDER_TRANSITION", "That order status transition is not allowed.");
  }
  if (message.includes("PROMO_CUSTOMER_LIMIT_REACHED")) {
    return fail(409, "PROMO_CUSTOMER_LIMIT_REACHED", "You have already used this offer.");
  }
  if (message.includes("PROMO_LIMIT_REACHED")) {
    return fail(409, "PROMO_LIMIT_REACHED", "That offer has reached its usage limit.");
  }
  if (message.includes("PROMO_NOT_AVAILABLE")) {
    return fail(409, "PROMO_NOT_AVAILABLE", "That offer is no longer available.");
  }
  if (message.includes("UNIQUE constraint failed")) {
    return fail(409, "CONFLICT", "A record with those details already exists.");
  }
  return fail(500, "INTERNAL_ERROR", "The store could not complete this request.");
}

export function methodNotAllowed(allowed: string[]): Response {
  return fail(405, "METHOD_NOT_ALLOWED", "That method is not available for this endpoint.", undefined, {
    allow: allowed.join(", "),
  });
}
