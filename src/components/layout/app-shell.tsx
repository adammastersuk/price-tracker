"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const nav = [
  ["/dashboard", "Dashboard"],
  ["/products", "Products"],
  ["/exceptions", "Exceptions"],
  ["/settings", "Settings"]
] as const;

type Theme = "light" | "dark";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const root = document.documentElement;
    const stored = localStorage.getItem("price-tracker-theme");
    const initialTheme: Theme = stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

    setTheme(initialTheme);
    root.classList.toggle("dark", initialTheme === "dark");
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    localStorage.setItem("price-tracker-theme", nextTheme);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-white/90 backdrop-blur dark:bg-slate-900/95 dark:border-slate-700">
        <div className="container flex h-16 items-center justify-between">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-300">Bents Garden & Home</p>
            <h1 className="text-lg font-semibold">Competitor Pricing Tracker</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="rounded-lg border px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <nav className="flex gap-2">
              {nav.map(([href, label]) => (
                <Link key={href} href={href} className={cn("rounded-lg px-3 py-2 text-sm", pathname.startsWith(href) ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main className="container py-6">{children}</main>
    </div>
  );
}
