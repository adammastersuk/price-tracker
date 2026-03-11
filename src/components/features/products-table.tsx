"use client";
import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardContent, Input, Select } from "@/components/ui/primitives";
import { PricingStatusChip, WorkflowChip } from "@/components/features/status-chip";
import { defaultFilters, queryProducts, uniqueValues } from "@/lib/data-service";
import { exportProductsCsv } from "@/lib/csv";
import { currency, pct } from "@/lib/utils";
import { materialGap } from "@/lib/pricing-logic";
import { CompetitorListing, TrackedProductRow } from "@/types/pricing";

interface RefreshSummary { succeeded: number; failed: number; suspicious: number; }
interface ProductForm { sku: string; name: string; brand: string; buyer: string; supplier: string; department: string; bents_price: number; cost_price: string; product_url: string; }
interface DuplicateSkuInfo { sourceProductId: string; targetProductId: string; targetSku: string; targetName: string; }
interface MergeSummary { movedCompetitorCount: number; skippedDuplicateCompetitorCount: number; movedNotesCount: number; movedHistoryCount: number; sourceDeleted: boolean; }
type ProductFormTextKey = "sku" | "name" | "brand" | "buyer" | "supplier" | "department" | "product_url" | "cost_price";
type SortKey = "sku" | "product" | "buyer" | "bents" | "competitor" | "diff" | "status" | "workflow";
type SortDirection = "asc" | "desc";

const competitorStatusLabel = (c: CompetitorListing) => {
  if (c.lastCheckStatus === "pending") return "Pending check";
  if (c.lastCheckStatus === "failed") return "Failed check";
  if (c.competitorCurrentPrice === null) return "No price yet";
  return currency(c.competitorCurrentPrice);
};

const marginLabel = (row: TrackedProductRow) => row.marginPercent === null ? "Margin unavailable" : pct(row.marginPercent);

const competitorSummary = (row: TrackedProductRow) => {
  const valid = row.competitorListings.filter((c) => c.competitorCurrentPrice !== null && c.lastCheckStatus === "success");
  const lowest = [...valid].sort((a, b) => (a.competitorCurrentPrice ?? 0) - (b.competitorCurrentPrice ?? 0))[0];
  if (lowest) {
    return {
      primary: currency(lowest.competitorCurrentPrice ?? 0),
      secondary: lowest.competitorName,
      extra: row.competitorCount > 1 ? `+${row.competitorCount - 1} more` : ""
    };
  }

  if (row.competitorListings.some((c) => c.lastCheckStatus === "pending")) return { primary: "Pending check", secondary: "", extra: "" };
  if (row.competitorListings.some((c) => c.lastCheckStatus === "failed")) return { primary: "Failed check", secondary: "", extra: "" };
  return { primary: "No valid price", secondary: row.competitorName === "No competitor" ? "" : row.competitorName, extra: "" };
};

