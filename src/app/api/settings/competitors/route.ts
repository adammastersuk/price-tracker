import { NextRequest, NextResponse } from "next/server";
import { createCompetitor, getSettingsConfig } from "@/lib/db";
import { canonicalizeDomain } from "@/lib/matching";
import { ensureUniqueSetting, validateCompetitorUrls } from "@/lib/settings-validation";

export async function GET() {
  try {
    const settings = await getSettingsConfig();
    return NextResponse.json({ data: settings.competitors });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const name = String(payload?.name ?? "").trim();
    const baseUrl = String(payload?.baseUrl ?? "").trim();
    const domain = String(payload?.domain ?? "").trim();
    const adapterKey = String(payload?.adapterKey ?? "generic").trim() || "generic";
    const isEnabled = payload?.isEnabled !== false;
    if (!name || !baseUrl || !domain) {
      return NextResponse.json({ error: "name, baseUrl and domain are required" }, { status: 400 });
    }

    const urlValidationError = validateCompetitorUrls(baseUrl, domain);
    if (urlValidationError) return NextResponse.json({ error: urlValidationError }, { status: 400 });
    await ensureUniqueSetting("competitor-name", name);
    await ensureUniqueSetting("competitor-domain", domain);

    const created = await createCompetitor({
      name,
      base_url: baseUrl,
      domain: canonicalizeDomain(domain),
      adapter_key: adapterKey,
      is_enabled: isEnabled
    });

    return NextResponse.json({ data: created[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
