"use client";
import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardContent, Input, Select } from "@/components/ui/primitives";
import { PricingStatusChip, WorkflowChip } from "@/components/features/status-chip";
import { defaultFilters, queryProducts, uniqueValues } from "@/lib/data-service";
import { exportProductsCsv } from "@/lib/csv";
import { currency, pct } from "@/lib/utils";
import { materialGap } from "@/lib/pricing-logic";
import { CompetitorListing, CompetitorStockStatus, TrackedProductRow } from "@/types/pricing";

interface RefreshSummary { succeeded: number; failed: number; suspicious: number; }
interface ProductForm { sku: string; name: string; brand: string; buyer: string; supplier: string; department: string; bents_price: number; cost_price: string; product_url: string; }
interface DuplicateSkuInfo { sourceProductId: string; targetProductId: string; targetSku: string; targetName: string; }
interface MergeSummary { movedCompetitorCount: number; skippedDuplicateCompetitorCount: number; movedNotesCount: number; movedHistoryCount: number; sourceDeleted: boolean; }
type ProductFormTextKey = "sku" | "name" | "brand" | "buyer" | "supplier" | "department" | "product_url" | "cost_price";
type SortKey = "sku" | "product" | "buyer" | "bents" | "competitor" | "diff" | "status" | "workflow";
type SortDirection = "asc" | "desc";

const statusTone: Record<CompetitorListing["lastCheckStatus"], string> = {
  success: "bg-emerald-100 text-emerald-800",
  suspicious: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-700",
  pending: "bg-slate-100 text-slate-700"
};

const stockOptions: CompetitorStockStatus[] = ["In Stock", "Low Stock", "Out of Stock", "Unknown"];
const workflowOptions = ["Open", "Monitoring", "Reviewed", "No Action", "Closed"] as const;

const statusText = (status: CompetitorListing["lastCheckStatus"]) => {
  if (status === "success") return "Success";
  if (status === "suspicious") return "Suspicious";
  if (status === "failed") return "Failed";
  return "Pending";
};

const trustNote = (listing: CompetitorListing) => {
  if (listing.lastCheckStatus === "suspicious") {
    const retained = listing.checkErrorMessage.toLowerCase().includes("retained");
    return retained
      ? "Price candidate rejected and previous valid value retained for review."
      : "Extractor flagged this result as suspicious. Review before acting.";
  }
  if (listing.lastCheckStatus === "failed") return "Latest extraction failed. Last known values may be stale.";
  if (listing.lastCheckStatus === "pending") return "Awaiting extraction check.";
  return "Price extracted successfully.";
};

const marginLabel = (row: TrackedProductRow) => row.marginPercent === null ? "Margin unavailable" : pct(row.marginPercent);

