import { NextRequest, NextResponse } from "next/server";
import { enqueueCompetitorRefresh, processOneQueuedRefresh } from "@/lib/competitor-check/runner";
import { safeParseJson } from "@/lib/json";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text().catch(() => "");
    const payload = safeParseJson<Record<string, unknown>>(rawBody, {});

    if (typeof payload.runId === "string" && payload.runId.trim()) {
      const summary = await processOneQueuedRefresh(payload.runId);
      return NextResponse.json({ data: summary });
    }

    const productIds = Array.isArray(payload.productIds)
      ? payload.productIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;
    const competitorListingIds = Array.isArray(payload.competitorListingIds)
      ? payload.competitorListingIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;

    const queued = await enqueueCompetitorRefresh({
      productIds,
      competitorListingIds,
      batchSize: typeof payload.batchSize === "number" ? payload.batchSize : undefined,
      scheduleMode: payload.scheduleMode === "priority" || payload.scheduleMode === "daily" ? payload.scheduleMode : "manual",
      triggerSource: "manual"
    });

    if (!queued.runId) {
      return NextResponse.json({ data: { total: 0, processed: 0, succeeded: 0, failed: 0, suspicious: 0, failures: [], pending: 0 } });
    }

    const summary = await processOneQueuedRefresh(queued.runId);
    return NextResponse.json({ data: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown refresh error";
    return NextResponse.json({ ok: false, error: `Competitor refresh failed: ${message}` }, { status: 500 });
  }
}
