import { NextRequest, NextResponse } from "next/server";
import { createProduct, insertCompetitorPrice, insertPriceHistory } from "@/lib/db";

interface ParsedRow {
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

function parseCsv(csvText: string): ParsedRow[] {
  const [header, ...lines] = csvText.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!header || !lines.length) {
    return [];
  }

  return lines.map((line) => {
    const [sku, productName, bentsPrice, bentsUrl, competitorName, competitorUrl, buyer, supplier, department, cost] = line.split(",");
    return {
      sku,
      productName,
      bentsPrice: Number(bentsPrice),
      bentsUrl,
      competitorName,
      competitorUrl,
      buyer,
      supplier,
      department,
      cost: cost ? Number(cost) : undefined
    };
  }).filter((row) => row.sku && row.productName && Number.isFinite(row.bentsPrice));
}

export async function POST(request: NextRequest) {
  try {
    const { csvText } = await request.json();
    const rows = parseCsv(csvText ?? "");

    if (!rows.length) {
      return NextResponse.json({ error: "No valid rows found in CSV." }, { status: 400 });
    }

    for (const row of rows) {
      const created = await createProduct({
        sku: row.sku,
        name: row.productName,
        bents_price: row.bentsPrice,
        product_url: row.bentsUrl,
        buyer: row.buyer,
        supplier: row.supplier,
        department: row.department,
        cost_price: row.cost
      });
      const productId = created[0].id;
      await insertCompetitorPrice({
  product_id: productId,
  competitor_name: row.competitorName,
  competitor_url: row.competitorUrl,
  pricing_status: "Needs review"
});

await insertPriceHistory({
  product_id: productId,
  competitor_name: row.competitorName
});
    }

    return NextResponse.json({ imported: rows.length });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
