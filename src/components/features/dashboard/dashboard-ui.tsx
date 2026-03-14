import Link from "next/link";
import { ArrowRight, ArrowUpRight, Download, Filter, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Input, Select } from "@/components/ui/primitives";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { PricingStatusChip } from "@/components/features/status-chip";
import { QueueItem } from "@/lib/data-service";
import { TrackedProductRow } from "@/types/pricing";
import { cn, currency, pct } from "@/lib/utils";

interface DashboardHeaderProps {
  filters: {
    search: string;
    buyers: string[];
    departments: string[];
    competitors: string[];
    statuses: string[];
  };
  choices: {
    buyers: string[];
    departments: string[];
    competitors: string[];
    statuses: string[];
  };
  openFilter: string | null;
  onOpenFilter: (key: string | null) => void;
  onSearch: (value: string) => void;
  onChange: (key: "buyers" | "departments" | "competitors" | "statuses", value: string[]) => void;
}

export function DashboardHeader({ filters, choices, openFilter, onOpenFilter, onSearch, onChange }: DashboardHeaderProps) {
  return (
    <Card className="border-slate-200/90 shadow-sm dark:border-border">
      <CardHeader className="space-y-4 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-foreground">Price Checker Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">Track price changes, stock anomalies and competitiveness trends across your product catalog.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Date range" defaultValue="7d" className="min-w-[150px]">
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="quarter">Quarter to date</option>
            </Select>
            <button className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <Filter className="h-4 w-4" /> Saved view
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <Download className="h-4 w-4" /> Export report
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input placeholder="Search SKU or product" value={filters.search} onChange={(event) => onSearch(event.target.value)} />
          <MultiSelectFilter label="Buyer" allLabel="All buyers" options={choices.buyers} selected={filters.buyers} onChange={(buyers) => onChange("buyers", buyers)} open={openFilter === "buyers"} onOpenChange={(open) => onOpenFilter(open ? "buyers" : null)} />
          <MultiSelectFilter label="Category" allLabel="All categories" options={choices.departments} selected={filters.departments} onChange={(departments) => onChange("departments", departments)} open={openFilter === "departments"} onOpenChange={(open) => onOpenFilter(open ? "departments" : null)} />
          <MultiSelectFilter label="Competitor" allLabel="All competitors" options={choices.competitors} selected={filters.competitors} onChange={(competitors) => onChange("competitors", competitors)} open={openFilter === "competitors"} onOpenChange={(open) => onOpenFilter(open ? "competitors" : null)} />
          <MultiSelectFilter label="Stock & Status" allLabel="All statuses" options={choices.statuses} selected={filters.statuses} onChange={(statuses) => onChange("statuses", statuses)} open={openFilter === "statuses"} onOpenChange={(open) => onOpenFilter(open ? "statuses" : null)} />
        </div>
      </CardHeader>
    </Card>
  );
}

interface KPIItem {
  title: string;
  value: string;
  trend: number;
  context: string;
  sparkline: number[];
  tone?: "positive" | "negative" | "neutral";
}

