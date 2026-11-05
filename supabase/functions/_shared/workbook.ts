// Excel workbooks (.xlsx and legacy .xls) → plain tables for statements.ts.
// The SheetJS module is passed in so this file runs anywhere:
//   Deno:  import * as XLSX from "npm:xlsx@0.18.5"
//   Node:  import * as XLSX from "xlsx"
import type { Table } from "./statements.ts";

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

// deno-lint-ignore no-explicit-any
export function workbookTables(XLSX: any, bytes: Uint8Array): Table[] {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  return wb.SheetNames.map((name: string) => {
    const ws = wb.Sheets[name];
    // Some exporters write a wrong sheet dimension (e.g. Sony): rebuild it from the cells.
    let maxR = 0, maxC = 0;
    for (const k of Object.keys(ws)) {
      if (k[0] === "!") continue;
      const a = XLSX.utils.decode_cell(k);
      if (a.r > maxR) maxR = a.r;
      if (a.c > maxC) maxC = a.c;
    }
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false }) as unknown[][];
    return {
      name,
      rows: rows.map((r) => r.map((c) =>
        c == null ? "" : c instanceof Date ? iso(c) : typeof c === "number" ? (Number.isInteger(c) ? c.toFixed(0) : String(c)) : String(c))),
    };
  });
}
