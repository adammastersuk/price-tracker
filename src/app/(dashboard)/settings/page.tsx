"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui/primitives";

interface Buyer { id: string; name: string; isActive: boolean; departments: string[]; usedByProducts: number; }
interface Department { id: string; name: string; buyers: string[]; usedByProducts: number; }
interface Competitor { id: string; name: string; baseUrl: string; domain: string; adapterKey: string; isEnabled: boolean; usedByProducts: number; }
interface RuntimeSettings {
  scrapeDefaults: { staleCheckHours: number; batchSize: number; defaultRefreshFrequencyHours: number; };
  toleranceSettings: { inLinePricingTolerancePercent: number; suspiciousLowPriceThresholdPercent: number; suspiciousHighPriceThresholdPercent: number; };
}
interface SettingsPayload { buyers: Buyer[]; departments: Department[]; competitors: Competitor[]; runtimeSettings: RuntimeSettings; }

const defaultState: SettingsPayload = { buyers: [], departments: [], competitors: [], runtimeSettings: { scrapeDefaults: { staleCheckHours: 24, batchSize: 50, defaultRefreshFrequencyHours: 24 }, toleranceSettings: { inLinePricingTolerancePercent: 3, suspiciousLowPriceThresholdPercent: 35, suspiciousHighPriceThresholdPercent: 80 } } };

