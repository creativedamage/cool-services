"use client";
/** Church Ops (Full Mode): its own sign-in, then the page. */
import { OpsGate } from "@/components/ops/OpsGate";
import { OpsMeContext } from "@/components/ops/context";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OpsGate>
        {(me) => (
          <OpsMeContext.Provider value={me}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[1280px] px-6 py-6">{children}</div>
            </div>
          </OpsMeContext.Provider>
        )}
      </OpsGate>
    </div>
  );
}
