"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const nav = [
  ["/dashboard", "Dashboard"],
  ["/products", "Products"],
  ["/exceptions", "Exceptions"],
  ["/settings", "Settings"]
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen">
      <header className="border-b bg-white/90 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Bents Garden & Home</p>
            <h1 className="text-lg font-semibold">Competitor Pricing Tracker</h1>
          </div>
          <nav className="flex gap-2">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className={cn("rounded-lg px-3 py-2 text-sm", pathname.startsWith(href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="container py-6">{children}</main>
    </div>
  );
}
