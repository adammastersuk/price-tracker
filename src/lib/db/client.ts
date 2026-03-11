const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn("Supabase environment variables are missing. Database requests will fail until configured.");
}

interface RequestOptions {
  table: string;
  method?: "GET" | "POST" | "PATCH";
  query?: URLSearchParams;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function supabaseRequest<T>({
  table,
  method = "GET",
  query,
  body,
  headers = {}
}: RequestOptions): Promise<T> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  const url = `${supabaseUrl}/rest/v1/${table}${query ? `?${query.toString()}` : ""}`;
  const response = await fetch(url, {
    method,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase error (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return [] as T;
  }

  return response.json() as Promise<T>;
}
