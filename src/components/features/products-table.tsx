"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
} from "@/components/ui/primitives";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import {
  PricingStatusChip,
} from "@/components/features/status-chip";
import {
  defaultFilters,
  queryProducts,
  uniqueValues,
} from "@/lib/data-service";
import { exportProductsCsv } from "@/lib/csv";
import { currency, pct } from "@/lib/utils";
import { materialGap } from "@/lib/pricing-logic";
import { calculateBentsMarginPercent } from "@/lib/pricing";
import {
  CompetitorListing,
  CompetitorStockStatus,
  TrackedProductRow,
} from "@/types/pricing";
import { safeReadJsonResponse } from "@/lib/json";
import { isInStockForComparison, listingSortWeight } from "@/lib/competitor-check/classification";

interface RefreshSummary {
  succeeded: number;
  failed: number;
  suspicious: number;
}
interface ProductForm {
  sku: string;
  name: string;
  brand: string;
  buyer: string;
  supplier: string;
  department: string;
  bents_price: number;
  cost_price: string;
  product_url: string;
}
interface DuplicateSkuInfo {
  sourceProductId: string;
  targetProductId: string;
  targetSku: string;
  targetName: string;
}
interface MergeSummary {
  movedCompetitorCount: number;
  skippedDuplicateCompetitorCount: number;
  movedNotesCount: number;
  movedHistoryCount: number;
  sourceDeleted: boolean;
}
type ProductFormTextKey =
  | "sku"
  | "name"
  | "brand"
  | "buyer"
  | "supplier"
  | "department"
  | "product_url"
  | "cost_price";
type SortKey =
  | "sku"
  | "product"
  | "buyer"
  | "bents"
  | "competitor"
  | "diff"
  | "status";
type SortDirection = "asc" | "desc";

const rowsPerPageOptions = [10, 20, 50] as const;
const defaultRowsPerPage = 20;
const rowsPerPageStorageKey = "products-table-rows-per-page";

const statusTone: Record<CompetitorListing["lastCheckStatus"], string> = {
  success: "border border-emerald-200 bg-emerald-100 text-emerald-800",
  suspicious: "border border-amber-200 bg-amber-100 text-amber-800",
  failed: "border border-rose-200 bg-rose-100 text-rose-700",
  pending:
    "border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-surface-hover/70 dark:text-slate-100",
};

const stockOptions: CompetitorStockStatus[] = [
  "In Stock",
  "Low Stock",
  "Out of Stock",
  "URL Unavailable",
  "Unknown",
  "Not tracked",
];

const buyerSignalTone = {
  cheaper: "border border-rose-200 bg-rose-100 text-rose-700",
  higher: "border border-emerald-200 bg-emerald-100 text-emerald-800",
  inline: "border border-sky-200 bg-sky-100 text-sky-800",
} as const;

const checkedAtPill = (checkedAt: string | null) => {
  if (!checkedAt) return null;
  const checkedDate = new Date(checkedAt);
  const isOlderThanDay = Date.now() - checkedDate.getTime() > 24 * 60 * 60 * 1000;
  const label = isOlderThanDay
    ? `Checked ${checkedDate.toLocaleDateString([], { day: "2-digit", month: "short" })}, ${checkedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : `Checked ${checkedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  return {
    label,
    tone: isOlderThanDay
      ? "border border-rose-200 bg-rose-100 text-rose-700"
      : "border border-emerald-200 bg-emerald-100 text-emerald-800",
  };
};

interface SavedViewState {
  search: string;
  buyers: string[];
  departments: string[];
  suppliers: string[];
  competitors: string[];
  statuses: string[];
  sortKey: string;
  sortDirection: "asc" | "desc";
}

interface SavedView {
  id: string;
  name: string;
  state: SavedViewState;
}

const starterViews: Array<{ name: string; state: SavedViewState }> = [
  {
    name: "Needs review",
    state: {
      search: "",
      buyers: [],
      departments: [],
      suppliers: [],
      competitors: [],
      statuses: ["Needs review"],
      sortKey: "status",
      sortDirection: "desc",
    },
  },
  {
    name: "Bents not cheapest",
    state: {
      search: "",
      buyers: [],
      departments: [],
      suppliers: [],
      competitors: [],
      statuses: ["Higher than competitor"],
      sortKey: "diff",
      sortDirection: "desc",
    },
  },
  {
    name: "Promo discrepancies",
    state: {
      search: "",
      buyers: [],
      departments: [],
      suppliers: [],
      competitors: [],
      statuses: ["Promo discrepancy"],
      sortKey: "status",
      sortDirection: "desc",
    },
  },
  {
    name: "Suspicious extractions",
    state: {
      search: "",
      buyers: [],
      departments: [],
      suppliers: [],
      competitors: [],
      statuses: ["Needs review"],
      sortKey: "status",
      sortDirection: "desc",
    },
  },
  {
    name: "Stale checks",
    state: {
      search: "",
      buyers: [],
      departments: [],
      suppliers: [],
      competitors: [],
      statuses: [],
      sortKey: "status",
      sortDirection: "desc",
    },
  },
];

const statusText = (status: CompetitorListing["lastCheckStatus"]) => {
  if (status === "success") return "Success";
  if (status === "suspicious") return "Suspicious";
  if (status === "failed") return "Failed";
  return "Pending";
};

const trustNote = (listing: CompetitorListing) => {
  if (listing.lastCheckStatus === "suspicious") {
    const retained = listing.checkErrorMessage
      .toLowerCase()
      .includes("retained");
    return retained
      ? "Price candidate rejected and previous valid value retained for review."
      : "Extractor flagged this result as suspicious. Review before acting.";
  }
  if (listing.lastCheckStatus === "failed")
    return "Latest extraction failed. Last known values may be stale.";
  if (listing.lastCheckStatus === "pending")
    return "Awaiting extraction check.";
  return "Price extracted successfully.";
};

const diagnosticsWarnings = (listing: CompetitorListing): string[] => {
  const warnings = listing.extractionMetadata?.trust_warnings;
  const messages: string[] = Array.isArray(warnings)
    ? warnings.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];

  if (listing.lastCheckStatus === "failed") {
    const parsedHostname = listing.extractionMetadata?.parsed_hostname;
    const selectedAdapter = listing.extractionMetadata?.selected_adapter;
    const htmlSignals = listing.extractionMetadata?.html_signals as
      | Record<string, unknown>
      | undefined;
    const htmlSnippets = listing.extractionMetadata?.html_signal_snippets as
      | Record<string, unknown>
      | undefined;

    if (typeof parsedHostname === "string" && parsedHostname)
      messages.push(`parsed_hostname=${parsedHostname}`);
    if (typeof selectedAdapter === "string" && selectedAdapter)
      messages.push(`selected_adapter=${selectedAdapter}`);

    if (htmlSignals && typeof htmlSignals === "object") {
      const keys = [
        "contains_woocommerce_price_amount",
        "contains_product_title",
        "contains_ast_stock_detail",
        "contains_add_to_basket",
      ] as const;
      for (const key of keys) {
        if (typeof htmlSignals[key] === "boolean")
          messages.push(`${key}=${String(htmlSignals[key])}`);
      }
    }

    const snippet = htmlSnippets?.woocommerce_price_amount_snippet;
    if (typeof snippet === "string" && snippet.trim())
      messages.push(`woocommerce_price_amount_snippet=${snippet}`);
  }

  return messages;
};

