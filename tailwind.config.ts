import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(214 31% 91%)",
        input: "hsl(214 31% 91%)",
        ring: "hsl(215 20% 35%)",
        background: "hsl(210 20% 98%)",
        foreground: "hsl(222 47% 11%)",
        card: "hsl(0 0% 100%)",
        muted: "hsl(210 30% 96%)",
        primary: { DEFAULT: "hsl(219 88% 50%)", foreground: "hsl(0 0% 100%)" }
      },
      boxShadow: { panel: "0 8px 24px rgba(15, 23, 42, 0.06)" }
    }
  },
  plugins: []
};
export default config;
