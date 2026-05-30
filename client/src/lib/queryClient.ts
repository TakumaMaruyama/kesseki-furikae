import { QueryClient, QueryFunction } from "@tanstack/react-query";

type ParsedResponseBody =
  | { kind: "empty"; rawText: ""; data: null }
  | { kind: "json"; rawText: string; data: any }
  | { kind: "html" | "text"; rawText: string; data: string };

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

function buildResponseError(res: Response, body: ParsedResponseBody): Error {
  let message: string | undefined;

  if (body.kind === "json" && body.data && typeof body.data === "object") {
    message = body.data.error || body.data.message;
  } else if (body.kind === "text") {
    message = body.rawText;
  } else if (body.kind === "html") {
    message = `APIの代わりにHTMLが返されました: ${res.url}`;
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
    ? `APIの代わりにHTMLが返されました: ${res.url}`
    : `サーバーからJSON以外の応答が返されました: ${res.url}`;
  const error: any = new Error(message);
  error.status = res.status;
  return error;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  const body = await readResponseBody(res);

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
