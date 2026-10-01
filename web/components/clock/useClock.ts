"use client";
/**
 * Live clock state for any screen: a stream of changes from the server (server-sent events) plus a
 * local tick, corrected by the server's clock so every screen shows the same second.
 */
import { useEffect, useRef, useState } from "react";
import type { ClockState } from "@shared/clock";

export interface ClockOut { state: ClockState; showTimeOfDay: boolean; transparent: boolean; title: string; infoHeading: string }

export function useClockStream(base = "/api/clock-out", fps = 10) {
  const [out, setOut] = useState<ClockOut | null>(null);
  const [connected, setConnected] = useState(false);
  const offset = useRef(0); // server time − this computer's time
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      es = new EventSource(`${base}/stream`);
      es.onmessage = (e) => {
        const v = JSON.parse(e.data) as ClockOut;
        offset.current = v.state.serverNow - Date.now();
        setOut(v);
        setConnected(true);
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => { es?.close(); if (retry) clearTimeout(retry); };
  }, [base]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset.current), 1000 / fps);
    return () => clearInterval(t);
  }, [fps]);

  return { out, now, connected };
}
