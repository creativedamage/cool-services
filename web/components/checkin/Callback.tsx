"use client";
/**
 * Back from Planning Center (/callback on the check-in address, /checkin/callback elsewhere).
 * Finishes signing in here, or, when an iPhone home-screen app opened Planning Center in a
 * separate browser view, leaves the sign-in for the app to pick up and says to switch back.
 */
import { useEffect, useState } from "react";
import { finishSignIn } from "@/lib/checkin";
import { SIGNIN_ERROR } from "./CheckInApp";
import { AppMark, Centered, Shell } from "./ui";

const home = () => "/checkin";

export default function Callback() {
  const [state, setState] = useState<"working" | "handed-off">("working");
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const code = q.get("code"), st = q.get("state"), err = q.get("error_description") ?? q.get("error");
    const back = (message?: string) => {
      if (message) { try { sessionStorage.setItem(SIGNIN_ERROR, message); } catch { /* */ } }
      location.replace(home());
    };
    if (err || !code || !st) return back(err ? `Planning Center: ${err}` : undefined);
    finishSignIn(code, st)
      .then((r) => (r === "signed-in" ? back() : setState("handed-off")))
      .catch((e) => back((e as Error).message));
  }, []);
  return (
    <Shell>
      <Centered>
        <AppMark />
        {state === "working" ? (
          <p className="mt-6 text-ink-muted">Signing you in…</p>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-semibold">You’re signed in</h1>
            <p className="mt-2 text-[15px] text-ink-muted">Close this window and switch back to Check-ins on your home screen.</p>
            <a href={home()} className="btn-ghost mt-8 text-sm">Not using the home-screen app? Start again here</a>
          </>
        )}
      </Centered>
    </Shell>
  );
}