function AccordionSection({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <Card>
    <button type="button" onClick={onToggle} className="flex w-full items-center justify-between p-5 text-left">
      <h3 className="text-sm font-medium text-slate-700">{title} ({count})</h3>
      <span className="text-xs text-slate-500">{open ? "Hide" : "Show"}</span>
    </button>
    {open ? <CardContent className="pt-0">{children}</CardContent> : null}
  </Card>;
}


export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPayload>(defaultState);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newBuyer, setNewBuyer] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newCompetitor, setNewCompetitor] = useState({ name: "", baseUrl: "", domain: "", adapterKey: "generic" });
  const [editingBuyerId, setEditingBuyerId] = useState<string | null>(null);
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingCompetitorId, setEditingCompetitorId] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<"buyers" | "departments" | "competitors" | null>("buyers");

  const load = useCallback(async () => {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Failed to load settings");
    setSettings(payload.data);
  }, []);

  useEffect(() => { load().catch((err) => setError(err.message)); }, [load]);

  const departmentByName = useMemo(() => new Map(settings.departments.map((d) => [d.name, d.id])), [settings.departments]);

  const runAction = async (action: () => Promise<void>, successText: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); await load(); setMessage(successText); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <div>
      <h2 className="text-xl font-semibold">Settings</h2>
      <p className="text-sm text-slate-600">Internal decision-support configuration only. Competitor prices are reference signals, not automatic repricing instructions.</p>
      <p className="text-sm text-slate-600">These settings drive import matching and product filters. Unmatched import values are flagged with warnings and are never auto-created.</p>
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      <Card><CardContent className="p-4"><p className="text-xs uppercase text-slate-500">Buyers</p><p className="text-2xl font-semibold">{settings.buyers.length}</p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-xs uppercase text-slate-500">Departments</p><p className="text-2xl font-semibold">{settings.departments.length}</p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-xs uppercase text-slate-500">Competitors</p><p className="text-2xl font-semibold">{settings.competitors.length}</p></CardContent></Card>
    </div>

    {message && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
    {error && <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    <AccordionSection title="Buyers" count={settings.buyers.length} open={openSection === "buyers"} onToggle={() => setOpenSection((prev) => prev === "buyers" ? null : "buyers")}>
      <div className="space-y-3">
      <p className="text-sm text-slate-600">Manage buyers and assigned departments. Duplicate names are blocked using normalized matching.</p>
      {settings.buyers.map((buyer) => <div key={buyer.id} className="rounded border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{buyer.name}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge className={buyer.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}>{buyer.isActive ? "Active" : "Inactive"}</Badge>
              <Badge className="bg-slate-100 text-slate-700">Used by {buyer.usedByProducts} products</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">{buyer.departments.length ? buyer.departments.map((dept) => <Badge key={dept} className="bg-blue-50 text-blue-700">{dept}</Badge>) : <span className="text-xs text-slate-500">No departments assigned</span>}</div>
          </div>
          <div className="flex gap-2">
            <Button className="bg-slate-700" onClick={() => setEditingBuyerId(editingBuyerId === buyer.id ? null : buyer.id)}>Edit</Button>
            <Button className="bg-rose-700" disabled={busy || buyer.usedByProducts > 0} title={buyer.usedByProducts > 0 ? "Reassign products before deleting this buyer." : "Delete buyer"} onClick={() => runAction(async () => {
              const response = await fetch(`/api/settings/buyers/${buyer.id}`, { method: "DELETE" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to delete buyer");
            }, "Buyer deleted")}>Delete</Button>
          </div>
        </div>
        {editingBuyerId === buyer.id ? <div className="mt-3 space-y-2 border-t pt-3">
          <Input value={buyer.name} onChange={(e) => setSettings((prev) => ({ ...prev, buyers: prev.buyers.map((b) => b.id === buyer.id ? { ...b, name: e.target.value } : b) }))} />
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={buyer.isActive} onChange={(e) => setSettings((prev) => ({ ...prev, buyers: prev.buyers.map((b) => b.id === buyer.id ? { ...b, isActive: e.target.checked } : b) }))} /> Active</label>
          <div className="flex flex-wrap gap-2">{settings.departments.map((department) => {
            const checked = buyer.departments.includes(department.name);
            return <button key={department.id} type="button" className={`text-xs rounded-full border px-2 py-1 ${checked ? "bg-blue-50 border-blue-300" : "bg-white"}`} onClick={() => setSettings((prev) => ({ ...prev, buyers: prev.buyers.map((b) => b.id !== buyer.id ? b : { ...b, departments: checked ? b.departments.filter((d) => d !== department.name) : [...b.departments, department.name] }) }))}>{department.name}</button>;
          })}</div>
          <div className="flex gap-2"><Button disabled={busy} onClick={() => runAction(async () => {
            const response = await fetch(`/api/settings/buyers/${buyer.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: buyer.name, isActive: buyer.isActive, departmentIds: buyer.departments.map((name) => departmentByName.get(name)).filter(Boolean) }) });
            const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to save buyer"); setEditingBuyerId(null);
          }, "Buyer saved")}>Save</Button><Button className="bg-slate-600" onClick={() => setEditingBuyerId(null)}>Cancel</Button></div>
        </div> : null}
      </div>)}
      <div className="flex flex-wrap gap-2 items-center border-t pt-3">
        <Input className="max-w-sm" placeholder="Add buyer" value={newBuyer} onChange={(e) => setNewBuyer(e.target.value)} />
        <Button disabled={busy || !newBuyer.trim()} onClick={() => runAction(async () => {
          const response = await fetch("/api/settings/buyers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newBuyer, isActive: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to create buyer"); setNewBuyer("");
        }, "Buyer created")}>Add buyer</Button>
      </div>
      </div>
    </AccordionSection>

    <AccordionSection title="Departments" count={settings.departments.length} open={openSection === "departments"} onToggle={() => setOpenSection((prev) => prev === "departments" ? null : "departments")}>
      <div className="space-y-3">
      {settings.departments.map((department) => <div key={department.id} className="rounded border p-3">
        <div className="flex items-center justify-between gap-2">
          <div><p className="font-medium">{department.name}</p><p className="text-xs text-slate-500">Assigned buyers: {department.buyers.join(", ") || "None"}</p><p className="text-xs text-slate-500">Used by {department.usedByProducts} products</p></div>
          <div className="flex gap-2"><Button className="bg-slate-700" onClick={() => setEditingDepartmentId(editingDepartmentId === department.id ? null : department.id)}>Edit</Button>
            <Button className="bg-rose-700" disabled={busy || department.usedByProducts > 0} onClick={() => runAction(async () => {
              const response = await fetch(`/api/settings/departments/${department.id}`, { method: "DELETE" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to delete department");
            }, "Department deleted")}>Delete</Button></div>
        </div>
        {editingDepartmentId === department.id ? <div className="mt-3 flex gap-2"><Input value={department.name} onChange={(e) => setSettings((prev) => ({ ...prev, departments: prev.departments.map((d) => d.id === department.id ? { ...d, name: e.target.value } : d) }))} /><Button onClick={() => runAction(async () => {
          const response = await fetch(`/api/settings/departments/${department.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: department.name }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to save department"); setEditingDepartmentId(null);
        }, "Department saved")}>Save</Button></div> : null}
      </div>)}
      <div className="flex gap-2 items-center border-t pt-3"><Input className="max-w-sm" placeholder="Add department" value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} /><Button disabled={busy || !newDepartment.trim()} onClick={() => runAction(async () => {
        const response = await fetch("/api/settings/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newDepartment }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to create department"); setNewDepartment("");
      }, "Department created")}>Add department</Button></div>
      </div>
    </AccordionSection>

    <AccordionSection title="Competitors" count={settings.competitors.length} open={openSection === "competitors"} onToggle={() => setOpenSection((prev) => prev === "competitors" ? null : "competitors")}>
      <div className="space-y-3">
      <p className="text-sm text-slate-600">Matching prioritizes competitor URL/domain first, then competitor name.</p>
      {settings.competitors.map((competitor) => <div key={competitor.id} className="rounded border p-3">
        <div className="grid gap-2 md:grid-cols-5 md:items-center">
          <div className="md:col-span-2"><p className="font-medium">{competitor.name}</p><p className="text-xs text-slate-500">{competitor.domain}</p></div>
          <p className="text-xs text-slate-600">Adapter: {competitor.adapterKey}</p>
          <Badge className={competitor.isEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}>{competitor.isEnabled ? "Enabled" : "Disabled"}</Badge>
          <p className="text-xs text-slate-600">Used by {competitor.usedByProducts} listings</p>
        </div>
        <div className="mt-2 flex gap-2"><Button className="bg-slate-700" onClick={() => setEditingCompetitorId(editingCompetitorId === competitor.id ? null : competitor.id)}>Edit</Button>
          <Button className="bg-rose-700" disabled={busy || competitor.usedByProducts > 0} onClick={() => runAction(async () => {
            const response = await fetch(`/api/settings/competitors/${competitor.id}`, { method: "DELETE" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to delete competitor");
          }, "Competitor deleted")}>Delete</Button></div>
        {editingCompetitorId === competitor.id ? <div className="mt-3 grid gap-2 lg:grid-cols-5 border-t pt-3">
          <Input value={competitor.name} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, name: e.target.value } : c) }))} />
          <Input value={competitor.baseUrl} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, baseUrl: e.target.value } : c) }))} />
          <Input value={competitor.domain} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, domain: e.target.value } : c) }))} />
          <Input value={competitor.adapterKey} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, adapterKey: e.target.value } : c) }))} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={competitor.isEnabled} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, isEnabled: e.target.checked } : c) }))} /> Enabled</label>
          <div className="lg:col-span-5"><Button onClick={() => runAction(async () => {
            const response = await fetch(`/api/settings/competitors/${competitor.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(competitor) });
            const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to save competitor"); setEditingCompetitorId(null);
          }, "Competitor saved")}>Save competitor</Button></div>
        </div> : null}
      </div>)}
      <div className="grid gap-2 lg:grid-cols-5 border-t pt-3">
        <Input placeholder="Name" value={newCompetitor.name} onChange={(e) => setNewCompetitor((prev) => ({ ...prev, name: e.target.value }))} />
        <Input placeholder="Base URL" value={newCompetitor.baseUrl} onChange={(e) => setNewCompetitor((prev) => ({ ...prev, baseUrl: e.target.value }))} />
        <Input placeholder="Domain" value={newCompetitor.domain} onChange={(e) => setNewCompetitor((prev) => ({ ...prev, domain: e.target.value }))} />
        <Input placeholder="Adapter key" value={newCompetitor.adapterKey} onChange={(e) => setNewCompetitor((prev) => ({ ...prev, adapterKey: e.target.value }))} />
        <Button disabled={busy || !newCompetitor.name || !newCompetitor.baseUrl || !newCompetitor.domain} onClick={() => runAction(async () => {
          const response = await fetch("/api/settings/competitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newCompetitor, isEnabled: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to create competitor"); setNewCompetitor({ name: "", baseUrl: "", domain: "", adapterKey: "generic" });
        }, "Competitor created")}>Add competitor</Button>
      </div>
      </div>
    </AccordionSection>

    <Card><CardHeader><CardTitle>Scrape defaults</CardTitle></CardHeader><CardContent className="grid gap-2 lg:grid-cols-4 items-end">
      <label className="text-sm">Stale check hours<p className="text-xs text-slate-500">Age before listings are treated as stale for refresh queues.</p><Input type="number" min={1} value={settings.runtimeSettings.scrapeDefaults.staleCheckHours} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, scrapeDefaults: { ...prev.runtimeSettings.scrapeDefaults, staleCheckHours: Number(e.target.value) } } }))} /></label>
      <label className="text-sm">Batch size<p className="text-xs text-slate-500">How many products are checked per run.</p><Input type="number" min={1} value={settings.runtimeSettings.scrapeDefaults.batchSize} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, scrapeDefaults: { ...prev.runtimeSettings.scrapeDefaults, batchSize: Number(e.target.value) } } }))} /></label>
      <label className="text-sm">Default refresh frequency (hours)<p className="text-xs text-slate-500">Default revisit cadence for competitor checks.</p><Input type="number" min={1} value={settings.runtimeSettings.scrapeDefaults.defaultRefreshFrequencyHours} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, scrapeDefaults: { ...prev.runtimeSettings.scrapeDefaults, defaultRefreshFrequencyHours: Number(e.target.value) } } }))} /></label>
      <Button disabled={busy} onClick={() => runAction(async () => {
        const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "scrape_defaults", value: settings.runtimeSettings.scrapeDefaults }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to save scrape defaults");
      }, "Scrape defaults saved")}>Save scrape defaults</Button>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Tolerance / trust settings</CardTitle></CardHeader><CardContent className="grid gap-2 lg:grid-cols-4 items-end">
      <label className="text-sm">In-line tolerance %<p className="text-xs text-slate-500">Threshold for in-line pricing flags.</p><Input type="number" min={0} step="0.1" value={settings.runtimeSettings.toleranceSettings.inLinePricingTolerancePercent} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, toleranceSettings: { ...prev.runtimeSettings.toleranceSettings, inLinePricingTolerancePercent: Number(e.target.value) } } }))} /></label>
      <label className="text-sm">Suspicious low-price threshold %<p className="text-xs text-slate-500">Detect unusually low extracted competitor values.</p><Input type="number" min={0} step="0.1" value={settings.runtimeSettings.toleranceSettings.suspiciousLowPriceThresholdPercent} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, toleranceSettings: { ...prev.runtimeSettings.toleranceSettings, suspiciousLowPriceThresholdPercent: Number(e.target.value) } } }))} /></label>
      <label className="text-sm">Suspicious high-price threshold %<p className="text-xs text-slate-500">Detect unusually high extracted competitor values.</p><Input type="number" min={0} step="0.1" value={settings.runtimeSettings.toleranceSettings.suspiciousHighPriceThresholdPercent} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, toleranceSettings: { ...prev.runtimeSettings.toleranceSettings, suspiciousHighPriceThresholdPercent: Number(e.target.value) } } }))} /></label>
      <Button disabled={busy} onClick={() => runAction(async () => {
        const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "tolerance_settings", value: settings.runtimeSettings.toleranceSettings }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Failed to save tolerance settings");
      }, "Tolerance settings saved")}>Save tolerance settings</Button>
    </CardContent></Card>
  </div>;
}
