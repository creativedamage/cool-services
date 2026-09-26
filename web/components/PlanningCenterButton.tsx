"use client";
/**
 * "Sign in with Planning Center" button.
 *
 * Uses Planning Center's OFFICIAL logo file, unmodified, from /public/brand/planning-center-icon.svg
 * (download: https://www.planningcenter.com/logos). Per their guidelines, the full-colour logo sits
 * on a white background, keeps clear space at least the icon's height, and is never recoloured,
 * redrawn or combined with our logo. If the file hasn't been added yet, the button shows text only
 * rather than an imitation.
 */
import { useState } from "react";

export const PCO_LOGO_SRC = "/brand/planning-center-icon.svg";

export function PlanningCenterButton({ href = "/api/auth/login" }: { href?: string }) {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <a
      href={href}
      className="mt-6 flex h-12 w-full items-center justify-center gap-5 rounded-xl border border-[#dadce0] bg-white px-5 font-semibold text-[#1f2328] shadow-sm transition hover:bg-[#f6f7f9] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {logoOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={PCO_LOGO_SRC} alt="" aria-hidden height={22} width={22} className="h-[22px] w-auto"
          onError={() => setLogoOk(false)} />
      )}
      <span>Sign in with Planning Center</span>
    </a>
  );
}
