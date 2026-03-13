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
    "Diff %",
    "Workflow",
    "Issue Summary"
  ];

  const body = rows.map((row) => {
    const signals = rowCommercialSignals(row);
    const issueSummary = [
      signals.missingMapping ? "Missing mapping" : "",
      signals.failedCheck ? "Failed check" : "",
      signals.suspicious ? "Suspicious" : "",
      signals.stale ? "Stale" : "",
      signals.bentsNotCheapest && signals.lowestTrusted
        ? `Gap +£${signals.gapGbp.toFixed(2)} vs ${signals.lowestTrusted.competitorName}`
        : ""
    ].filter(Boolean).join("; ");

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
      row.priceDifferencePercent ?? "",
      row.actionWorkflowStatus,
      issueSummary
    ].map(csvEscape).join(",");
  });

  return [headers.map(csvEscape).join(","), ...body].join("\n");
}
