import type { Config } from "tailwindcss";

/**
 * Cool Services palette. Every color is a CSS variable (see globals.css) so the whole app switches
 * between dark and light themes instantly — no raw hex values in components.
 */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;
const soft = (name: string) => `rgb(var(--c-${name}) / 0.12)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: v("surface"),
        raised: v("raised"),
        hover: v("hover"),
        line: v("line"),
        "line-strong": v("line-strong"),
        ink: { DEFAULT: v("ink"), soft: v("ink-soft"), muted: v("ink-muted"), faint: v("ink-faint") },
        accent: { DEFAULT: v("accent"), soft: soft("accent"), strong: v("accent-strong") },
        "on-accent": v("on-accent"),
        ok: { DEFAULT: v("ok"), soft: soft("ok") },
        warn: { DEFAULT: v("warn"), soft: soft("warn") },
        bad: { DEFAULT: v("bad"), soft: soft("bad") },
        violet: { DEFAULT: v("violet"), soft: soft("violet") },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
      },
      keyframes: {
        "slide-in": { from: { transform: "translateX(24px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "fade-up": { from: { transform: "translateY(6px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "flash": { "0%": { backgroundColor: "rgb(var(--c-ok) / 0.22)" }, "100%": { backgroundColor: "transparent" } },
      },
      animation: {
        "slide-in": "slide-in 180ms cubic-bezier(.2,.8,.2,1)",
        "fade-up": "fade-up 160ms ease-out",
        "flash": "flash 2.5s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
