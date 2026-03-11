import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";

export function DashboardCards({ stats }: { stats: Record<string, number> }) {
  const entries = [
    ["Total tracked", stats.total],
    ["Checked today", stats.checkedToday],
    ["Higher than competitor", stats.higher],
    ["Cheaper than competitor", stats.cheaper],
    ["Promo discrepancy", stats.promoDiscrepancy],
    ["Unresolved review items", stats.unresolved]
  ];
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{entries.map(([k,v]) => <Card key={String(k)}><CardHeader><CardTitle>{k}</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{v}</p></CardContent></Card>)}</div>;
}
