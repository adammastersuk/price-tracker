import { seededRows } from "@/data/seed-data";
import { TrackedProductRow } from "@/types/pricing";

export interface ProductFilters { search: string; buyer: string; department: string; supplier: string; brand: string; competitor: string; status: string; }

export const defaultFilters: ProductFilters = { search: "", buyer: "all", department: "all", supplier: "all", brand: "all", competitor: "all", status: "all" };

export function queryProducts(filters: ProductFilters): TrackedProductRow[] {
  return seededRows.filter((r) => {
    const search = filters.search.toLowerCase();
    const matchSearch = !search || r.internalSku.toLowerCase().includes(search) || r.productName.toLowerCase().includes(search);
    return matchSearch
      && (filters.buyer === "all" || r.buyer === filters.buyer)
      && (filters.department === "all" || r.department === filters.department)
      && (filters.supplier === "all" || r.supplier === filters.supplier)
      && (filters.brand === "all" || r.brand === filters.brand)
      && (filters.competitor === "all" || r.competitorName === filters.competitor)
      && (filters.status === "all" || r.pricingStatus === filters.status);
  });
}

export const uniqueValues = {
  buyers: [...new Set(seededRows.map((r) => r.buyer))],
  departments: [...new Set(seededRows.map((r) => r.department))],
  suppliers: [...new Set(seededRows.map((r) => r.supplier))],
  brands: [...new Set(seededRows.map((r) => r.brand))],
  competitors: [...new Set(seededRows.map((r) => r.competitorName))],
  statuses: [...new Set(seededRows.map((r) => r.pricingStatus))]
};

export const exceptionQueue = () => seededRows.filter((r) =>
  r.competitorCurrentPrice === null
  || r.matchConfidence === "Low"
  || r.pricingStatus === "Promo discrepancy"
  || (r.priceDifferencePercent !== null && r.priceDifferencePercent > 10)
  || Date.now() - new Date(r.lastCheckedAt).getTime() > 48 * 3600_000
);

export const dashboardStats = () => {
  const today = new Date().toDateString();
  const rows = seededRows;
  return {
    total: rows.length,
    checkedToday: rows.filter((r) => new Date(r.lastCheckedAt).toDateString() === today).length,
    higher: rows.filter((r) => r.pricingStatus === "Higher than competitor").length,
    cheaper: rows.filter((r) => r.pricingStatus === "Cheaper than competitor").length,
    promoDiscrepancy: rows.filter((r) => r.pricingStatus === "Promo discrepancy").length,
    unresolved: rows.filter((r) => r.actionWorkflowStatus !== "Resolved").length
  };
};
