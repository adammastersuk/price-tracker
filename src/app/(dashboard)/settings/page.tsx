"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui/primitives";

interface Buyer {
  id: string;
  name: string;
  isActive: boolean;
  departments: string[];
}

interface Department {
  id: string;
  name: string;
  buyers: string[];
}

interface Competitor {
  id: string;
  name: string;
  baseUrl: string;
  domain: string;
  adapterKey: string;
  isEnabled: boolean;
}

interface RuntimeSettings {
  scrapeDefaults: { staleCheckHours: number; batchSize: number; defaultRefreshFrequencyHours: number; };
  toleranceSettings: { inLinePricingTolerancePercent: number; suspiciousLowPriceThresholdPercent: number; suspiciousHighPriceThresholdPercent: number; };
}

interface SettingsPayload {
  buyers: Buyer[];
  departments: Department[];
  competitors: Competitor[];
  runtimeSettings: RuntimeSettings;
}

const defaultState: SettingsPayload = {
  buyers: [],
  departments: [],
  competitors: [],
  runtimeSettings: {
    scrapeDefaults: { staleCheckHours: 24, batchSize: 50, defaultRefreshFrequencyHours: 24 },
    toleranceSettings: { inLinePricingTolerancePercent: 3, suspiciousLowPriceThresholdPercent: 35, suspiciousHighPriceThresholdPercent: 80 }
  }
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPayload>(defaultState);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [newBuyer, setNewBuyer] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newCompetitor, setNewCompetitor] = useState({ name: "", baseUrl: "", domain: "", adapterKey: "generic" });

  const load = useCallback(async () => {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Failed to load settings");
    setSettings(payload.data);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  const departmentByName = useMemo(() => new Map(settings.departments.map((d) => [d.name, d.id])), [settings.departments]);

  const runAction = async (action: () => Promise<void>, successText: string) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await action();
      await load();
      setMessage(successText);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-4">
    <div>
      <h2 className="text-xl font-semibold">Settings</h2>
      <p className="text-sm text-slate-600">Internal decision-support configuration only. Competitor prices are reference signals, not automatic repricing instructions.</p>
    </div>

    {message && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
    {error && <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    <Card><CardHeader><CardTitle>Buyers</CardTitle></CardHeader><CardContent className="space-y-3">
      {settings.buyers.map((buyer) => <div key={buyer.id} className="rounded border p-3 space-y-2">
        <div className="grid gap-2 lg:grid-cols-4">
          <Input value={buyer.name} onChange={(e) => setSettings((prev) => ({ ...prev, buyers: prev.buyers.map((b) => b.id === buyer.id ? { ...b, name: e.target.value } : b) }))} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={buyer.isActive} onChange={(e) => setSettings((prev) => ({ ...prev, buyers: prev.buyers.map((b) => b.id === buyer.id ? { ...b, isActive: e.target.checked } : b) }))} /> Active</label>
          <div className="lg:col-span-2 text-sm text-slate-600">Departments: {buyer.departments.join(", ") || "None"}</div>
        </div>
        <div className="flex flex-wrap gap-2">{settings.departments.map((department) => {
          const checked = buyer.departments.includes(department.name);
          return <label key={department.id} className="text-xs rounded border px-2 py-1"><input type="checkbox" className="mr-1" checked={checked} onChange={() => setSettings((prev) => ({ ...prev, buyers: prev.buyers.map((b) => b.id !== buyer.id ? b : { ...b, departments: checked ? b.departments.filter((d) => d !== department.name) : [...b.departments, department.name] } ) }))} />{department.name}</label>;
        })}</div>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => runAction(async () => {
            const response = await fetch(`/api/settings/buyers/${buyer.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: buyer.name, isActive: buyer.isActive, departmentIds: buyer.departments.map((name) => departmentByName.get(name)).filter(Boolean) }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? "Failed to save buyer");
          }, "Buyer saved")}>Save</Button>
          <Button className="bg-rose-700" disabled={busy} onClick={() => runAction(async () => {
            const response = await fetch(`/api/settings/buyers/${buyer.id}`, { method: "DELETE" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? "Failed to delete buyer");
          }, "Buyer deleted")}>Delete</Button>
        </div>
      </div>)}
      <div className="flex flex-wrap gap-2 items-center">
        <Input className="max-w-sm" placeholder="Add buyer" value={newBuyer} onChange={(e) => setNewBuyer(e.target.value)} />
        <Button disabled={busy || !newBuyer.trim()} onClick={() => runAction(async () => {
          const response = await fetch("/api/settings/buyers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newBuyer }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Failed to create buyer");
          setNewBuyer("");
        }, "Buyer created")}>Add buyer</Button>
      </div>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Departments</CardTitle></CardHeader><CardContent className="space-y-2">
      {settings.departments.map((department) => <div key={department.id} className="rounded border p-3 flex flex-wrap items-center gap-2">
        <Input className="max-w-sm" value={department.name} onChange={(e) => setSettings((prev) => ({ ...prev, departments: prev.departments.map((d) => d.id === department.id ? { ...d, name: e.target.value } : d) }))} />
        <p className="text-sm text-slate-600 flex-1">Assigned buyers: {department.buyers.join(", ") || "None"}</p>
        <Button disabled={busy} onClick={() => runAction(async () => {
          const response = await fetch(`/api/settings/departments/${department.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: department.name }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Failed to save department");
        }, "Department saved")}>Save</Button>
        <Button className="bg-rose-700" disabled={busy} onClick={() => runAction(async () => {
          const response = await fetch(`/api/settings/departments/${department.id}`, { method: "DELETE" });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Failed to delete department");
        }, "Department deleted")}>Delete</Button>
      </div>)}
      <div className="flex gap-2 items-center">
        <Input className="max-w-sm" placeholder="Add department" value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} />
        <Button disabled={busy || !newDepartment.trim()} onClick={() => runAction(async () => {
          const response = await fetch("/api/settings/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newDepartment }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Failed to create department");
          setNewDepartment("");
        }, "Department created")}>Add department</Button>
      </div>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Competitors</CardTitle></CardHeader><CardContent className="space-y-2">
      {settings.competitors.map((competitor) => <div key={competitor.id} className="rounded border p-3 grid gap-2 lg:grid-cols-6 items-center">
        <Input value={competitor.name} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, name: e.target.value } : c) }))} />
        <Input value={competitor.baseUrl} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, baseUrl: e.target.value } : c) }))} />
        <Input value={competitor.domain} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, domain: e.target.value } : c) }))} />
        <Input value={competitor.adapterKey} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, adapterKey: e.target.value } : c) }))} />
        <label className="text-sm"><input type="checkbox" className="mr-1" checked={competitor.isEnabled} onChange={(e) => setSettings((prev) => ({ ...prev, competitors: prev.competitors.map((c) => c.id === competitor.id ? { ...c, isEnabled: e.target.checked } : c) }))} />Enabled</label>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => runAction(async () => {
            const response = await fetch(`/api/settings/competitors/${competitor.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(competitor) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? "Failed to save competitor");
          }, "Competitor saved")}>Save</Button>
          <Button className="bg-rose-700" disabled={busy} onClick={() => runAction(async () => {
            const response = await fetch(`/api/settings/competitors/${competitor.id}`, { method: "DELETE" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? "Failed to delete competitor");
          }, "Competitor deleted")}>Delete</Button>
        </div>
      </div>)}
      <div className="grid gap-2 lg:grid-cols-5">
        <Input placeholder="Name" value={newCompetitor.name} onChange={(e) => setNewCompetitor((prev) => ({ ...prev, name: e.target.value }))} />
        <Input placeholder="Base URL" value={newCompetitor.baseUrl} onChange={(e) => setNewCompetitor((prev) => ({ ...prev, baseUrl: e.target.value }))} />
        <Input placeholder="Domain" value={newCompetitor.domain} onChange={(e) => setNewCompetitor((prev) => ({ ...prev, domain: e.target.value }))} />
        <Input placeholder="Adapter key" value={newCompetitor.adapterKey} onChange={(e) => setNewCompetitor((prev) => ({ ...prev, adapterKey: e.target.value }))} />
        <Button disabled={busy || !newCompetitor.name || !newCompetitor.baseUrl || !newCompetitor.domain} onClick={() => runAction(async () => {
          const response = await fetch("/api/settings/competitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newCompetitor, isEnabled: true }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Failed to create competitor");
          setNewCompetitor({ name: "", baseUrl: "", domain: "", adapterKey: "generic" });
        }, "Competitor created")}>Add competitor</Button>
      </div>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Scrape defaults</CardTitle></CardHeader><CardContent className="grid gap-2 lg:grid-cols-4 items-end">
      <label className="text-sm">Stale check hours<Input type="number" min={1} value={settings.runtimeSettings.scrapeDefaults.staleCheckHours} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, scrapeDefaults: { ...prev.runtimeSettings.scrapeDefaults, staleCheckHours: Number(e.target.value) } } }))} /></label>
      <label className="text-sm">Batch size<Input type="number" min={1} value={settings.runtimeSettings.scrapeDefaults.batchSize} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, scrapeDefaults: { ...prev.runtimeSettings.scrapeDefaults, batchSize: Number(e.target.value) } } }))} /></label>
      <label className="text-sm">Default refresh frequency (hours)<Input type="number" min={1} value={settings.runtimeSettings.scrapeDefaults.defaultRefreshFrequencyHours} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, scrapeDefaults: { ...prev.runtimeSettings.scrapeDefaults, defaultRefreshFrequencyHours: Number(e.target.value) } } }))} /></label>
      <Button disabled={busy} onClick={() => runAction(async () => {
        const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "scrape_defaults", value: settings.runtimeSettings.scrapeDefaults }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Failed to save scrape defaults");
      }, "Scrape defaults saved")}>Save scrape defaults</Button>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Tolerance / trust settings</CardTitle></CardHeader><CardContent className="grid gap-2 lg:grid-cols-4 items-end">
      <label className="text-sm">In-line tolerance %<Input type="number" min={0} step="0.1" value={settings.runtimeSettings.toleranceSettings.inLinePricingTolerancePercent} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, toleranceSettings: { ...prev.runtimeSettings.toleranceSettings, inLinePricingTolerancePercent: Number(e.target.value) } } }))} /></label>
      <label className="text-sm">Suspicious low-price threshold %<Input type="number" min={0} step="0.1" value={settings.runtimeSettings.toleranceSettings.suspiciousLowPriceThresholdPercent} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, toleranceSettings: { ...prev.runtimeSettings.toleranceSettings, suspiciousLowPriceThresholdPercent: Number(e.target.value) } } }))} /></label>
      <label className="text-sm">Suspicious high-price threshold %<Input type="number" min={0} step="0.1" value={settings.runtimeSettings.toleranceSettings.suspiciousHighPriceThresholdPercent} onChange={(e) => setSettings((prev) => ({ ...prev, runtimeSettings: { ...prev.runtimeSettings, toleranceSettings: { ...prev.runtimeSettings.toleranceSettings, suspiciousHighPriceThresholdPercent: Number(e.target.value) } } }))} /></label>
      <Button disabled={busy} onClick={() => runAction(async () => {
        const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "tolerance_settings", value: settings.runtimeSettings.toleranceSettings }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Failed to save tolerance settings");
      }, "Tolerance settings saved")}>Save tolerance settings</Button>
    </CardContent></Card>
  </div>;
}
