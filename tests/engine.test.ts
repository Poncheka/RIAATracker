import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDistroKidReport, classify } from "../supabase/functions/_shared/distrokid.ts";
import { computeCertifications, tierFor, nextTier } from "../supabase/functions/_shared/riaa.ts";

const H = "Reporting Date\tSale Month\tStore\tArtist\tTitle\tISRC\tUPC\tQuantity\tTeam Percentage\tSong/Album\tCountry of Sale\tSongwriter Royalties Withheld\tEarnings (USD)";
const row = (store: string, title: string, isrc: string, upc: string, qty: number, kind = "Song", country = "US", month = "2026-01") =>
  ["2026-04-05", month, store, "A", title, isrc, upc, qty, 100, kind, country, 0, 1].join("\t");

test("tiers", () => {
  assert.equal(tierFor(499_999).level, "none");
  assert.equal(tierFor(500_000).level, "gold");
  assert.equal(tierFor(1_000_000).level, "platinum");
  assert.equal(tierFor(3_200_000).label, "3× Platinum");
  assert.equal(tierFor(10_000_000).level, "diamond");
  assert.equal(nextTier(9_100_000).label, "Diamond");
  assert.equal(nextTier(1_500_000).label, "2× Platinum");
});

test("classifies stores", () => {
  assert.equal(classify("Spotify", "Song").kind, "stream");
  assert.equal(classify("iTunes", "Song").kind, "track_download");
  assert.equal(classify("iTunes", "Album").kind, "album_download");
  assert.equal(classify("Apple Music", "Song").kind, "stream");
  assert.equal(classify("TikTok", "Song").kind, "excluded");
  assert.equal(classify("YouTube (Content ID)", "Song").kind, "excluded");
  assert.equal(classify("SiriusXM", "Song").kind, "excluded");
});

test("single = downloads + streams/150, US only", () => {
  const csv = [H, row("Spotify", "Song 1", "X1", "U1", 150_000), row("iTunes", "Song 1", "X1", "U1", 100), row("Spotify", "Song 1", "X1", "U1", 999_999, "Song", "GB"), row("TikTok", "Song 1", "X1", "U1", 5_000_000)].join("\n");
  const p = parseDistroKidReport(csv);
  const r = computeCertifications(p.monthly, p.excluded);
  assert.equal(r.singles.length, 1);
  assert.equal(r.singles[0].units, 1_100);
  assert.equal(p.excluded.byReason["Outside the US"], 999_999);
  assert.equal(p.excluded.byReason["Social / UGC"], 5_000_000);
});

test("clean/explicit versions combine into one single", () => {
  const csv = [H, row("Spotify", "Song 1 (Explicit)", "X1", "U1", 150), row("Spotify", "Song 1 (Clean)", "X2", "U2", 150)].join("\n");
  const r = computeCertifications(parseDistroKidReport(csv).monthly);
  assert.equal(r.singles.length, 1);
  assert.equal(r.singles[0].units, 2);
});

test("album = album dl + track dl/10 + streams/1500, incl. pre-release single UPC", () => {
  const csv = [H,
    row("Spotify", "T1", "X1", "111", 1500), row("Spotify", "T2", "X2", "111", 1500), row("Spotify", "T3", "X3", "111", 1500),
    row("Spotify", "T1", "X1", "222", 3000), // single's own UPC still counts toward the album
    row("iTunes", "T2", "X2", "111", 20), row("iTunes", "", "", "111", 7, "Album"),
  ].join("\n");
  const r = computeCertifications(parseDistroKidReport(csv).monthly);
  assert.equal(r.albums.length, 1);
  assert.equal(r.albums[0].units, 7 + 2 + 5); // 7 album dl + 20/10 + 7500/1500
});

test("CSV with quotes and comma delimiter", () => {
  const csv = 'Sale Month,Store,Artist,Title,ISRC,UPC,Quantity,Country of Sale\n2026-02,Spotify,"Harbor, June","Hi, there",X9,U9,"1,500",US\n';
  const p = parseDistroKidReport(csv);
  assert.equal(p.monthly[0].streams, 1500);
  assert.equal(p.monthly[0].title, "Hi, there");
});

test("pace + ETA", () => {
  const rows = [H];
  for (let m = 1; m <= 6; m++) rows.push(row("Spotify", "S", "X", "U", 150 * 50_000, "Song", "US", `2026-0${m}`)); // 50K units/mo
  const r = computeCertifications(parseDistroKidReport(rows.join("\n")).monthly);
  assert.equal(r.singles[0].units, 300_000);
  assert.equal(r.singles[0].monthlyPace, 50_000);
  assert.equal(r.singles[0].monthsToNext, 4);
});

test("UnitedMasters monthly statement has no stream counts → clear warning, no rows", () => {
  const text = readFileSync(new URL("./fixtures/unitedmasters-monthly-header.csv", import.meta.url), "utf8");
  const p = parseDistroKidReport(text);
  assert.equal(p.monthly.length, 0);
  assert.match(p.warnings[0], /Missing required column/);
});

test("generic distributor headers (Platform / Territory / Units / Track Title)", () => {
  const csv = "Sales Month,Platform,Territory,Track Title,Track Artist,ISRC,UPC,Units,Sale Type\n2026-03,Spotify,US,Song A,Artist,X1,123,150,Stream\n2026-03,Apple Music,GB,Song A,Artist,X1,123,999,Stream\n";
  const p = parseDistroKidReport(csv);
  assert.equal(p.monthly[0].streams, 150);
  assert.equal(p.excluded.byReason["Outside the US"], 999);
});
