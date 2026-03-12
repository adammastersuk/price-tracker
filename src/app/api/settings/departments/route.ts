import { NextRequest, NextResponse } from "next/server";
import { createDepartment, getSettingsConfig } from "@/lib/db";

export async function GET() {
  try {
    const settings = await getSettingsConfig();
    return NextResponse.json({ data: settings.departments });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const name = String(payload?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Department name is required" }, { status: 400 });
    const created = await createDepartment(name);
    return NextResponse.json({ data: created[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
