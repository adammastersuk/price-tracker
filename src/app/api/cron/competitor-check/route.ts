import { NextRequest, NextResponse } from "next/server";
import { enqueueCompetitorRefresh, processOneQueuedRefresh } from "@/lib/competitor-check/runner";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization")?.replace("Bearer ", "");
  const headerSecret = request.headers.get("x-cron-secret");
  return auth === secret || headerSecret === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";
  if (process.env.NODE_ENV !== "production" && !force) {
    return NextResponse.json({ data: { skipped: true, reason: "Cron checks only run in production. Use ?force=1 for manual test." } });
  }

  try {
    console.info("[cron] competitor-check started");
    const mode = (request.nextUrl.searchParams.get("mode") as "priority" | "daily" | null) ?? "daily";
    const existingRunId = request.nextUrl.searchParams.get("runId");
    const runId = existingRunId ?? (await enqueueCompetitorRefresh({ scheduleMode: mode, triggerSource: "cron" })).runId;

    if (!runId) {
      return NextResponse.json({ data: { total: 0, processed: 0, succeeded: 0, failed: 0, suspicious: 0, failures: [], pending: 0 } });
    }

    const summary = await processOneQueuedRefresh(runId);
    console.info("[cron] competitor-check finished", summary);
    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error("[cron] competitor-check failed", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
