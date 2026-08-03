export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(status: number, body: { message?: string; code?: string } | null) {
    super(body?.message ?? body?.code ?? `Request failed (${status})`);
    this.name = "ApiError";
    this.code = body?.code ?? "REQUEST_FAILED";
    this.status = status;
    this.details = body;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = options.body == null || isFormData ? options.headers : { "Content-Type": "application/json", ...(options.headers ?? {}) };
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}
