import { QueryClient, QueryFunction } from "@tanstack/react-query";

type ParsedResponseBody =
  | { kind: "empty"; rawText: ""; data: null }
  | { kind: "json"; rawText: string; data: any }
  | { kind: "html" | "text"; rawText: string; data: string };

const API_HTML_RECOVERY_KEY = "__api_html_recovery_attempted__";

function normalizeApiRequestData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeApiRequestData);
  }

  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  const input = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(input)) {
    // Replit deployment filtering rejects JSON bodies containing this key name.
    if (key === "declaredClassBand") {
      if (!("classBand" in input)) {
        normalized.classBand = normalizeApiRequestData(entryValue);
      }
      continue;
    }

    normalized[key] = normalizeApiRequestData(entryValue);
  }

  return normalized;
}

async function readResponseBody(res: Response): Promise<ParsedResponseBody> {
  const rawText = await res.text();
  if (!rawText) {
    return { kind: "empty", rawText: "", data: null };
  }

  const trimmed = rawText.trim();
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  const looksLikeJson = contentType.includes("application/json") || /^[\[{]/.test(trimmed);

  if (looksLikeJson) {
    try {
      return {
        kind: "json",
        rawText,
        data: JSON.parse(trimmed),
      };
    } catch {
      throw new Error("サーバー応答のJSON解析に失敗しました。");
    }
  }

  if (trimmed.startsWith("<")) {
    return { kind: "html", rawText, data: rawText };
  }

  return { kind: "text", rawText, data: rawText };
}

function summarizeHtml(rawHtml: string): string | null {
  const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = titleMatch[1].replace(/\s+/g, " ").trim();
    if (title) {
      return title;
    }
  }

  const h1Match = rawHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) {
    const h1 = h1Match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (h1) {
      return h1;
    }
  }

  return null;
}

function formatHtmlApiError(res: Response, rawHtml: string): string {
  const statusDetail = `${res.status}${res.statusText ? ` ${res.statusText}` : ""}${res.redirected ? ", redirected" : ""}`;
  const summary = summarizeHtml(rawHtml);
  return summary
    ? `APIの代わりにHTMLが返されました (${statusDetail}): ${res.url} [${summary}]`
    : `APIの代わりにHTMLが返されました (${statusDetail}): ${res.url}`;
}

function buildResponseError(res: Response, body: ParsedResponseBody): Error {
  let message: string | undefined;

  if (body.kind === "json" && body.data && typeof body.data === "object") {
    message = body.data.error || body.data.message;
  } else if (body.kind === "text") {
    message = body.rawText;
  } else if (body.kind === "html") {
    message = formatHtmlApiError(res, body.rawText);
  }

  if (!message && res.status === 401) {
    message = "401: Unauthorized - セッションの有効期限が切れました。再度ログインしてください。";
  }

  if (!message) {
    message = `${res.status}: ${res.statusText}`;
  }

  const error: any = new Error(message);
  error.status = res.status;

  if (body.kind === "json" && body.data && typeof body.data === "object") {
    if (typeof body.data.rowIndex === "number") {
      error.rowIndex = body.data.rowIndex;
    }
  }

  return error;
}

function buildUnexpectedResponseError(res: Response, body: ParsedResponseBody): Error {
  const message = body.kind === "html"
    ? formatHtmlApiError(res, body.rawText)
    : `サーバーからJSON以外の応答が返されました (${res.status} ${res.statusText}${res.redirected ? ", redirected" : ""}): ${res.url}`;
  const error: any = new Error(message);
  error.status = res.status;
  return error;
}

function isApiUrl(url: string): boolean {
  return url.startsWith("/api/") || url.includes("/api/");
}

async function recoverFromStaleClientCache(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (sessionStorage.getItem(API_HTML_RECOVERY_KEY) === "1") {
      return false;
    }
    sessionStorage.setItem(API_HTML_RECOVERY_KEY, "1");
  } catch {
    return false;
  }

  let recovered = false;

  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map(async (registration) => {
          recovered = (await registration.unregister()) || recovered;
        }),
      );
    } catch {
      // Ignore SW cleanup failures and continue with cache cleanup.
    }
  }

  if ("caches" in window) {
    try {
      const cacheKeys = await caches.keys();
      if (cacheKeys.length > 0) {
        recovered = true;
      }
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
    } catch {
      // Ignore cache cleanup failures and still fall back to a manual retry message.
    }
  }

  if (recovered) {
    window.setTimeout(() => {
      window.location.reload();
    }, 100);
  }

  return recovered;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<any> {
  const normalizedData = data ? normalizeApiRequestData(data) : undefined;
  const res = await fetch(url, {
    method,
    headers: normalizedData ? { "Content-Type": "application/json" } : {},
    body: normalizedData ? JSON.stringify(normalizedData) : undefined,
    credentials: "include",
  });

  const body = await readResponseBody(res);

  if (isApiUrl(url) && body.kind === "html") {
    const recovered = await recoverFromStaleClientCache();
    if (recovered) {
      throw new Error("古いアプリキャッシュを更新しています。自動で再読み込みしない場合は、ページを開き直してもう一度お試しください。");
    }
  }

  if (!res.ok) {
    throw buildResponseError(res, body);
  }

  if (body.kind === "empty") {
    return null;
  }

  if (body.kind !== "json") {
    throw buildUnexpectedResponseError(res, body);
  }

  return body.data;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    const body = await readResponseBody(res);

    if (body.kind === "html") {
      const queryUrl = queryKey.join("/") as string;
      if (isApiUrl(queryUrl)) {
        const recovered = await recoverFromStaleClientCache();
        if (recovered) {
          throw new Error("古いアプリキャッシュを更新しています。自動で再読み込みしない場合は、ページを開き直してもう一度お試しください。");
        }
      }
    }

    if (!res.ok) {
      throw buildResponseError(res, body);
    }

    if (body.kind === "empty") {
      return null;
    }

    if (body.kind !== "json") {
      throw buildUnexpectedResponseError(res, body);
    }

    return body.data;
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
