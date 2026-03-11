"use client";

import { useEffect, useState } from "react";
import { PricingStatusChip, WorkflowChip } from "@/components/features/status-chip";
import { Card, CardContent } from "@/components/ui/primitives";
import { exceptionQueue, exceptionReason } from "@/lib/data-service";
import { TrackedProductRow } from "@/types/pricing";

export default function ExceptionsPage() {
  const [rows, setRows] = useState<TrackedProductRow[]>([]);

  useEffect(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => setRows(payload.data ?? []));
  }, []);

  const exceptions = exceptionQueue(rows);

  return <div className="space-y-4"><h2 className="text-xl font-semibold">Exceptions Queue</h2>
    <Card><CardContent className="p-0"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["SKU","Product","Reason","Owner","Workflow"].map((h)=><th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead>
      <tbody>{exceptions.length ? exceptions.map((r)=><tr key={r.id} className="border-t"><td className="px-3 py-2">{r.internalSku}</td><td>{r.productName}</td><td>{exceptionReason(r)} <span className="ml-2"><PricingStatusChip status={r.pricingStatus} /></span></td><td>{r.actionOwner}</td><td><WorkflowChip status={r.actionWorkflowStatus} /></td></tr>) : <tr><td className="px-3 py-5 text-slate-500" colSpan={5}>No exceptions at the moment.</td></tr>}</tbody></table></CardContent></Card>
  </div>;
}
