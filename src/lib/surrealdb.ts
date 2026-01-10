import { fetchLogged } from "@/lib/http";

import { getSurrealBaseUrl } from "@/lib/surrealEndpoint";

type SurrealQueryResult = {
  status?: string;
  time?: string;
  result?: unknown;
};

export function getBaseUrl(): string {
  return getSurrealBaseUrl();
}

export function getOptionalSurrealHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const ns = process.env.SURREAL_NS;
  const db = process.env.SURREAL_DB;
  if (ns) headers["Surreal-NS"] = ns;
  if (db) headers["Surreal-DB"] = db;
  return headers;
}

export function toSurrealThingLiteral(value: string): string | null {
  const v = (value || "").trim();
  const idx = v.indexOf(":");
  if (idx <= 0 || idx === v.length - 1) return null;
  const table = v.slice(0, idx);
  const id = v.slice(idx + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return null;
  if (!/^[A-Za-z0-9_]+$/.test(id)) return null;
  return `${table}:${id}`;
}

export function thingIdToString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const tb = record["tb"];
    const id = record["id"];
    if (typeof tb === "string" && typeof id === "string") {
      return `${tb}:${id}`;
    }
    if (typeof id === "string") return id;
  }
  return undefined;
}

function extractErrorMessage(result: unknown): string {
  if (typeof result === "string") {
    // Try to extract user-friendly message from error string
    const match = result.match(/An error occurred: (.+)/);
    if (match) return match[1];
    return result;
  }
  return "Database error";
}

export async function executeSurrealQL(options: {
  token: string;
  query: string;
  logName: string;
}): Promise<
  | { success: true; data: SurrealQueryResult[] }
  | { success: false; error: string; details?: string }
> {
  const { token, query, logName } = options;
  const baseUrl = getBaseUrl();
  const surrealHeaders = getOptionalSurrealHeaders();

  try {
    const res = await fetchLogged(
      `${baseUrl}/sql`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
          ...surrealHeaders,
        },
        body: query,
      },
      { name: logName },
    );

    if (!res.ok) {
      const errorText = await res.text();
      return {
        success: false,
        error: `Request failed with status ${res.status}`,
        details: errorText,
      };
    }

    const data = (await res.json()) as SurrealQueryResult[];

    if (!Array.isArray(data)) {
      return {
        success: false,
        error: "Invalid response format from database",
      };
    }

    // Check for ERR status in any statement
    for (let i = 0; i < data.length; i++) {
      const statement = data[i];
      if (statement?.status === "ERR") {
        return {
          success: false,
          error: extractErrorMessage(statement.result),
          details: typeof statement.result === "string" ? statement.result : undefined,
        };
      }
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: "Network or parsing error",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getResultArray<T = unknown>(statement: SurrealQueryResult | undefined): T[] {
  const result = statement?.result;
  return Array.isArray(result) ? (result as T[]) : [];
}
