"use client";
import { useQuery } from "@tanstack/react-query";
import { Api, qk } from "@/lib/api";

/** The church's own logo when one is set in Settings, otherwise the Sundays mark. */
export function Logo({ size = 40 }: { size?: number }) {
  const logo = useQuery({ queryKey: qk.settings, queryFn: Api.settings, staleTime: 60_000 }).data?.logo;
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-xl object-contain" />;
  }
  return <SundaysMark size={size} />;
}

/** The Sundays mark: a countdown ring around a live dot (the app icon, docs/brand/sundays-icon.svg). */
export function SundaysMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" className="shrink-0" aria-label="Sundays">
      <defs>
        <linearGradient id="sd-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#13233A" /><stop offset="1" stopColor="#060D17" /></linearGradient>
        <linearGradient id="sd-arc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6FB1FF" /><stop offset="1" stopColor="#2F7BFF" /></linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#sd-bg)" />
      <circle cx="512" cy="512" r="250" fill="none" stroke="#1C2C44" strokeWidth="64" />
      <path d="M512 262 A250 250 0 1 1 295.5 637" fill="none" stroke="url(#sd-arc)" strokeWidth="64" strokeLinecap="round" />
      <circle cx="512" cy="512" r="96" fill="none" stroke="#FF4D5E" strokeOpacity="0.35" strokeWidth="14" />
      <circle cx="512" cy="512" r="62" fill="#F5404F" />
    </svg>
  );
}
