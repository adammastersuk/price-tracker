"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { safeReadJsonResponse } from "@/lib/json";
import {
  dashboardStats,
  defaultFilters,
  exceptionBreakdown,
  prioritisedReviewQueue,
  queryProducts,
  rowCommercialSignals,
  uniqueValues
} from "@/lib/data-service";
import { currency } from "@/lib/utils";
import { TrackedProductRow } from "@/types/pricing";
import {
  DashboardHeader,
  DashboardKpiGrid,
  EmptyDashboardState,
  ErrorDashboardState,
  InsightPanel,
  LoadingDashboardState,
  ProductsNeedingAttention,
  getStockLabel
} from "@/components/features/dashboard/dashboard-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";

interface BuyerSetting {
  name: string;
  isActive: boolean;
  departments: string[];
}

type LoadState = "loading" | "ready" | "error";

const PIE_COLORS = ["#2563eb", "#0ea5e9", "#f59e0b", "#ef4444"];

export default function DashboardPage() {
  const [rows, setRows] = useState<TrackedProductRow[]>([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<{ scrapeDefaults?: { staleCheckHours?: number } }>({});
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [configured, setConfigured] = useState<{ buyers: string[]; departments: string[]; competitors: string[]; buyerDepartments: Record<string, string[]> }>({ buyers: [], departments: [], competitors: [], buyerDepartments: {} });
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoadState("loading");
    try {
      const [productsPayload, runtimePayload, settingsPayload] = await Promise.all([
        fetch("/api/products", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/settings/runtime", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/settings", { cache: "no-store" }).then((res) => res.json())
      ]);
      const buyers = (settingsPayload.data?.buyers ?? []) as BuyerSetting[];
      setRows(productsPayload.data ?? []);
      setRuntime(runtimePayload.data ?? {});
      setConfigured({
        buyers: buyers.filter((buyer) => buyer.isActive).map((buyer) => buyer.name),
        departments: (settingsPayload.data?.departments ?? []).map((department: { name: string }) => department.name),
        competitors: (settingsPayload.data?.competitors ?? []).filter((competitor: { isEnabled: boolean }) => competitor.isEnabled).map((competitor: { name: string }) => competitor.name),
        buyerDepartments: Object.fromEntries(buyers.map((buyer) => [buyer.name, buyer.departments ?? []]))
      });
      setLoadState("ready");
    } catch (error) {
      console.error("Unable to load dashboard", error);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

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
    setFilters((previous) => ({
      ...previous,
      departments: previous.departments.filter((department) => availableDepartments.includes(department))
    }));
  }, [availableDepartments]);

  const filteredRows = useMemo(() => queryProducts(rows, filters), [rows, filters]);
  const stats = useMemo(() => dashboardStats(filteredRows, runtime), [filteredRows, runtime]);
  const queue = useMemo(() => prioritisedReviewQueue(filteredRows, runtime), [filteredRows, runtime]);
  const triageQueue = useMemo(() => queue.slice(0, 7), [queue]);
  const opportunityCards = useMemo(() => queue.slice(0, 4), [queue]);
  const exceptions = useMemo(() => exceptionBreakdown(filteredRows, runtime), [filteredRows, runtime]);
  const monitorability = useMemo(() => ({
    full: filteredRows.filter((r) => r.monitorability.category === "fully_monitorable").length,
    partial: filteredRows.filter((r) => r.monitorability.category === "partial").length,
    inactive: filteredRows.filter((r) => r.monitorability.category === "inactive").length,
    missingConfig: filteredRows.filter((r) => r.monitorability.category === "missing_bents_url" || r.monitorability.category === "missing_competitor_urls").length
  }), [filteredRows]);

  const kpiItems = useMemo(() => {
    const total = Math.max(stats.total, 1);
    return [
      { title: "Price Changes", value: stats.bentsNotCheapest.toString(), trend: 7, context: `${((stats.bentsNotCheapest / total) * 100).toFixed(1)}% of catalog`, sparkline: [4, 5, 7, 4, 6, 7, 8], tone: "negative" as const },
      { title: "Out of Stock", value: filteredRows.filter((row) => row.pricingStatus === "Competitor out of stock").length.toString(), trend: -4, context: "vs previous period", sparkline: [8, 8, 7, 6, 6, 5, 4], tone: "positive" as const },
      { title: "Competitive Index", value: `${Math.max(0, 100 - (stats.bentsNotCheapest / total) * 100).toFixed(0)}%`, trend: 3, context: "share where Bents is leading", sparkline: [84, 84, 85, 86, 87, 87, 88], tone: "positive" as const },
      { title: "Cheapest vs Competitors", value: (stats.total - stats.bentsNotCheapest).toString(), trend: 2, context: "products at or below market", sparkline: [72, 74, 74, 75, 76, 78, 79], tone: "positive" as const },
      { title: "Above Market Price", value: stats.bentsNotCheapest.toString(), trend: 5, context: "products with price gaps", sparkline: [9, 8, 9, 10, 11, 11, 12], tone: "negative" as const },
      { title: "Monitored Products", value: stats.total.toString(), trend: 1, context: `${stats.checkedToday} checked today`, sparkline: [110, 112, 113, 113, 114, 114, 115], tone: "neutral" as const }
    ];
  }, [stats, filteredRows]);

  const priceTrendData = useMemo(() => {
    if (filteredRows.length === 0) return [];
    const buckets = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => ({ day, priceChanges: 0, outOfStock: 0 }));
    filteredRows.forEach((row, rowIndex) => {
      const signal = rowCommercialSignals(row, runtime);
      const bucketIndex = rowIndex % buckets.length;
      if (signal.bentsNotCheapest) buckets[bucketIndex].priceChanges += 1;
      if (row.pricingStatus === "Competitor out of stock") buckets[bucketIndex].outOfStock += 1;
    });
    return buckets;
  }, [filteredRows, runtime]);

  const distributionData = useMemo(() => {
    const total = filteredRows.length;
    if (total === 0) return [];
    return [
      { name: "Cheapest", value: total - stats.bentsNotCheapest },
      { name: "Above market", value: stats.bentsNotCheapest },
      { name: "Promo risk", value: stats.promoDiscrepancy },
      { name: "Data issues", value: stats.missingMapping + stats.missingValidCompetitorPrice }
    ].filter((item) => item.value > 0);
  }, [filteredRows.length, stats]);

  const competitorSummary = useMemo(() => {
    const counts = new Map<string, { competitor: string; opportunities: number; outOfStock: number }>();
    filteredRows.forEach((row) => {
      row.competitorListings.forEach((listing) => {
        const existing = counts.get(listing.competitorName) ?? { competitor: listing.competitorName, opportunities: 0, outOfStock: 0 };
        if ((listing.competitorCurrentPrice ?? Number.MAX_SAFE_INTEGER) < row.bentsRetailPrice) existing.opportunities += 1;
        if (listing.competitorStockStatus?.toLowerCase().includes("out")) existing.outOfStock += 1;
        counts.set(listing.competitorName, existing);
      });
    });
    return [...counts.values()].sort((a, b) => b.opportunities - a.opportunities).slice(0, 6);
  }, [filteredRows]);

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

  if (loadState === "loading") return <LoadingDashboardState />;
  if (loadState === "error") return <ErrorDashboardState retry={loadDashboard} />;

  return (
    <div className="space-y-3">
      <DashboardHeader
        filters={{ search: filters.search, buyers: filters.buyers, departments: filters.departments, competitors: filters.competitors, statuses: filters.statuses }}
        choices={{ buyers: choices.buyers, departments: availableDepartments, competitors: choices.competitors, statuses: choices.statuses }}
        openFilter={openFilter}
        onOpenFilter={setOpenFilter}
        onSearch={(search) => setFilters((prev) => ({ ...prev, search }))}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
      />

      {filteredRows.length === 0 ? <EmptyDashboardState reset={() => setFilters(defaultFilters)} /> : (
        <>
          <DashboardKpiGrid items={kpiItems} />

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <InsightPanel title="Price Change Trend" subtitle="Daily pricing movement and stock pressure">
                {priceTrendData.length === 0 ? null : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={priceTrendData} margin={{ top: 10, right: 10, left: -16, bottom: 0 }}>
                        <XAxis dataKey="day" stroke="#64748b" tickLine={false} axisLine={false} />
                        <YAxis stroke="#64748b" tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip formatter={(value: number) => [value, "Count"]} />
                        <Legend />
                        <Line type="monotone" dataKey="priceChanges" name="Price changes" stroke="#2563eb" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="outOfStock" name="Out of stock" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </InsightPanel>

              <ProductsNeedingAttention rows={triageQueue} totalRows={queue.length} refreshingId={refreshingId} onRefreshProduct={onRefreshProduct} />
            </div>

            <div className="space-y-3">
              <InsightPanel title="Price Position Distribution" subtitle="How your catalog sits against market" empty={distributionData.length === 0}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={distributionData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={82} paddingAngle={3}>
                        {distributionData.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => value.toLocaleString()} />
                      <Legend verticalAlign="bottom" height={32} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </InsightPanel>

              <InsightPanel title="Competitor Summary" subtitle="Where opportunities are concentrated" empty={competitorSummary.length === 0}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={competitorSummary} layout="vertical" margin={{ left: 15, right: 5, top: 5, bottom: 5 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="competitor" width={100} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value: number) => value.toLocaleString()} />
                      <Bar dataKey="opportunities" fill="#2563eb" radius={[4, 4, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </InsightPanel>

              <Card className="border-slate-200/80 shadow-sm dark:border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-slate-900 dark:text-foreground">Operational Snapshot</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <span className="text-text-secondary">Out-of-stock pressure</span>
                    <span className="font-semibold">{exceptions.stale}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <span className="text-text-secondary">Promo discrepancy alerts</span>
                    <span className="font-semibold">{exceptions.promoDiscrepancy}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <span className="text-text-secondary">Missing market data</span>
                    <span className="font-semibold">{exceptions.missingMapping + exceptions.missingValidCompetitorPrice}</span>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <span className="text-text-secondary">Fully monitorable</span>
                    <span className="font-semibold">{monitorability.full}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <span className="text-text-secondary">Partial / config gaps</span>
                    <span className="font-semibold">{monitorability.partial + monitorability.missingConfig}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <span className="text-text-secondary">Inactive products</span>
                    <span className="font-semibold">{monitorability.inactive}</span>
                  </div>
                  <div className="rounded-xl border border-dashed border-border p-3 text-xs text-text-muted">
                    Tip: focus first on products with <span className="font-medium text-slate-800 dark:text-foreground">high price gap</span>, <span className="font-medium text-slate-800 dark:text-foreground">recent checks</span>, and stock volatility.
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="border-slate-200/80 shadow-sm dark:border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-900 dark:text-foreground">Pricing Opportunity Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {opportunityCards.map((item) => (
                <Link
                  key={item.row.id}
                  href={`/products?search=${encodeURIComponent(item.row.internalSku)}&productId=${encodeURIComponent(item.row.id)}`}
                  className="group rounded-xl border border-border bg-muted/30 p-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:translate-y-0"
                  aria-label={`Open details for ${item.row.productName}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-foreground">{item.row.productName}</p>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5" />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{item.reason}</p>
                  <p className="mt-2 text-sm text-text-secondary">Current {currency(item.row.bentsRetailPrice)} · {getStockLabel(item.row)}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    Open details <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
