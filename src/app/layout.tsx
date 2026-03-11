import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

export const metadata = {
  title: "Bents Competitor Pricing Tracker",
  description: "Internal decision-support pricing tracker for Buying Team"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
