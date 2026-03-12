import { NextRequest, NextResponse } from "next/server";
import { getSettingsConfig, insertPriceHistory, upsertCompetitorPrice, upsertProductBySku } from "@/lib/db";
import { canonicalizeDomain, looksLikeValidUrl, withAliases } from "@/lib/matching";
import { logActivity } from "@/lib/operations";

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

interface ParseResult { rows: ParsedRow[]; skipped: number; errors: string[]; }
interface RowMessage { rowNumber: number; message: string; }

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

function pickMappedValue(raw: string | undefined, map: Map<string, string>) {
  if (!raw?.trim()) return { mapped: undefined, matched: true };
  const trimmed = raw.trim();
  if (map.has(trimmed)) return { mapped: map.get(trimmed), matched: true };
  const lower = trimmed.toLowerCase();
  const lowerMatch = [...map.entries()].find(([key]) => key.toLowerCase() === lower);
  if (lowerMatch) return { mapped: lowerMatch[1], matched: true };
  const loose = withAliases(trimmed);
  const looseMatch = [...map.entries()].find(([key]) => withAliases(key) === loose);
  if (looseMatch) return { mapped: looseMatch[1], matched: true };
  return { mapped: trimmed, matched: false };
}

export async function POST(request: NextRequest) {
  try {
    const { csvText, preview } = await request.json();
    const parsed = parseCsv(csvText ?? "");
    if (!parsed.rows.length) {
      return NextResponse.json({ error: parsed.errors[0] ?? "No valid rows found in CSV.", skipped: parsed.skipped, errors: parsed.errors }, { status: 400 });
    }

    const settings = await getSettingsConfig();
    const buyerMap = new Map(settings.buyers.map((item) => [item.name, item.name]));
    const departmentMap = new Map(settings.departments.map((item) => [item.name, item.name]));
    const competitorNameMap = new Map(settings.competitors.map((item) => [item.name, item.name]));
    const competitorDomainMap = new Map(settings.competitors.map((item) => [canonicalizeDomain(item.domain), item.name]));

    const rowWarnings: RowMessage[] = [];
    const rowErrors: RowMessage[] = parsed.errors.map((message) => ({ rowNumber: 0, message }));
    const unmatchedBuyers = new Set<string>();
    const unmatchedDepartments = new Set<string>();
    const unmatchedCompetitors = new Set<string>();

    const prepared = parsed.rows.map((row) => {
      const errors: string[] = [];
      const warnings: string[] = [];

      if (!looksLikeValidUrl(row.bentsUrl)) errors.push("Missing or invalid Bents_URL (blocking).");
      if (!looksLikeValidUrl(row.competitorUrl)) errors.push("Missing or invalid competitor_URL (blocking).");

      const buyerResult = pickMappedValue(row.buyer, buyerMap);
      if (row.buyer && !buyerResult.matched) {
        warnings.push(`Unmatched buyer: ${row.buyer.trim()}`);
        unmatchedBuyers.add(row.buyer.trim());
      }

      const departmentResult = pickMappedValue(row.department, departmentMap);
      if (row.department && !departmentResult.matched) {
        warnings.push(`Unmatched department: ${row.department.trim()}`);
        unmatchedDepartments.add(row.department.trim());
      }

      const competitorDomain = canonicalizeDomain(row.competitorUrl);
      let competitorName = competitorDomainMap.get(competitorDomain);
      if (!competitorName) {
        const byName = pickMappedValue(row.competitorName, competitorNameMap);
        competitorName = byName.mapped ?? row.competitorName.trim();
        if (!byName.matched) {
          warnings.push(`Unconfigured competitor: ${row.competitorName.trim()}`);
          unmatchedCompetitors.add(row.competitorName.trim());
        }
      }

      if (errors.length) errors.forEach((message) => rowErrors.push({ rowNumber: row.rowNumber, message }));
      if (warnings.length) warnings.forEach((message) => rowWarnings.push({ rowNumber: row.rowNumber, message }));

      return {
        ...row,
        buyer: buyerResult.mapped,
        department: departmentResult.mapped,
        competitorName: competitorName ?? row.competitorName.trim(),
        hasError: errors.length > 0,
        hasWarning: warnings.length > 0
      };
    });

    const summary = {
      rowsValid: prepared.filter((row) => !row.hasError && !row.hasWarning).length,
      rowsWithWarnings: prepared.filter((row) => !row.hasError && row.hasWarning).length,
      rowsWithErrors: prepared.filter((row) => row.hasError).length,
      unmatchedBuyers: [...unmatchedBuyers],
      unmatchedDepartments: [...unmatchedDepartments],
      unmatchedCompetitors: [...unmatchedCompetitors],
      previewRows: [...rowErrors, ...rowWarnings].slice(0, 5)
    };

    if (preview) {
      return NextResponse.json({ ok: true, skipped: parsed.skipped, summary, warnings: rowWarnings, errors: rowErrors });
    }

    let imported = 0;
    let failed = 0;

    for (const row of prepared) {
      if (row.hasError) {
        failed += 1;
        continue;
      }
      try {
        const upserted = await upsertProductBySku({
          sku: row.sku,
          name: row.productName,
          bents_price: row.bentsPrice,
          product_url: row.bentsUrl,
          buyer: row.buyer,
          supplier: row.supplier,
          department: row.department,
          cost_price: row.cost,
          margin_percent: calculateMarginPercent(row.bentsPrice, row.cost)
        });

        const productId = upserted[0].id;
        await upsertCompetitorPrice({
          product_id: productId,
          competitor_name: row.competitorName,
          competitor_url: row.competitorUrl,
          pricing_status: "Needs review"
        });
        await insertPriceHistory({ product_id: productId, competitor_name: row.competitorName });
        imported += 1;
      } catch (error) {
        failed += 1;
        rowErrors.push({ rowNumber: row.rowNumber, message: "Row could not be imported. Please check the values and try again." });
        console.error("CSV import row failed", error);
      }
    }

    await logActivity({ event_type: "csv_import", entity_type: "import", summary: `CSV import completed (${imported} imported, ${failed} failed, ${parsed.skipped} skipped).`, metadata: { imported, failed, skipped: parsed.skipped } });

    return NextResponse.json({
      imported,
      skipped: parsed.skipped,
      failed,
      summary,
      warnings: rowWarnings,
      errors: rowErrors.map((item) => `Row ${item.rowNumber}: ${item.message}`)
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
