import { NextRequest, NextResponse } from "next/server";
import { getSettingsConfig, insertPriceHistory, upsertCompetitorPrice, upsertProductBySku } from "@/lib/db";
import { canonicalizeDomain, looksLikeValidUrl, withAliases } from "@/lib/matching";
import { logActivity } from "@/lib/operations";
import { calculateBentsMarginPercent } from "@/lib/pricing";
import { parseCsv } from "./parse";

interface RowMessage { rowNumber: number; message: string; }


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
      const hasCompetitorDetails = Boolean(row.competitorName?.trim() || row.competitorUrl?.trim());
      if (hasCompetitorDetails && !looksLikeValidUrl(row.competitorUrl ?? "")) errors.push("Invalid competitor_URL (blocking when competitor details are provided).");

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

      let competitorName: string | undefined;
      if (row.competitorUrl?.trim()) {
        const competitorDomain = canonicalizeDomain(row.competitorUrl);
        competitorName = competitorDomainMap.get(competitorDomain);
      }
      if (!competitorName && row.competitorName?.trim()) {
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
        competitorName,
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
      previewRows: [...rowErrors, ...rowWarnings].slice(0, 5),
      monitorableRows: prepared.filter((row) => !row.hasError).length,
      monitorabilityBreakdown: {
        fullyMonitorable: prepared.filter((row) => !row.hasError && looksLikeValidUrl(row.bentsUrl) && looksLikeValidUrl(row.competitorUrl ?? "")).length,
        missingBentsUrl: prepared.filter((row) => !looksLikeValidUrl(row.bentsUrl)).length,
        missingCompetitorUrl: prepared.filter((row) => !row.competitorUrl?.trim()).length
      }
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
          margin_percent: calculateBentsMarginPercent(row.bentsPrice, row.cost) ?? undefined
        });

        const productId = upserted[0].id;
        if (row.competitorUrl?.trim() && row.competitorName?.trim()) {
          await upsertCompetitorPrice({
            product_id: productId,
            competitor_name: row.competitorName,
            competitor_url: row.competitorUrl,
            pricing_status: "Needs review"
          });
          await insertPriceHistory({ product_id: productId, competitor_name: row.competitorName });
        }
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
