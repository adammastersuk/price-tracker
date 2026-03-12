import { NextRequest, NextResponse } from "next/server";
import { insertPriceHistory, upsertCompetitorPrice, upsertProductBySku } from "@/lib/db";
import { normalizeBuyerDepartmentAndCompetitor } from "@/lib/settings-normalizers";

interface ParsedRow {
  rowNumber: number;
  sku: string;
  productName: string;
  bentsPrice: number;
  bentsUrl: string;
  competitorName: string;
  competitorUrl: string;
  buyer?: string;
  supplier?: string;
  department?: string;
  cost?: number;
}

interface ParseResult {
  rows: ParsedRow[];
  skipped: number;
  errors: string[];
}

const REQUIRED_HEADERS = ["SKU", "product_name", "Bents_price", "Bents_URL", "competitor_name", "competitor_URL"];
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

function parseCsv(csvText: string): ParseResult {
  const lines = csvText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      rows: [],
      skipped: 0,
      errors: ["The CSV appears empty. Please include a header row and at least one data row."]
    };
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((requiredHeader) => !headers.includes(requiredHeader));

  if (missingHeaders.length > 0) {
    return {
      rows: [],
      skipped: lines.length - 1,
      errors: [`Missing required columns: ${missingHeaders.join(", ")}. Please use the example CSV template.`]
    };
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
      if (!key) {
        return;
      }

      const value = values[headerIndex] ?? "";
      if (key === "bentsPrice" || key === "cost") {
        (row as Record<string, unknown>)[key] = value ? Number(value) : undefined;
      } else {
        (row as Record<string, unknown>)[key] = value;
      }
    });

    const missingFields: string[] = [];
    if (!row.sku) missingFields.push("SKU");
    if (!row.productName) missingFields.push("product_name");
    if (!Number.isFinite(row.bentsPrice)) missingFields.push("Bents_price");
    if (!row.bentsUrl) missingFields.push("Bents_URL");
    if (!row.competitorName) missingFields.push("competitor_name");
    if (!row.competitorUrl) missingFields.push("competitor_URL");

    if (missingFields.length > 0) {
      skipped += 1;
      errors.push(`Row ${rawRowNumber} was skipped because it's missing: ${missingFields.join(", ")}.`);
      continue;
    }

    rows.push(row as ParsedRow);
  }

  return { rows, skipped, errors };
}

function calculateMarginPercent(bentsPrice: number, cost?: number): number | undefined {
  if (!Number.isFinite(cost) || !Number.isFinite(bentsPrice) || bentsPrice <= 0) return undefined;
  return Number((((bentsPrice - Number(cost)) / bentsPrice) * 100).toFixed(2));
}

export async function POST(request: NextRequest) {
  try {
    const { csvText } = await request.json();
    const parsed = parseCsv(csvText ?? "");

    if (!parsed.rows.length) {
      return NextResponse.json({ error: parsed.errors[0] ?? "No valid rows found in CSV.", skipped: parsed.skipped, errors: parsed.errors }, { status: 400 });
    }

    let imported = 0;
    let failed = 0;
    const errors = [...parsed.errors];

    for (const row of parsed.rows) {
      try {
        const normalized = await normalizeBuyerDepartmentAndCompetitor({
          buyer: row.buyer,
          department: row.department,
          competitorName: row.competitorName
        });

        const upserted = await upsertProductBySku({
          sku: row.sku,
          name: row.productName,
          bents_price: row.bentsPrice,
          product_url: row.bentsUrl,
          buyer: normalized.buyer,
          supplier: row.supplier,
          department: normalized.department,
          cost_price: row.cost,
          margin_percent: calculateMarginPercent(row.bentsPrice, row.cost)
        });
        const productId = upserted[0].id;
        await upsertCompetitorPrice({
          product_id: productId,
          competitor_name: normalized.competitorName ?? row.competitorName,
          competitor_url: row.competitorUrl,
          pricing_status: "Needs review"
        });

        await insertPriceHistory({
          product_id: productId,
          competitor_name: normalized.competitorName ?? row.competitorName
        });

        imported += 1;
      } catch (error) {
        failed += 1;
        errors.push(`Row ${row.rowNumber} could not be imported. Please check the values and try again.`);
        console.error("CSV import row failed", error);
      }
    }

    return NextResponse.json({
      imported,
      skipped: parsed.skipped,
      failed,
      errors
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
