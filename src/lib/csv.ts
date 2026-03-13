import { rowCommercialSignals } from "@/lib/data-service";
import { TrackedProductRow } from "@/types/pricing";

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function exportProductsCsv(rows: TrackedProductRow[]): string {
  const headers = [
    "SKU",
    "Product Name",
    "Buyer",
    "Supplier",
    "Department",
    "Bents Price",
    "Lowest Price",
    "Lowest Competitor",
    "Diff GBP",
    "Diff %"
  ];

  const body = rows.map((row) => {
    const signals = rowCommercialSignals(row);
    return [
      row.internalSku,
      row.productName,
      row.buyer,
      row.supplier,
      row.department,
      row.bentsRetailPrice,
      signals.lowestTrusted ? signals.lowestTrusted.price : "",
      signals.lowestTrusted ? signals.lowestTrusted.competitorName : "",
      row.priceDifferenceGbp ?? "",
      row.priceDifferencePercent ?? ""
    ].map(csvEscape).join(",");
  });

  return [headers.map(csvEscape).join(","), ...body].join("\n");
}
