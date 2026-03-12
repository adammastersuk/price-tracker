import { NextRequest, NextResponse } from "next/server";
import { deleteCompetitorPrice, getCompetitorPrices, insertCompetitorPrice, insertPriceHistory, updateCompetitorPrice } from "@/lib/db";
import { normalizeBuyerDepartmentAndCompetitor } from "@/lib/settings-normalizers";
import { logActivity } from "@/lib/operations";

export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  try {
    const rows = await getCompetitorPrices(productId);
    return NextResponse.json({ data: rows });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const normalized = await normalizeBuyerDepartmentAndCompetitor({ competitorName: payload?.competitor_name });
    const inserted = await insertCompetitorPrice({ ...payload, competitor_name: normalized.competitorName ?? payload?.competitor_name });

    if (payload.product_id && payload.competitor_name) {
      await insertPriceHistory({
        product_id: payload.product_id,
        competitor_name: payload.competitor_name,
        price: payload.competitor_current_price,
        checked_at: payload.last_checked_at
      });
    }

    await logActivity({ event_type: "competitor_listing_created", entity_type: "competitor_listing", entity_id: inserted[0]?.id, summary: `Competitor listing created: ${normalized.competitorName ?? payload?.competitor_name}` });
    return NextResponse.json({ data: inserted[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json();
    if (!payload?.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const normalized = await normalizeBuyerDepartmentAndCompetitor({ competitorName: payload?.updates?.competitor_name });
    const updated = await updateCompetitorPrice(payload.id, { ...(payload.updates ?? {}), competitor_name: normalized.competitorName ?? payload?.updates?.competitor_name });

    if (payload.recordHistory && payload.updates?.product_id && payload.updates?.competitor_name) {
      await insertPriceHistory({
        product_id: payload.updates.product_id,
        competitor_name: payload.updates.competitor_name,
        price: payload.updates.competitor_current_price,
        checked_at: payload.updates.last_checked_at
      });
    }

    await logActivity({ event_type: "competitor_listing_updated", entity_type: "competitor_listing", entity_id: payload.id, summary: "Competitor listing updated." });
    return NextResponse.json({ data: updated[0] });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const listingId = request.nextUrl.searchParams.get("id");
    if (!listingId) {
      return NextResponse.json({ error: "Competitor listing id is required" }, { status: 400 });
    }

    await deleteCompetitorPrice(listingId);
    await logActivity({ event_type: "competitor_listing_deleted", entity_type: "competitor_listing", entity_id: listingId, summary: "Competitor listing deleted." });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete competitor listing. Please try again." }, { status: 500 });
  }
}
