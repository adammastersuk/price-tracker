import { Badge } from "@/components/ui/primitives";
import { PricingStatus, WorkflowStatus } from "@/types/pricing";

export function PricingStatusChip({ status }: { status: PricingStatus }) {
  const color: Record<PricingStatus, string> = {
    "Higher than competitor": "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
    "Cheaper than competitor": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    "In line with competitor": "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-100",
    "Promo discrepancy": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    "Competitor out of stock": "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
    "Needs review": "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200",
    "Missing competitor data": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
  };
  return <Badge className={color[status]}>{status}</Badge>;
}

export function WorkflowChip({ status }: { status: WorkflowStatus }) {
  const color: Record<WorkflowStatus, string> = {
    Open: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
    Monitoring: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200",
    Reviewed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    "No Action": "bg-slate-200 text-slate-700 dark:bg-slate-700/70 dark:text-slate-100",
    Closed: "bg-slate-800 text-white dark:bg-slate-600 dark:text-slate-100",
    "In Review": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200",
    "Awaiting Supplier": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    Resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
  };
  return <Badge className={color[status]}>{status}</Badge>;
}
