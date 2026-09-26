"use client";
import { useQuery } from "@tanstack/react-query";
import { Api, qk } from "@/lib/api";

/** The church's own logo when one is set in Settings, otherwise the Cool Services mark. */
export function Logo({ size = 40 }: { size?: number }) {
  const logo = useQuery({ queryKey: qk.settings, queryFn: Api.settings, staleTime: 60_000 }).data?.logo;
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-xl object-contain" />;
  }
  return (
    <div style={{ width: size, height: size }}
      className="grid place-items-center rounded-xl bg-gradient-to-br from-accent to-[#2563EB] shadow-[0_0_24px_-4px_rgba(79,156,255,0.6)]">
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="#051226" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 3v6M9 6h6M5 21V12l7-4 7 4v9M10 21v-4h4v4" />
      </svg>
    </div>
  );
}