const competitorSummary = (row: TrackedProductRow) => {
  const valid = row.competitorListings.filter((c) =>
    c.competitorCurrentPrice !== null
    && c.competitorCurrentPrice > 0
    && c.lastCheckStatus === "success"
    && c.extractionMetadata?.trust_rejected !== true
  );
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

const competitorBadges = (row: TrackedProductRow) => {
  const suspicious = row.competitorListings.filter((c) => c.lastCheckStatus === "suspicious").length;
  const checked = row.competitorListings.filter((c) => c.lastCheckStatus === "success").length;
  const valid = row.competitorListings.filter((c) => c.lastCheckStatus === "success" && c.competitorCurrentPrice !== null && c.extractionMetadata?.trust_rejected !== true);
  return {
    hasLowest: valid.length > 0,
    suspicious,
    checked
  };
};

const formatDiff = (listing: CompetitorListing) => {
  const diff = listing.priceDifferenceGbp;
  const pctDiff = listing.priceDifferencePercent;
  if (diff === null || pctDiff === null) return { line1: "No difference available", line2: "", tone: "text-slate-600" };
  if (Math.abs(diff) < 0.005) return { line1: "£0.00 difference", line2: "In line with Bents", tone: "text-slate-700" };

  const direction = diff > 0 ? "cheaper" : "above";
  const line1 = `${currency(Math.abs(diff))} ${direction === "cheaper" ? "cheaper than Bents" : "above Bents"}`;
  const line2 = `${Math.abs(pctDiff).toFixed(1)}% ${direction === "cheaper" ? "below" : "above"} Bents`;
  return { line1, line2, tone: direction === "cheaper" ? "text-emerald-700" : "text-rose-700" };
};

export function ProductsTable({ rows, onRefreshDone, initialFilters }: { rows: TrackedProductRow[]; onRefreshDone: () => Promise<void>; initialFilters?: Partial<typeof defaultFilters>; }) {
  const [filters, setFilters] = useState({ ...defaultFilters, ...initialFilters });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkWorkflowStatus, setBulkWorkflowStatus] = useState<(typeof workflowOptions)[number]>("Open");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [duplicateSku, setDuplicateSku] = useState<DuplicateSkuInfo | null>(null);
  const [mergeSummary, setMergeSummary] = useState<MergeSummary | null>(null);
  const [merging, setMerging] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("sku");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [editingCompetitorId, setEditingCompetitorId] = useState<string | null>(null);
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
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.includes(row.id)), [rows, selectedIds]);
  const visibleSelectedCount = useMemo(() => filteredRows.filter((row) => selectedIds.includes(row.id)).length, [filteredRows, selectedIds]);
  const [productForm, setProductForm] = useState<ProductForm | null>(null);
  const [competitorForm, setCompetitorForm] = useState<CompetitorListing[]>([]);

  useEffect(() => {
    if (!selectedId && rows.length) setSelectedId(rows[0].id);
    if (selectedId && rows.length && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]?.id ?? null);
    }
  }, [rows, selectedId]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(rows.map((row) => row.id));
      const next = prev.filter((id) => valid.has(id));
      if (next.length !== prev.length) {
        setBulkMessage(`Selection updated: ${prev.length - next.length} row(s) are no longer available.`);
      }
      return next;
    });
  }, [rows]);

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
    setEditingCompetitorId(null);
    setSaveMessage("");
    setDuplicateSku(null);
    setMergeSummary(null);
  }, [selected]);

  const setSummaryMessage = (summary: RefreshSummary) => {
    setMessage(`Refresh complete: ${summary.succeeded} success, ${summary.failed} failed, ${summary.suspicious} suspicious changes.`);
  };

  const runRefresh = async (productIds?: string[], competitorListingIds?: string[]) => {
    setRefreshing(true);
    setMessage("");
    try {
      const response = await fetch("/api/competitor/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, competitorListingIds })
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

  const deleteCompetitor = async (competitorId: string) => {
    if (!selected) return;
    if (!window.confirm("Delete this competitor listing? This cannot be undone.")) return;

    const response = await fetch(`/api/competitor?id=${competitorId}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaveMessage(payload.error ?? "Failed to delete competitor listing.");
      return;
    }
    setSaveMessage("Competitor listing deleted.");
    await onRefreshDone();
  };

  const deleteProductRow = async () => {
    if (!selected) return;
    const ok = window.confirm("Delete this product and all linked competitor data? This cannot be undone.");
    if (!ok) return;

    const response = await fetch(`/api/products?id=${selected.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaveMessage(payload.error ?? "Failed to delete product.");
      return;
    }

    setSaveMessage("Product deleted.");
    await onRefreshDone();
    setSelectedId(null);
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

      await onRefreshDone();
      setEditMode(false);
      setSaveMessage("Product saved successfully.");
    } finally {
      setSaving(false);
    }
  };

  const saveCompetitorEdit = async (competitor: CompetitorListing) => {
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
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaveMessage(payload.error ?? "Failed to save competitor listing.");
      return;
    }
    setEditingCompetitorId(null);
    setSaveMessage("Competitor listing updated.");
    await onRefreshDone();
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

  const downloadCsv = (targetRows: TrackedProductRow[], prefix = "bents-pricing-export") => {
    const blob = new Blob([exportProductsCsv(targetRows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runBulkAction = async (action: "assign_owner" | "set_workflow_status" | "mark_reviewed") => {
    if (!selectedIds.length) return;
    if ((action === "set_workflow_status" || action === "mark_reviewed") && !window.confirm(`Apply this ${action === "mark_reviewed" ? "reviewed shortcut" : "workflow status"} update to ${selectedIds.length} product(s)?`)) {
      return;
    }

    setBulkBusy(true);
    setBulkMessage("");
    try {
      const response = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          productIds: selectedIds,
          owner: bulkOwner,
          workflowStatus: action === "mark_reviewed" ? "Reviewed" : bulkWorkflowStatus
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBulkMessage(payload.error ?? "Bulk action failed.");
        return;
      }
      setBulkMessage(`Updated ${payload.data?.updated ?? selectedIds.length} row(s) successfully.`);
      await onRefreshDone();
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkRefresh = async () => {
    if (!selectedIds.length) return;
    setBulkBusy(true);
    await runRefresh(selectedIds);
    setBulkBusy(false);
  };

  const toggleAllVisible = (checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...new Set([...prev, ...sortedRows.map((row) => row.id)])]);
      return;
    }
    const visibleIds = new Set(sortedRows.map((row) => row.id));
    setSelectedIds((prev) => prev.filter((id) => !visibleIds.has(id)));
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
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">{sortedRows.length} products · {selectedIds.length} selected {visibleSelectedCount !== selectedIds.length ? `(visible ${visibleSelectedCount})` : ""}</p><div className="flex gap-2"><Button onClick={() => downloadCsv(filteredRows)}>Export CSV</Button><Button onClick={() => runRefresh()} disabled={refreshing}>Refresh all rows</Button></div></div>
      {selectedIds.length > 0 && <Card><CardContent className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-700 mr-2">{selectedIds.length} selected</p><Button onClick={runBulkRefresh} disabled={refreshing || bulkBusy}>Refresh selected</Button><Button onClick={() => downloadCsv(selectedRows, "bents-pricing-selected")}>Export selected</Button><div className="flex items-center gap-2"><Select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)}><option value="">Select owner</option>{values.buyers.map((v) => <option key={v} value={v}>{v}</option>)}</Select><Input value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)} placeholder="Or type owner" className="w-40" /><Button onClick={() => runBulkAction("assign_owner")} disabled={!bulkOwner.trim() || bulkBusy}>Assign owner</Button></div><div className="flex items-center gap-2"><Select value={bulkWorkflowStatus} onChange={(e) => setBulkWorkflowStatus(e.target.value as (typeof workflowOptions)[number])}>{workflowOptions.map((option) => <option key={option} value={option}>{option}</option>)}</Select><Button onClick={() => runBulkAction("set_workflow_status")} disabled={bulkBusy}>Set workflow status</Button><Button className="bg-emerald-700" onClick={() => runBulkAction("mark_reviewed")} disabled={bulkBusy}>Mark reviewed</Button></div><Button className="bg-slate-500" onClick={() => setSelectedIds([])} disabled={bulkBusy}>Clear selection</Button></CardContent></Card>}
      {message && <p className="text-sm text-slate-700">{message}</p>}
      {bulkMessage && <p className="text-sm text-slate-700">{bulkMessage}</p>}

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-panel">
        <table className="w-full min-w-[1100px] text-sm"><thead className="sticky top-0 bg-slate-50"><tr className="text-left text-slate-600"><th className="px-3 py-2"><input type="checkbox" aria-label="Select all visible rows" checked={sortedRows.length > 0 && sortedRows.every((row) => selectedIds.includes(row.id))} onChange={(e) => toggleAllVisible(e.target.checked)} /></th>{([
          ["SKU", "sku"], ["Product", "product"], ["Buyer", "buyer"], ["Bents", "bents"], ["Competitor", "competitor"], ["Diff", "diff"], ["Status", "status"], ["Workflow", "workflow"]
        ] as Array<[string, SortKey]>).map(([label, key]) => <th key={key} className="px-3 py-2"><button className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => onSort(key)}>{label}<span className="text-xs">{sortIndicator(key)}</span></button></th>)}</tr></thead>
          <tbody>{sortedRows.map((r) => <tr key={r.id} className={`border-t hover:bg-slate-50 cursor-pointer ${materialGap(r) ? "bg-amber-50/60" : ""} ${selectedIds.includes(r.id) ? "ring-1 ring-sky-200 bg-sky-50/40" : ""}`} onClick={() => setSelectedId(r.id)}>
            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id))} /></td>
            <td className="px-3 py-2 font-medium">{r.internalSku}</td><td className="px-3 py-2">{r.productName}</td><td className="px-3 py-2">{r.buyer}</td>
            <td className="px-3 py-2">{currency(r.bentsRetailPrice)}</td>
            <td className="px-3 py-2">{(() => {
              const summary = competitorSummary(r);
              const badges = competitorBadges(r);
              return <><p className="font-semibold text-slate-900">{summary.primary}</p>{summary.secondary && <p className="text-xs text-slate-600">{summary.secondary}</p>}
                <div className="mt-1 flex flex-wrap gap-1 text-[11px]">{badges.hasLowest && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Lowest valid</span>}
                  {badges.suspicious > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{badges.suspicious} suspicious</span>}
                  {badges.checked > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">{badges.checked} checked</span>}</div>
                {summary.extra && <p className="text-xs text-slate-500">{summary.extra}</p>}</>;
            })()}</td>
            <td className="px-3 py-2">{r.priceDifferencePercent !== null ? pct(r.priceDifferencePercent) : "-"}</td><td className="px-3 py-2"><PricingStatusChip status={r.pricingStatus} /></td>
            <td className="px-3 py-2"><WorkflowChip status={r.actionWorkflowStatus} /></td></tr>)}</tbody>
        </table>
      </div>
      {selected && productForm && <Card><CardContent className="grid gap-5 lg:grid-cols-3"><div className="lg:col-span-2 space-y-3"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{selected.productName}</h3><div className="flex gap-2"><Button onClick={() => runRefresh([selected.id])} disabled={refreshing}>Refresh this product</Button><Button className="bg-slate-700" onClick={() => setEditMode((v) => !v)}>{editMode ? "Cancel edit" : "Edit product"}</Button><Button className="bg-rose-700" onClick={deleteProductRow}>Delete product</Button></div></div><p className="text-sm text-slate-600">Decision support only: review competitor signals alongside margin, stock, supplier context and commercial judgement. Competitor prices are reference signals, not repricing instructions.</p>

            {editMode ? <div className="grid gap-2 md:grid-cols-2">{[
              ["SKU", "sku"], ["Product name", "name"], ["Brand", "brand"], ["Buyer", "buyer"], ["Supplier", "supplier"], ["Department", "department"], ["Bents URL", "product_url"], ["Cost price", "cost_price"]
            ].map(([label, key]) => {
              const formKey = key as ProductFormTextKey;
              return <label key={key} className="text-xs text-slate-600">{label}<Input value={productForm[formKey] ?? ""} onChange={(e) => setProductForm((prev) => prev ? { ...prev, [formKey]: e.target.value } : prev)} /></label>;
            })}<label className="text-xs text-slate-600">Bents price<Input type="number" step="0.01" value={productForm.bents_price} onChange={(e) => setProductForm((prev) => prev ? { ...prev, bents_price: Number(e.target.value) } : prev)} /></label></div> : <>
              <p><b>Margin:</b> {marginLabel(selected)} | <b>Latest check:</b> {new Date(selected.lastCheckedAt).toLocaleString()}</p>
            </>}

            <div className="rounded-lg border p-3 space-y-3"><p className="font-medium">Competitor comparison ({selected.competitorCount})</p>
              {competitorForm.length === 0 && <p className="rounded border border-dashed p-4 text-sm text-slate-600">No competitor listings yet. Keep the product and add listings when mappings are available.</p>}
              <div className="grid gap-3 md:grid-cols-2">
                {competitorForm.map((c) => {
                  const diff = formatDiff(c);
                  const isEditing = editingCompetitorId === c.id;
                  return <div key={c.id} className="rounded-lg border p-3 space-y-3 bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-3xl font-bold leading-none">{c.competitorCurrentPrice !== null ? currency(c.competitorCurrentPrice) : "No price"}</p>
                        <p className="text-sm text-slate-600 mt-1">{c.competitorName}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusTone[c.lastCheckStatus]}`}>{statusText(c.lastCheckStatus)}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
                      <p><b>Was:</b> {c.competitorWasPrice !== null ? currency(c.competitorWasPrice) : "-"}</p>
                      <p className={c.competitorPromoPrice !== null ? "font-semibold text-amber-700" : ""}><b>Promo:</b> {c.competitorPromoPrice !== null ? currency(c.competitorPromoPrice) : "-"}</p>
                      <p><b>Stock:</b> {c.competitorStockStatus}</p>
                      <p><b>Checked:</b> {new Date(c.lastCheckedAt).toLocaleString()}</p>
                      <p className={`col-span-2 ${diff.tone}`}><b>Diff vs Bents:</b> {diff.line1}{diff.line2 ? ` · ${diff.line2}` : ""}</p>
                      <p className="col-span-2"><b>Source:</b> {c.extractionSource || "Unknown adapter"}</p>
                      <p className="col-span-2 text-slate-600">{trustNote(c)}</p>
                      {c.checkErrorMessage && <p className="col-span-2 text-amber-700">{c.checkErrorMessage}</p>}
                    </div>

                    {isEditing && <div className="grid gap-2 md:grid-cols-2">
                      <label className="text-xs">Competitor name<Input value={c.competitorName} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorName: e.target.value } : x))} /></label>
                      <label className="text-xs">Competitor URL<Input value={c.competitorProductUrl} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorProductUrl: e.target.value } : x))} /></label>
                      <label className="text-xs">Current price<Input type="number" step="0.01" value={c.competitorCurrentPrice ?? ""} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorCurrentPrice: e.target.value === "" ? null : Number(e.target.value) } : x))} /></label>
                      <label className="text-xs">Promo price<Input type="number" step="0.01" value={c.competitorPromoPrice ?? ""} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorPromoPrice: e.target.value === "" ? null : Number(e.target.value) } : x))} /></label>
                      <label className="text-xs md:col-span-2">Stock status
                        <Select value={c.competitorStockStatus} onChange={(e) => setCompetitorForm((prev) => prev.map((x) => x.id === c.id ? { ...x, competitorStockStatus: e.target.value as CompetitorStockStatus } : x))}>
                          {stockOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </Select>
                      </label>
                    </div>}

                    <div className="flex flex-wrap gap-2">
                      <a href={c.competitorProductUrl || "#"} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">View competitor page</a>
                      <Button onClick={() => runRefresh(undefined, [c.id])} disabled={refreshing}>Refresh this competitor</Button>
                      {isEditing ? <>
                        <Button onClick={() => saveCompetitorEdit(c)}>Save</Button>
                        <Button className="bg-slate-500" onClick={() => { setEditingCompetitorId(null); setCompetitorForm(selected.competitorListings); }}>Cancel</Button>
                      </> : <Button className="bg-slate-700" onClick={() => setEditingCompetitorId(c.id)}>Edit competitor</Button>}
                      <Button className="bg-rose-700" onClick={() => deleteCompetitor(c.id)}>Delete competitor</Button>
                    </div>
                  </div>;
                })}
              </div>
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
