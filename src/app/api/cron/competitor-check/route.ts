import { NextRequest, NextResponse } from "next/server";
import { runCompetitorRefresh } from "@/lib/competitor-check/runner";

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
    const summary = await runCompetitorRefresh();
    console.info("[cron] competitor-check finished", summary);
    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error("[cron] competitor-check failed", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
