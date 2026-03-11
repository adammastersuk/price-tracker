import { DashboardCards } from "@/components/features/dashboard-cards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { dashboardStats } from "@/lib/data-service";

export default function DashboardPage() {
  const stats = dashboardStats();
  return (
    <div className="space-y-5">
      <DashboardCards stats={stats} />
      <Card><CardHeader><CardTitle>Operational focus</CardTitle></CardHeader><CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Use competitor pricing as one input alongside margin, stock and supplier terms.</li>
          <li>Prioritise unresolved items and promo discrepancies for review meetings.</li>
          <li>Export filtered views for category and supplier conversations.</li>
        </ul>
      </CardContent></Card>
    </div>
  );
}
