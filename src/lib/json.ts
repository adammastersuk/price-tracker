export function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === "object") {
    return value as T;
  }
  return fallback;
}

export function toPlainObject(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = safeParseJson<unknown>(value, fallback);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return fallback;
}

export function toNullablePlainObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const obj = toPlainObject(value, {});
  return Object.keys(obj).length ? obj : null;
}

export async function safeReadJsonResponse<T>(response: Response, fallback: T): Promise<T> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return fallback;
  return safeParseJson<T>(text, fallback);
}
