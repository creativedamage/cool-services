"use client";
/** /change-order?t=<the link token>: no sign-in, the link is the key. */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ClientChangeOrder } from "@/components/avl/purchasing/Public";

export default function Page() { return <Suspense><Inner /></Suspense>; }
function Inner() { return <ClientChangeOrder token={useSearchParams().get("t") ?? ""} />; }
