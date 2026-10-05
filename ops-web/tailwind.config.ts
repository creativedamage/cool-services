import type { Config } from "tailwindcss";
import base from "../web/tailwind.config";

/** Sundays' palette, scanning the shared screens in ../web plus this site's own shell. */
export default {
  ...base,
  content: [
    "./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}",
    "../web/components/**/*.{ts,tsx}", "../web/lib/**/*.{ts,tsx}",
    "../web/app/(app)/ops/**/*.{ts,tsx}", "../web/app/(app)/avl/**/*.{ts,tsx}", "../web/app/ops-print/**/*.{ts,tsx}",
  ],
} satisfies Config;