export function ProductsTable({ rows, onRefreshDone }: { rows: TrackedProductRow[]; onRefreshDone: () => Promise<void>; }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [duplicateSku, setDuplicateSku] = useState<DuplicateSkuInfo | null>(null);
  const [mergeSummary, setMergeSummary] = useState<MergeSummary | null>(null);
  const [merging, setMerging] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("sku");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const filteredRows = useMemo(() => queryProducts(rows, filters), [rows, filters]);
  const sortedRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const nullRank = (value: number | null | undefined) => (value === null || value === undefined ? Number.POSITIVE_INFINITY : value);
    return [...filteredRows].sort((a, b) => {
      const aComp = competitorSummary(a);
      const bComp = competitorSummary(b);
      switch (sortKey) {
        case "sku": return direction * a.internalSku.localeCompare(b.internalSku);
        case "product": return direction * a.productName.localeCompare(b.productName);
        case "buyer": return direction * a.buyer.localeCompare(b.buyer);
        case "bents": return direction * (a.bentsRetailPrice - b.bentsRetailPrice);
        case "competitor": {
          const aValue = a.competitorCurrentPrice ?? nullRank(undefined);
          const bValue = b.competitorCurrentPrice ?? nullRank(undefined);
          if (Number.isFinite(aValue) && Number.isFinite(bValue)) return direction * (aValue - bValue);
          return direction * aComp.primary.localeCompare(bComp.primary);
        }
        case "diff": return direction * ((a.priceDifferencePercent ?? nullRank(undefined)) - (b.priceDifferencePercent ?? nullRank(undefined)));
        case "status": return direction * a.pricingStatus.localeCompare(b.pricingStatus);
        case "workflow": return direction * a.actionWorkflowStatus.localeCompare(b.actionWorkflowStatus);
        default: return 0;
      }
    });
  }, [filteredRows, sortDirection, sortKey]);
  const values = useMemo(() => uniqueValues(rows), [rows]);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const [productForm, setProductForm] = useState<ProductForm | null>(null);
  const [competitorForm, setCompetitorForm] = useState<CompetitorListing[]>([]);

  useEffect(() => {
    if (!selectedId && rows.length) {
      setSelectedId(rows[0].id);
    }
  }, [rows, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setProductForm({
      sku: selected.internalSku,
      name: selected.productName,
      brand: selected.brand === "Unknown" ? "" : selected.brand,
      buyer: selected.buyer === "Unassigned" ? "" : selected.buyer,
      supplier: selected.supplier === "Unknown" ? "" : selected.supplier,
      department: selected.department === "Unassigned" ? "" : selected.department,
      bents_price: selected.bentsRetailPrice,
      cost_price: selected.costPrice === null ? "" : String(selected.costPrice),
      product_url: selected.bentsProductUrl
    });
    setCompetitorForm(selected.competitorListings);
    setEditMode(false);
    setSaveMessage("");
    setDuplicateSku(null);
    setMergeSummary(null);
  }, [selected]);

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

  const saveEdits = async () => {
    if (!selected || !productForm) return;
    setSaving(true);
    setSaveMessage("");
    setDuplicateSku(null);
    setMergeSummary(null);
    try {
      const productResponse = await fetch("/api/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          updates: {
            sku: productForm.sku,
            name: productForm.name,
            brand: productForm.brand || null,
            buyer: productForm.buyer || null,
            supplier: productForm.supplier || null,
            department: productForm.department || null,
            bents_price: Number(productForm.bents_price),
            cost_price: productForm.cost_price === "" ? null : Number(productForm.cost_price),
            product_url: productForm.product_url || null
          }
        })
      });

      const productPayload = await productResponse.json();
      if (!productResponse.ok) {
        if (productPayload.code === "DUPLICATE_SKU" && productPayload.duplicate) {
          setDuplicateSku(productPayload.duplicate);
          setSaveMessage(productPayload.error ?? "That SKU already exists on another product.");
          return;
        }
        setSaveMessage(productPayload.error ?? "Failed to save product");
        return;
      }

      for (const competitor of competitorForm) {
        const response = await fetch("/api/competitor", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: competitor.id,
            updates: {
              competitor_name: competitor.competitorName,
              competitor_url: competitor.competitorProductUrl,
              competitor_current_price: competitor.competitorCurrentPrice,
              competitor_promo_price: competitor.competitorPromoPrice,
              competitor_stock_status: competitor.competitorStockStatus
            }
          })
        });
        if (!response.ok) {
          const payload = await response.json();
          setSaveMessage(payload.error ?? "Failed to save competitor row");
          return;
        }
      }

      await onRefreshDone();
      setEditMode(false);
      setSaveMessage("Saved successfully.");
    } finally {
      setSaving(false);
    }
  };

  const runMergeIntoTarget = async () => {
    if (!duplicateSku) return;
    setMerging(true);
    try {
      const response = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceProductId: duplicateSku.sourceProductId,
          targetProductId: duplicateSku.targetProductId
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setSaveMessage(payload.error ?? "Failed to merge products");
        return;
      }

      setMergeSummary(payload.data);
      setDuplicateSku(null);
      setEditMode(false);
      await onRefreshDone();
      setSelectedId(duplicateSku.targetProductId);
      setSaveMessage("Merge completed successfully.");
    } finally {
      setMerging(false);
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

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => prev === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : "↕";

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
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">{sortedRows.length} products</p><div className="flex gap-2"><Button onClick={downloadCsv}>Export CSV</Button><Button onClick={() => runRefresh(selectedIds)} disabled={refreshing || !selectedIds.length}>Refresh selected rows</Button><Button onClick={() => runRefresh()} disabled={refreshing}>Refresh all rows</Button></div></div>
      {message && <p className="text-sm text-slate-700">{message}</p>}

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-panel">
        <table className="w-full min-w-[1100px] text-sm"><thead className="sticky top-0 bg-slate-50"><tr className="text-left text-slate-600"><th className="px-3 py-2"></th>{([
          ["SKU", "sku"], ["Product", "product"], ["Buyer", "buyer"], ["Bents", "bents"], ["Competitor", "competitor"], ["Diff", "diff"], ["Status", "status"], ["Workflow", "workflow"]
        ] as Array<[string, SortKey]>).map(([label, key]) => <th key={key} className="px-3 py-2"><button className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => onSort(key)}>{label}<span className="text-xs">{sortIndicator(key)}</span></button></th>)}</tr></thead>
          <tbody>{sortedRows.map((r) => <tr key={r.id} className={`border-t hover:bg-slate-50 cursor-pointer ${materialGap(r) ? "bg-amber-50/60" : ""}`} onClick={() => setSelectedId(r.id)}>
            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id))} /></td>
            <td className="px-3 py-2 font-medium">{r.internalSku}</td><td className="px-3 py-2">{r.productName}</td><td className="px-3 py-2">{r.buyer}</td>
            <td className="px-3 py-2">{currency(r.bentsRetailPrice)}</td>
            <td className="px-3 py-2">{(() => {
              const summary = competitorSummary(r);
              return <><p className="font-semibold text-slate-900">{summary.primary}</p>{summary.secondary && <p className="text-xs text-slate-600">{summary.secondary}</p>}{summary.extra && <p className="text-xs text-slate-500">{summary.extra}</p>}</>;
            })()}</td>
            <td className="px-3 py-2">{r.priceDifferencePercent !== null ? pct(r.priceDifferencePercent) : "-"}</td><td className="px-3 py-2"><PricingStatusChip status={r.pricingStatus} /></td>
            <td className="px-3 py-2"><WorkflowChip status={r.actionWorkflowStatus} /></td></tr>)}</tbody>
        </table>
      </div>
      {selected && productForm && <Card><CardContent className="grid gap-5 lg:grid-cols-3"><div className="lg:col-span-2 space-y-3"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{selected.productName}</h3><div className="flex gap-2"><Button onClick={() => runRefresh([selected.id])} disabled={refreshing}>Refresh this product</Button><Button className="bg-slate-700" onClick={() => setEditMode((v) => !v)}>{editMode ? "Cancel edit" : "Edit product"}</Button></div></div><p className="text-sm text-slate-600">Decision support only: review competitor signals alongside margin, stock, supplier context and commercial judgement.</p>

            {editMode ? <div className="grid gap-2 md:grid-cols-2">{[
              ["SKU", "sku"], ["Product name", "name"], ["Brand", "brand"], ["Buyer", "buyer"], ["Supplier", "supplier"], ["Department", "department"], ["Bents URL", "product_url"], ["Cost price", "cost_price"]
            ].map(([label, key]) => {
              const formKey = key as ProductFormTextKey;
              return <label key={key} className="text-xs text-slate-600">{label}<Input value={productForm[formKey] ?? ""} onChange={(e) => setProductForm((prev) => prev ? { ...prev, [formKey]: e.target.value } : prev)} /></label>;
            })}<label className="text-xs text-slate-600">Bents price<Input type="number" step="0.01" value={productForm.bents_price} onChange={(e) => setProductForm((prev) => prev ? { ...prev, bents_price: Number(e.target.value) } : prev)} /></label></div> : <>
              <p><b>Margin:</b> {marginLabel(selected)} | <b>Stock:</b> {selected.competitorStockStatus}</p><p><b>Latest check:</b> {new Date(selected.lastCheckedAt).toLocaleString()} ({selected.lastCheckStatus})</p><p><b>Previous price:</b> {selected.history[1]?.competitorPrice ? currency(selected.history[1].competitorPrice) : "N/A"} | <b>Source:</b> {selected.extractionSource || "n/a"}</p><p><b>Error:</b> {selected.checkErrorMessage || "None"}</p>
            </>}

            <div className="rounded-lg border p-3 space-y-3"><p className="font-medium">Competitor listings ({selected.competitorCount})</p>
              {competitorForm.map((c, index) => <div key={c.id} className="rounded border p-2 space-y-2"><div className="grid gap-2 md:grid-cols-2">{editMode ? <>
                <label className="text-xs">Competitor name<Input value={c.competitorName} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorName: e.target.value } : x))} /></label>
                <label className="text-xs">Competitor URL<Input value={c.competitorProductUrl} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorProductUrl: e.target.value } : x))} /></label>
                <label className="text-xs">Current price<Input type="number" step="0.01" value={c.competitorCurrentPrice ?? ""} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorCurrentPrice: e.target.value === "" ? null : Number(e.target.value) } : x))} /></label>
                <label className="text-xs">Promo price<Input type="number" step="0.01" value={c.competitorPromoPrice ?? ""} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorPromoPrice: e.target.value === "" ? null : Number(e.target.value) } : x))} /></label>
              </> : <>
                <p><b>{index + 1}. {c.competitorName}</b></p>
                <p className="text-xs text-slate-600">{competitorStatusLabel(c)} | {c.lastCheckStatus} | checked {new Date(c.lastCheckedAt).toLocaleString()}</p>
                <p className="text-xs text-slate-600">{c.competitorProductUrl}</p>
                <p className="text-xs">Promo: {c.competitorPromoPrice !== null ? currency(c.competitorPromoPrice) : "-"} | Prev valid: {c.competitorWasPrice !== null ? currency(c.competitorWasPrice) : "-"}</p>
                <p className="text-xs">Raw extraction: {c.rawPriceText || "none"}</p>
                <p className="text-xs text-amber-700">{c.checkErrorMessage || ""}</p>
              </>}</div></div>)}
            </div>

            <p><b>Action owner:</b> {selected.actionOwner} | <b>Internal note:</b> {selected.internalNote || "No note yet"}</p>
            {saveMessage && <p className="text-sm text-slate-700">{saveMessage}</p>}
            {duplicateSku && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm">
                <p>SKU <b>{duplicateSku.targetSku}</b> already exists on <b>{duplicateSku.targetName}</b>. Choose merge to reassign competitor listings to the existing product.</p>
                <div className="flex gap-2">
                  <Button className="bg-amber-700" onClick={runMergeIntoTarget} disabled={merging}>{merging ? "Merging..." : "Merge into existing SKU"}</Button>
                  <Button className="bg-slate-500" onClick={() => setDuplicateSku(null)} disabled={merging}>Cancel merge</Button>
                </div>
              </div>
            )}
            {mergeSummary && (
              <p className="text-sm text-emerald-700">Merged successfully: moved {mergeSummary.movedCompetitorCount} competitor listings, skipped {mergeSummary.skippedDuplicateCompetitorCount} duplicates, moved {mergeSummary.movedNotesCount} notes and {mergeSummary.movedHistoryCount} history rows. {mergeSummary.sourceDeleted ? "Source product removed." : "Source product retained because linked records remain."}</p>
            )}
            {editMode && <div className="flex gap-2"><Button onClick={saveEdits} disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button><Button className="bg-slate-500" onClick={() => { setEditMode(false); setProductForm(null); setCompetitorForm([]); setSelectedId(selected.id); setDuplicateSku(null); }}>Cancel</Button></div>}
          </div>
        <div className="h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={selected.history.slice(0, 12).reverse().map((p) => ({ day: new Date(p.checkedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), bents: p.bentsPrice, competitor: p.competitorPrice ?? 0 }))}><XAxis dataKey="day" hide /><YAxis hide /><Tooltip /><Line type="monotone" dataKey="bents" stroke="#2563eb" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="competitor" stroke="#16a34a" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
      </CardContent></Card>}
    </div>
  );
}
