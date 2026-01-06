type RedactRule = string | RegExp;

export type FetchLogOptions = {
  name?: string;
  enabled?: boolean;
  maxBodyChars?: number;
  redactRequestHeaders?: RedactRule[];
  redactResponseHeaders?: RedactRule[];
};

function isLoggingEnabled(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;
  const env = process.env.HTTP_LOG;
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function shouldRedact(key: string, rules: RedactRule[]): boolean {
  return rules.some((r) => (typeof r === "string" ? r.toLowerCase() === key.toLowerCase() : r.test(key)));
}

type AuthTokenLogMode = "off" | "snippet" | "full";

function getAuthTokenLogMode(): AuthTokenLogMode {
  // Opt-in only, and never in production.
  if (process.env.NODE_ENV === "production") return "off";

  const env = (process.env.HTTP_LOG_AUTH_TOKEN || "").trim().toLowerCase();
  if (!env) return "off";
  if (env === "0" || env === "false" || env === "no" || env === "off") return "off";
  if (env === "full") return "full";
  if (env === "1" || env === "true" || env === "yes" || env === "on" || env === "snippet") return "snippet";
  return "off";
}

function redactAuthorizationValue(value: string): string {
  const v = value.trim();
  const m = /^Bearer\s+(.+)$/i.exec(v);
  const token = m?.[1] ?? v;
  if (token.length <= 16) return "Bearer [REDACTED]";
  const prefix = token.slice(0, 8);
  const suffix = token.slice(-6);
  return `Bearer ${prefix}…${suffix}`;
}

function logAuthorizationFull(value: string) {
  // Log in chunks to avoid devtools shortening long strings.
  const v = value.trim();
  const chunkSize = 120;
  for (let i = 0; i < v.length; i += chunkSize) {
    const chunk = v.slice(i, i + chunkSize);
    console.log(`[http] authorization(full) ${String(i / chunkSize).padStart(2, "0")}:`, chunk);
  }
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [k, v] of headers) out[k] = v;
    return out;
  }
  return { ...headers } as Record<string, string>;
}

function redactHeaders(headers: Record<string, string>, rules: RedactRule[]): Record<string, string> {
  const out: Record<string, string> = {};
  const authMode = getAuthTokenLogMode();
  for (const [k, v] of Object.entries(headers)) {
    if (shouldRedact(k, rules)) {
      if (k.toLowerCase() === "authorization") {
        if (authMode === "full") out[k] = v;
        else if (authMode === "snippet") out[k] = redactAuthorizationValue(v);
        else out[k] = "[REDACTED]";
      } else out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function truncate(value: string, max: number): string {
  const v = (value || "").replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  return `${v.slice(0, max)}…`;
}

function describeBody(body: BodyInit | null | undefined, maxBodyChars: number): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return truncate(body, maxBodyChars);
  if (body instanceof URLSearchParams) return truncate(body.toString(), maxBodyChars);
  // For streams/blobs/formdata/etc, avoid consuming.
  return `[${Object.prototype.toString.call(body)}]`;
}

export async function fetchLogged(input: RequestInfo | URL, init?: RequestInit, opts?: FetchLogOptions) {
  const enabled = isLoggingEnabled(opts?.enabled);
  const maxBodyChars = opts?.maxBodyChars ?? 1500;
  const name = opts?.name;
  const start = Date.now();

  const requestHeaders = normalizeHeaders(init?.headers);
  const redactRequestHeaders = opts?.redactRequestHeaders ?? [
    "authorization",
    /cookie/i,
    /set-cookie/i,
    /x-api-key/i,
  ];

  const redactedReqHeaders = redactHeaders(requestHeaders, redactRequestHeaders);

  const method = init?.method || "GET";
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String(input);
  const requestBody = describeBody(init?.body ?? null, maxBodyChars);

  if (enabled) {
    console.log(`[http] -> ${name ? name + " " : ""}${method} ${url}`);
    if (Object.keys(redactedReqHeaders).length) console.log("[http] request headers:", redactedReqHeaders);
    if (requestBody != null) console.log("[http] request body:", requestBody);

    // In `full` mode, also print Authorization in chunks.
    const authMode = getAuthTokenLogMode();
    if (authMode === "full") {
      const authHeaderKey = Object.keys(requestHeaders).find((k) => k.toLowerCase() === "authorization");
      const authValue = authHeaderKey ? requestHeaders[authHeaderKey] : undefined;
      if (typeof authValue === "string" && authValue.trim()) {
        logAuthorizationFull(authValue);
      }
    }
  }

  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (enabled) {
      console.log(`[http] <- ${name ? name + " " : ""}${method} ${url} network_error in ${Date.now() - start}ms`);
      console.log("[http] error:", err);
    }
    throw err;
  }

  if (!enabled) return res;

  const resHeaders = normalizeHeaders(res.headers);
  const redactedResHeaders = redactHeaders(resHeaders, opts?.redactResponseHeaders ?? [
    /set-cookie/i,
  ]);

  let responseText: string | undefined;
  try {
    responseText = truncate(await res.clone().text(), maxBodyChars);
  } catch {
    responseText = "[unreadable_body]";
  }

  console.log(
    `[http] <- ${name ? name + " " : ""}${method} ${url} ${res.status} in ${Date.now() - start}ms`,
  );
  if (Object.keys(redactedResHeaders).length) console.log("[http] response headers:", redactedResHeaders);
  if (responseText != null) console.log("[http] response body:", responseText);

  return res;
}
