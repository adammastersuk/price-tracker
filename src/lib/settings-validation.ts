import { canonicalizeDomain, looksLikeValidUrl, withAliases } from "@/lib/matching";
import { getSettingsConfig } from "@/lib/db";

export function normalizeEntityName(value: string) {
  return withAliases(value);
}

export function validateCompetitorUrls(baseUrl: string, domain: string) {
  if (!looksLikeValidUrl(baseUrl)) {
    return "Base URL must be a valid http(s) URL.";
  }

  const normalizedDomain = canonicalizeDomain(domain);
  if (!normalizedDomain) {
    return "Domain must be valid, e.g. example.com.";
  }

  const baseDomain = canonicalizeDomain(baseUrl);
  if (baseDomain && normalizedDomain !== baseDomain) {
    return "Domain should match the base URL domain.";
  }

  return null;
}

export async function ensureUniqueSetting(entity: "buyer" | "department" | "competitor-name" | "competitor-domain", value: string, idToIgnore?: string) {
  const settings = await getSettingsConfig();
  const normalized = normalizeEntityName(value);

  if (entity === "buyer") {
    const exists = settings.buyers.some((item) => item.id !== idToIgnore && normalizeEntityName(item.name) === normalized);
    if (exists) throw new Error("A buyer with a similar name already exists.");
    return;
  }

  if (entity === "department") {
    const exists = settings.departments.some((item) => item.id !== idToIgnore && normalizeEntityName(item.name) === normalized);
    if (exists) throw new Error("A department with a similar name already exists.");
    return;
  }

  if (entity === "competitor-name") {
    const exists = settings.competitors.some((item) => item.id !== idToIgnore && normalizeEntityName(item.name) === normalized);
    if (exists) throw new Error("A competitor with a similar name already exists.");
    return;
  }

  const normalizedDomain = canonicalizeDomain(value);
  const exists = settings.competitors.some((item) => item.id !== idToIgnore && canonicalizeDomain(item.domain) === normalizedDomain);
  if (exists) throw new Error("A competitor already exists for that domain.");
}
