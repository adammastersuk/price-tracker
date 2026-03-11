"use client";
import { useState } from "react";
import { Button, Card, CardContent, Input } from "@/components/ui/primitives";

export function CsvImport() {
  const [text, setText] = useState("SKU,product name,Bents price,Bents URL,competitor name,competitor URL,buyer,supplier,department,cost");
  const [message, setMessage] = useState("");

  const handleImport = () => {
    const rows = text.split("\n").filter(Boolean);
    if (rows.length < 2) return setMessage("Please paste CSV rows beneath the header.");
    setMessage(`Imported ${rows.length - 1} rows to demo session successfully.`);
  };

  return <Card><CardContent className="space-y-3"><h3 className="font-semibold">CSV Import</h3>
    <p className="text-sm text-slate-600">Import initial datasets for onboarding categories (demo parser in phase 1).</p>
    <textarea className="h-32 w-full rounded-lg border p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
    <div className="flex gap-2"><Button onClick={handleImport}>Validate & Import</Button><Input readOnly value={message} className="text-xs" /></div>
  </CardContent></Card>;
}
