import type { TbAccount } from "@/lib/settingsService";

export function signClass(value: number): string | undefined {
  return value < 0 ? "negative" : value > 0 ? "positive" : undefined;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function toFiniteNumber(value: string | number | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function rowsFromTbAccount(
  tbAccount: TbAccount | undefined,
  isDefaultAccount?: boolean
): Array<{ label: string; text: string; className?: string }> {
  if (!tbAccount) return [];
  const rows: Array<{ label: string; text: string; className?: string }> = [];

  // For default accounts, flip the sign since they're liabilities from bank's perspective
  const shouldFlipSign = isDefaultAccount === true;

  const book = toFiniteNumber(tbAccount.book_balance);
  const spendable = toFiniteNumber(tbAccount.spendable_balance);
  const projected = toFiniteNumber(tbAccount.projected_balance);

  if (book != null) {
    // Don't flip if value is 0 (to avoid -0)
    const displayValue = shouldFlipSign && book !== 0 ? -book : book;
    rows.push({ label: "Book", text: formatNumber(displayValue), className: signClass(displayValue) });
  }
  if (spendable != null) {
    // Don't flip if value is 0 (to avoid -0)
    const displayValue = shouldFlipSign && spendable !== 0 ? -spendable : spendable;
    rows.push({ label: "Spendable", text: formatNumber(displayValue), className: signClass(displayValue) });
  }
  if (projected != null) {
    // Don't flip if value is 0 (to avoid -0)
    const displayValue = shouldFlipSign && projected !== 0 ? -projected : projected;
    rows.push({ label: "Projected", text: formatNumber(displayValue), className: signClass(displayValue) });
  }

  return rows;
}
