"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CsvImport } from "@/components/features/csv-import";
import { ProductsTable } from "@/components/features/products-table";
import { TrackedProductRow } from "@/types/pricing";

interface BuyerSetting { name: string; isActive: boolean; departments: string[]; }

const parseMulti = (value: string | null) => value ? value.split(",").map((v) => decodeURIComponent(v).trim()).filter(Boolean) : [];

export default function ProductsPage() {
  const [rows, setRows] = useState<TrackedProductRow[]>([]);
  const [configuredOptions, setConfiguredOptions] = useState<{ buyers: string[]; departments: string[]; competitors: string[]; buyerDepartments: Record<string, string[]> }>({ buyers: [], departments: [], competitors: [], buyerDepartments: {} });
  const searchParams = useSearchParams();

  const loadProducts = useCallback(async () => {
    const [productsResponse, settingsResponse] = await Promise.all([
      fetch("/api/products", { cache: "no-store" }),
      fetch("/api/settings", { cache: "no-store" })
    ]);
    const productsPayload = await productsResponse.json();
    const settingsPayload = await settingsResponse.json();
    const buyers = (settingsPayload.data?.buyers ?? []) as BuyerSetting[];
    setRows(productsPayload.data ?? []);
    setConfiguredOptions({
      buyers: buyers.filter((buyer) => buyer.isActive).map((buyer) => buyer.name),
      departments: (settingsPayload.data?.departments ?? []).map((department: { name: string }) => department.name),
      competitors: (settingsPayload.data?.competitors ?? []).filter((competitor: { isEnabled: boolean; name: string }) => competitor.isEnabled).map((competitor: { name: string }) => competitor.name),
      buyerDepartments: Object.fromEntries(buyers.map((buyer) => [buyer.name, buyer.departments ?? []]))
    });
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const initialFilters = useMemo(() => ({
    search: searchParams.get("search") ?? "",
    statuses: parseMulti(searchParams.get("status")),
    buyers: parseMulti(searchParams.get("buyers")),
    departments: parseMulti(searchParams.get("departments")),
    competitors: parseMulti(searchParams.get("competitors"))
  }), [searchParams]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Products</h2>
      <CsvImport onImported={loadProducts} />
      <ProductsTable rows={rows} onRefreshDone={loadProducts} initialFilters={initialFilters} configuredOptions={configuredOptions} />
    </div>
  );
}
