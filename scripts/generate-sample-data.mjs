// Generates 24 months of fictional DistroKid statements (TSV, DistroKid's
// export header) for demo mode and tests. Artist and songs are invented.
// Usage: node scripts/generate-sample-data.mjs [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "sample-data";
mkdirSync(out, { recursive: true });

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const ARTIST = "June Harbor";
const ALBUM_UPC = "198000000017";
// title, isrc, upc(s), releaseIdx, peak monthly US streams, decay
const TRACKS = [
  ["Low Orbit", "QZDA62400001", ["198000000001", ALBUM_UPC], 0, 13_500_000, 0.93],
  ["Glass Coast", "QZDA62400002", ["198000000002", ALBUM_UPC], 2, 6_200_000, 0.94],
  ["Saltwater Hymn", "QZDA62400003", [ALBUM_UPC], 4, 4_100_000, 0.975],
  ["Copper Sun", "QZDA62400004", [ALBUM_UPC], 4, 1_300_000, 0.96],
  ["Hollow Bloom", "QZDA62400005", [ALBUM_UPC], 4, 900_000, 0.95],
  ["Northbound", "QZDA62400006", [ALBUM_UPC], 4, 650_000, 0.95],
  ["Paper Lanterns", "QZDA62400007", [ALBUM_UPC], 4, 420_000, 0.95],
  ["Last Ferry Home", "QZDA62400008", [ALBUM_UPC], 4, 380_000, 0.96],
  ["Velvet Static", "QZDA62500009", ["198000000009"], 12, 2_400_000, 1.03],
  ["Night Shift Radio", "QZDA62500010", ["198000000010"], 18, 1_900_000, 1.06],
];
const STREAM_STORES = [["Spotify", 0.62], ["Apple Music", 0.21], ["Amazon Unlimited", 0.06], ["YouTube Music", 0.07], ["Tidal", 0.02], ["Deezer", 0.02]];
const HEADER = ["Reporting Date", "Sale Month", "Store", "Artist", "Title", "ISRC", "UPC", "Quantity", "Team Percentage", "Song/Album", "Country of Sale", "Songwriter Royalties Withheld", "Earnings (USD)"];

const start = new Date(Date.UTC(2024, 9, 1)); // 2024-10
for (let i = 0; i < 24; i++) {
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
  const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const reported = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 5)).toISOString().slice(0, 10);
  const lines = [HEADER.join("\t")];
  const row = (store, t, isrc, upc, qty, kind, country, rate) =>
    lines.push([reported, period, store, ARTIST, t, isrc, upc, Math.round(qty), "100", kind, country, "0", (qty * rate).toFixed(4)].join("\t"));

  for (const [title, isrc, upcs, rel, peak, decay] of TRACKS) {
    const age = i - rel;
    if (age < 0) continue;
    const ramp = age === 0 ? 0.55 : age === 1 ? 0.9 : 1;
    const us = peak * ramp * Math.pow(decay, Math.max(0, age - 1)) * (0.92 + rand() * 0.16);
    // streams split across the single's UPC and the album UPC once the album is out
    const upcSplit = upcs.length > 1 && i >= 4 ? [[upcs[0], 0.55], [upcs[1], 0.45]] : [[upcs[0], 1]];
    for (const [upc, share] of upcSplit) {
      for (const [store, s] of STREAM_STORES) {
        row(store, title, isrc, upc, us * share * s, "Song", "US", 0.0038);
        row(store, title, isrc, upc, us * share * s * 0.55, "Song", ["GB", "CA", "DE", "AU", "MX"][Math.floor(rand() * 5)], 0.0031);
      }
      row("iTunes", title, isrc, upc, us * share * 0.0009, "Song", "US", 0.7);
    }
    row("TikTok", title, isrc, upcs[0], us * 0.35, "Song", "US", 0.0004);
    row("YouTube (Content ID)", title, isrc, upcs[0], us * 0.12, "Song", "US", 0.0006);
  }
  if (i >= 4) row("iTunes", "Low Orbit", "", ALBUM_UPC, 900 * Math.pow(0.9, i - 4) + rand() * 50, "Album", "US", 6.5);
  writeFileSync(join(out, `${period}.tsv`), lines.join("\n") + "\n");
}
console.log(`Wrote 24 monthly statements to ${out}/`);
