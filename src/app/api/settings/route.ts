import { NextRequest, NextResponse } from "next/server";
import { getSettingsConfig, updateAppSetting } from "@/lib/db";

export async function GET() {
  try {
    const config = await getSettingsConfig();
    return NextResponse.json({ data: config });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const payload = await request.json();
    const key = String(payload?.key ?? "");
    const value = payload?.value as Record<string, unknown> | undefined;
    if (!key || !value || typeof value !== "object") {
      return NextResponse.json({ error: "key and value are required" }, { status: 400 });
    }
    const updated = await updateAppSetting(key, value);
    return NextResponse.json({ data: updated[0] });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
