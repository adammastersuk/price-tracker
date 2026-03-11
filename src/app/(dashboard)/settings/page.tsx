import { Card, CardContent, CardHeader, CardTitle, Input, Select } from "@/components/ui/primitives";

const sections = ["Competitor sources","Import settings","Scrape schedule","Tolerance settings","User permissions","Adapter configuration"];

export default function SettingsPage() {
  return <div className="space-y-4"><h2 className="text-xl font-semibold">Settings</h2>
    <div className="grid gap-4 lg:grid-cols-2">{sections.map((s)=><Card key={s}><CardHeader><CardTitle>{s}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      <Input placeholder={`${s} placeholder`} />
      <Select><option>Demo mode</option><option>Future live integration</option></Select>
    </CardContent></Card>)}</div>
  </div>;
}
