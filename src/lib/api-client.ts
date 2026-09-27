export interface ParsedApiResponse<T = any> {
  ok: boolean;
  data: T | null;
  error: string | null;
  status: number;
}
export async function parseApiResponse<T = any>(
  res: Response,
  defaultErrorMessage = "Request failed"
): Promise<ParsedApiResponse<T>> {
  const status = res.status;
  if (res.redirected && res.url.includes("/login")) {
    return {
      ok: false,
      data: null,
      error: "Your session has expired. Please refresh the page and sign in again.",
      status: 401,
    };
  }
  const contentType = res.headers.get("content-type") || "";
  let json: any = null;
  if (contentType.includes("application/json")) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  } else {
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      if (status === 401) {
        return {
          ok: false,
          data: null,
          error: "Your session has expired. Please log in again.",
          status,
        };
      }
      if (status === 403) {
        return {
          ok: false,
          data: null,
          error: "Permission denied for this action.",
          status,
        };
      }
      if (status === 404) {
        return {
          ok: false,
          data: null,
          error: "The requested item or endpoint was not found.",
          status,
        };
      }
      if (status === 409) {
        return {
          ok: false,
          data: null,
          error: "This item was changed by someone else. Please refresh and try again.",
          status,
        };
      }
      if (status === 422) {
        return {
          ok: false,
          data: null,
          error: "This action is not allowed for the item's current state.",
          status,
        };
      }
      return {
        ok: false,
        data: null,
        error: `Server returned an unexpected error (${status}). Please try again.`,
        status,
      };
    }
  }
  if (!res.ok) {
    const errorMsg =
      json?.error?.message ||
      json?.message ||
      (status === 401
        ? "Your session has expired. Please log in again."
        : `${defaultErrorMessage} (${status})`);
    return { ok: false, data: json?.data ?? null, error: errorMsg, status };
  }
  return { ok: true, data: json?.data ?? json, error: null, status };
}
