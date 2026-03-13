import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        panel: "hsl(var(--panel))",
        card: "hsl(var(--card))",
        muted: "hsl(var(--muted))",
        primary: { DEFAULT: "hsl(219 88% 50%)", foreground: "hsl(0 0% 100%)" }
      },
      boxShadow: { panel: "0 8px 24px rgba(15, 23, 42, 0.06)" }
    }
  },
  plugins: []
};
export default config;
