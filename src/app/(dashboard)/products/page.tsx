"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CsvImport } from "@/components/features/csv-import";
import { ProductsTable } from "@/components/features/products-table";
import { TrackedProductRow } from "@/types/pricing";

export default function ProductsPage() {
  const [rows, setRows] = useState<TrackedProductRow[]>([]);
  const [configuredOptions, setConfiguredOptions] = useState<{ buyers: string[]; departments: string[]; competitors: string[] }>({ buyers: [], departments: [], competitors: [] });
  const searchParams = useSearchParams();

  const loadProducts = useCallback(async () => {
    const [productsResponse, settingsResponse] = await Promise.all([
      fetch("/api/products", { cache: "no-store" }),
      fetch("/api/settings", { cache: "no-store" })
    ]);
    const productsPayload = await productsResponse.json();
    const settingsPayload = await settingsResponse.json();
    setRows(productsPayload.data ?? []);
    setConfiguredOptions({
      buyers: (settingsPayload.data?.buyers ?? []).filter((buyer: { isActive: boolean; name: string }) => buyer.isActive).map((buyer: { name: string }) => buyer.name),
      departments: (settingsPayload.data?.departments ?? []).map((department: { name: string }) => department.name),
      competitors: (settingsPayload.data?.competitors ?? []).filter((competitor: { isEnabled: boolean; name: string }) => competitor.isEnabled).map((competitor: { name: string }) => competitor.name)
    });
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const initialFilters = useMemo(() => ({
    search: searchParams.get("search") ?? "",
    status: searchParams.get("status") ?? "all"
  }), [searchParams]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Products</h2>
      <CsvImport onImported={loadProducts} />
      <ProductsTable rows={rows} onRefreshDone={loadProducts} initialFilters={initialFilters} configuredOptions={configuredOptions} />
    </div>
  );
}
