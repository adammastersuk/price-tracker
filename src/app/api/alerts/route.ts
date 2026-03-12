import { NextResponse } from "next/server";
import { getAlerts } from "@/lib/operations";

export async function GET() {
  try {
    const data = await getAlerts(100);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Unable to load alerts." }, { status: 500 });
  }
}
