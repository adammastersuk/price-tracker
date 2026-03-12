import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";

interface DashboardMetric {
  label: string;
  value: number;
  tone?: "neutral" | "alert";
}

export function DashboardCards({ metrics }: { metrics: DashboardMetric[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric.label}>
          <CardHeader>
            <CardTitle>{metric.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-semibold ${metric.tone === "alert" ? "text-rose-700" : "text-slate-900"}`}>{metric.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