const marginLabel = (row: TrackedProductRow) =>
  row.marginPercent === null ? "Margin unavailable" : pct(row.marginPercent);

const matchedMarginLabel = (row: TrackedProductRow) => {
  const lowest = lowestTrustedListing(row);
  const matchedPriceIncVat = lowest?.competitorCurrentPrice ?? null;
  const matchedMarginPercent = calculateBentsMarginPercent(
    matchedPriceIncVat,
    row.costPrice,
  );

  return matchedMarginPercent === null ? "-" : pct(matchedMarginPercent);
};

const competitorCardPriceLabel = (listing: CompetitorListing) => {
  if (listing.competitorCurrentPrice !== null)
    return currency(listing.competitorCurrentPrice);
  if (listing.lastCheckStatus === "failed") {
    const msg = listing.checkErrorMessage?.trim();
    if (msg) return msg;
  }
  if (listing.competitorStockStatus === "Not tracked") return "Not tracked";
  return "No price";
};

const listingPriceRank = (listing: CompetitorListing) => {
  const price = listing.competitorCurrentPrice;
  return price !== null && price > 0 ? price : Number.POSITIVE_INFINITY;
};

const sortCompetitorListings = (listings: CompetitorListing[]) =>
  listings
    .map((listing, index) => ({ listing, index }))
    .sort((a, b) => {
      const statusWeightDiff = listingSortWeight(a.listing) - listingSortWeight(b.listing);
      if (statusWeightDiff !== 0) return statusWeightDiff;
      const priceDiff = listingPriceRank(a.listing) - listingPriceRank(b.listing);
      if (priceDiff !== 0) return priceDiff;
      return a.index - b.index;
    })
    .map(({ listing }) => listing);

const lowestTrustedListing = (row: TrackedProductRow) =>
  sortCompetitorListings(row.competitorListings.filter((c) => isInStockForComparison(c)))[0];

const competitorSummary = (row: TrackedProductRow) => {
  const lowest = lowestTrustedListing(row);
  if (lowest) {
    return {
      primary: currency(lowest.competitorCurrentPrice ?? 0),
      secondary: lowest.competitorName,
      extra: row.competitorCount > 1 ? `+${row.competitorCount - 1} more` : "",
    };
  }

  if (!row.competitorListings.length)
    return { primary: "Not tracked", secondary: "", extra: "" };
  if (row.competitorListings.every((c) => c.competitorStockStatus === "Not tracked"))
    return { primary: "Not tracked", secondary: "", extra: "" };
  if (row.competitorListings.some((c) => c.lastCheckStatus === "pending"))
    return { primary: "Pending check", secondary: "", extra: "" };
  if (row.competitorListings.some((c) => c.lastCheckStatus === "failed"))
    return { primary: "Failed check", secondary: "", extra: "" };
  return {
    primary: "No valid price",
    secondary: row.competitorName === "No competitor" ? "" : row.competitorName,
    extra: "",
  };
};

const buyerSignal = (row: TrackedProductRow) => {
  const lowest = lowestTrustedListing(row);
  if (!lowest) {
    return {
      label: "In line with competitor",
      key: "inline" as const,
      diffLabel: "No difference available",
      checkedAt: row.lastCheckedAt,
    };
  }

  const diff = row.bentsRetailPrice - (lowest.competitorCurrentPrice ?? row.bentsRetailPrice);
  const absDiff = currency(Math.abs(diff));
  const pctDiff =
    lowest.priceDifferencePercent !== null
      ? `${Math.abs(lowest.priceDifferencePercent).toFixed(1)}%`
      : null;

  if (Math.abs(diff) < 0.005) {
    return {
      label: "In line with competitor",
      key: "inline" as const,
      diffLabel: "£0.00 (0.0%)",
      checkedAt: lowest.lastCheckedAt,
    };
  }

  if (diff > 0) {
    return {
      label: "Cheaper than Bents",
      key: "cheaper" as const,
      diffLabel: `${absDiff}${pctDiff ? ` (${pctDiff})` : ""}`,
      checkedAt: lowest.lastCheckedAt,
    };
  }

  return {
    label: "Higher than Bents",
    key: "higher" as const,
    diffLabel: `${absDiff}${pctDiff ? ` (${pctDiff})` : ""}`,
    checkedAt: lowest.lastCheckedAt,
  };
};

const buildPaginationItems = (currentPage: number, totalPages: number) => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis-right", totalPages] as const;
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis-left",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "ellipsis-left",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis-right",
    totalPages,
  ] as const;
};

const formatDiff = (listing: CompetitorListing) => {
  const diff = listing.priceDifferenceGbp;
  const pctDiff = listing.priceDifferencePercent;
  if (diff === null || pctDiff === null)
    return {
      text: "No difference available",
      tone: "text-text-secondary dark:text-text-secondary",
    };
  if (Math.abs(diff) < 0.005)
    return {
      text: "£0.00 difference · In line with Bents",
      tone: "text-slate-700 dark:text-foreground",
    };

  if (diff > 0) {
    return {
      text: `-${currency(Math.abs(diff))} (-${Math.abs(pctDiff).toFixed(1)}%) cheaper than Bents`,
      tone: "text-rose-700 dark:text-rose-400",
    };
  }

  return {
    text: `+${currency(Math.abs(diff))} (+${Math.abs(pctDiff).toFixed(1)}%) more expensive than Bents`,
    tone: "text-emerald-700 dark:text-emerald-400",
  };
};

interface ConfiguredOptions {
  buyers: string[];
  departments: string[];
  competitors: string[];
  buyerDepartments?: Record<string, string[]>;
}

