import { Badge } from "@/components/ui/primitives";
import { PricingStatus, WorkflowStatus } from "@/types/pricing";

type DashboardStatusLabel = PricingStatus | "Cheaper than Bents" | "Price gap" | "Check failed";

export function PricingStatusChip({ status }: { status: DashboardStatusLabel }) {
  const color: Record<DashboardStatusLabel, string> = {
    "Higher than competitor": "border border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/35 dark:text-rose-200",
    "Cheaper than competitor": "border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/35 dark:text-emerald-200",
    "Cheaper than Bents": "border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/35 dark:text-emerald-200",
    "In line with competitor": "border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-700/60 dark:text-slate-100",
    "Promo discrepancy": "border border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/35 dark:text-amber-200",
    "Competitor out of stock": "border border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-700/40 dark:bg-violet-900/35 dark:text-violet-200",
    "Needs review": "border border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-700/40 dark:bg-orange-900/35 dark:text-orange-200",
    "Missing competitor data": "border border-red-200 bg-red-100 text-red-700 dark:border-red-700/40 dark:bg-red-900/35 dark:text-red-200",
    "Price gap": "border border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-700/40 dark:bg-sky-900/35 dark:text-sky-200",
    "Check failed": "border border-red-200 bg-red-100 text-red-700 dark:border-red-700/40 dark:bg-red-900/35 dark:text-red-200"
  };
  return <Badge className={color[status]}>{status}</Badge>;
}

export function WorkflowChip({ status }: { status: WorkflowStatus }) {
  const color: Record<WorkflowStatus, string> = {
    Open: "border border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-700/40 dark:bg-sky-900/35 dark:text-sky-200",
    Monitoring: "border border-indigo-200 bg-indigo-100 text-indigo-700 dark:border-indigo-700/40 dark:bg-indigo-900/35 dark:text-indigo-200",
    Reviewed: "border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/35 dark:text-emerald-200",
    "No Action": "border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-700/60 dark:text-slate-100",
    Closed: "border border-slate-700 bg-slate-800 text-white dark:border-slate-500 dark:bg-slate-500 dark:text-slate-50",
    "In Review": "border border-indigo-200 bg-indigo-100 text-indigo-700 dark:border-indigo-700/40 dark:bg-indigo-900/35 dark:text-indigo-200",
    "Awaiting Supplier": "border border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/35 dark:text-amber-200",
    Resolved: "border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/35 dark:text-emerald-200"
  };
  return <Badge className={color[status]}>{status}</Badge>;
}
