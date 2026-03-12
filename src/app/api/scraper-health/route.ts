import { NextResponse } from "next/server";
import { getScraperHealth } from "@/lib/operations";

export async function GET() {
  try {
    const data = await getScraperHealth(14);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Unable to load scraper health." }, { status: 500 });
  }
}
