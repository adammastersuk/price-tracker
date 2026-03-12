export function normalizeLooseValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\band\b/g, "&")
    .replace(/[^a-z0-9&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BASE_ALIASES: Record<string, string> = {
  "bbq and ovens": "bbq & ovens",
  "xmas trees and lighting": "xmas trees & lighting",
  "xmas decs": "xmas decs"
};

export function withAliases(value: string, aliases?: Record<string, string>): string {
  const normalized = normalizeLooseValue(value);
  const mergedAliases = { ...BASE_ALIASES, ...(aliases ?? {}) };
  const aliasTarget = mergedAliases[normalized];
  return aliasTarget ? normalizeLooseValue(aliasTarget) : normalized;
}

export function canonicalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function looksLikeValidUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
