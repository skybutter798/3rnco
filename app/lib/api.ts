export const API_ROOT = "/api/v1";
let csrfToken = "";

export type ApiFieldErrors = Record<string, string | string[]>;

export class ApiError extends Error {
  code: string;
  fields?: ApiFieldErrors;
  status: number;

  constructor(message: string, code = "REQUEST_FAILED", status = 500, fields?: ApiFieldErrors) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: { code?: string; message?: string; fields?: ApiFieldErrors } | string };

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | unknown[];
};

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const method = (options.method || "GET").toUpperCase();
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRF-Token", csrfToken);

  let body = options.body;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const isNativeBody =
    typeof body === "string" ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== "undefined" && (body instanceof ArrayBuffer || ArrayBuffer.isView(body as ArrayBufferView)));

  if (body !== undefined && !isForm && !isNativeBody) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers,
    body: body as BodyInit | null | undefined,
    credentials: "same-origin",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as ApiSuccess<T> | ApiFailure)
    : null;

  if (!response.ok || !payload || payload.ok === false) {
    const error = payload && payload.ok === false ? payload.error : null;
    const detail = typeof error === "string" ? { message: error } : error;
    throw new ApiError(
      detail?.message || (response.status === 401 ? "Please sign in to continue." : "We could not complete that request."),
      detail?.code || `HTTP_${response.status}`,
      response.status,
      detail?.fields,
    );
  }

  const data = payload.data;
  if (data && typeof data === "object" && "csrfToken" in data) {
    const nextToken = (data as { csrfToken?: unknown }).csrfToken;
    if (typeof nextToken === "string") csrfToken = nextToken;
  }
  if (path === "/auth/logout") csrfToken = "";
  return data;
}

export async function uploadAdminImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const result = await apiRequest<{ url?: string; path?: string; media?: { url?: string } }>("/admin/uploads", {
    method: "POST",
    body: form,
  });
  const url = result.media?.url || result.url || result.path;
  if (!url) throw new ApiError("The image upload completed without a usable URL.", "UPLOAD_RESPONSE_INVALID");
  return url;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
