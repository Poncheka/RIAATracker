// Builds the files for a "RIAA package": the US sales summary by DSP that the
// RIAA / GR&F audit asks for, plus a cover sheet and a request email template.
// Pure TypeScript; the caller zips the returned file map.

import type { UsageByStore } from "./distrokid.ts";
import { STREAMS_PER_ALBUM_UNIT, STREAMS_PER_SINGLE_UNIT, TRACK_DOWNLOADS_PER_ALBUM_UNIT, type CertItem } from "./riaa.ts";

export interface PackageInput {
  item: CertItem;
  artist: string;
  sourceName: string;
  asOf: string; // YYYY-MM
  byStore: UsageByStore[]; // any rows; filtered to this release here
  statements?: Array<{ name: string; text: string }>;
  generatedAt?: Date;
}

const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";
const n = (x: number) => Math.round(x * 100) / 100;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const month = (p: string) => { const [y, m] = p.split("-").map(Number); return y && m ? new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : p; };
export const packageFileName = (item: CertItem) =>
  `riaa-package-${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "release"}.zip`;

export function buildRiaaPackage(input: PackageInput): Record<string, string> {
  const { item, artist, sourceName, asOf } = input;
  const isAlbum = item.type === "album";
  const isrcs = new Set(item.isrcs);
  const rows = input.byStore.filter((r) => (r.isrc && isrcs.has(r.isrc)) || (isAlbum && !r.isrc && r.upc === item.upc && r.albumDownloads > 0));
  const unitsOf = (s: number, td: number, ad: number) =>
    isAlbum ? ad + td / TRACK_DOWNLOADS_PER_ALBUM_UNIT + s / STREAMS_PER_ALBUM_UNIT : td + s / STREAMS_PER_SINGLE_UNIT;
  const title = (r: UsageByStore) => (r.isrc ? r.title : `${item.title} (album download)`);

  // 1) by DSP, all months
  const byDsp = new Map<string, { store: string; isrc: string; title: string; s: number; td: number; ad: number }>();
  for (const r of rows) {
    const k = `${r.store}|${r.isrc}`;
    const a = byDsp.get(k) ?? { store: r.store, isrc: r.isrc, title: title(r), s: 0, td: 0, ad: 0 };
    a.s += r.streams; a.td += r.trackDownloads; a.ad += r.albumDownloads; byDsp.set(k, a);
  }
  const dspRows = [...byDsp.values()].sort((a, b) => a.store.localeCompare(b.store) || a.title.localeCompare(b.title));
  const tot = dspRows.reduce((t, r) => ({ s: t.s + r.s, td: t.td + r.td, ad: t.ad + r.ad }), { s: 0, td: 0, ad: 0 });
  const summaryCsv = csv([
    ["DSP", "ISRC", "Track", "US on-demand streams", "US track downloads", "US album downloads", `RIAA ${isAlbum ? "album" : "single"} units`],
    ...dspRows.map((r) => [r.store, r.isrc, r.title, r.s, r.td, r.ad, n(unitsOf(r.s, r.td, r.ad))]),
    ["TOTAL", "", "", tot.s, tot.td, tot.ad, n(unitsOf(tot.s, tot.td, tot.ad))],
  ]);

  // 2) by month × DSP
  const monthCsv = csv([
    ["Month", "DSP", "ISRC", "Track", "US on-demand streams", "US track downloads", "US album downloads"],
    ...[...rows].sort((a, b) => a.period.localeCompare(b.period) || a.store.localeCompare(b.store) || a.isrc.localeCompare(b.isrc))
      .map((r) => [r.period, r.store, r.isrc, title(r), r.streams, r.trackDownloads, r.albumDownloads]),
  ]);

  // 3) track list
  const tracks = new Map<string, { title: string; upcs: Set<string>; first: string; s: number; td: number }>();
  for (const r of rows) {
    if (!r.isrc) continue;
    const t = tracks.get(r.isrc) ?? { title: r.title, upcs: new Set<string>(), first: r.period, s: 0, td: 0 };
    if (r.upc) t.upcs.add(r.upc);
    if (r.period < t.first) t.first = r.period;
    t.s += r.streams; t.td += r.trackDownloads; tracks.set(r.isrc, t);
  }
  const tracksCsv = csv([
    ["ISRC", "Track", "Artist", "UPCs seen", "First US sale month", "US on-demand streams", "US track downloads"],
    ...[...tracks.entries()].map(([isrc, t]) => [isrc, t.title, artist, [...t.upcs].join(" "), t.first, t.s, t.td]),
  ]);

  const firstMonth = [...tracks.values()].map((t) => t.first).sort()[0] ?? item.firstPeriod;
  const level = item.current.level === "none" ? item.next.label : item.current.label;
  const units = unitsOf(tot.s, tot.td, tot.ad);
  const statementNames = (input.statements ?? []).map((s) => s.name);
  const gen = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);

  const email = `To: RIAA Gold & Platinum Program (see riaa.com/gold-platinum for the current request address)
Subject: Certification request: ${artist} - "${item.title}" (${isAlbum ? "Album" : "Digital Single"}, ${level})

Hello,

I'd like to request ${level} certification for the following release:

Record company / label:  [YOUR LABEL NAME — for self-released music, you or your company]
Label imprint:           [same as above if none]
Artist:                  ${artist}
Title:                   ${item.title}
Configuration:           ${isAlbum ? `Album (${item.trackCount} tracks, UPC ${item.upc ?? ""})` : "Digital Single"}
Level requested:         ${level}
Selection / catalog #:   [CATALOG NUMBER${isAlbum && item.upc ? ` or UPC ${item.upc}` : ""}]
Release date:            [RELEASE DATE — first US sales appear in ${month(firstMonth)}]
Genre:                   [GENRE]${isAlbum ? "\nSuggested retail price:  [SRLP]" : ""}

Attached: a US sales summary by DSP covering permanent downloads and on-demand streams only
(international, UGC and non-interactive plays excluded), ISRCs for every track, and our
${sourceName} royalty statements. Label copy and audio files are attached separately.

Our own count: ${Math.round(units).toLocaleString("en-US")} US units through ${month(asOf)}.

Thank you,
[NAME]
[PHONE / EMAIL]
`;

  const cover = `<!doctype html><html><head><meta charset="utf-8"><title>RIAA package: ${esc(item.title)}</title>
<style>body{font:15px/1.55 -apple-system,Segoe UI,Inter,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111}
h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}.muted{color:#666}table{border-collapse:collapse;width:100%}
td,th{text-align:left;padding:6px 10px;border-bottom:1px solid #ddd}th{background:#f5f5f5}.box{background:#fff8e1;border:1px solid #f0d27a;padding:12px 14px;border-radius:8px}
code{background:#f3f3f3;padding:1px 5px;border-radius:4px}</style></head><body>
<p class="muted">Where's My Plaque? · RIAA application package · generated ${gen}</p>
<h1>${esc(item.title)}</h1>
<p><b>${esc(artist)}</b> · ${isAlbum ? `Album, ${item.trackCount} tracks` : "Digital single"} · counted toward <b>${esc(level)}</b></p>
<table>
<tr><th>US on-demand streams</th><td>${tot.s.toLocaleString("en-US")}</td></tr>
<tr><th>US track downloads</th><td>${tot.td.toLocaleString("en-US")}</td></tr>
${isAlbum ? `<tr><th>US album downloads</th><td>${tot.ad.toLocaleString("en-US")}</td></tr>` : ""}
<tr><th>RIAA units (our count)</th><td><b>${Math.round(units).toLocaleString("en-US")}</b> through ${month(asOf)}</td></tr>
<tr><th>Unit rule used</th><td>${isAlbum ? "1 album download = 10 track downloads = 1,500 on-demand streams" : "1 download = 150 on-demand audio/video streams"}</td></tr>
</table>
<div class="box" style="margin-top:18px"><b>This is an estimate, not an RIAA certification.</b> It comes from your ${esc(sourceName)} statements.
Certification happens only after you apply and Gelfand, Rennert &amp; Feldman (GR&amp;F) audits the numbers, for a fee.</div>

<h2>What's in this folder</h2>
<table>
<tr><td><code>us-sales-by-dsp.csv</code></td><td>The audit's core document: US permanent downloads and on-demand streams by DSP, totals and units.</td></tr>
<tr><td><code>us-sales-by-month-and-dsp.csv</code></td><td>The same data month by month, for the auditor's reconciliation.</td></tr>
<tr><td><code>tracks.csv</code></td><td>Every ISRC counted, with the UPCs it appeared under.</td></tr>
<tr><td><code>riaa-request-email.txt</code></td><td>A request email with everything we know filled in. Fill in the [BRACKETS].</td></tr>
${statementNames.length ? `<tr><td><code>statements/</code></td><td>Your original ${esc(sourceName)} statements (${statementNames.length} file${statementNames.length > 1 ? "s" : ""}). The auditor may ask for these.</td></tr>` : ""}
</table>

<h2>What you still need to add</h2>
<ol>
<li><b>Audio.</b> A digital copy of each track, tagged with its ISRC.</li>
<li><b>Label copy</b> for every track${isAlbum ? " and every version of the album (standard, deluxe, clean…)" : ""}: title, artist, writers, producers, ISRC, running time.</li>
<li><b>Release date</b> for each track${isAlbum ? " and the album" : ""}. We can only see the first month with US sales (${month(firstMonth)}).</li>
<li><b>Catalog number and genre.</b> Your distributor's UPC works as a catalog number for most self-released music.</li>
${isAlbum ? "<li><b>Suggested retail price</b> of the album.</li>" : ""}
</ol>

<h2>How we counted</h2>
<ul>
<li>US only. International streams and sales are excluded.</li>
<li>On-demand streams from subscription and ad-supported services count. TikTok, Facebook/Instagram, YouTube Content ID (UGC), fitness/gaming services and programmed radio don't.</li>
<li>${isAlbum ? "Every track that appears on this album counts, including singles released first under their own UPC." : "Clean, explicit and edited versions of the same song are combined. Remixes and live versions aren't."}</li>
<li>Rows with zero or negative quantities (refunds, adjustments) are ignored.</li>
</ul>
<p class="muted">Rules: RIAA ${isAlbum ? "Album" : "Digital Single"} Award certification audit requirements (Sept 2023). Not affiliated with or endorsed by the RIAA.</p>
</body></html>`;

  const files: Record<string, string> = {
    "00-READ-ME-FIRST.html": cover,
    "us-sales-by-dsp.csv": summaryCsv,
    "us-sales-by-month-and-dsp.csv": monthCsv,
    "tracks.csv": tracksCsv,
    "riaa-request-email.txt": email,
  };
  for (const s of input.statements ?? []) files[`statements/${s.name}`] = s.text;
  return files;
}
