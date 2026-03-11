import { CsvImport } from "@/components/features/csv-import";
import { ProductsTable } from "@/components/features/products-table";

export default function ProductsPage() {
  return <div className="space-y-4"><h2 className="text-xl font-semibold">Products</h2><CsvImport /><ProductsTable /></div>;
}
