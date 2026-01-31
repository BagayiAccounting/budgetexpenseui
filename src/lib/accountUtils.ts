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
  tbAccount: TbAccount | undefined
): Array<{ label: string; text: string; className?: string }> {
  if (!tbAccount) return [];
  const rows: Array<{ label: string; text: string; className?: string }> = [];

  const book = toFiniteNumber(tbAccount.book_balance);
  const spendable = toFiniteNumber(tbAccount.spendable_balance);
  const projected = toFiniteNumber(tbAccount.projected_balance);

  if (book != null) {
    rows.push({ label: "Book", text: formatNumber(book), className: signClass(book) });
  }
  if (spendable != null) {
    rows.push({ label: "Spendable", text: formatNumber(spendable), className: signClass(spendable) });
  }
  if (projected != null) {
    rows.push({ label: "Projected", text: formatNumber(projected), className: signClass(projected) });
  }

  return rows;
}
