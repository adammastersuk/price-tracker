import { NextRequest, NextResponse } from "next/server";
import { deleteCompetitorSafe, updateCompetitor } from "@/lib/db";
import { canonicalizeDomain, looksLikeValidUrl } from "@/lib/matching";
import { ensureUniqueSetting } from "@/lib/settings-validation";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await request.json();
    const updates: Record<string, unknown> = {};
    const nextName = typeof payload?.name === "string" ? payload.name.trim() : undefined;
    const nextBaseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl.trim() : undefined;
    const nextDomain = typeof payload?.domain === "string" ? payload.domain.trim() : undefined;

    if (nextName) {
      await ensureUniqueSetting("competitor-name", nextName, params.id);
      updates.name = nextName;
    }

    if (nextBaseUrl) {
      if (!looksLikeValidUrl(nextBaseUrl)) {
        return NextResponse.json({ error: "Base URL must be a valid http(s) URL." }, { status: 400 });
      }
      updates.base_url = nextBaseUrl;
    }

    if (nextDomain) {
      const normalizedDomain = canonicalizeDomain(nextDomain);
      if (!normalizedDomain) {
        return NextResponse.json({ error: "Domain must be valid, e.g. example.com." }, { status: 400 });
      }
      await ensureUniqueSetting("competitor-domain", nextDomain, params.id);
      updates.domain = normalizedDomain;
    }

    if (nextBaseUrl && nextDomain) {
      const baseDomain = canonicalizeDomain(nextBaseUrl);
      const normalizedDomain = canonicalizeDomain(nextDomain);
      if (baseDomain && baseDomain !== normalizedDomain) {
        return NextResponse.json({ error: "Domain should match the base URL domain." }, { status: 400 });
      }
    }

    if (typeof payload?.adapterKey === "string") updates.adapter_key = payload.adapterKey.trim();
    if (typeof payload?.isEnabled === "boolean") updates.is_enabled = payload.isEnabled;

    await updateCompetitor(params.id, updates);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteCompetitorSafe(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
