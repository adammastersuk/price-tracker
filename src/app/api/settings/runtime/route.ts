import { NextResponse } from "next/server";
import { getRuntimeSettings } from "@/lib/db";

export async function GET() {
  try {
    const data = await getRuntimeSettings();
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