export function ProductsTable({
  rows,
  onRefreshDone,
  initialFilters,
  configuredOptions,
  initialSelectedProductParam,
  loadError
}: {
  rows: TrackedProductRow[];
  onRefreshDone: () => Promise<void>;
  initialFilters?: Partial<typeof defaultFilters>;
  configuredOptions?: ConfiguredOptions;
  initialSelectedProductParam?: string;
  loadError?: string;
}) {
  const [filters, setFilters] = useState({
    ...defaultFilters,
    ...initialFilters,
  });
  const router = useRouter();
  const pathname = usePathname();
  const [autoAdjustMessage, setAutoAdjustMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [duplicateSku, setDuplicateSku] = useState<DuplicateSkuInfo | null>(
    null,
  );
  const [mergeSummary, setMergeSummary] = useState<MergeSummary | null>(null);
  const [merging, setMerging] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("sku");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [editingCompetitorId, setEditingCompetitorId] = useState<string | null>(
    null,
  );
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewName, setSavedViewName] = useState("");
  const [activeSavedViewId, setActiveSavedViewId] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [cycleHealthExpanded, setCycleHealthExpanded] = useState(false);
  const [rowsPerPage, setRowsPerPage] = useState<number>(defaultRowsPerPage);
  const normalizedSelectedParam = (initialSelectedProductParam ?? "")
    .trim()
    .toLowerCase();
  const filteredRows = useMemo(
    () => queryProducts(rows, filters),
    [rows, filters],
  );

  const currentViewState = (): SavedViewState => ({
    search: filters.search,
    buyers: filters.buyers,
    departments: filters.departments,
    suppliers: filters.suppliers,
    competitors: filters.competitors,
    statuses: filters.statuses,
    sortKey,
    sortDirection,
  });

  const applyViewState = (state: SavedViewState) => {
    setFilters((prev) => ({ ...prev, ...state }));
    setSortKey(state.sortKey as SortKey);
    setSortDirection(state.sortDirection);
  };

  const loadSavedViews = async () => {
    const res = await fetch("/api/saved-views", { cache: "no-store" });
    const payload = await res.json();
    const stored = (payload.data ?? []) as SavedView[];
    const merged = [
      ...starterViews
        .filter((starter) => !stored.some((v) => v.name === starter.name))
        .map((v, idx) => ({
          id: `starter-${idx}`,
          name: v.name,
          state: v.state,
        })),
      ...stored,
    ];
    setSavedViews(merged);
  };

  useEffect(() => {
    loadSavedViews();
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(rowsPerPageStorageKey);
    const parsed = Number(stored);
    if (rowsPerPageOptions.includes(parsed as (typeof rowsPerPageOptions)[number])) {
      setRowsPerPage(parsed);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(rowsPerPageStorageKey, String(rowsPerPage));
  }, [rowsPerPage]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const nullRank = (value: number | null | undefined) =>
      value === null || value === undefined ? Number.POSITIVE_INFINITY : value;
    return [...filteredRows].sort((a, b) => {
      const aComp = competitorSummary(a);
      const bComp = competitorSummary(b);
      switch (sortKey) {
        case "sku":
          return direction * a.internalSku.localeCompare(b.internalSku);
        case "product":
          return direction * a.productName.localeCompare(b.productName);
        case "buyer":
          return direction * a.buyer.localeCompare(b.buyer);
        case "bents":
          return direction * (a.bentsRetailPrice - b.bentsRetailPrice);
        case "competitor": {
          const aValue = a.competitorCurrentPrice ?? nullRank(undefined);
          const bValue = b.competitorCurrentPrice ?? nullRank(undefined);
          if (Number.isFinite(aValue) && Number.isFinite(bValue))
            return direction * (aValue - bValue);
          return direction * aComp.primary.localeCompare(bComp.primary);
        }
        case "diff":
          return (
            direction *
            ((a.priceDifferencePercent ?? nullRank(undefined)) -
              (b.priceDifferencePercent ?? nullRank(undefined)))
          );
        case "status":
          return direction * a.pricingStatus.localeCompare(b.pricingStatus);
        default:
          return 0;
      }
    });
  }, [filteredRows, sortDirection, sortKey]);
  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStartIndex = totalRows === 0 ? 0 : (clampedPage - 1) * rowsPerPage;
  const paginatedRows = sortedRows.slice(
    pageStartIndex,
    pageStartIndex + rowsPerPage,
  );
  const showingStart = totalRows === 0 ? 0 : pageStartIndex + 1;
  const showingEnd =
    totalRows === 0 ? 0 : Math.min(pageStartIndex + rowsPerPage, totalRows);
  const paginationItems = useMemo(
    () => buildPaginationItems(clampedPage, totalPages),
    [clampedPage, totalPages],
  );
  const values = useMemo(() => {
    const derived = uniqueValues(rows);
    return {
      ...derived,
      buyers: configuredOptions?.buyers?.length
        ? configuredOptions.buyers
        : derived.buyers,
      departments: configuredOptions?.departments?.length
        ? configuredOptions.departments
        : derived.departments,
      competitors: configuredOptions?.competitors?.length
        ? configuredOptions.competitors
        : derived.competitors,
    };
  }, [rows, configuredOptions]);
  const availableDepartments = useMemo(() => {
    if (filters.buyers.length === 0) return values.departments;
    const union = new Set<string>();
    filters.buyers.forEach((buyer) =>
      (configuredOptions?.buyerDepartments?.[buyer] ?? []).forEach(
        (department) => union.add(department),
      ),
    );
    return values.departments.filter((department) => union.has(department));
  }, [filters.buyers, values.departments, configuredOptions?.buyerDepartments]);

  useEffect(() => {
    setFilters((prev) => {
      const pruned = prev.departments.filter((department) =>
        availableDepartments.includes(department),
      );
      if (pruned.length === prev.departments.length) return prev;
      setAutoAdjustMessage(
        "Department selection updated to match selected buyers.",
      );
      return { ...prev, departments: pruned };
    });
  }, [availableDepartments]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, sortKey, sortDirection, rowsPerPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  useEffect(() => {
    setCycleHealthExpanded(false);
  }, [selected?.id]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.buyers.length)
      params.set("buyers", filters.buyers.map(encodeURIComponent).join(","));
    if (filters.departments.length)
      params.set(
        "departments",
        filters.departments.map(encodeURIComponent).join(","),
      );
    if (filters.competitors.length)
      params.set(
        "competitors",
        filters.competitors.map(encodeURIComponent).join(","),
      );
    if (filters.statuses.length)
      params.set("status", filters.statuses.map(encodeURIComponent).join(","));
    if (selected) {
      params.set("productId", selected.id);
      params.set("sku", selected.internalSku);
    }
    const query = params.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as never, {
      scroll: false,
    });
  }, [filters, pathname, router, selected]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds],
  );
  const visibleSelectedCount = useMemo(
    () => filteredRows.filter((row) => selectedIds.includes(row.id)).length,
    [filteredRows, selectedIds],
  );
  const [productForm, setProductForm] = useState<ProductForm | null>(null);
  const [competitorForm, setCompetitorForm] = useState<CompetitorListing[]>([]);
  const drawerOpen = Boolean(selected && productForm);
  const lastAppliedSelectedParamRef = useRef<string | null>(null);

  const closeDrawer = useCallback(() => {
    setSelectedId(null);
  }, []);

  const lowestTrustedCompetitor = useMemo(() => {
    if (!selected) return null;
    const valid = competitorForm.filter((listing) => isInStockForComparison(listing));
    if (!valid.length) return null;
    return sortCompetitorListings(valid)[0];
  }, [competitorForm, selected]);

  const priceSummaryText = useMemo(() => {
    if (!selected) return "No competitor benchmark available yet.";
    if (!lowestTrustedCompetitor?.competitorCurrentPrice)
      return "No valid competitor price available yet.";
    const diff = selected.bentsRetailPrice - lowestTrustedCompetitor.competitorCurrentPrice;
    if (Math.abs(diff) < 0.005) return "In line with lowest competitor.";
    if (diff > 0) return `You are ${currency(diff)} higher.`;
    return `You are ${currency(Math.abs(diff))} lower.`;
  }, [lowestTrustedCompetitor, selected]);

  useEffect(() => {
    if (!rows.length) {
      if (selectedId !== null) setSelectedId(null);
      lastAppliedSelectedParamRef.current = normalizedSelectedParam;
      return;
    }

    const targetRow = normalizedSelectedParam
      ? rows.find(
          (row) =>
            row.id.toLowerCase() === normalizedSelectedParam ||
            row.internalSku.toLowerCase() === normalizedSelectedParam,
        )
      : null;

    if (lastAppliedSelectedParamRef.current !== normalizedSelectedParam) {
      lastAppliedSelectedParamRef.current = normalizedSelectedParam;
      setSelectedId(targetRow?.id ?? null);
      return;
    }

    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(targetRow?.id ?? null);
    }
  }, [normalizedSelectedParam, rows, selectedId]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(rows.map((row) => row.id));
      const next = prev.filter((id) => valid.has(id));
      if (next.length !== prev.length) {
        setRefreshMessage(`Selection updated: ${prev.length - next.length} row(s) are no longer available.`);
      }
      return next;
    });
  }, [rows]);

  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, drawerOpen]);

  useEffect(() => {
    if (!selected) return;
    setProductForm({
      sku: selected.internalSku,
      name: selected.productName,
      brand: selected.brand === "Unknown" ? "" : selected.brand,
      buyer: selected.buyer === "Unassigned" ? "" : selected.buyer,
      supplier: selected.supplier === "Unknown" ? "" : selected.supplier,
      department:
        selected.department === "Unassigned" ? "" : selected.department,
      bents_price: selected.bentsRetailPrice,
      cost_price: selected.costPrice === null ? "" : String(selected.costPrice),
      product_url: selected.bentsProductUrl,
    });
    setCompetitorForm(selected.competitorListings);
    setEditMode(false);
    setEditingCompetitorId(null);
    setSaveMessage("");
    setDuplicateSku(null);
    setMergeSummary(null);
  }, [selected]);

  const setSummaryMessage = (summary: RefreshSummary) => {
    setRefreshMessage(
      `Refresh complete: ${summary.succeeded} success, ${summary.failed} failed, ${summary.suspicious} suspicious changes.`,
    );
  };

  const runRefresh = async (
    productIds?: string[],
    competitorListingIds?: string[],
  ) => {
    setRefreshing(true);
    setRefreshMessage("");
    try {
      const response = await fetch("/api/competitor/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, competitorListingIds }),
      });
      const payload = await safeReadJsonResponse<{
        data?: RefreshSummary;
        error?: string;
      }>(response, {});
      if (!response.ok) {
        setRefreshMessage(
          `Refresh failed: ${payload.error ?? "Unable to complete refresh."}`,
        );
        return;
      }
      setSummaryMessage(
        payload.data ?? { succeeded: 0, failed: 0, suspicious: 0 },
      );
      try {
        await onRefreshDone();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unable to reload products after refresh.";
        setRefreshMessage((prev) => prev ? `${prev} Reload warning: ${detail}` : `Reload warning: ${detail}`);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const deleteCompetitor = async (competitorId: string) => {
    if (!selected) return;
    if (
      !window.confirm("Delete this competitor listing? This cannot be undone.")
    )
      return;

    const response = await fetch(`/api/competitor?id=${competitorId}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaveMessage(payload.error ?? "Failed to delete competitor listing.");
      return;
    }
    setSaveMessage("Competitor listing deleted.");
    await onRefreshDone();
  };

  const deleteProductRow = async () => {
    if (!selected) return;
    const ok = window.confirm(
      "Delete this product and all linked competitor data? This cannot be undone.",
    );
    if (!ok) return;

    const response = await fetch(`/api/products?id=${selected.id}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaveMessage(payload.error ?? "Failed to delete product.");
      return;
    }

    setSaveMessage("Product deleted.");
    await onRefreshDone();
    setSelectedId(null);
  };

  const saveEdits = async () => {
    if (!selected || !productForm) return;
    setSaving(true);
    setSaveMessage("");
    setDuplicateSku(null);
    setMergeSummary(null);
    try {
      const productResponse = await fetch("/api/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          updates: {
            sku: productForm.sku,
            name: productForm.name,
            brand: productForm.brand || null,
            buyer: productForm.buyer || null,
            supplier: productForm.supplier || null,
            department: productForm.department || null,
            bents_price: Number(productForm.bents_price),
            cost_price:
              productForm.cost_price === ""
                ? null
                : Number(productForm.cost_price),
            product_url: productForm.product_url || null,
          },
        }),
      });

      const productPayload = await productResponse.json();
      if (!productResponse.ok) {
        if (
          productPayload.code === "DUPLICATE_SKU" &&
          productPayload.duplicate
        ) {
          setDuplicateSku(productPayload.duplicate);
          setSaveMessage(
            productPayload.error ??
              "That SKU already exists on another product.",
          );
          return;
        }
        setSaveMessage(productPayload.error ?? "Failed to save product");
        return;
      }

      await onRefreshDone();
      setEditMode(false);
      setSaveMessage("Product saved successfully.");
    } finally {
      setSaving(false);
    }
  };

  const saveCompetitorEdit = async (competitor: CompetitorListing) => {
    const response = await fetch("/api/competitor", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: competitor.id,
        updates: {
          competitor_name: competitor.competitorName,
          competitor_url: competitor.competitorProductUrl,
          competitor_current_price: competitor.competitorCurrentPrice,
          competitor_promo_price: competitor.competitorPromoPrice,
          competitor_stock_status: competitor.competitorStockStatus,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaveMessage(payload.error ?? "Failed to save competitor listing.");
      return;
    }
    setEditingCompetitorId(null);
    setSaveMessage("Competitor listing updated.");
    await onRefreshDone();
  };

  const runMergeIntoTarget = async () => {
    if (!duplicateSku) return;
    setMerging(true);
    try {
      const response = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceProductId: duplicateSku.sourceProductId,
          targetProductId: duplicateSku.targetProductId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSaveMessage(payload.error ?? "Failed to merge products");
        return;
      }

      setMergeSummary(payload.data);
      setDuplicateSku(null);
      setEditMode(false);
      await onRefreshDone();
      setSelectedId(duplicateSku.targetProductId);
      setSaveMessage("Merge completed successfully.");
    } finally {
      setMerging(false);
    }
  };

  const downloadCsv = (
    targetRows: TrackedProductRow[],
    prefix = "bents-pricing-export",
  ) => {
    const blob = new Blob([exportProductsCsv(targetRows)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runBulkRefresh = async () => {
    if (!selectedIds.length) return;
    setBulkBusy(true);
    await runRefresh(selectedIds);
    setBulkBusy(false);
  };

  const toggleAllVisible = (checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [
        ...new Set([...prev, ...paginatedRows.map((row) => row.id)]),
      ]);
      return;
    }
    const visibleIds = new Set(paginatedRows.map((row) => row.id));
    setSelectedIds((prev) => prev.filter((id) => !visibleIds.has(id)));
  };

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : "↕";

  return (
    <div className="relative space-y-4">
      <Card>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-5 flex flex-wrap items-center gap-2 rounded border bg-muted px-2 py-2">
            <Select
              value={activeSavedViewId}
              onChange={(e) => {
                const id = e.target.value;
                setActiveSavedViewId(id);
                const view = savedViews.find((v) => v.id === id);
                if (view) applyViewState(view.state);
              }}
            >
              <option value="">Saved views</option>
              {savedViews.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </Select>
            <Input
              placeholder="View name"
              value={savedViewName}
              onChange={(e) => setSavedViewName(e.target.value)}
              className="max-w-[180px]"
            />
            <Button
              className="bg-slate-700 px-2 py-1 text-xs"
              onClick={async () => {
                if (!savedViewName.trim()) return;
                const res = await fetch("/api/saved-views", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: savedViewName.trim(),
                    state: currentViewState(),
                  }),
                });
                if (res.ok) {
                  setSavedViewName("");
                  await loadSavedViews();
                }
              }}
            >
              Save
            </Button>
            <Button
              className="bg-slate-700 px-2 py-1 text-xs"
              disabled={
                !activeSavedViewId || activeSavedViewId.startsWith("starter-")
              }
              onClick={async () => {
                await fetch(`/api/saved-views/${activeSavedViewId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ state: currentViewState() }),
                });
                await loadSavedViews();
              }}
            >
              Overwrite
            </Button>
            <Button
              className="bg-slate-700 px-2 py-1 text-xs"
              disabled={
                !activeSavedViewId || activeSavedViewId.startsWith("starter-")
              }
              onClick={async () => {
                if (!savedViewName.trim()) return;
                await fetch(`/api/saved-views/${activeSavedViewId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: savedViewName.trim() }),
                });
                setSavedViewName("");
                await loadSavedViews();
              }}
            >
              Rename
            </Button>
            <Button
              className="bg-rose-700 px-2 py-1 text-xs"
              disabled={
                !activeSavedViewId || activeSavedViewId.startsWith("starter-")
              }
              onClick={async () => {
                if (!window.confirm("Delete this saved view?")) return;
                await fetch(`/api/saved-views/${activeSavedViewId}`, {
                  method: "DELETE",
                });
                setActiveSavedViewId("");
                await loadSavedViews();
              }}
            >
              Delete
            </Button>
          </div>
          <Input
            placeholder="Search SKU or product"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="lg:col-span-1"
          />
          <MultiSelectFilter
            label="Buyers"
            allLabel="All buyers"
            options={values.buyers}
            selected={filters.buyers}
            onChange={(buyers) => setFilters((prev) => ({ ...prev, buyers }))}
            open={openFilter === "buyers"}
            onOpenChange={(open) => setOpenFilter(open ? "buyers" : null)}
          />
          <MultiSelectFilter
            label="Departments"
            allLabel="All departments"
            options={availableDepartments}
            selected={filters.departments}
            onChange={(departments) =>
              setFilters((prev) => ({ ...prev, departments }))
            }
            open={openFilter === "departments"}
            onOpenChange={(open) => setOpenFilter(open ? "departments" : null)}
          />
          <MultiSelectFilter
            label="Suppliers"
            allLabel="All suppliers"
            options={values.suppliers}
            selected={filters.suppliers}
            onChange={(suppliers) =>
              setFilters((prev) => ({ ...prev, suppliers }))
            }
            open={openFilter === "suppliers"}
            onOpenChange={(open) => setOpenFilter(open ? "suppliers" : null)}
          />
          <MultiSelectFilter
            label="Competitors"
            allLabel="All competitors"
            options={values.competitors}
            selected={filters.competitors}
            onChange={(competitors) =>
              setFilters((prev) => ({ ...prev, competitors }))
            }
            open={openFilter === "competitors"}
            onOpenChange={(open) => setOpenFilter(open ? "competitors" : null)}
          />
          <MultiSelectFilter
            label="Statuses"
            allLabel="All statuses"
            options={values.statuses}
            selected={filters.statuses}
            onChange={(statuses) =>
              setFilters((prev) => ({ ...prev, statuses }))
            }
            open={openFilter === "statuses"}
            onOpenChange={(open) => setOpenFilter(open ? "statuses" : null)}
          />
        </CardContent>
      </Card>
      {autoAdjustMessage && (
        <p className="text-xs text-text-muted">{autoAdjustMessage}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary dark:text-text-secondary">
          {totalRows} products · {selectedIds.length} selected{" "}
          {visibleSelectedCount !== selectedIds.length
            ? `(visible ${visibleSelectedCount})`
            : ""}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => downloadCsv(filteredRows)}>Export CSV</Button>
          <Button onClick={() => runRefresh()} disabled={refreshing}>
            Refresh all rows
          </Button>
        </div>
      </div>
      {selectedIds.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-foreground mr-2">
              {selectedIds.length} selected
            </p>
            <Button onClick={runBulkRefresh} disabled={refreshing || bulkBusy}>
              Refresh selected
            </Button>
            <Button
              onClick={() =>
                downloadCsv(selectedRows, "bents-pricing-selected")
              }
            >
              Export selected
            </Button>
            <Button
              className="bg-slate-500"
              onClick={() => setSelectedIds([])}
              disabled={bulkBusy}
            >
              Clear selection
            </Button>
          </CardContent>
        </Card>
      )}
      {refreshMessage && (
        <p className="text-sm text-slate-700 dark:text-foreground">{refreshMessage}</p>
      )}
      {loadError && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Failed to load products: {loadError}
        </p>
      )}

      <div>
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-panel">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="sticky top-0 bg-muted dark:bg-surface-raised">
              <tr className="text-left text-text-secondary dark:text-text-secondary">
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={
                      paginatedRows.length > 0 &&
                      paginatedRows.every((row) => selectedIds.includes(row.id))
                    }
                    onChange={(e) => toggleAllVisible(e.target.checked)}
                  />
                </th>
                {(
                  [
                    ["SKU", "sku"],
                    ["Product", "product"],
                    ["Buyer", "buyer"],
                    ["Bents", "bents"],
                    ["Competitor", "competitor"],
                    ["Diff", "diff"],
                    ["Status", "status"],
                                      ] as Array<[string, SortKey]>
                ).map(([label, key]) => (
                  <th key={key} className="px-3 py-2">
                    <button
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:text-foreground dark:hover:text-foreground"
                      onClick={() => onSort(key)}
                    >
                      {label}
                      <span className="text-xs">{sortIndicator(key)}</span>
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2">Margin</th>
                <th className="px-3 py-2">Matched Margin</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-3 py-10 text-center text-sm text-text-secondary"
                  >
                    {loadError
                      ? "Products failed to load. Check the error above and retry."
                      : totalRows === 0
                        ? "No products match the current filters."
                        : "No products available on this page."}
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer border-t hover:bg-muted dark:hover:bg-surface-hover ${materialGap(r) ? "bg-amber-50/60 dark:bg-amber-900/25" : ""} ${selectedIds.includes(r.id) ? "ring-1 ring-sky-200 bg-sky-50/40 dark:ring-sky-500/40 dark:bg-sky-900/25" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <td
                    className="px-3 py-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(r.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked
                            ? [...prev, r.id]
                            : prev.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{r.internalSku}</td>
                  <td className="px-3 py-2">{r.productName}</td>
                  <td className="px-3 py-2">{r.buyer}</td>
                  <td className="px-3 py-2">{currency(r.bentsRetailPrice)}</td>
                  <td className="px-3 py-2">
                    {(() => {
                      const summary = competitorSummary(r);
                      const signal = buyerSignal(r);
                      const checkedPill = checkedAtPill(signal.checkedAt);
                      return (
                        <>
                          <p className="font-semibold text-slate-900 dark:text-foreground">
                            {summary.primary}
                          </p>
                          {summary.secondary && (
                            <p className="text-xs text-text-secondary">
                              {summary.secondary}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-text-secondary">
                            Diff vs Bents: {signal.diffLabel}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span
                              className={`inline-flex h-6 items-center whitespace-nowrap rounded-md px-2.5 py-0.5 leading-none ${buyerSignalTone[signal.key]}`}
                            >
                              {signal.label}
                            </span>
                            {checkedPill && (
                              <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-md px-2.5 py-0.5 leading-none ${checkedPill.tone}`}>
                                {checkedPill.label}
                              </span>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    {r.priceDifferencePercent !== null
                      ? pct(r.priceDifferencePercent)
                      : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <PricingStatusChip status={r.pricingStatus} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{marginLabel(r)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{matchedMarginLabel(r)}</td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      className="px-2 py-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(r.id);
                      }}
                    >
                      View
                    </Button>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary sm:text-sm">
            <label
              htmlFor="products-rows-per-page"
              className="font-medium text-foreground"
            >
              View
            </label>
            <Select
              id="products-rows-per-page"
              aria-label="Rows per page"
              value={String(rowsPerPage)}
              onChange={(event) => {
                setRowsPerPage(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="h-8 min-w-20 rounded-md px-2 text-xs sm:text-sm"
            >
              {rowsPerPageOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <p aria-live="polite" className="text-xs text-text-secondary sm:text-sm">
              Showing {showingStart}–{showingEnd} of {totalRows} products
            </p>
          </div>
          <nav
            aria-label="Products table pagination"
            className="flex items-center gap-1"
          >
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={clampedPage === 1 || totalRows === 0}
              className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs font-medium text-text-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Previous
            </button>
            {paginationItems.map((item, index) =>
              typeof item === "number" ? (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCurrentPage(item)}
                  aria-current={clampedPage === item ? "page" : undefined}
                  className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    clampedPage === item
                      ? "border-primary bg-primary text-white"
                      : "border-border text-text-secondary hover:bg-muted"
                  }`}
                >
                  {item}
                </button>
              ) : (
                <span
                  key={`${item}-${index}`}
                  className="px-1 text-xs text-text-muted"
                  aria-hidden="true"
                >
                  …
                </span>
              ),
            )}
            <button
              type="button"
              onClick={() =>
                setCurrentPage((prev) => Math.min(prev + 1, totalPages))
              }
              disabled={clampedPage === totalPages || totalRows === 0}
              className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs font-medium text-text-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Next
            </button>
          </nav>
        </div>
      </div>
      <div
        aria-hidden={!drawerOpen}
        onClick={closeDrawer}
        className={`fixed inset-0 z-30 bg-slate-950/25 transition-opacity duration-200 ${drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={`fixed right-0 top-0 z-40 h-screen w-full max-w-[470px] border-l border-border bg-panel shadow-[-14px_0_40px_rgba(15,23,42,0.25)] transition-transform duration-300 ease-out ${drawerOpen ? "translate-x-0" : "translate-x-full pointer-events-none"}`}
      >
        <div className="flex h-full flex-col overflow-hidden">
          {selected && productForm && (
            <Card className="flex h-full flex-col border-0 shadow-none">
              <CardContent className="flex h-full flex-col gap-4 overflow-y-auto p-4 md:p-5">
                <div className="sticky top-0 z-10 -mx-4 -mt-4 space-y-3 border-b border-border bg-panel px-4 pb-3 pt-4 md:-mx-5 md:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold leading-tight">
                      {selected.productName}
                    </h3>
                    <button
                      aria-label="Close product details"
                      className="rounded-md border border-border px-2 py-1 text-sm text-text-secondary hover:bg-muted"
                      onClick={closeDrawer}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <p>
                      <b>Margin:</b> {marginLabel(selected)}
                    </p>
                    {checkedAtPill(selected.lastCheckedAt) && (
                      <span className={`rounded-full px-2 py-0.5 ${checkedAtPill(selected.lastCheckedAt)?.tone}`}>
                        {checkedAtPill(selected.lastCheckedAt)?.label}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      onClick={() => runRefresh([selected.id])}
                      disabled={refreshing}
                      className="px-2.5 py-1 text-xs"
                    >
                      Refresh
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-2.5 text-xs">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-full border border-border bg-muted/40 px-3 py-1.5 text-left font-medium text-slate-700 hover:bg-muted dark:text-foreground"
                    aria-expanded={cycleHealthExpanded}
                    onClick={() => setCycleHealthExpanded((prev) => !prev)}
                  >
                    <span>Cycle health</span>
                    <span className="text-[11px] text-text-secondary">
                      {cycleHealthExpanded ? "Hide" : "Show"} details
                    </span>
                  </button>
                  <div className={`grid transition-all duration-300 ease-out ${cycleHealthExpanded ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"}`}>
                    <div className="overflow-hidden">
                      <div className="space-y-1 text-text-secondary">
                        <p>Bents status: {selected.sourceHealth.bents.status}{selected.sourceHealth.bents.checkedAt ? ` (${new Date(selected.sourceHealth.bents.checkedAt).toLocaleString()})` : ""}</p>
                        <p>Competitors checked: {selected.sourceHealth.competitors.success}/{selected.sourceHealth.competitors.total} successful</p>
                        <p>Cycle sources successful: {selected.cycleHealth.successfulSources}/{selected.cycleHealth.totalSources}</p>
                        <p>{selected.cycleHealth.partialFailure ? "Partial failure detected" : "No partial failure"} · {selected.cycleHealth.stale ? "Older than 24h" : "Within 24h"}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-3 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                    Price summary
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                    <p className="text-xs text-text-secondary">Bents price</p>
                    <p className="text-right font-semibold">
                      {currency(selected.bentsRetailPrice)}
                    </p>
                    <p className="text-xs text-text-secondary">Lowest competitor</p>
                    <p className="text-right font-semibold">
                      {lowestTrustedCompetitor?.competitorCurrentPrice
                        ? `${currency(lowestTrustedCompetitor.competitorCurrentPrice)} · ${lowestTrustedCompetitor.competitorName}`
                        : "Not available"}
                    </p>
                  </div>
                  <p className="mt-2 text-xs font-medium text-sky-700 dark:text-sky-300">
                    {priceSummaryText}
                  </p>
                  <a
                    href={selected.bentsProductUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
                  >
                    View Bents product ↗
                  </a>
                </div>

                {editMode ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {[
                      ["SKU", "sku"],
                      ["Product name", "name"],
                      ["Brand", "brand"],
                      ["Supplier", "supplier"],
                      ["Bents URL", "product_url"],
                      ["Cost price", "cost_price"],
                    ].map(([label, key]) => {
                      const formKey = key as ProductFormTextKey;
                      return (
                        <label
                          key={key}
                          className="text-xs text-text-secondary"
                        >
                          {label}
                          <Input
                            value={productForm[formKey] ?? ""}
                            onChange={(e) =>
                              setProductForm((prev) =>
                                prev
                                  ? { ...prev, [formKey]: e.target.value }
                                  : prev,
                              )
                            }
                          />
                        </label>
                      );
                    })}
                    <label className="text-xs text-text-secondary">
                      Buyer
                      <Select
                        value={productForm.buyer}
                        onChange={(e) =>
                          setProductForm((prev) =>
                            prev ? { ...prev, buyer: e.target.value } : prev,
                          )
                        }
                      >
                        <option value="">Unassigned</option>
                        {values.buyers.map((buyer) => (
                          <option key={buyer} value={buyer}>
                            {buyer}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="text-xs text-text-secondary">
                      Department
                      <Select
                        value={productForm.department}
                        onChange={(e) =>
                          setProductForm((prev) =>
                            prev
                              ? { ...prev, department: e.target.value }
                              : prev,
                          )
                        }
                      >
                        <option value="">Unassigned</option>
                        {values.departments.map((department) => (
                          <option key={department} value={department}>
                            {department}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="text-xs text-text-secondary">
                      Bents price
                      <Input
                        type="number"
                        step="0.01"
                        value={productForm.bents_price}
                        onChange={(e) =>
                          setProductForm((prev) =>
                            prev
                              ? { ...prev, bents_price: Number(e.target.value) }
                              : prev,
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}

                <div className="rounded-lg border bg-panel p-3 space-y-3">
                  <p className="font-medium">
                    Competitor comparison ({selected.competitorCount})
                  </p>
                  {competitorForm.length === 0 && (
                    <p className="rounded border border-dashed p-4 text-sm text-text-secondary">
                      No competitor listings yet. Keep the product and add
                      listings when mappings are available.
                    </p>
                  )}
                  <div className="space-y-2">
                    {sortCompetitorListings(competitorForm).map((c) => {
                      const diff = formatDiff(c);
                      const diagnostics = diagnosticsWarnings(c);
                      const isEditing = editingCompetitorId === c.id;
                      return (
                        <div
                          key={c.id}
                          className="rounded-lg border bg-card p-2.5 space-y-2"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-slate-900 dark:text-foreground">
                                {c.competitorName}
                              </p>
                              <div className="text-right space-y-1">
                                <p className="text-lg font-bold leading-none">
                                  {competitorCardPriceLabel(c)}
                                </p>
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone[c.lastCheckStatus]}`}
                                >
                                  {statusText(c.lastCheckStatus)}
                                </span>
                              </div>
                            </div>
                            <p className={`text-xs font-medium ${diff.tone}`}>
                              {diff.text}
                            </p>
                          </div>

                          <div className="space-y-1 text-xs text-slate-700 dark:text-foreground">
                            <p>
                              <b>Stock:</b> {c.competitorStockStatus}
                            </p>
                            {checkedAtPill(c.lastCheckedAt) && (
                              <p>
                                <span className={`rounded-full px-2 py-0.5 ${checkedAtPill(c.lastCheckedAt)?.tone}`}>
                                  {checkedAtPill(c.lastCheckedAt)?.label}
                                </span>
                              </p>
                            )}
                            {c.checkErrorMessage && (
                              <p className="w-full text-amber-700 dark:text-amber-400">
                                {c.checkErrorMessage}
                              </p>
                            )}
                          </div>

                          <details className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-border dark:bg-surface-raised">
                            <summary className="cursor-pointer font-medium text-text-secondary dark:text-text-secondary">
                              Diagnostics
                            </summary>
                            <div className="mt-2 space-y-1 text-text-secondary dark:text-text-secondary">
                              <p>
                                <b>Source:</b>{" "}
                                {c.extractionSource || "Unknown adapter"}
                              </p>
                              <p>{trustNote(c)}</p>
                              <p>
                                <b>Diagnostics details:</b>{" "}
                                {diagnostics.length
                                  ? diagnostics.join(" ")
                                  : "No diagnostics available"}
                              </p>
                            </div>
                          </details>

                          {isEditing && (
                            <div className="grid gap-2 md:grid-cols-2">
                              <label className="text-xs">
                                Competitor name
                                <Select
                                  value={c.competitorName}
                                  onChange={(e) =>
                                    setCompetitorForm((prev) =>
                                      prev.map((x) =>
                                        x.id === c.id
                                          ? {
                                              ...x,
                                              competitorName: e.target.value,
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                >
                                  <option value={c.competitorName}>
                                    {c.competitorName}
                                  </option>
                                  {values.competitors
                                    .filter((name) => name !== c.competitorName)
                                    .map((name) => (
                                      <option key={name} value={name}>
                                        {name}
                                      </option>
                                    ))}
                                </Select>
                              </label>
                              <label className="text-xs">
                                Competitor URL
                                <Input
                                  value={c.competitorProductUrl}
                                  onChange={(e) =>
                                    setCompetitorForm((prev) =>
                                      prev.map((x) =>
                                        x.id === c.id
                                          ? {
                                              ...x,
                                              competitorProductUrl:
                                                e.target.value,
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <label className="text-xs">
                                Current price
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={c.competitorCurrentPrice ?? ""}
                                  onChange={(e) =>
                                    setCompetitorForm((prev) =>
                                      prev.map((x) =>
                                        x.id === c.id
                                          ? {
                                              ...x,
                                              competitorCurrentPrice:
                                                e.target.value === ""
                                                  ? null
                                                  : Number(e.target.value),
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <label className="text-xs">
                                Promo price
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={c.competitorPromoPrice ?? ""}
                                  onChange={(e) =>
                                    setCompetitorForm((prev) =>
                                      prev.map((x) =>
                                        x.id === c.id
                                          ? {
                                              ...x,
                                              competitorPromoPrice:
                                                e.target.value === ""
                                                  ? null
                                                  : Number(e.target.value),
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <label className="text-xs md:col-span-2">
                                Stock status
                                <Select
                                  value={c.competitorStockStatus}
                                  onChange={(e) =>
                                    setCompetitorForm((prev) =>
                                      prev.map((x) =>
                                        x.id === c.id
                                          ? {
                                              ...x,
                                              competitorStockStatus: e.target
                                                .value as CompetitorStockStatus,
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                >
                                  {stockOptions.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </Select>
                              </label>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-1.5">
                            <a
                              href={c.competitorProductUrl || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-surface-raised dark:text-foreground dark:hover:bg-surface-hover"
                            >
                              View product ↗
                            </a>
                            <Button
                              onClick={() => runRefresh(undefined, [c.id])}
                              disabled={refreshing}
                              className="px-2 py-1 text-xs"
                            >
                              Refresh
                            </Button>
                            {isEditing ? (
                              <>
                                <Button
                                  className="px-2 py-1 text-xs"
                                  onClick={() => saveCompetitorEdit(c)}
                                >
                                  Save
                                </Button>
                                <Button
                                  className="bg-slate-500 px-2 py-1 text-xs"
                                  onClick={() => {
                                    setEditingCompetitorId(null);
                                    setCompetitorForm(
                                      selected.competitorListings,
                                    );
                                  }}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                className="bg-slate-700 px-2 py-1 text-xs"
                                onClick={() => setEditingCompetitorId(c.id)}
                              >
                                Edit
                              </Button>
                            )}
                            <Button
                              className="bg-rose-700 px-2 py-1 text-xs"
                              onClick={() => deleteCompetitor(c.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {saveMessage && (
                  <p className="text-sm text-slate-700 dark:text-foreground">
                    {saveMessage}
                  </p>
                )}
                {duplicateSku && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm">
                    <p>
                      SKU <b>{duplicateSku.targetSku}</b> already exists on{" "}
                      <b>{duplicateSku.targetName}</b>. Choose merge to reassign
                      competitor listings to the existing product.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        className="bg-amber-700"
                        onClick={runMergeIntoTarget}
                        disabled={merging}
                      >
                        {merging ? "Merging..." : "Merge into existing SKU"}
                      </Button>
                      <Button
                        className="bg-slate-500"
                        onClick={() => setDuplicateSku(null)}
                        disabled={merging}
                      >
                        Cancel merge
                      </Button>
                    </div>
                  </div>
                )}
                {mergeSummary && (
                  <p className="text-sm text-emerald-700">
                    Merged successfully: moved{" "}
                    {mergeSummary.movedCompetitorCount} competitor listings,
                    skipped {mergeSummary.skippedDuplicateCompetitorCount}{" "}
                    duplicates, moved {mergeSummary.movedNotesCount} notes and{" "}
                    {mergeSummary.movedHistoryCount} history rows.{" "}
                    {mergeSummary.sourceDeleted
                      ? "Source product removed."
                      : "Source product retained because linked records remain."}
                  </p>
                )}
                {editMode && (
                  <div className="flex gap-2">
                    <Button onClick={saveEdits} disabled={saving}>
                      {saving ? "Saving..." : "Save changes"}
                    </Button>
                    <Button
                      className="bg-slate-500"
                      onClick={() => {
                        setEditMode(false);
                        setProductForm(null);
                        setCompetitorForm([]);
                        setSelectedId(selected.id);
                        setDuplicateSku(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </aside>
    </div>
  );
}
