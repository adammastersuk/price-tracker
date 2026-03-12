"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CsvImport } from "@/components/features/csv-import";
import { ProductsTable } from "@/components/features/products-table";
import { TrackedProductRow } from "@/types/pricing";

export default function ProductsPage() {
  const [rows, setRows] = useState<TrackedProductRow[]>([]);
  const searchParams = useSearchParams();

  const loadProducts = useCallback(async () => {
    const response = await fetch("/api/products", { cache: "no-store" });
    const payload = await response.json();
    setRows(payload.data ?? []);
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
      <ProductsTable rows={rows} onRefreshDone={loadProducts} initialFilters={initialFilters} />
    </div>
  );
}
