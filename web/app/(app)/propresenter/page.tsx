"use client";
/** ProPresenter: watch and take over any of your ProPresenter computers. */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { MonitorUp, Settings2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Api, qk } from "@/lib/api";
import { ProControl, useProState } from "@/components/pro/ProControl";
import { Spinner } from "@/components/ui";
import { PrefsLink } from "@/components/settings/PrefsLink";

function Page() {
  const machines = useQuery({ queryKey: qk.proMachines, queryFn: Api.proMachines });
  const q = useSearchParams().get("m");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!machines.data?.length) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("coolservices.pro.machine"); } catch { /* ignore */ }
    setSel((cur) => cur ?? [q, saved].find((x) => x && machines.data!.some((m) => m.id === x)) ?? machines.data![0].id);
  }, [machines.data, q]);
  useEffect(() => { if (sel) try { localStorage.setItem("coolservices.pro.machine", sel); } catch { /* ignore */ } }, [sel]);

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3 pr-28">
        <MonitorUp size={18} className="text-accent" />
        <h1 className="text-lg font-semibold">ProPresenter</h1>
        <div className="ml-4 flex flex-wrap gap-1">
          {machines.data?.map((m) => <MachineTab key={m.id} id={m.id} name={m.name} active={sel === m.id} onClick={() => setSel(m.id)} />)}
        </div>
        <PrefsLink section="pro-computers" className="btn-ghost ml-auto py-1 text-xs"><Settings2 size={13} /> ProPresenter computers</PrefsLink>
      </header>
      {machines.isLoading ? <div className="p-8"><Spinner /></div>
        : !machines.data?.length ? (
          <div className="m-8 max-w-lg rounded-xl border border-dashed border-line p-6 text-sm text-ink-muted">
            No ProPresenter computers yet. Add your side screens computer in <PrefsLink className="text-accent underline" section="pro-computers">Preferences → Video</PrefsLink>.
          </div>
        ) : sel && <ProControl key={sel} id={sel} />}
    </div>
  );
}

function MachineTab({ id, name, active, onClick }: { id: string; name: string; active: boolean; onClick: () => void }) {
  const st = useProState(id, false);
  return (
    <button onClick={onClick} className={clsx("flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition", active ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover hover:text-ink-soft")}>
      <span className={clsx("h-2 w-2 rounded-full", st.data ? (st.data.ok ? "bg-ok" : "bg-bad") : "bg-ink-faint")} />
      {name}
    </button>
  );
}

export default function ProPresenterPage() { return <Suspense><Page /></Suspense>; }
