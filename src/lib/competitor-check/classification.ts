import { CompetitorListing } from "@/types/pricing";
import { AdapterResult } from "./adapters";

export type InternalResultStatus = "ok" | "out_of_stock" | "removed" | "adapter_error";
export type RunStatus = "success" | "failed";
export type AvailabilityStatus = "in_stock" | "low_stock" | "out_of_stock" | "url_unavailable" | "unknown";

function normalizeStockLabel(stock: string | null | undefined): CompetitorListing["competitorStockStatus"] {
  const normalized = (stock ?? "").trim().toLowerCase();
  if (normalized === "in stock") return "In Stock";
  if (normalized === "low stock" || normalized === "limited stock") return "Low Stock";
  if (normalized === "out of stock") return "Out of Stock";
  if (normalized === "url unavailable" || normalized === "listing unavailable") return "URL Unavailable";
  return "Unknown";
}

export function availabilityFromStockStatus(stock: CompetitorListing["competitorStockStatus"]): AvailabilityStatus {
  if (stock === "In Stock") return "in_stock";
  if (stock === "Low Stock") return "low_stock";
  if (stock === "Out of Stock") return "out_of_stock";
  if (stock === "URL Unavailable") return "url_unavailable";
  return "unknown";
}

export function classifyAdapterOutcome(fetched: AdapterResult): {
  internalResultStatus: InternalResultStatus;
  runStatus: RunStatus;
  availabilityStatus: AvailabilityStatus;
  competitorStockStatus: CompetitorListing["competitorStockStatus"];
} {
  const normalizedStock = normalizeStockLabel(fetched.competitor_stock_status);
  const internalResultStatus: InternalResultStatus = fetched.result_status
    ?? (normalizedStock === "Out of Stock" ? "out_of_stock" : "ok");

  if (internalResultStatus === "removed") {
    return {
      internalResultStatus,
      runStatus: "success",
      availabilityStatus: "url_unavailable",
      competitorStockStatus: "URL Unavailable"
    };
  }

  if (internalResultStatus === "out_of_stock") {
    return {
      internalResultStatus,
      runStatus: "success",
      availabilityStatus: "out_of_stock",
      competitorStockStatus: "Out of Stock"
    };
  }

  if (internalResultStatus === "adapter_error") {
    return {
      internalResultStatus,
      runStatus: "failed",
      availabilityStatus: "unknown",
      competitorStockStatus: "Unknown"
    };
  }

  return {
    internalResultStatus,
    runStatus: "success",
    availabilityStatus: availabilityFromStockStatus(normalizedStock),
    competitorStockStatus: normalizedStock
  };
}

export function isInStockForComparison(listing: Pick<CompetitorListing, "lastCheckStatus" | "competitorStockStatus" | "competitorCurrentPrice" | "suspiciousChangeFlag" | "extractionMetadata">): boolean {
  if (listing.lastCheckStatus !== "success") return false;
  if (listing.suspiciousChangeFlag === true || listing.extractionMetadata?.trust_rejected === true) return false;
  if (listing.competitorStockStatus !== "In Stock" && listing.competitorStockStatus !== "Low Stock") return false;
  return listing.competitorCurrentPrice !== null && Number.isFinite(listing.competitorCurrentPrice) && listing.competitorCurrentPrice > 0;
}

export function listingSortWeight(listing: Pick<CompetitorListing, "competitorStockStatus" | "lastCheckStatus">): number {
  if (listing.lastCheckStatus === "failed" || listing.lastCheckStatus === "pending") return 4;
  if (listing.competitorStockStatus === "In Stock" || listing.competitorStockStatus === "Low Stock") return 1;
  if (listing.competitorStockStatus === "Out of Stock") return 2;
  if (listing.competitorStockStatus === "URL Unavailable") return 3;
  if (listing.competitorStockStatus === "Not tracked") return 5;
  return 4;
}
