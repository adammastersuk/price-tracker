import { NextRequest, NextResponse } from "next/server";
import { enqueueCompetitorRefresh, processOneQueuedRefresh } from "@/lib/competitor-check/runner";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}));

    if (payload.runId) {
      const summary = await processOneQueuedRefresh(payload.runId);
      return NextResponse.json({ data: summary });
    }

    const queued = await enqueueCompetitorRefresh({
      productIds: payload.productIds,
      competitorListingIds: payload.competitorListingIds,
      batchSize: payload.batchSize,
      scheduleMode: payload.scheduleMode ?? "manual",
      triggerSource: "manual"
    });

    if (!queued.runId) {
      return NextResponse.json({ data: { total: 0, processed: 0, succeeded: 0, failed: 0, suspicious: 0, failures: [], pending: 0 } });
    }

    const summary = await processOneQueuedRefresh(queued.runId);
    return NextResponse.json({ data: summary });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
