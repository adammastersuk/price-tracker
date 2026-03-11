import { TrackedProductRow } from "@/types/pricing";

export function exportProductsCsv(rows: TrackedProductRow[]): string {
  const headers = ["SKU","Product Name","Buyer","Department","Bents Price","Competitor","Competitor Price","Price Diff GBP","Price Diff %","Status","Action Owner","Workflow"];
  const body = rows.map((r) => [r.internalSku, r.productName, r.buyer, r.department, r.bentsRetailPrice, r.competitorName, r.competitorCurrentPrice ?? "", r.priceDifferenceGbp ?? "", r.priceDifferencePercent ?? "", r.pricingStatus, r.actionOwner, r.actionWorkflowStatus].join(","));
  return [headers.join(","), ...body].join("\n");
}
