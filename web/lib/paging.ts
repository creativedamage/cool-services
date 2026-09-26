"use client";
import { useEffect, useRef, useState } from "react";
import type { PagingStatus } from "@shared/types";

/**
 * Seconds until the page on screen is gone (0 = free to page). Uses the server's clock, so the
 * app and every iPad count down together even if their clocks disagree.
 */
export function useOnScreenSeconds(status: PagingStatus | undefined, receivedAt: number) {
  const offset = useRef(0);
  useEffect(() => {
    if (status) offset.current = Date.parse(status.serverTime) - receivedAt;
  }, [status, receivedAt]);
  const calc = () => status?.onScreenUntil ? Math.max(0, Math.ceil((Date.parse(status.onScreenUntil) - (Date.now() + offset.current)) / 1000)) : 0;
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!status?.onScreenUntil) return;
    const t = setInterval(() => setLeft(calc()), 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.onScreenUntil, receivedAt]);
  return left;
}

export const MINISTRY_LABEL = { nursery: "Nursery", kids: "Kids" } as const;
