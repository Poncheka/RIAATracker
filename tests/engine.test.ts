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

// ---- multi-source reader (synthetic fixtures; never commit customer statements) ----
import { parseStatementText, parseStatementBytes, parseStatementTables } from "../supabase/functions/_shared/statements.ts";

const utf16le = (s: string) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 255; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };

test("UTF-16 without BOM, tab-delimited", () => {
  const p = parseStatementBytes(utf16le("Period\tStore\tCountry\tTrack Title\tISRC\tQuantity\n2025-06\tSpotify\tUS\tSong\tUSABC2500001\t300\n"));
  assert.equal(p.monthly[0].streams, 300);
  assert.equal(p.monthly[0].period, "2025-06");
});

test("CR-only line endings and a header below a title block", () => {
  const text = ["Label Royalty Statement", "Period: Q2 2025", "", "Sales Period,Retailer,Territory,Track,ISRC,Units,Sale Type", "2025-04,Apple Music,US,Song,USABC2500001,1500,Stream", "2025-04,iTunes,US,Song,USABC2500001,4,Download"].join("\r");
  const p = parseStatementText(text);
  assert.equal(p.monthly[0].streams, 1500);
  assert.equal(p.monthly[0].trackDownloads, 4);
});

test("separate stream/download columns with year + month (RouteNote style)", () => {
  const csv = "Year,Month,Store,Country,Title,ISRC,Stream,Downloads\n2025,3,Spotify,US,Song,USABC2500001,900,0\n2025,3,iTunes,US,Song,USABC2500001,0,2\n";
  const p = parseStatementText(csv, { target: "ROUTE_NOTE" });
  assert.equal(p.monthly[0].period, "2025-03");
  assert.equal(p.monthly[0].streams, 900);
  assert.equal(p.monthly[0].trackDownloads, 2);
});

test("worldwide-only rows are excluded as 'No country breakdown'", () => {
  const csv = "Period,Source,Region,Title,ISRC,Net Units\n2025-01,Spotify Premium,All,Song,USABC2500001,5000\n";
  const p = parseStatementText(csv, { target: "ROYALTY_SHARE" });
  assert.equal(p.monthly.length, 0);
  assert.equal(p.excluded.byReason["No country breakdown"], 5000);
});

test("publishing statements are rejected with a clear message", () => {
  const csv = "Period,Source,Title,Writers,Territory,Units,Royalty\n2025-01,Spotify,Song,Jane Doe,US,1000,1.20\n";
  const p = parseStatementText(csv);
  assert.equal(p.monthly.length, 0);
  assert.match(p.warnings[0], /^Unsupported statement: This is a publishing statement/);
});

test("voided rows reverse the original (Symphonic style)", () => {
  const csv = "Activity Period,Digital Service Provider,Territory,Track Title,ISRC,Count,Delivery,Sale or Void\n2025-01,Spotify,US,Song,USABC2500001,1000,Streaming,Sale\n2025-01,Spotify,US,Song,USABC2500001,400,Streaming,Void\n";
  const p = parseStatementText(csv, { target: "SYMPHONIC" });
  assert.equal(p.monthly[0].streams, 600);
});

test("sync, physical and neighboring-rights sources say why they can't count", () => {
  for (const target of ["ZYNC", "REDEYE_WORLDWIDE", "KOLLECTIVE"]) {
    const p = parseStatementText("a,b\n1,2\n", { target });
    assert.match(p.warnings[0], /^Unsupported statement:/);
  }
});

test("revenue-only UnitedMasters file gets the friendly message", () => {
  const text = readFileSync(new URL("./fixtures/unitedmasters-monthly-header.csv", import.meta.url), "utf8");
  const p = parseStatementText(text, { target: "UNITED_MASTERS" });
  assert.match(p.warnings[0], /^Unsupported statement: These statements only show money/);
});

test("excel-style tables: header found on a later sheet", () => {
  const p = parseStatementTables([
    { name: "Summary", rows: [["Statement summary"], ["Total", "123.45"]] },
    { name: "Detail", rows: [["Sales Month", "DSP", "Country", "Track Title", "ISRC", "Quantity", "Sales Type"], ["2025-05-01", "Amazon Music Unlimited", "United States", "Song", "USABC2500001", "3000", "Streaming"]] },
  ]);
  assert.equal(p.monthly[0].streams, 3000);
  assert.equal(p.meta?.sheet, "Detail");
});

test("cloud locker, radio and fees never count", () => {
  assert.equal(classify("iTunes Match", "").kind, "excluded");
  assert.equal(classify("Pandora", "Non-Interactive Radio").kind, "excluded");
  assert.equal(classify("Spotify", "Distribution Fee").kind, "excluded");
  assert.equal(classify("NetEase Cloud Music", "Stream").kind, "stream");
});

test("UMG US artist statement: Source is the territory, Excel =\"...\" quoting", () => {
  const csv = [
    "Summary", "RoySys,Acct_no,Dom_Earnings", '"US","=""1""","1.00"', "", "Detail",
    "RoySys,Acct_no,Source,Title,DSP,Sales Type,Sales Date,Selection,Units",
    '"US","=""1""","THIRD PARTY","SONG","=""SPOTIFY""","SUBSCRIPTIONS","=""06/25""","=""USABC2500001""","3000"',
    '"US","=""1""","DOMESTIC UMG","SONG","=""APPLE""","PERMANENT DOWNLOAD","=""06/25""","=""USABC2500001""","5"',
    '"US","=""1""","CANADA","SONG","=""SPOTIFY""","SUBSCRIPTIONS","=""06/25""","=""USABC2500001""","900"',
    '"US","=""1""","THIRD PARTY","SONG","=""TIKTOK""","USER GENERATED STREAMS","=""06/25""","=""USABC2500001""","10000"',
  ].join("\n");
  const p = parseStatementText(csv, { target: "UNIVERSAL_MUSIC_NORTH_AMERICA" });
  assert.equal(p.monthly[0].period, "2025-06");
  assert.equal(p.monthly[0].isrc, "USABC2500001");
  assert.equal(p.monthly[0].streams, 3000);
  assert.equal(p.monthly[0].trackDownloads, 5);
  assert.equal(p.excluded.byReason["Outside the US"], 900);
});
