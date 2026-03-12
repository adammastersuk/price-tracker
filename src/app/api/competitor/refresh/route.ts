import { NextRequest, NextResponse } from "next/server";
import { runCompetitorRefresh } from "@/lib/competitor-check/runner";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}));
    const summary = await runCompetitorRefresh({
      productIds: payload.productIds,
      competitorListingIds: payload.competitorListingIds,
      batchSize: payload.batchSize,
      scheduleMode: payload.scheduleMode ?? "manual",
      triggerSource: "manual"
    });

    return NextResponse.json({ data: summary });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
