"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@/components/ui/primitives";

interface MultiSelectFilterProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function summarize(label: string, allLabel: string, selected: string[]) {
  if (selected.length === 0) return allLabel;
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} +1`;
  return `${selected.length} ${label.toLowerCase()} selected`;
}

export function MultiSelectFilter({ label, options, selected, onChange, allLabel, open: controlledOpen, onOpenChange }: MultiSelectFilterProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, setOpen]);

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button type="button" className="h-10 w-full justify-between border bg-card text-left text-foreground" onClick={() => setOpen(!open)}>
        <span className="truncate">{summarize(label, allLabel, selected)}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">▾</span>
      </Button>
      {open ? (
        <div className="absolute z-20 mt-1 w-full min-w-[260px] rounded-lg border bg-panel p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <button type="button" className="underline" onClick={() => onChange(options)}>Select all</button>
            <button type="button" className="underline" onClick={() => onChange([])}>Clear all</button>
          </div>
          {options.length > 6 ? <Input placeholder={`Search ${label.toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2 h-9" /> : null}
          <div className="max-h-52 space-y-1 overflow-auto pr-1">
            {visibleOptions.map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
                <span className="truncate">{option}</span>
              </label>
            ))}
            {visibleOptions.length === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400">No options match.</p> : null}
          </div>
          <div className="mt-2 text-right">
            <button type="button" className="text-xs text-slate-600 underline dark:text-slate-300" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