function Sparkline({ points, tone = "neutral" }: { points: number[]; tone?: KPIItem["tone"] }) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(1, max - min);
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100;
      const y = 100 - ((point - min) / range) * 100;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
  const color = tone === "positive" ? "stroke-emerald-500" : tone === "negative" ? "stroke-rose-500" : "stroke-sky-500";

  return (
    <svg viewBox="0 0 100 28" role="img" aria-label="Trend sparkline" className="h-7 w-20">
      <path d={path} fill="none" className={cn("stroke-2", color)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DashboardKpiGrid({ items }: { items: KPIItem[] }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" aria-label="KPI summary cards">
      {items.map((item) => {
        const TrendIcon = item.trend >= 0 ? TrendingUp : TrendingDown;
        const trendTone = item.tone === "positive" ? "text-emerald-700" : item.tone === "negative" ? "text-rose-700" : "text-slate-700 dark:text-text-secondary";
        return (
          <Card key={item.title} className="border-slate-200/80 shadow-sm dark:border-border">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{item.title}</p>
                <Sparkline points={item.sparkline} tone={item.tone} />
              </div>
              <p className="text-2xl font-semibold text-slate-900 dark:text-foreground">{item.value}</p>
              <div className="flex items-center justify-between gap-2 text-xs">
                <p className={cn("inline-flex items-center gap-1 font-medium", trendTone)}><TrendIcon className="h-3.5 w-3.5" /> {item.trend > 0 ? "+" : ""}{item.trend}%</p>
                <p className="text-text-muted">{item.context}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

export function InsightPanel({ title, subtitle, children, empty }: { title: string; subtitle: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <Card className="border-slate-200/80 shadow-sm dark:border-border">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-base font-semibold text-slate-900 dark:text-foreground">{title}</CardTitle>
        <p className="text-xs text-text-muted">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {empty ? <p className="rounded-xl border border-dashed border-border bg-muted/70 px-4 py-8 text-center text-sm text-text-muted">No data available for the selected filters.</p> : children}
      </CardContent>
    </Card>
  );
}

interface ActionTableProps {
  rows: QueueItem[];
  refreshingId: string | null;
  onRefreshProduct: (id: string) => void;
  totalRows: number;
}

function queueReasonBadge(reason: string) {
  if (reason.includes("Promo discrepancy")) return "Promo mismatch";
  if (reason.includes("Missing competitor mapping")) return "Missing market map";
  if (reason.includes("Missing valid competitor price")) return "Missing market price";
  if (reason.includes("Failed check")) return "Failed check";
  if (reason.includes("Stale check")) return "Stale signal";
  if (reason.includes("Suspicious")) return "Volatility risk";
  if (reason.includes("Bents +£")) return "Price gap";
  return "Commercial check";
}

export function ProductsNeedingAttention({ rows, refreshingId, onRefreshProduct, totalRows }: ActionTableProps) {
  return (
    <Card className="border-slate-200/80 shadow-sm dark:border-border">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-foreground">Products Needing Attention</CardTitle>
          <p className="text-xs text-text-muted">Showing the highest-priority triage items by pricing, stock and data confidence.</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-text-muted">Showing {rows.length} of {totalRows}</p>
          <Link href="/products" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Open full catalog <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-[950px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-surface-hover dark:text-text-secondary">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Current</th>
                <th className="px-4 py-3">Lowest competitor</th>
                <th className="px-4 py-3">Gap</th>
                <th className="px-4 py-3">Priority reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">No urgent products right now. Try widening your filters.</td>
                </tr>
              ) : rows.map((item) => (
                <tr key={item.row.id} className="border-t border-border/80 align-top">
                  <td className="px-4 py-2">
                    <p className="max-w-[280px] truncate font-medium text-slate-900 dark:text-foreground">{item.row.productName}</p>
                    <p className="text-xs text-text-muted">{item.row.internalSku}</p>
                  </td>
                  <td className="px-4 py-2">{currency(item.row.bentsRetailPrice)}</td>
                  <td className="px-4 py-2">{item.lowestTrusted ? `${currency(item.lowestTrusted.price)} · ${item.lowestTrusted.competitorName}` : "No valid competitor"}</td>
                  <td className="px-4 py-2">
                    {item.gapGbp > 0 ? <p className="font-medium text-rose-700">{currency(item.gapGbp)} ({pct(item.gapPercent)})</p> : <span className="text-text-muted">-</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium leading-5 text-text-secondary whitespace-nowrap">{queueReasonBadge(item.reason)}</span>
                  </td>
                  <td className="px-4 py-2"><PricingStatusChip status={item.row.pricingStatus} /></td>
                                    <td className="px-4 py-2">
                    <div className="flex flex-col gap-2">
                      <Link href={`/products?search=${encodeURIComponent(item.row.internalSku)}&productId=${encodeURIComponent(item.row.id)}`} className="inline-flex items-center gap-1 text-primary hover:underline">Open details <ArrowUpRight className="h-3.5 w-3.5" /></Link>
                      <button onClick={() => onRefreshProduct(item.row.id)} disabled={refreshingId === item.row.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <RefreshCw className={cn("h-3.5 w-3.5", refreshingId === item.row.id && "animate-spin")} /> {refreshingId === item.row.id ? "Refreshing" : "Refresh check"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function LoadingDashboardState() {
  return (
    <div className="space-y-4" aria-label="Loading dashboard" aria-live="polite">
      <div className="h-40 animate-pulse rounded-2xl border border-border bg-card" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-border bg-card" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="h-72 animate-pulse rounded-2xl border border-border bg-card xl:col-span-2" />
        <div className="h-72 animate-pulse rounded-2xl border border-border bg-card" />
      </div>
      <div className="h-96 animate-pulse rounded-2xl border border-border bg-card" />
    </div>
  );
}

export function EmptyDashboardState({ reset }: { reset: () => void }) {
  return (
    <Card>
      <CardContent className="py-20 text-center">
        <p className="text-lg font-semibold text-slate-900 dark:text-foreground">No products match this view</p>
        <p className="mt-2 text-sm text-text-muted">Clear filters to view your monitored products and pricing opportunities.</p>
        <button onClick={reset} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Reset filters</button>
      </CardContent>
    </Card>
  );
}

export function ErrorDashboardState({ retry }: { retry: () => void }) {
  return (
    <Card>
      <CardContent className="py-20 text-center">
        <p className="text-lg font-semibold text-slate-900 dark:text-foreground">Unable to load dashboard</p>
        <p className="mt-2 text-sm text-text-muted">There was a problem fetching pricing data. Please try again.</p>
        <button onClick={retry} className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Retry</button>
      </CardContent>
    </Card>
  );
}

export function getStockLabel(row: TrackedProductRow) {
  if (row.pricingStatus === "Competitor out of stock") return "Competitor OOS";
  return "In market";
}
