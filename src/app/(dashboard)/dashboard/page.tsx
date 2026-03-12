"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DashboardCards } from "@/components/features/dashboard-cards";
import { PricingStatusChip, WorkflowChip } from "@/components/features/status-chip";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from "@/components/ui/primitives";
import {
  dashboardStats,
  defaultFilters,
  exceptionBreakdown,
  largestPriceGaps,
  prioritisedReviewQueue,
  queryProducts,
  staleThresholdHours,
  uniqueValues
} from "@/lib/data-service";
import { currency, pct } from "@/lib/utils";
import { TrackedProductRow } from "@/types/pricing";

type GapSort = "gbp" | "percent";

export default function DashboardPage() {
  const [rows, setRows] = useState<TrackedProductRow[]>([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [gapSort, setGapSort] = useState<GapSort>("gbp");
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<{ scrapeDefaults?: { staleCheckHours?: number } }>({});
  const [configured, setConfigured] = useState<{ buyers: string[]; departments: string[] }>({ buyers: [], departments: [] });

  useEffect(() => {
    Promise.all([
      fetch("/api/products", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/settings/runtime", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/settings", { cache: "no-store" }).then((res) => res.json())
    ]).then(([productsPayload, runtimePayload, settingsPayload]) => {
      setRows(productsPayload.data ?? []);
      setRuntime(runtimePayload.data ?? {});
      setConfigured({
        buyers: (settingsPayload.data?.buyers ?? []).filter((b: { isActive: boolean }) => b.isActive).map((b: { name: string }) => b.name),
        departments: (settingsPayload.data?.departments ?? []).map((d: { name: string }) => d.name)
      });
    });
  }, []);

  const choices = useMemo(() => {
    const derived = uniqueValues(rows);
    return { ...derived, buyers: configured.buyers.length ? configured.buyers : derived.buyers, departments: configured.departments.length ? configured.departments : derived.departments };
  }, [rows, configured]);
  const filteredRows = useMemo(() => queryProducts(rows, filters), [rows, filters]);
  const stats = useMemo(() => dashboardStats(filteredRows, runtime), [filteredRows, runtime]);
  const queue = useMemo(() => prioritisedReviewQueue(filteredRows, runtime).slice(0, 12), [filteredRows, runtime]);
  const gapRows = useMemo(() => largestPriceGaps(filteredRows, gapSort, runtime).slice(0, 10), [filteredRows, gapSort, runtime]);
  const exceptions = useMemo(() => exceptionBreakdown(filteredRows, runtime), [filteredRows, runtime]);

  const metrics = [
    { label: "Products tracked", value: stats.total },
    { label: "Checked today", value: stats.checkedToday },
    { label: "Bents not cheapest", value: stats.bentsNotCheapest, tone: "alert" as const },
    { label: "Promo discrepancies", value: stats.promoDiscrepancy, tone: "alert" as const },
    { label: "Suspicious extractions", value: stats.suspicious, tone: "alert" as const },
    { label: "Stale checks", value: stats.stale, tone: "alert" as const },
    { label: "Missing competitor mappings", value: stats.missingMapping, tone: "alert" as const },
    { label: "Missing valid competitor price", value: stats.missingValidCompetitorPrice, tone: "alert" as const }
  ];

  const onRefreshProduct = async (productId: string) => {
    setRefreshingId(productId);
    await fetch("/api/competitor/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: [productId] })
    });
    const response = await fetch("/api/products", { cache: "no-store" });
    const payload = await response.json();
    setRows(payload.data ?? []);
    setRefreshingId(null);
  };

  const issueLinks: Array<{ label: string; count: number; query: string }> = [
    { label: "Bents higher than competitor", count: exceptions.bentsHigher, query: "Higher than competitor" },
    { label: "Promo discrepancy", count: exceptions.promoDiscrepancy, query: "Promo discrepancy" },
    { label: "Suspicious extraction", count: exceptions.suspicious, query: "Needs review" },
    { label: "Failed check", count: exceptions.failed, query: "Needs review" },
    { label: "Missing competitor mapping", count: exceptions.missingMapping, query: "Missing competitor data" },
    { label: "Missing valid competitor price", count: exceptions.missingValidCompetitorPrice, query: "Missing competitor data" },
    { label: `Stale checks (${staleThresholdHours(runtime)}h+)`, count: exceptions.stale, query: "Needs review" }
  ];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Commercial filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            placeholder="Search SKU or product"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
          <Select value={filters.buyer} onChange={(e) => setFilters((prev) => ({ ...prev, buyer: e.target.value }))}>
            <option value="all">All buyers</option>
            {choices.buyers.map((buyer) => <option key={buyer} value={buyer}>{buyer}</option>)}
          </Select>
          <Select value={filters.supplier} onChange={(e) => setFilters((prev) => ({ ...prev, supplier: e.target.value }))}>
            <option value="all">All suppliers</option>
            {choices.suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
          </Select>
          <Select value={filters.department} onChange={(e) => setFilters((prev) => ({ ...prev, department: e.target.value }))}>
            <option value="all">All departments</option>
            {choices.departments.map((department) => <option key={department} value={department}>{department}</option>)}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}>
            <option value="all">All statuses</option>
            {[...new Set([...choices.statuses, ...choices.workflows])].map((status) => <option key={status} value={status}>{status}</option>)}
          </Select>
        </CardContent>
      </Card>

      <DashboardCards metrics={metrics} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Needs review first</CardTitle>
            <Link href="/products" className="text-sm text-primary">Open products table</Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Buyer</th>
                    <th className="px-3 py-2">Bents</th>
                    <th className="px-3 py-2">Lowest valid competitor</th>
                    <th className="px-3 py-2">Issue</th>
                    <th className="px-3 py-2">Workflow</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.length > 0 ? queue.map((item) => (
                    <tr key={item.row.id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <p className="font-medium">{item.row.productName}</p>
                        <p className="text-xs text-slate-500">{item.row.internalSku}</p>
                      </td>
                      <td className="px-3 py-2">{item.row.buyer || "-"}</td>
                      <td className="px-3 py-2">{currency(item.row.bentsRetailPrice)}</td>
                      <td className="px-3 py-2">
                        {item.lowestTrusted
                          ? `${currency(item.lowestTrusted.price)} · ${item.lowestTrusted.competitorName}`
                          : "No trustworthy price"}
                      </td>
                      <td className="px-3 py-2">
                        <p>{item.reason}</p>
                        {item.gapGbp > 0 ? <p className="text-xs text-rose-700">Gap {currency(item.gapGbp)} · {pct(item.gapPercent)}</p> : null}
                      </td>
                      <td className="px-3 py-2"><WorkflowChip status={item.row.actionWorkflowStatus} /></td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-2">
                          <Link href={`/products?search=${encodeURIComponent(item.row.internalSku)}`} className="text-sm text-primary">Review now</Link>
                          <Button
                            className="bg-slate-700 px-2 py-1 text-xs"
                            disabled={refreshingId === item.row.id}
                            onClick={() => onRefreshProduct(item.row.id)}
                          >
                            {refreshingId === item.row.id ? "Refreshing..." : "Refresh"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="px-3 py-5 text-slate-500">No priority items for these filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Exception breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {issueLinks.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded border px-3 py-2">
                <div>
                  <p className="font-medium">{item.label}</p>
                  <Link href={`/products?status=${encodeURIComponent(item.query)}`} className="text-xs text-primary">Open filtered products</Link>
                </div>
                <p className="text-lg font-semibold">{item.count}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Largest price gaps (Bents above lowest trustworthy competitor)</CardTitle>
          <div className="flex items-center gap-2 text-sm">
            <span>Rank by</span>
            <Select value={gapSort} onChange={(e) => setGapSort(e.target.value as GapSort)}>
              <option value="gbp">£ gap</option>
              <option value="percent">% gap</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Bents</th>
                <th className="px-3 py-2">Lowest valid competitor</th>
                <th className="px-3 py-2">£ gap</th>
                <th className="px-3 py-2">% gap</th>
              </tr>
            </thead>
            <tbody>
              {gapRows.length > 0 ? gapRows.map((item) => (
                <tr key={item.row.id} className="border-t">
                  <td className="px-3 py-2">{item.row.internalSku}</td>
                  <td className="px-3 py-2">{item.row.productName}</td>
                  <td className="px-3 py-2"><PricingStatusChip status={item.row.pricingStatus} /></td>
                  <td className="px-3 py-2">{currency(item.row.bentsRetailPrice)}</td>
                  <td className="px-3 py-2">{item.lowestTrusted ? `${item.lowestTrusted.competitorName} · ${currency(item.lowestTrusted.price)}` : "-"}</td>
                  <td className="px-3 py-2 text-rose-700">{currency(item.gapGbp)}</td>
                  <td className="px-3 py-2 text-rose-700">{pct(item.gapPercent)}</td>
                </tr>
              )) : (
                <tr>
                  <td className="px-3 py-5 text-slate-500" colSpan={7}>No meaningful price gaps for these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Operational focus</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Decision support only: competitor pricing is one input, alongside margin, stock, supplier context and promotions.</li>
            <li>Prioritise unresolved items with large trusted price gaps or promo inconsistencies first.</li>
            <li>Use filtered views for buyer and supplier review meetings without implying auto-match repricing.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
