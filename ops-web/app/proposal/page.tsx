"use client";
/** The client's proposal page: /proposal?t=<the proposal's link token>. */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ClientProposal } from "@/components/avl/ClientProposal";

export default function Page() { return <Suspense><Proposal /></Suspense>; }
function Proposal() { return <ClientProposal token={useSearchParams().get("t") ?? ""} />; }
