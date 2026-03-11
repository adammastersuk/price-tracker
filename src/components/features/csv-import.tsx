"use client";

import { useMemo, useRef, useState } from "react";
import { Button, Card, CardContent } from "@/components/ui/primitives";

const REQUIRED_HEADERS = ["SKU", "product_name", "Bents_price", "Bents_URL", "competitor_name", "competitor_URL"];
const OPTIONAL_HEADERS = ["buyer", "supplier", "department", "cost"];
const EXPECTED_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];

const EXAMPLE_CSV = [
  EXPECTED_HEADERS.join(","),
  "BEN-1001,Bents 1L Whole Milk,1.45,https://www.bents.co.uk/products/ben-1001,Tesco,https://www.tesco.com/groceries/en-GB/products/299123456,Jane Carter,Dairy Partners,Chilled,0.95",
  "BEN-2042,Bents Sourdough Loaf,2.1,https://www.bents.co.uk/products/ben-2042,Sainsbury's,https://www.sainsburys.co.uk/gol-ui/product/sourdough-loaf-800g,Tom Singh,Bakers United,Bakery,1.25",
  "BEN-3308,Bents Colombian Ground Coffee 227g,4.75,https://www.bents.co.uk/products/ben-3308,Asda,https://groceries.asda.com/product/coffee/colombian-ground-coffee/1000382219910,Sarah Moss,Casa Roasters,Hot Drinks,3.1"
].join("\n");

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

function validateCsvText(csvText: string): ValidationResult {
  const lines = csvText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      isValid: false,
      errors: ["The CSV looks empty. Please include a header row and at least one product row."]
    };
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((requiredHeader) => !headers.includes(requiredHeader));

  if (missingHeaders.length > 0) {
    return {
      isValid: false,
      errors: [`Missing required columns: ${missingHeaders.join(", ")}. Please use the example template.`]
    };
  }

  return { isValid: true, errors: [] };
}

export function CsvImport({ onImported }: { onImported: () => Promise<void> }) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedFileName = useMemo(() => selectedFile?.name ?? "No file selected", [selectedFile]);

  const chooseFile = () => fileInputRef.current?.click();

  const handleFileSelected = (file: File | null) => {
    setFeedback("");
    setValidationErrors([]);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setSelectedFile(null);
      setValidationErrors(["Please select a .csv file."]);
      return;
    }

    setSelectedFile(file);
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([EXAMPLE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "products-import-example.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!selectedFile) {
      setValidationErrors(["Please choose a CSV file before importing."]);
      return;
    }

    setIsImporting(true);
    setFeedback("");
    setValidationErrors([]);

    try {
      const csvText = await selectedFile.text();
      const validation = validateCsvText(csvText);

      if (!validation.isValid) {
        setValidationErrors(validation.errors);
        return;
      }

      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText })
      });

      const payload = await response.json();

      if (!response.ok) {
        setValidationErrors([payload.error ?? "We couldn't import that file. Please check the format and try again."]);
        return;
      }

      const failed = Number(payload.failed ?? 0);
      const skipped = Number(payload.skipped ?? 0);
      const imported = Number(payload.imported ?? 0);
      const rowErrors: string[] = Array.isArray(payload.errors) ? payload.errors : [];

      setFeedback(`Import complete: ${imported} row${imported === 1 ? "" : "s"} imported, ${skipped + failed} row${skipped + failed === 1 ? "" : "s"} skipped.`);
      setValidationErrors(rowErrors);
      await onImported();
    } catch {
      setValidationErrors(["Something went wrong while reading your file. Please try again."]);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-semibold">CSV Import</h3>
          <p className="mt-1 text-sm text-slate-600">Upload a CSV file using the template provided.</p>
          <p className="text-sm text-slate-600">Required columns: SKU, product_name, Bents_price, Bents_URL, competitor_name, competitor_URL</p>
          <p className="text-sm text-slate-600">Optional columns: buyer, supplier, department, cost</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" className="bg-slate-800" onClick={handleDownloadTemplate}>
            Download example CSV
          </Button>
          <Button type="button" onClick={chooseFile}>
            Choose CSV file
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => handleFileSelected(event.target.files?.[0] ?? null)}
          />
        </div>

        <button
          type="button"
          onClick={chooseFile}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            handleFileSelected(event.dataTransfer.files?.[0] ?? null);
          }}
          className={`w-full rounded-xl border-2 border-dashed p-4 text-left transition ${dragActive ? "border-primary bg-blue-50" : "border-slate-300 bg-slate-50"}`}
        >
          <p className="text-sm font-medium text-slate-700">Drag and drop a CSV file here, or click to browse.</p>
          <p className="mt-2 text-xs text-slate-500">Selected file: {selectedFileName}</p>
        </button>

        <div className="flex flex-wrap items-start gap-3">
          <Button type="button" disabled={!selectedFile || isImporting} onClick={handleImport}>
            {isImporting ? "Importing..." : "Import CSV"}
          </Button>
          {feedback ? <p className="text-sm text-emerald-700">{feedback}</p> : null}
        </div>

        {validationErrors.length > 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Please check your CSV file:</p>
            <ul className="mt-1 list-disc pl-5">
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
