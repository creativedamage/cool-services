"use client";
/**
 * Request type icons. A type's icon is either one of these line icons (stored as "i:Name") or an
 * emoji someone typed. Old types stored plain emoji, which still show as before.
 */
import clsx from "clsx";
import {
  Armchair, Baby, Bath, Battery, BookOpen, Box, Brush, Building, Cable, Calendar, Camera, Car, ClipboardList, Coffee, DoorOpen, Droplets,
  Fan, Flame, Gift, Hammer, HandHelping, Headphones, HeartHandshake, KeyRound, Laptop, Leaf, Lightbulb, Lock, Megaphone, Mic, Monitor, Music,
  Package, Paintbrush, Plug, Presentation, Printer, Projector, Shield, Shirt, ShoppingCart, Smartphone, Snowflake, Sparkles, Speaker, SprayCan,
  Tablet, Tag, Thermometer, Ticket, Trash2, Truck, Tv, Users, Utensils, Video, Wifi, Wrench, type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type { RequestKind } from "@shared/ops/workflow";

/** Stored as "i:<code>" (the database keeps icons to 8 characters). Never change a code once used. */
export const TYPE_ICONS: Record<string, [label: string, icon: LucideIcon]> = {
  laptop: ["Laptop", Laptop], monitr: ["Monitor", Monitor], tablet: ["Tablet", Tablet], phone: ["Smartphone", Smartphone],
  printr: ["Printer", Printer], wifi: ["Wifi", Wifi], cable: ["Cable", Cable], plug: ["Plug", Plug], batt: ["Battery", Battery],
  camera: ["Camera", Camera], video: ["Video", Video], mic: ["Mic", Mic], phones: ["Headphones", Headphones], speakr: ["Speaker", Speaker],
  projtr: ["Projector", Projector], tv: ["Tv", Tv], slides: ["Presentation", Presentation], bulb: ["Lightbulb", Lightbulb],
  wrench: ["Wrench", Wrench], hammer: ["Hammer", Hammer], paint: ["Paintbrush", Paintbrush], brush: ["Brush", Brush],
  water: ["Droplets", Droplets], temp: ["Thermometer", Thermometer], cold: ["Snowflake", Snowflake], fan: ["Fan", Fan],
  flame: ["Flame", Flame], door: ["Door", DoorOpen], key: ["Keys", KeyRound], lock: ["Lock", Lock], shield: ["Shield", Shield],
  bldg: ["Building", Building], chair: ["Armchair", Armchair], bath: ["Bath", Bath], spray: ["SprayCan", SprayCan],
  trash: ["Trash", Trash2], leaf: ["Leaf", Leaf], car: ["Car", Car], truck: ["Truck", Truck], pkg: ["Package", Package], box: ["Box", Box],
  cart: ["ShoppingCart", ShoppingCart], coffee: ["Coffee", Coffee], food: ["Food", Utensils], shirt: ["Shirt", Shirt],
  baby: ["Baby", Baby], music: ["Music", Music], book: ["BookOpen", BookOpen], cal: ["Calendar", Calendar], ticket: ["Ticket", Ticket],
  gift: ["Gift", Gift], announ: ["Megaphone", Megaphone], people: ["People", Users], care: ["Care", HeartHandshake],
  help: ["HandHelping", HandHelping], list: ["ClipboardList", ClipboardList], spark: ["Sparkles", Sparkles], tag: ["Tag", Tag],
};
const KIND_FALLBACK: Record<RequestKind, LucideIcon> = { TECHNOLOGY: Laptop, SUPPLY: Box, MAINTENANCE: Wrench, OTHER: Tag };

/** A type's icon in a rounded tile (or bare with `plain`). */
export function TypeIcon({ icon, kind, size = 16, className, plain }: { icon: string | null | undefined; kind?: RequestKind; size?: number; className?: string; plain?: boolean }) {
  const Line = icon?.startsWith("i:") ? TYPE_ICONS[icon.slice(2)]?.[1] : undefined;
  const Fallback = kind ? KIND_FALLBACK[kind] : Tag;
  const inner = Line ? <Line size={size} /> : icon && !Line && !icon.startsWith("i:") ? <span style={{ fontSize: size + 1, lineHeight: 1 }}>{icon}</span> : <Fallback size={size} />;
  if (plain) return <span className={clsx("inline-grid shrink-0 place-items-center align-[-2px]", className)}>{inner}</span>;
  return <span className={clsx("grid shrink-0 place-items-center rounded-lg bg-accent-soft text-accent", className ?? "h-9 w-9")}>{inner}</span>;
}

/** Pick a line icon, or type an emoji. */
export function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isEmoji = Boolean(value) && !value.startsWith("i:");
  const [emoji, setEmoji] = useState(isEmoji ? value : "");
  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1.5 rounded-xl border border-line bg-canvas/40 p-2">
        {Object.entries(TYPE_ICONS).map(([code, [name, Icon]]) => {
          const on = value === `i:${code}`;
          return (
            <button key={code} type="button" title={name} aria-label={name} aria-pressed={on} onClick={() => onChange(`i:${code}`)}
              className={clsx("grid h-[38px] place-items-center rounded-lg border transition",
                on ? "border-accent bg-accent text-on-accent" : "border-transparent text-ink-soft hover:border-line-strong hover:bg-hover hover:text-ink")}>
              <Icon size={17} />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
        <span>Or use an emoji</span>
        <input className={clsx("input h-8 w-20 text-center text-base", isEmoji && "border-accent")} maxLength={8} value={emoji} placeholder="type"
          onChange={(e) => { setEmoji(e.target.value); onChange(e.target.value.trim()); }} />
        {value && <button type="button" className="ml-auto text-ink-faint hover:text-ink" onClick={() => { setEmoji(""); onChange(""); }}>Clear</button>}
      </div>
    </div>
  );
}
