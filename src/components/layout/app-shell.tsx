"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, CircleHelp, CreditCard, LayoutDashboard, Moon, Package, Settings, Sparkles, Sun, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const primaryNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/exceptions", label: "Exceptions", icon: TriangleAlert }
] as const;

const secondaryNav = [
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/settings?tab=billing", label: "Billing", icon: CreditCard },
  { href: "/settings?tab=help", label: "Help", icon: CircleHelp }
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

  const NavLink = ({ href, label, icon: Icon, compact = false }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; compact?: boolean }) => {
    const isActive = pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={cn(
          "group flex items-center rounded-xl border border-transparent text-sm font-medium text-slate-600 transition hover:bg-slate-100/80 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-text-secondary dark:hover:bg-surface-hover dark:hover:text-foreground",
          compact ? "gap-2 px-3 py-2" : "gap-3 px-3 py-2.5",
          isActive && "border-slate-200 bg-white text-slate-900 shadow-sm dark:border-border dark:bg-surface-raised dark:text-foreground"
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-slate-500 dark:text-text-muted")} />
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-border bg-panel px-4 py-5 lg:flex">
          <div className="mb-7 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-border dark:bg-surface-raised">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted">Bents Platform</p>
              <p className="text-sm font-semibold">Price Intelligence</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Workspace</p>
            {primaryNav.map((item) => <NavLink key={item.href} {...item} />)}
          </div>

          <div className="mt-auto space-y-2 border-t border-border pt-4">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Support</p>
            {secondaryNav.map((item) => <NavLink key={item.href} {...item} />)}
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-border bg-panel/95 px-4 py-3 backdrop-blur lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-600 dark:text-text-secondary">Bents Garden & Home</p>
                <p className="truncate text-xs text-text-muted">Competitor pricing operations</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-border p-2 text-text-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Notifications">
                  <Bell className="h-4 w-4" />
                </button>
                <button onClick={toggleTheme} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-slate-600 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-text-secondary">
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {theme === "dark" ? "Light" : "Dark"}
                </button>
              </div>
            </div>
            <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {primaryNav.map((item) => <NavLink key={item.href} {...item} compact />)}
              <Link href="/settings" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-text-secondary dark:hover:bg-surface-hover"><Sparkles className="h-4 w-4" />Quick settings</Link>
            </nav>
          </header>
          <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
