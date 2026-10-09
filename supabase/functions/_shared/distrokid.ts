// DistroKid royalty report parser.
// Pure TypeScript, no dependencies — runs in Deno (Supabase Edge Functions),
// Node and the browser. Header names are matched loosely so it survives the
// small differences between DistroKid's raw export and Mogul's normalized copy.

export type UsageKind = "stream" | "track_download" | "album_download" | "excluded";

export interface UsageRow {
  period: string; // YYYY-MM (sale month)
  store: string;
  artist: string;
  title: string;
  album: string;
  isrc: string;
  upc: string;
  country: string;
  quantity: number;
  kind: UsageKind;
  excludedReason?: string;
}

/** Monthly US-only aggregate per ISRC+UPC. This is what we persist. */
export interface UsageMonthly {
  period: string;
  isrc: string;
  upc: string;
  title: string;
  artist: string;
  album: string;
  streams: number; // US on-demand audio/video streams
  trackDownloads: number; // US permanent track downloads
  albumDownloads: number; // US permanent album downloads (isrc may be "")
}

export interface ExcludedSummary {
  streams: number; // all quantities we did not count
  byReason: Record<string, number>;
  byStore: Record<string, number>;
}

export interface ParseResult {
  rows: UsageRow[];
  monthly: UsageMonthly[];
  excluded: ExcludedSummary;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split("\n", 1)[0];
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) out.push(row);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_ALIASES: Record<string, string[]> = {
  period: ["salemonth", "salesmonth", "salesperiod", "period", "month", "usagemonth", "reportingperiod"],
  store: ["store", "dsp", "service", "platform", "retailer", "storename"],
  artist: ["artist", "artistname", "primaryartist"],
  title: ["title", "songtitle", "tracktitle", "track", "trackname", "song"],
  album: ["album", "albumtitle", "release", "releasetitle", "releasename", "product"],
  isrc: ["isrc"],
  upc: ["upc", "ean", "upcean", "barcode"],
  quantity: ["quantity", "qty", "units", "streams", "plays", "count"],
  country: ["countryofsale", "country", "territory", "countrycode", "region"],
  kind: ["songalbum", "sourcetype", "type", "producttype", "salestype", "configuration", "format"],
};

function mapHeaders(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  const normalized = header.map(norm);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = normalized.findIndex((h) => aliases.includes(h));
    if (i >= 0) idx[key] = i;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// RIAA eligibility rules applied per row
// ---------------------------------------------------------------------------

const US = new Set(["us", "usa", "unitedstates", "unitedstatesofamerica", "px", "usmilitary"]);

// Stores whose rows are UGC, social, fitness or programmed radio. RIAA only
// counts on-demand streams from label-reported services, and no UGC.
const EXCLUDED_STORES: Array<[RegExp, string]> = [
  [/tik ?tok|capcut|resso|triller|snap|instagram|facebook|\bmeta\b|social/i, "Social / UGC"],
  [/content ?id|ugc|shorts|youtube \(ugc\)/i, "Social / UGC"],
  [/peloton|fitness|roblox|twitch|game|\bluna\b/i, "Fitness / gaming"],
  [/itunes match|locker/i, "Cloud locker"],
  [/sirius|sxm|soundexchange|radio(?!.*all ?access)/i, "Programmed radio"],
];

const DOWNLOAD_STORES = /itunes|download|purchase|beatport|7digital|google play store|juno|traxsource|bandcamp/i;
const STREAM_STORES =
  /spotify|apple music|amazon|youtube|tidal|deezer|napster|pandora|soundcloud|audiomack|anghami|boomplay|iheart|qobuz|kkbox|joox|jiosaavn|gaana|yandex|vk|zvuk|netease|tencent|line music|awa|claro|trebel|melon|genie|flo/i;

export function classify(store: string, kindRaw: string): { kind: UsageKind; reason?: string } {
  for (const [re, reason] of EXCLUDED_STORES) if (re.test(store)) return { kind: "excluded", reason };
  const isAlbum = /album/i.test(kindRaw);
  if (DOWNLOAD_STORES.test(store) && !/apple music|unlimited|prime|stream/i.test(store)) {
    return { kind: isAlbum ? "album_download" : "track_download" };
  }
  if (STREAM_STORES.test(store)) return { kind: "stream" };
  return { kind: "excluded", reason: "Unrecognized store" };
}

function toPeriod(raw: string, fallback: string): string {
  const s = (raw || "").trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})/); // 2026-01, 2026/1, 2026-01-31
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); // 01/31/2026
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{4})$/); // 01/2026
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  if (s && !isNaN(d.getTime())) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return fallback;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function parseDistroKidReport(text: string, opts: { fallbackPeriod?: string } = {}): ParseResult {
  const warnings: string[] = [];
  const table = parseDelimited(text);
  const empty: ParseResult = { rows: [], monthly: [], excluded: { streams: 0, byReason: {}, byStore: {} }, warnings };
  if (table.length < 2) { warnings.push("Report is empty"); return empty; }

  const h = mapHeaders(table[0]);
  for (const req of ["store", "quantity"]) if (h[req] === undefined) {
    warnings.push(`Missing required column: ${req}. Headers were: ${table[0].join(" | ")}`);
    return empty;
  }
  if (h.isrc === undefined && h.title === undefined) { warnings.push("Report has neither ISRC nor title"); return empty; }
  if (h.country === undefined) warnings.push("No country column — counting all territories (RIAA is US-only, so this overstates progress)");

  const get = (r: string[], k: string) => (h[k] === undefined ? "" : (r[h[k]] ?? "").trim());
  const fallback = opts.fallbackPeriod ?? "";
  const rows: UsageRow[] = [];
  const excluded: ExcludedSummary = { streams: 0, byReason: {}, byStore: {} };

  for (const r of table.slice(1)) {
    const quantity = Number(get(r, "quantity").replace(/,/g, "")) || 0;
    if (quantity <= 0) continue; // refunds/negatives don't move certification
    const store = get(r, "store");
    const country = get(r, "country");
    let { kind, reason } = classify(store, get(r, "kind"));
    if (kind !== "excluded" && h.country !== undefined && !US.has(norm(country))) {
      kind = "excluded"; reason = "Outside the US";
    }
    const row: UsageRow = {
      period: toPeriod(get(r, "period"), fallback),
      store, country, quantity, kind,
      artist: get(r, "artist"),
      title: get(r, "title"),
      album: get(r, "album"),
      isrc: get(r, "isrc").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      upc: get(r, "upc").replace(/\D/g, ""),
    };
    if (reason) row.excludedReason = reason;
    rows.push(row);
    if (kind === "excluded") {
      excluded.streams += quantity;
      excluded.byReason[reason!] = (excluded.byReason[reason!] ?? 0) + quantity;
      if (reason !== "Outside the US") excluded.byStore[store] = (excluded.byStore[store] ?? 0) + quantity;
    }
  }

  return { rows, monthly: aggregateMonthly(rows), excluded, warnings };
}

