interface ParsedRow {
  rowNumber: number;
  sku: string;
  productName: string;
  bentsPrice: number;
  bentsUrl: string;
  competitorName?: string;
  competitorUrl?: string;
  buyer?: string;
  supplier?: string;
  department?: string;
  cost?: number;
}

interface ParseResult { rows: ParsedRow[]; skipped: number; errors: string[]; }

export const REQUIRED_HEADERS = ["SKU", "product_name", "Bents_price", "Bents_URL"];
const HEADER_INDEX: Record<string, keyof Omit<ParsedRow, "rowNumber">> = {
  SKU: "sku",
  product_name: "productName",
  Bents_price: "bentsPrice",
  Bents_URL: "bentsUrl",
  competitor_name: "competitorName",
  competitor_URL: "competitorUrl",
  buyer: "buyer",
  supplier: "supplier",
  department: "department",
  cost: "cost"
};

export function parseCsv(csvText: string): ParseResult {
  const lines = csvText.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], skipped: 0, errors: ["The CSV appears empty. Please include a header row and at least one data row."] };
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((requiredHeader) => !headers.includes(requiredHeader));
  if (missingHeaders.length > 0) {
    return { rows: [], skipped: lines.length - 1, errors: [`Missing required columns: ${missingHeaders.join(", ")}. Please use the example CSV template.`] };
  }

  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const rawRowNumber = index + 1;
    const values = lines[index].split(",").map((value) => value.trim());
    const row: Partial<ParsedRow> = { rowNumber: rawRowNumber };

    headers.forEach((header, headerIndex) => {
      const key = HEADER_INDEX[header];
      if (!key) return;
      const value = values[headerIndex] ?? "";
      (row as Record<string, unknown>)[key] = key === "bentsPrice" || key === "cost" ? (value ? Number(value) : undefined) : value;
    });

    const missingFields: string[] = [];
    if (!row.sku) missingFields.push("SKU");
    if (!row.productName) missingFields.push("product_name");
    if (!Number.isFinite(row.bentsPrice)) missingFields.push("Bents_price");
    if (!row.bentsUrl) missingFields.push("Bents_URL");
    if (missingFields.length > 0) {
      skipped += 1;
      errors.push(`Row ${rawRowNumber} was skipped because it's missing: ${missingFields.join(", ")}.`);
      continue;
    }

    rows.push(row as ParsedRow);
  }

  return { rows, skipped, errors };
}
