/**
 * Vendor price-list import: spreadsheet rows -> normalized product rows.
 *
 * Vendor spreadsheets never agree on headers ("Part #", "Item Number", "Dealer",
 * "Net Price"...), so columns are auto-detected via an alias table and the user can
 * override the mapping before importing. Sundays reads the CSV / Excel file on the Mac
 * and sends the normalized rows; the ops function checks them again.
 */
import { parseMoneyToCents } from "./math";

export const IMPORT_FIELDS = ["sku", "model", "name", "manufacturer", "category", "description", "cost", "msrp", "map"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, string>>; // field -> source header

const ALIASES: Record<ImportField, string[]> = {
  sku: ["sku", "part", "part #", "part number", "partnumber", "item", "item #", "item number", "vendor sku", "mfr part", "mpn"],
  model: ["model", "model #", "model number", "model no"],
  name: ["name", "product", "product name", "title", "item name", "short description"],
  manufacturer: ["manufacturer", "mfr", "mfg", "brand", "make"],
  category: ["category", "type", "product type", "department", "class"],
  description: ["description", "long description", "details", "desc"],
  cost: ["cost", "dealer", "dealer price", "dealer cost", "net", "net price", "your price", "unit cost", "price"],
  msrp: ["msrp", "list", "list price", "retail", "retail price"],
  map: ["map", "map price", "min advertised price"],
};

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();

/** Guess a mapping from the header row. Exact alias match beats "contains" match. */
export function detectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const pass of ["exact", "contains"] as const) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field]) continue;
      const hit = headers.find((h) => {
        if (used.has(h)) return false;
        const n = norm(h);
        return ALIASES[field].some((a) => (pass === "exact" ? n === a : n.includes(a)));
      });
      if (hit) {
        mapping[field] = hit;
        used.add(hit);
      }
    }
  }
  return mapping;
}

export type RawRow = Record<string, unknown>;

export interface NormalizedProduct {
  sku: string;
  model: string | null;
  name: string;
  manufacturer: string | null;
  category: string | null;
  description: string | null;
  costCents: number;
  msrpCents: number | null;
  mapCents: number | null;
}
export interface RowError { row: number; message: string } // 1-based spreadsheet row incl. header
export interface NormalizeResult { products: NormalizedProduct[]; errors: RowError[]; duplicates: number }

const str = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s.length ? s : null;
};

export function normalizeRows(rows: RawRow[], mapping: ColumnMapping): NormalizeResult {
  if (!mapping.sku) throw new Error("A SKU / part number column must be mapped.");
  if (!mapping.cost) throw new Error("A cost column must be mapped.");
  const get = (r: RawRow, f: ImportField) => (mapping[f] ? r[mapping[f]!] : undefined);
  const bySku = new Map<string, NormalizedProduct>();
  const errors: RowError[] = [];
  let duplicates = 0;
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const sku = str(get(r, "sku"));
    if (!sku) {
      if (Object.values(r).some((v) => str(v))) errors.push({ row: rowNo, message: "Missing SKU" });
      return;
    }
    const cost = parseMoneyToCents(get(r, "cost"));
    if (cost === null || cost < 0) {
      errors.push({ row: rowNo, message: `Invalid cost "${String(get(r, "cost") ?? "")}"` });
      return;
    }
    const model = str(get(r, "model"));
    const name = str(get(r, "name")) ?? str(get(r, "description")) ?? model ?? sku;
    if (bySku.has(sku.toUpperCase())) duplicates++; // last one wins
    bySku.set(sku.toUpperCase(), {
      sku, model, name,
      manufacturer: str(get(r, "manufacturer")),
      category: str(get(r, "category")),
      description: str(get(r, "description")),
      costCents: cost,
      msrpCents: parseMoneyToCents(get(r, "msrp")),
      mapCents: parseMoneyToCents(get(r, "map")),
    });
  });
  return { products: [...bySku.values()], errors, duplicates };
}
