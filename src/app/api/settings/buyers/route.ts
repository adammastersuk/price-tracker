import { NextRequest, NextResponse } from "next/server";
import { createBuyer, getSettingsConfig, updateBuyer } from "@/lib/db";
import { ensureUniqueSetting } from "@/lib/settings-validation";

export async function GET() {
  try {
    const settings = await getSettingsConfig();
    return NextResponse.json({ data: settings.buyers, departments: settings.departments.map((d) => ({ id: d.id, name: d.name })) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const name = String(payload?.name ?? "").trim();
    const isActive = payload?.isActive !== false;
    const departmentIds = Array.isArray(payload?.departmentIds) ? payload.departmentIds.map((v: unknown) => String(v)) : [];
    if (!name) return NextResponse.json({ error: "Buyer name is required" }, { status: 400 });

    await ensureUniqueSetting("buyer", name);
    const created = await createBuyer(name, isActive);
    if (departmentIds.length) {
      await updateBuyer(created[0].id, { department_ids: departmentIds });
    }
    return NextResponse.json({ data: created[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
