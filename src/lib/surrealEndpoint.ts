export const DEFAULT_SURREAL_BASE_URL = "http://localhost:8000";

/**
 * Shared SurrealDB/service base URL resolution.
 *
 * Precedence:
 * - explicit service env var (e.g. USER_SERVICE_BASE_URL)
 * - SURREAL_BASE_URL (shared override)
 * - DEFAULT_SURREAL_BASE_URL
 */
export function getUserServiceBaseUrl(): string {
  return (
    process.env.USER_SERVICE_BASE_URL ||
    process.env.SURREAL_BASE_URL ||
    DEFAULT_SURREAL_BASE_URL
  );
}

export function getBudgetServiceBaseUrl(): string {
  return (
    process.env.BUDGET_SERVICE_BASE_URL ||
    process.env.SURREAL_BASE_URL ||
    DEFAULT_SURREAL_BASE_URL
  );
}

/**
 * Generic base URL for Surreal-backed routes.
 *
 * Precedence:
 * - SURREAL_BASE_URL
 * - BUDGET_SERVICE_BASE_URL
 * - USER_SERVICE_BASE_URL
 * - DEFAULT_SURREAL_BASE_URL
 */
export function getSurrealBaseUrl(): string {
  return (
    process.env.SURREAL_BASE_URL ||
    process.env.BUDGET_SERVICE_BASE_URL ||
    process.env.USER_SERVICE_BASE_URL ||
    DEFAULT_SURREAL_BASE_URL
  );
}