export function aggregateMonthly(rows: UsageRow[]): UsageMonthly[] {
  const map = new Map<string, UsageMonthly>();
  for (const r of rows) {
    if (r.kind === "excluded") continue;
    // Fall back to title+artist as the key when a report has no ISRC.
    const isrc = r.kind === "album_download" ? "" : r.isrc || `T:${norm(r.artist)}:${norm(r.title)}`;
    const key = `${r.period}|${isrc}|${r.upc}`;
    let m = map.get(key);
    if (!m) {
      m = { period: r.period, isrc, upc: r.upc, title: r.kind === "album_download" ? "" : r.title, artist: r.artist, album: r.album, streams: 0, trackDownloads: 0, albumDownloads: 0 };
      map.set(key, m);
    }
    if (r.kind === "stream") m.streams += r.quantity;
    else if (r.kind === "track_download") m.trackDownloads += r.quantity;
    else if (r.kind === "album_download") m.albumDownloads += r.quantity;
    if (!m.album && r.album) m.album = r.album;
  }
  return [...map.values()];
}

export function mergeExcluded(list: ExcludedSummary[]): ExcludedSummary {
  const out: ExcludedSummary = { streams: 0, byReason: {}, byStore: {} };
  for (const e of list) {
    out.streams += e.streams;
    for (const [k, v] of Object.entries(e.byReason)) out.byReason[k] = (out.byReason[k] ?? 0) + v;
    for (const [k, v] of Object.entries(e.byStore)) out.byStore[k] = (out.byStore[k] ?? 0) + v;
  }
  return out;
}

/** US, RIAA-eligible usage per month × ISRC × UPC × store. Feeds the RIAA package. */
export interface UsageByStore {
  period: string; isrc: string; upc: string; title: string; artist: string; store: string;
  streams: number; trackDownloads: number; albumDownloads: number;
}

export function aggregateByStore(rows: UsageRow[]): UsageByStore[] {
  const map = new Map<string, UsageByStore>();
  for (const r of rows) {
    if (r.kind === "excluded") continue;
    const isrc = r.kind === "album_download" ? "" : r.isrc || `T:${norm(r.artist)}:${norm(r.title)}`;
    const key = `${r.period}|${isrc}|${r.upc}|${r.store}`;
    let m = map.get(key);
    if (!m) map.set(key, (m = { period: r.period, isrc, upc: r.upc, title: r.title, artist: r.artist, store: r.store, streams: 0, trackDownloads: 0, albumDownloads: 0 }));
    if (r.kind === "stream") m.streams += r.quantity;
    else if (r.kind === "track_download") m.trackDownloads += r.quantity;
    else m.albumDownloads += r.quantity;
  }
  return [...map.values()];
}
