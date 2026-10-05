"use client";
/** The site's front door: back to whichever app you used last (Operations the first time). */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { lastApp, lastHref } from "@/components/AppSwitcher";
import { Spinner } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // Back from the "confirm your email" link: Supabase puts the sign-in in the URL hash.
    const side = lastApp() === "avl" ? "avl" : "ops";
    router.replace(`${lastHref(side)}${window.location.hash}`);
  }, [router]);
  return <div className="grid h-screen place-items-center text-ink-muted"><Spinner size={18} /></div>;
}
