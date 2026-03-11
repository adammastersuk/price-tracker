"use client";
import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardContent, Input, Select } from "@/components/ui/primitives";
import { PricingStatusChip, WorkflowChip } from "@/components/features/status-chip";
import { defaultFilters, queryProducts, uniqueValues } from "@/lib/data-service";
import { exportProductsCsv } from "@/lib/csv";
import { currency, pct } from "@/lib/utils";
import { materialGap } from "@/lib/pricing-logic";
import { TrackedProductRow } from "@/types/pricing";

interface RefreshSummary { succeeded: number; failed: number; suspicious: number; }

export function ProductsTable({ rows, onRefreshDone }: { rows: TrackedProductRow[]; onRefreshDone: () => Promise<void>; }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [selected, setSelected] = useState<TrackedProductRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const filteredRows = useMemo(() => queryProducts(rows, filters), [rows, filters]);
  const values = useMemo(() => uniqueValues(rows), [rows]);

  const setSummaryMessage = (summary: RefreshSummary) => {
    setMessage(`Refresh complete: ${summary.succeeded} success, ${summary.failed} failed, ${summary.suspicious} suspicious changes.`);
  };

  const runRefresh = async (productIds?: string[]) => {
    setRefreshing(true);
    setMessage("");
    try {
      const response = await fetch("/api/competitor/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds })
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(`Refresh failed: ${payload.error ?? "Unknown error"}`);
        return;
      }
      setSummaryMessage(payload.data);
      await onRefreshDone();
    } finally {
      setRefreshing(false);
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([exportProductsCsv(filteredRows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bents-pricing-export.csv";
    link.click();
  };

  return (
    <div className="space-y-4">
      <Card><CardContent className="grid gap-3 md:grid-cols-3 lg:grid-cols-7">
        <Input placeholder="Search SKU or product" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="lg:col-span-2" />
        <Select value={filters.buyer} onChange={(e) => setFilters({ ...filters, buyer: e.target.value })}><option value="all">All buyer</option>{values.buyers.map((v) => <option key={v}>{v}</option>)}</Select>
        <Select value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}><option value="all">All department</option>{values.departments.map((v) => <option key={v}>{v}</option>)}</Select>
        <Select value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}><option value="all">All supplier</option>{values.suppliers.map((v) => <option key={v}>{v}</option>)}</Select>
        <Select value={filters.competitor} onChange={(e) => setFilters({ ...filters, competitor: e.target.value })}><option value="all">All competitor</option>{values.competitors.map((v) => <option key={v}>{v}</option>)}</Select>
        <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="all">All status</option>{values.statuses.map((v) => <option key={v}>{v}</option>)}</Select>
      </CardContent></Card>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">{filteredRows.length} products</p><div className="flex gap-2"><Button onClick={downloadCsv}>Export CSV</Button><Button onClick={() => runRefresh(selectedIds)} disabled={refreshing || !selectedIds.length}>Refresh selected rows</Button><Button onClick={() => runRefresh()} disabled={refreshing}>Refresh all rows</Button></div></div>
      {message && <p className="text-sm text-slate-700">{message}</p>}
      <div className="overflow-x-auto rounded-2xl border bg-white shadow-panel">
        <table className="w-full min-w-[1100px] text-sm"><thead className="sticky top-0 bg-slate-50"><tr className="text-left text-slate-600"><th className="px-3 py-2"></th>{["SKU","Product","Buyer","Bents","Competitor","Diff","Status","Workflow"].map((h)=><th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{filteredRows.map((r) => <tr key={r.id} className={`border-t hover:bg-slate-50 cursor-pointer ${materialGap(r) ? "bg-amber-50/60" : ""}`} onClick={() => setSelected(r)}>
            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id))} /></td>
            <td className="px-3 py-2 font-medium">{r.internalSku}</td><td className="px-3 py-2">{r.productName}</td><td className="px-3 py-2">{r.buyer}</td>
            <td className="px-3 py-2">{currency(r.bentsRetailPrice)}</td><td className="px-3 py-2">{r.competitorCurrentPrice ? currency(r.competitorCurrentPrice) : "N/A"}</td>
            <td className="px-3 py-2">{r.priceDifferencePercent !== null ? pct(r.priceDifferencePercent) : "-"}</td><td className="px-3 py-2"><PricingStatusChip status={r.pricingStatus} /></td>
            <td className="px-3 py-2"><WorkflowChip status={r.actionWorkflowStatus} /></td></tr>)}</tbody>
        </table>
      </div>
      {selected && <Card><CardContent className="grid gap-5 lg:grid-cols-3"><div className="lg:col-span-2 space-y-2"><h3 className="text-lg font-semibold">{selected.productName}</h3><p className="text-sm text-slate-600">Decision support only: review competitor signals alongside margin, stock, and supplier context.</p><p><b>Margin:</b> {pct(selected.marginPercent)} | <b>Stock:</b> {selected.competitorStockStatus}</p><p><b>Latest check:</b> {new Date(selected.lastCheckedAt).toLocaleString()} ({selected.lastCheckStatus})</p><p><b>Previous price:</b> {selected.history[1]?.competitorPrice ? currency(selected.history[1].competitorPrice) : "N/A"} | <b>Source:</b> {selected.extractionSource || "n/a"}</p><p><b>Error:</b> {selected.checkErrorMessage || "None"}</p><p><b>Action owner:</b> {selected.actionOwner} | <b>Internal note:</b> {selected.internalNote || "No note yet"}</p><div className="rounded-lg border border-dashed p-3 text-xs text-slate-500">Raw extraction: {selected.rawPriceText || "No raw extraction metadata"}</div><Button onClick={() => runRefresh([selected.id])} disabled={refreshing}>Refresh this product</Button></div>
        <div className="h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={selected.history.slice(0, 12).reverse().map((p) => ({ day: new Date(p.checkedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), bents: p.bentsPrice, competitor: p.competitorPrice ?? 0 }))}><XAxis dataKey="day" hide /><YAxis hide /><Tooltip /><Line type="monotone" dataKey="bents" stroke="#2563eb" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="competitor" stroke="#16a34a" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
      </CardContent></Card>}
    </div>
  );
}
