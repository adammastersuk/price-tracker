"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, LayoutDashboard, Moon, Package, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, Sun, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const primaryNav: Array<{ href: Route; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/exceptions", label: "Exceptions", icon: TriangleAlert }
];

type NavItem = {
  href?: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
};

const secondaryNav: Array<NavItem> = [
  { href: "/settings", label: "Settings", icon: Settings }
];

type Theme = "light" | "dark";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("light");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [comingSoonMessage, setComingSoonMessage] = useState<string | null>(null);

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

    const storedSidebarState = localStorage.getItem("price-tracker-sidebar-collapsed");
    if (storedSidebarState === "true") {
      setIsSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (!comingSoonMessage) {
      return;
    }

    const timeout = window.setTimeout(() => setComingSoonMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [comingSoonMessage]);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    localStorage.setItem("price-tracker-theme", nextTheme);
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem("price-tracker-sidebar-collapsed", String(next));
      return next;
    });
  };

  const NavLink = ({ href, label, icon: Icon, compact = false, collapsed = false, comingSoon = false }: { href?: Route; label: string; icon: React.ComponentType<{ className?: string }>; compact?: boolean; collapsed?: boolean; comingSoon?: boolean }) => {
    const isActive = href ? pathname.startsWith(href) : false;
    const baseClassName = cn(
      "group relative flex items-center rounded-xl border border-transparent text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100/80 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-text-secondary dark:hover:bg-surface-hover dark:hover:text-foreground",
      compact ? "gap-2 px-3 py-2" : collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
      isActive && "border-slate-200 bg-white text-slate-900 shadow-sm dark:border-border dark:bg-surface-raised dark:text-foreground",
      comingSoon && "opacity-90"
    );

    const content = (
      <>
        <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-slate-500 dark:text-text-muted")} />
        {!collapsed && (
          <>
            <span className="truncate">{label}</span>
            {comingSoon && <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">Coming soon</span>}
          </>
        )}
        {collapsed && (
          <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-3 hidden -translate-y-1/2 rounded-md border border-border bg-panel px-2 py-1 text-xs text-foreground shadow-lg group-hover:block group-focus-visible:block">
            {label}
            {comingSoon ? " • Coming soon" : ""}
          </span>
        )}
      </>
    );

    if (comingSoon || !href) {
      return (
        <button
          type="button"
          className={baseClassName}
          onClick={() => setComingSoonMessage(`${label} is coming soon.`)}
          aria-label={`${label} (coming soon)`}
          title={`${label} (coming soon)`}
        >
          {content}
        </button>
      );
    }

    return (
      <Link
        href={href}
        className={baseClassName}
        title={collapsed ? label : undefined}
        aria-current={isActive ? "page" : undefined}
      >
        {content}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[1600px]">
        <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-panel py-5 transition-[width,padding] duration-200 lg:flex", isSidebarCollapsed ? "w-20 px-3" : "w-72 px-4")}>
          <div className={cn("mb-5 flex items-center rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm transition-all dark:border-border dark:bg-surface-raised", isSidebarCollapsed ? "justify-center" : "gap-3")}>
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <BarChart3 className="h-5 w-5" />
            </div>
            {!isSidebarCollapsed && (
              <div>
                <p className="text-xs uppercase tracking-wide text-text-muted">Bents Platform</p>
                <p className="text-sm font-semibold">Price Intelligence</p>
              </div>
            )}
          </div>

          <button
            type="button"
            className={cn("mb-4 inline-flex items-center rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-text-secondary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", isSidebarCollapsed ? "justify-center" : "justify-start gap-2")}
            onClick={toggleSidebar}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!isSidebarCollapsed && <span>Collapse sidebar</span>}
          </button>

          <div className="space-y-2">
            {!isSidebarCollapsed && <p className="px-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Workspace</p>}
            {primaryNav.map((item) => <NavLink key={item.href} {...item} collapsed={isSidebarCollapsed} />)}
          </div>

          <div className="mt-auto space-y-2 border-t border-border pt-4">
            {!isSidebarCollapsed && <p className="px-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Support</p>}
            {secondaryNav.map((item) => <NavLink key={item.label} {...item} collapsed={isSidebarCollapsed} />)}
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
          {comingSoonMessage && (
            <div className="pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-border bg-panel px-4 py-2 text-sm shadow-lg lg:left-auto lg:right-6 lg:translate-x-0" role="status" aria-live="polite">
              {comingSoonMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
