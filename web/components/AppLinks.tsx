"use client";
/**
 * The Sundays apps (shared/apps.ts) from inside one of them: which app this window is, links that
 * open another app at a page (sundays-open://<app>/<page>, handled by the Mac app), the list of the
 * other apps, and the page shown when a link leads to a screen another app has.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";
import { APPS, APP_IDS, appFromUserAgent, appHas, type AppId } from "@shared/apps";
import { Api } from "@/lib/api";
import { STANDALONE } from "@/lib/ops";
import { Logo } from "@/components/Logo";

/** The app this window belongs to; null in a plain browser (which works like the full app). */
export function useCurrentApp(): AppId | null {
  const [id, setId] = useState<AppId | null>(null);
  useEffect(() => setId(appFromUserAgent(navigator.userAgent)), []);
  return id;
}
/** One of the separate apps (not the full Sundays app or a browser). */
export const isSingle = (id: AppId | null): id is AppId => Boolean(id && id !== "sundays");

/** A link to a page: in this window if this app has it, else in the app that does. */
export function appHref(current: AppId | null, page: string, target?: AppId | null): string {
  if (!isSingle(current) || (!target && appHas(current, page)) || target === current) return page;
  return `sundays-open://${target ?? "sundays"}${page}`;
}
export const openIn = (id: AppId, page = APPS[id].home) => `sundays-open://${id}${page}`;

function useListing(enabled: boolean) {
  return useQuery({ queryKey: ["sundaysApps"], queryFn: Api.sundaysApps, enabled: enabled && !STANDALONE, staleTime: 30_000, refetchInterval: 60_000, retry: false });
}

/** The other Sundays apps, at the bottom of a separate app's sidebar. */
export function OtherApps({ current }: { current: AppId }) {
  const [open, setOpen] = useState(false);
  const listing = useListing(open);
  const installed = new Map(listing.data?.apps.map((a) => [a.id, a]) ?? []);
  const ids = APP_IDS.filter((id) => id !== current);
  return (
    <div className="border-t border-line px-2 py-2">
      <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-ink-muted hover:bg-hover/60 hover:text-ink-soft" onClick={() => setOpen(!open)}>
        <LayoutGrid size={14} /> Sundays apps <span className="ml-auto text-[10px]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {ids.map((id) => {
            const a = installed.get(id);
            return (
              <a key={id} href={openIn(id)} title={APPS[id].blurb}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-hover/60 hover:text-ink">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: APPS[id].color }} />
                <span className="min-w-0 flex-1 truncate">{id === "sundays" ? "Sundays (everything)" : APPS[id].name}</span>
                {a?.running ? <span className="text-[10px] text-ok">open</span> : a && !a.installed ? <span className="text-[10px] text-ink-faint">get it</span> : <ArrowUpRight size={12} className="text-ink-faint" />}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A page this app doesn't have (a link from elsewhere): open it in the app that does. */
export function ElsewherePage({ current, target, page }: { current: AppId; target: AppId | null; page: string }) {
  const to = target ?? "sundays";
  const listing = useListing(true);
  const here = listing.data?.apps.find((a) => a.id === to);
  const full = listing.data?.apps.find((a) => a.id === "sundays");
  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="max-w-md text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl text-white" style={{ background: APPS[to].color }}><Logo size={30} /></span>
        <h1 className="mt-4 text-xl font-semibold">That’s in {APPS[to].name}</h1>
        <p className="mt-1 text-sm text-ink-muted">{APPS[current].name} doesn’t have this screen. {APPS[to].blurb}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <a href={openIn(to, page)} className="btn-primary">Open in {APPS[to].short === "Sundays" ? "Sundays" : APPS[to].name}</a>
          <a href={APPS[current].home} className="btn-outline">Back to {APPS[current].short}</a>
        </div>
        {here && !here.installed && (
          <p className={clsx("mt-4 text-xs text-ink-faint")}>
            {APPS[to].name} isn’t on this Mac{APPS[to].kind === "cloud" ? ", so it opens on the website." : full?.installed ? ", so it opens in the full Sundays app." : ". The button takes you to the download."}
          </p>
        )}
      </div>
    </div>
  );
}
