"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DashboardCards } from "@/components/features/dashboard-cards";
import { PricingStatusChip, WorkflowChip } from "@/components/features/status-chip";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { safeReadJsonResponse } from "@/lib/json";
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

interface BuyerSetting {
  name: string;
  isActive: boolean;
  departments: string[];
}

export default function DashboardPage() {
  const [rows, setRows] = useState<TrackedProductRow[]>([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [gapSort, setGapSort] = useState<GapSort>("gbp");
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<{ scrapeDefaults?: { staleCheckHours?: number } }>({});
  const [configured, setConfigured] = useState<{ buyers: string[]; departments: string[]; competitors: string[]; buyerDepartments: Record<string, string[]> }>({ buyers: [], departments: [], competitors: [], buyerDepartments: {} });
  const [autoAdjustMessage, setAutoAdjustMessage] = useState("");
  const [alerts, setAlerts] = useState<Array<{ id: string; reason: string; competitor_name?: string; status: string; created_at: string; gap_amount_gbp?: number; product_id?: string }>>([]);
  const [healthRows, setHealthRows] = useState<Array<{ competitorName: string; health: string; successRate: number; failureRate: number; suspiciousCount: number; lastSuccessfulRun: string | null }>>([]);
  const [activity, setActivity] = useState<Array<{ id: string; summary: string; created_at: string }>>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/products", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/settings/runtime", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/settings", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/alerts", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/scraper-health", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/activity", { cache: "no-store" }).then((res) => res.json())
    ]).then(([productsPayload, runtimePayload, settingsPayload, alertsPayload, healthPayload, activityPayload]) => {
      const buyers = (settingsPayload.data?.buyers ?? []) as BuyerSetting[];
      setRows(productsPayload.data ?? []);
      setRuntime(runtimePayload.data ?? {});
      setConfigured({
        buyers: buyers.filter((b) => b.isActive).map((b) => b.name),
        departments: (settingsPayload.data?.departments ?? []).map((d: { name: string }) => d.name),
        competitors: (settingsPayload.data?.competitors ?? []).filter((c: { isEnabled: boolean }) => c.isEnabled).map((c: { name: string }) => c.name),
        buyerDepartments: Object.fromEntries(buyers.map((buyer) => [buyer.name, buyer.departments ?? []]))
      });
      setAlerts(alertsPayload.data ?? []);
      setHealthRows(healthPayload.data ?? []);
      setActivity(activityPayload.data ?? []);
    });
  }, []);

  const choices = useMemo(() => {
    const derived = uniqueValues(rows);
    return {
      ...derived,
      buyers: configured.buyers.length ? configured.buyers : derived.buyers,
      departments: configured.departments.length ? configured.departments : derived.departments,
      competitors: configured.competitors.length ? configured.competitors : derived.competitors
    };
  }, [rows, configured]);

  const availableDepartments = useMemo(() => {
    if (filters.buyers.length === 0) return choices.departments;
    const union = new Set<string>();
    filters.buyers.forEach((buyer) => (configured.buyerDepartments[buyer] ?? []).forEach((department) => union.add(department)));
    return choices.departments.filter((department) => union.has(department));
  }, [filters.buyers, choices.departments, configured.buyerDepartments]);

  useEffect(() => {
    setFilters((prev) => {
      const pruned = prev.departments.filter((department) => availableDepartments.includes(department));
      if (pruned.length === prev.departments.length) return prev;
      setAutoAdjustMessage("Department selection updated to match selected buyers.");
      return { ...prev, departments: pruned };
    });
  }, [availableDepartments]);

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
    const payload = await safeReadJsonResponse<{ data?: TrackedProductRow[] }>(response, {});
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
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Input
            placeholder="Search SKU or product"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
          <MultiSelectFilter label="Buyers" allLabel="All buyers" options={choices.buyers} selected={filters.buyers} onChange={(buyers) => setFilters((prev) => ({ ...prev, buyers }))} />
          <MultiSelectFilter label="Departments" allLabel="All departments" options={availableDepartments} selected={filters.departments} onChange={(departments) => setFilters((prev) => ({ ...prev, departments }))} />
          <MultiSelectFilter label="Suppliers" allLabel="All suppliers" options={choices.suppliers} selected={filters.suppliers} onChange={(suppliers) => setFilters((prev) => ({ ...prev, suppliers }))} />
          <MultiSelectFilter label="Competitors" allLabel="All competitors" options={choices.competitors} selected={filters.competitors} onChange={(competitors) => setFilters((prev) => ({ ...prev, competitors }))} />
          <MultiSelectFilter label="Statuses" allLabel="All statuses" options={[...new Set([...choices.statuses, ...choices.workflows])]} selected={filters.statuses} onChange={(statuses) => setFilters((prev) => ({ ...prev, statuses }))} />
        </CardContent>
      </Card>
      {autoAdjustMessage ? <p className="text-xs text-slate-500">{autoAdjustMessage}</p> : null}

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


      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Recent alerts</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {alerts.slice(0, 8).map((alert) => (
              <div key={alert.id} className="rounded border px-3 py-2">
                <p className="font-medium">{alert.reason}</p>
                <p className="text-xs text-slate-500">{alert.competitor_name ?? "All competitors"} · {new Date(alert.created_at).toLocaleString()}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs">Status: {alert.status}</span>
                  {alert.status === "new" ? <Button className="bg-slate-700 px-2 py-1 text-xs" onClick={async () => { await fetch(`/api/alerts/${alert.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "acknowledged" }) }); setAlerts((prev) => prev.map((item) => item.id === alert.id ? { ...item, status: "acknowledged" } : item)); }}>Acknowledge</Button> : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Scraper health</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {healthRows.slice(0, 8).map((row) => (
              <div key={row.competitorName} className="rounded border px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{row.competitorName}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${row.health === "Healthy" ? "bg-emerald-100 text-emerald-800" : row.health === "Watch" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700"}`}>{row.health}</span>
                </div>
                <p className="text-xs text-slate-500">Success {row.successRate}% · Fail {row.failureRate}% · Suspicious {row.suspiciousCount}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {activity.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded border px-3 py-2">
                <p>{item.summary}</p>
                <p className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
