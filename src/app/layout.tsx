import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

export const metadata = {
  title: "Bents Competitor Pricing Tracker",
  description: "Internal decision-support pricing tracker for Buying Team"
};

const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('price-tracker-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
