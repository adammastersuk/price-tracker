import { Badge } from "@/components/ui/primitives";
import { PricingStatus, WorkflowStatus } from "@/types/pricing";

export function PricingStatusChip({ status }: { status: PricingStatus }) {
  const color: Record<PricingStatus, string> = {
    "Higher than competitor": "bg-rose-100 text-rose-700",
    "Cheaper than competitor": "bg-emerald-100 text-emerald-700",
    "In line with competitor": "bg-slate-100 text-slate-700",
    "Promo discrepancy": "bg-amber-100 text-amber-800",
    "Competitor out of stock": "bg-violet-100 text-violet-700",
    "Needs review": "bg-orange-100 text-orange-700",
    "Missing competitor data": "bg-red-100 text-red-700"
  };
  return <Badge className={color[status]}>{status}</Badge>;
}

export function WorkflowChip({ status }: { status: WorkflowStatus }) {
  const color: Record<WorkflowStatus, string> = {
    Open: "bg-sky-100 text-sky-700",
    "In Review": "bg-indigo-100 text-indigo-700",
    "Awaiting Supplier": "bg-amber-100 text-amber-700",
    Resolved: "bg-emerald-100 text-emerald-700"
  };
  return <Badge className={color[status]}>{status}</Badge>;
}
