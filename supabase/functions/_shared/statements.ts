// Sound-recording royalty statement reader.
//
// Reads line-item statements from distributors and labels (DistroKid, TuneCore,
// The Orchard, Empire, Sony, Warner, UMG, ...) and turns them into US-only,
// RIAA-eligible usage: on-demand streams, track downloads, album downloads.
//
// Pure TypeScript, no dependencies: runs in Deno (Supabase Edge Functions), Node
// and the browser. Excel workbooks are read elsewhere (workbook.ts, Deno only)
// and handed in as plain tables.
//
// How a file is read:
//   1. Text files are decoded (UTF-8, UTF-8 BOM, UTF-16 LE/BE with or without a
//      BOM) and line endings normalized (CRLF, LF and CR-only all work).
//   2. In every table (or sheet) the first 60 rows are scanned for the row that
//      looks most like a line-item header. Summary blocks above it are skipped.
//   3. Columns are mapped to roles (quantity, store, type, country, ISRC, ...)
//      by name. Per-source profiles pin the right column where generic names
//      are ambiguous.
//   4. Each row is classified from its store/service and its sale-type text.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsageKind = "stream" | "track_download" | "album_download" | "excluded";

export interface UsageRow {
  period: string; // YYYY-MM
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
  streams: number;
  trackDownloads: number;
  albumDownloads: number;
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
  /** What the reader found, for debugging and the admin view. */
  meta?: { sheet?: string; headerRow: number; columns: Record<string, string>; dataRows: number };
}

/** US, RIAA-eligible usage per month × ISRC × UPC × store. Feeds the RIAA package. */
export interface UsageByStore {
  period: string; isrc: string; upc: string; title: string; artist: string; store: string;
  streams: number; trackDownloads: number; albumDownloads: number;
}

export interface Table { name?: string; rows: string[][] }

export interface ParseOptions {
  fallbackPeriod?: string; // YYYY-MM, YYYY-Qn, YYYY-Hn — used when rows carry no date
  target?: string; // Mogul IntegrationTarget, e.g. "THE_ORCHARD", selects a profile
}

export class UnsupportedStatement extends Error {}

// ---------------------------------------------------------------------------
// Text decoding and delimited parsing
// ---------------------------------------------------------------------------

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  // UTF-16 without a BOM: lots of NUL bytes in odd (LE) or even (BE) positions.
  const n = Math.min(bytes.length, 4000);
  let oddNul = 0, evenNul = 0;
  for (let i = 0; i < n; i++) if (bytes[i] === 0) (i % 2 ? oddNul++ : evenNul++);
  if (oddNul > n / 6 && oddNul > evenNul * 4) return new TextDecoder("utf-16le").decode(bytes);
  if (evenNul > n / 6 && evenNul > oddNul * 4) return new TextDecoder("utf-16be").decode(bytes);
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const bad = (utf8.slice(0, 20000).match(/�/g) ?? []).length;
  return bad > 20 ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

export function sniffBinary(bytes: Uint8Array): "pdf" | "xlsx" | "xls" | "text" {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "xlsx";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "xls";
  return "text";
}

function detectDelimiter(lines: string[]): string {
  const cands = ["\t", ",", ";", "|"];
  let best = ",", bestScore = -1;
  for (const d of cands) {
    // the delimiter that splits the most sample lines into the same, largest width wins
    const counts = lines.map((l) => splitQuoted(l, d).length).filter((c) => c > 1);
    if (!counts.length) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [width, hits] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = hits * Math.log2(width + 1);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitQuoted(line: string, d: string): string[] {
  const out: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && f.trim() === "") { q = true; f = ""; }
    else if (c === d) { out.push(f); f = ""; }
    else f += c;
  }
  out.push(f);
  return out;
}

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const sample = clean.split("\n", 80).filter((l) => l.trim());
  const delim = delimiter ?? detectDelimiter(sample.slice(0, 60));
  const out: string[][] = [];
  let row: string[] = [], field = "", inQ = false, fieldStart = true;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQ) {
      if (c === '"') { if (clean[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
      continue;
    }
    if (c === '"' && fieldStart) { inQ = true; fieldStart = false; continue; }
    if (c === delim) { row.push(field); field = ""; fieldStart = true; continue; }
    if (c === "\n") {
      row.push(field); field = ""; fieldStart = true;
      if (row.some((x) => x.trim() !== "")) out.push(row);
      row = [];
      continue;
    }
    if (fieldStart && (c === " " || c === "\t") && c !== delim) { field += c; continue; }
    fieldStart = false;
    field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  return out;
}

// ---------------------------------------------------------------------------
// Column roles
// ---------------------------------------------------------------------------

const norm = (s: string) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

type Role = "period" | "period2" | "store" | "artist" | "title" | "album" | "isrc" | "upc" | "quantity"
  | "streamsQty" | "downloadsQty" | "country" | "year" | "month";

// Earlier names win. Matched after lower-casing and stripping punctuation.
const ROLE_ALIASES: Record<Role, string[]> = {
  quantity: ["netunits", "quantitynet", "salesunits", "saleunits", "quantity", "units", "unitssold", "numberofunitssold",
    "unitssoldnumber", "totalunits", "qty", "count", "streams", "plays", "totalevents", "netquantity", "streamcount", "volume"],
  streamsQty: ["stream"],
  downloadsQty: ["downloads"],
  store: ["store", "storename", "digitalserviceprovider", "digitalserviceproviderdsp", "dsp", "retailer", "partnername", "partner",
    "service", "subsource", "vendor", "channel", "platform", "servicename", "source", "digitalserviceprovidersubdescription",
    "incomesourcedescription", "network", "analysiscodedescription"],
  artist: ["trackartist", "trackartists", "artist", "artistname", "artists", "displayartist", "releaseartist", "releaseartists",
    "productartist", "albumartist", "recordingartist", "trackarist"],
  title: ["tracktitle", "trackname", "songtitle", "track", "song", "assetname", "recordingtitle", "itemname", "title", "titledescription", "itemtitle"],
  album: ["albumtitle", "releasetitle", "releasename", "producttitle", "albumname", "album", "release", "productname"],
  isrc: ["isrc", "isrccode", "assetisrc", "trackisrc", "optionalisrc", "isrcupc", "itemsold", "identifier", "releaseisrc"],
  upc: ["upc", "upcean", "productupc", "albumupc", "releaseupc", "upccode", "barcode", "orchardupc", "manufacturersupc", "upcean"],
  country: ["countrycode", "territorycode", "countryofsale", "salecountry", "deliverycountry", "retailerstmtcountryiso",
    "countryorigin", "buyercountrycode", "country", "territory", "customerterritory", "countrygeozone", "region", "territoryname"],
  period: ["salemonth", "salesmonth", "transmonth", "activityperiod", "approxsalesdate", "salesperiod", "saledate", "salesdate",
    "usagestartdate", "eventdate", "startdate", "datefrom", "begper", "periodfrommm", "incomeperiod", "date", "transactiondate",
    "periodnum", "period", "perioddate", "retailerreportingperiod", "reportingperiod", "incomedate", "statementdate", "reportdate", "reportingdate"],
  period2: [],
  year: ["year"],
  month: ["month"],
};

// Columns whose text says what kind of sale a row is. All matching columns are combined.
const KIND_COLUMNS = new Set([
  "songalbum", "sourcetype", "type", "transactiontype", "transtype", "transtypedescription", "salestype", "saletype",
  "salesdescription", "salesclassification", "deliverytype", "deliveryformat", "delivery", "contenttype", "configuration",
  "config", "configgroup", "distributionchannel", "distributionchanneldescription", "distributionmanner", "usetype",
  "producttype", "releasetype", "assettype", "mediatype", "eventtype", "royaltyformat", "royaltytype", "earningscategory",
  "incometypetransactiontype", "majorincometype", "salescodedescription", "itemtype", "revenuetype", "salesordvoid",
  "saleorvoid", "transactionsubtype", "compositionincometype", "catformat", "stype", "description", "subsource", "channel",
  "pricecategory", "pricebasisdescription", "incometype", "incometypedescription", "recordtype", "analysiscodedescription",
]);

// Columns we never read as sale-type text even when named like one, per source.
interface Profile {
  /** role → exact normalized column name to use */
  columns?: Partial<Record<Role, string>>;
  /** normalized column names to read as sale-type text (replaces the default set) */
  kind?: string[];
  /** extra store columns combined for classification */
  storeExtra?: string[];
  /** treat these country values as US */
  usValues?: string[];
  /** statements that are already US-only */
  allUs?: boolean;
  /** this source never reports per-unit consumption we can use */
  unsupported?: string;
  /** shown instead of "Missing required column" when a file from this source has no unit counts */
  noCounts?: string;
  /** [year, month] column pairs tried in order when there's no single date column */
  periodPairs?: Array<[string, string]>;
  /** rows are album/product totals with no per-track split */
  productLevel?: boolean;
  /** sale-type text that marks a reversal: the row's quantity is subtracted */
  reversal?: RegExp;
}

export const PROFILES: Record<string, Profile> = {
  DISTROKID: { columns: { store: "store", country: "countryofsale", period: "salemonth", quantity: "quantity" }, kind: ["songalbum", "sourcetype"] },
  TUNECORE: { columns: { store: "storename", isrc: "optionalisrc", quantity: "unitssold", period: "salesperiod" }, kind: ["salestype", "releasetype", "youtubepolicytype"] },
  CD_BABY: { columns: { store: "partnername", country: "deliverycountry", period: "salesdate", title: "trackname" }, kind: ["transactiontype"] },
  TOO_LOST: { columns: { store: "channel", period: "saledate", quantity: "units" }, kind: [] },
  THE_ORCHARD: { columns: { store: "retailer", country: "territory", quantity: "quantity", period: "activityperiod" }, kind: ["transtypedescription", "transtype"] },
  EMPIRE: { columns: { store: "service", period: "approxsalesdate", upc: "upcean" }, kind: ["type"] },
  SYMPHONIC: { columns: { store: "digitalserviceprovider", quantity: "count", period: "activityperiod", country: "territory" }, kind: ["delivery", "contenttype", "saleorvoid"], reversal: /\bvoid\b/i },
  DITTO: { columns: { store: "storename", country: "countrycode", period: "startdate" }, kind: [] },
  ROUTE_NOTE: { columns: { store: "retailer", country: "territorycode", streamsQty: "stream", downloadsQty: "downloads", year: "year", month: "month" }, kind: [] },
  CMDSHFT: { columns: { store: "store", country: "countryorigin", period: "transmonth" }, kind: ["transtype", "releasetype"] },
  DASHGO: { columns: { store: "store", country: "region", period: "transactiondate" }, kind: ["producttype", "usetype"] },
  JTV_DIGITAL: { columns: { store: "channel", period: "startdate" }, kind: [] },
  MONSTERCAT: { columns: { store: "store", period: "date" }, kind: ["type"] },
  EDDY: { columns: { store: "retailer", country: "countrygeozone", period: "date", isrc: "identifier" }, kind: ["channel", "type"] },
  VYDIA: { columns: { store: "network", country: "territoryshortcode", quantity: "totalevents", period: "eventdate" }, kind: ["mediatype", "assettype", "compositionincometype", "eventtype"] },
  FOUNDATION_MEDIA: { columns: { store: "vendor", country: "countrycode", quantity: "netunits", period: "saledate" }, kind: ["deliverytype", "deliveryformat"] },
  ZOJACK: { columns: { store: "vendor", country: "countryofsale", quantity: "netunits" }, kind: ["deliverytype"] },
  INGROOVES: { columns: { store: "retailer", country: "retailerstmtcountryiso", quantity: "quantitynet", period: "retailerreportingperiod", title: "song" }, kind: ["salesdescription", "salesclassification", "assettype"] },
  // FUGA / Curve-style label statements ("Contract Name | Type | Sale Date | ... | Source | Sub Source | ...")
  ARMADA_MUSIC: { columns: { store: "source", country: "territory", period: "saledate" }, kind: ["distributionchannel", "configuration", "description", "pricecategory"], storeExtra: ["subsource"] },
  INTEGRITY_MUSIC: { columns: { store: "subsource", country: "territory", period: "saledate" }, kind: ["distributionchannel", "configuration", "description"], storeExtra: ["source"] },
  NEW_WEST_RECORDS: { columns: { store: "subsource", country: "territory", period: "saledate" }, kind: ["distributionchannel", "configuration"], storeExtra: ["source"] },
  PLATOON: { columns: { store: "source", country: "territory", period: "saledate", isrc: "isrcupc" }, kind: ["distributionchannel", "configuration"], storeExtra: ["subsource"] },
  CURVE: { columns: { store: "subsource", country: "territory", period: "datefrom" }, kind: ["channel", "config"], storeExtra: ["source"] },
  SPARTA: { columns: { store: "subsource", country: "territory" }, kind: ["saletype", "configuration", "distributionchannel"], storeExtra: ["source"] },
  // Vista-style label statements (Matador, Ninja Tune, Distro Nation)
  MATADOR_RECORDS: { columns: { store: "vendor", country: "territorycode", isrc: "trackisrc", title: "trackname", period: "date" }, kind: ["royaltyformat", "salescodedescription", "catformat"] },
  NINJA_TUNE: { columns: { store: "analysiscodedescription", country: "territorycode", isrc: "trackisrc", title: "trackname", quantity: "totalunits", period: "date" }, kind: ["royaltyformat", "salescodedescription"] },
  DISTRO_NATION: { columns: { store: "analysiscodedescription", country: "territorycode", period: "date" }, kind: ["royaltyformat"] },
  // Major-label artist royalty statements
  SONY_RECORDS: { columns: { store: "partner", country: "countryofsale", quantity: "salesunits", period: "salesperiod", title: "trackname" }, kind: ["distributionchannel", "configgroup", "configuration", "distributionmanner"] },
  WARNER_MUSIC_GROUP: { columns: { store: "digitalserviceproviderdsp", country: "country", quantity: "saleunits", period: "salesperiod", title: "trackname" }, kind: ["config", "earningscategory", "distch"] },
  UNIVERSAL_MUSIC_GLOBAL: { columns: { store: "distributor", country: "country", quantity: "salesunits", period: "salesperiod", title: "tracktitle" }, kind: ["producttype", "salestype", "pricebasisdescription"] },
  BMG: { columns: { store: "source", country: "territory", period: "saledate", isrc: "productcode" }, kind: ["distributionchanneldescription", "configuration"] },
  OWSLA: { columns: { store: "dist", country: "territory", period: "saledate", isrc: "productcode", title: "producttitle", artist: "productartist" }, kind: ["config"] },
  POSITION_MUSIC: { columns: { store: "subsource", country: "territory", title: "songtitle" }, kind: ["incometypetransactiontype"], periodPairs: [["periodfromyy", "periodfrommm"], ["periodtoyy", "periodtomm"]] },
  SECRETLY_DISTRIBUTION: { columns: { store: "digitalserviceprovidersubdescription", country: "countrycode", period: "invoicedescription", title: "titledescription" }, kind: ["transactiontype"], productLevel: true },
  CURB: { columns: { store: "source", country: "territory", period: "begper", title: "song" }, kind: ["config", "usage"], usValues: ["d"] },
  // Royalty Share artist statements (Dine Alone, Mom+Pop): one block per release, codes DS / DT / DA
  ROYALTY_SHARE: { columns: { store: "source", country: "region", quantity: "netunits", title: "tracktitle" }, kind: ["source"] },
  DINE_ALONE_RECORDS: { columns: { store: "source", country: "region", quantity: "netunits", title: "tracktitle" }, kind: ["source"] },
  KOLLECTIVE: { unsupported: "This is a neighboring-rights statement (radio, TV and public performance), which doesn't count toward RIAA certification." },
  UNITED_MASTERS: { noCounts: "These statements only show money per song, not how many times it was streamed or bought." },
  // UMG US artist statements: "Source" is the territory. DOMESTIC UMG (UMG's own US sales) and
  // THIRD PARTY (US-licensed services) are US; foreign income is listed by country name.
  UNIVERSAL_MUSIC_NORTH_AMERICA: { columns: { country: "source", store: "dsp", isrc: "selection", upc: "selection", period: "salesdate", quantity: "units", title: "title" }, kind: ["salestype"], usValues: ["domestic umg", "third party", "domesticumg", "thirdparty"], noCounts: "This is an account-balance summary with no per-song stream or sales counts." },
  ZYNC: { unsupported: "This is a sync-licensing statement, which doesn't count toward RIAA certification." },
  REDEYE_WORLDWIDE: { columns: { store: "customer", country: "country", period: "invoicedate" }, kind: [], unsupported: "This is a physical-distribution statement (CD/vinyl invoices). RIAA physical sales need shipment records, not streams." },
  BANDCAMP: { columns: { store: "paidto", country: "buyercountrycode", period: "date", quantity: "quantity" }, kind: ["itemtype"] },
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const US = new Set(["us", "usa", "unitedstates", "unitedstatesofamerica", "unitedstatesthe", "px", "usmilitary", "840", "usunitedstates", "estadosunidos", "アメリカ合衆国"]);
const WORLD = new Set(["all", "ww", "world", "worldwide", "global", "restofworld", "row", "international", "multiple", "various", "xx", "zz"]);
export const isWorldwide = (raw: string) => WORLD.has(norm(raw));
export const isUS = (raw: string, extra: string[] = []) => {
  const n = norm(raw);
  return US.has(n) || extra.includes(n) || /^usa?(united|$)/.test(n) || n.startsWith("unitedstates");
};

// Stores whose plays never count: UGC, social, fitness, gaming, programmed radio, lockers.
const EXCLUDED_STORES: Array<[RegExp, string]> = [
  [/tik ?tok|douyin|capcut|resso|triller|snap(chat)?\b|\bsnap\b|instagram|\big_|facebook|\bmeta\b|threads|social|lemon8|likee|kwai|byte ?dance|reels/i, "Social / UGC"],
  [/content ?id|\bugc\b|user generated|shorts|audio library|creator/i, "Social / UGC"],
  [/peloton|fitness|roblox|twitch|gaming|\bgame|\bluna\b|xbox|playstation|touchtunes|ami entertainment|jukebox|karaoke/i, "Fitness / gaming"],
  [/sirius|sxm|soundexchange|non[- ]?interactive|live365|music choice|radio(?!.*on.?demand)|\bplex\b|pcmusic|xite/i, "Programmed radio"],
  [/itunes match|cloud match|(?<!netease )\bcloud\b(?! music)|locker/i, "Cloud locker"],
  [/soundtrack your brand|background music|b2b|in.?store|mood ?media|playnetwork|business/i, "Business / background music"],
  [/mixcloud|dj mix/i, "DJ mixes"],
];

const KIND_EXCLUDE: Array<[RegExp, string]> = [
  [/\bugc\b|user generated|content ?id|short-?form|shorts|audio library|creation|\bcreate|reels|sticker|premium ugc|yt-ugc|red-ugc|production/i, "Social / UGC"],
  [/neighbo|performance|public perf|broadcast|webcast|non[- ]?interactive|radio|audiovisual|collection society/i, "Radio / performance"],
  [/mechanical|publishing|composition|\bcomp\b|\bpub\b|songwriter/i, "Publishing"],
  [/synch?\b|synchroni|licens|ancillary|advance|passthru/i, "Sync / licensing"],
  [/physical|\bcd\b|\blp\b|vinyl|cassette|\bmc\b|merch|consignment|bought stock/i, "Physical"],
  [/(?<!netease )\bcloud\b(?! music)|match units|locker|\bcl\b|tethered|\bdteth\b/i, "Cloud locker"],
  [/fraud|unqualified|invalid/i, "Disqualified streams"],
  [/ringtone|ringback|master tone|mastertone/i, "Ringtones"],
  [/background music|business|b2b|fitness/i, "Business / background music"],
  [/cost|fee|expense|payment|balance|reserve|adjustment|breakage|opening|bonus|incentive|allocation|\bmisc\b/i, "Not a sale"],
  [/dj mix/i, "DJ mixes"],
];

// Sale-type text. "Strong" words decide on their own; otherwise the store decides.
const KIND_DOWNLOAD = /download|permanent|\bpd\b|\bdt\b|\bda\b|digital album|digital track|track sale|album sale\b|purchase|a la carte|ダウンロード/i;
const KIND_ALBUM = /\balbum\b|\bda\b|bundle/i;
const KIND_STREAM = /\bds\b|stream|on-?demand|subscription|subscript|ad[- ]?supported|ad[- ]?funded|premium|interactive|\bas\b|\bvs\b|art ?track|ストリーミング|video|vidtrack|\bvdd\b|\bdst\b|\bdvt\b|\bppv\b|partner.provided|discovery mode|audio tier|\bplays?\b/i;

const DOWNLOAD_STORES = /itunes(?! match)|download|purchase|beatport(?! link)|7digital|google play store|juno|traxsource|bandcamp|mp3|amazon digital|amazon\.com services/i;
const STREAM_STORES = /spotify|apple ?music|amazon|youtube|\byt\b|vevo|tidal|wimp|deezer|napster|pandora|soundcloud|audiomack|anghami|boomplay|iheart|qobuz|kkbox|joox|jiosaavn|saavn|gaana|yandex|zvuk|\bvk\b|netease|tencent|\bqq\b|kugou|kuwo|line music|\bawa\b|claro|trebel|melon|genie|\bflo\b|bugs|beatport link|beatsource|livexlive|slacker|melody ?vr|google play|nuuday|music island|united media agency|\buma\b|fizy|moov|hungama|wynk|simfy|rhapsody|mixradio|idagio|primephonic|sberzvuk|bilibili|kakao|digital service providers|merlin/i;

export function classify(storeText: string, kindText: string): { kind: UsageKind; reason?: string } {
  for (const [re, reason] of EXCLUDED_STORES) if (re.test(storeText)) return { kind: "excluded", reason };
  for (const [re, reason] of KIND_EXCLUDE) if (re.test(kindText)) return { kind: "excluded", reason };
  const album = KIND_ALBUM.test(kindText);
  const dlKind = KIND_DOWNLOAD.test(kindText);
  const streamKind = KIND_STREAM.test(kindText);
  if (dlKind && !streamKind) return { kind: album ? "album_download" : "track_download" };
  if (streamKind && !dlKind) return { kind: "stream" };
  // Type text missing or ambiguous: the store decides.
  const dlStore = DOWNLOAD_STORES.test(storeText) && !/apple music|unlimited|prime|stream|link/i.test(storeText);
  if (dlStore) return { kind: album ? "album_download" : "track_download" };
  if (STREAM_STORES.test(storeText)) return { kind: "stream" };
  return { kind: "excluded", reason: storeText.trim() ? "Unrecognized store" : "No store or sale type" };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (m: number) => String(m).padStart(2, "0");

export function toPeriod(raw: string, fallback = ""): string {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?:[ T].*)?$/))) return `${m[1]}-${pad(+m[2])}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) { const a = +m[1], b = +m[2]; return `${m[3]}-${pad(a > 12 ? b : a)}`; }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return `${m[2]}-${pad(+m[1])}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{2})$/)) && +m[1] >= 1 && +m[1] <= 12) return `20${m[2]}-${pad(+m[1])}`; // MM/YY
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})?$/)) && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`;
  if ((m = s.match(/^([a-z]{3,9})[-\s.,]*(\d{2,4})$/i)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    const y = m[2].length === 2 ? 2000 + +m[2] : +m[2]; return `${y}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}`;
  }
  if ((m = s.match(/^(\d{4})[-\s]*([a-z]{3,9})$/i)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) return `${m[1]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}`;
  if ((m = s.match(/(\d{4})\s*[-_ ]?\s*q([1-4])/i)) || (m = s.match(/q([1-4])\s*[-_ ]?\s*(\d{4})/i))) {
    const [y, q] = m[1].length === 4 ? [+m[1], +m[2]] : [+m[2], +m[1]]; return `${y}-${pad((q - 1) * 3 + 1)}`;
  }
  if ((m = s.match(/(\d{4})\s*[-_ ]?\s*h([12])/i)) || (m = s.match(/h([12])\s*[-_ ]?\s*(\d{4})/i)) || (m = s.match(/([12])h\s*[-_ ]?\s*(\d{2,4})/i))) {
    let y = m[1].length >= 2 && +m[1] > 2 ? +m[1] : +m[2]; const h = m[1].length >= 2 && +m[1] > 2 ? +m[2] : +m[1];
    if (y < 100) y += 2000; return `${y}-${pad(h === 1 ? 1 : 7)}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(+s) * 86400000);
    if (d.getUTCFullYear() > 1990 && d.getUTCFullYear() < 2100) return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
  if ((m = s.match(/(19|20)\d{2}[-/.](0?[1-9]|1[0-2])\b/))) return `${m[0].slice(0, 4)}-${pad(+m[2])}`;
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1990) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return fallback;
}

function num(raw: string): number {
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /-$/.test(s);
  s = s.replace(/[()$£€¥\s]/g, "").replace(/-$/, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.234,5
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return isNaN(n) ? 0 : neg ? -Math.abs(n) : n;
}

const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

interface Located { table: Table; headerRow: number; header: string[]; score: number }

function scoreHeader(cells: string[]): number {
  const n = new Set(cells.map(norm).filter(Boolean));
  if (n.size < 3) return 0;
  let s = 0;
  const has = (role: Role) => ROLE_ALIASES[role].some((a) => n.has(a));
  if (has("quantity") || has("streamsQty")) s += 3;
  if (has("store")) s += 2;
  if (has("isrc")) s += 2;
  if (has("title")) s += 1;
  if (has("country")) s += 1;
  if (has("period")) s += 1;
  if (has("upc")) s += 1;
  if (has("artist")) s += 1;
  if ([...n].some((c) => KIND_COLUMNS.has(c))) s += 1;
  return s + Math.min(n.size, 40) / 100;
}

function locate(tables: Table[]): Located | null {
  let best: Located | null = null;
  for (const t of tables) {
    const limit = Math.min(t.rows.length, 60);
    for (let r = 0; r < limit; r++) {
      const score = scoreHeader(t.rows[r]);
      // prefer sheets that actually have data under the header
      const dataBonus = Math.min(t.rows.length - r - 1, 50) / 100;
      if (score >= 5 && (!best || score + dataBonus > best.score)) best = { table: t, headerRow: r, header: t.rows[r], score: score + dataBonus };
    }
  }
  return best;
}

function mapColumns(header: string[], profile: Profile) {
  const normed = header.map(norm);
  const idx: Partial<Record<Role, number>> = {};
  for (const role of Object.keys(ROLE_ALIASES) as Role[]) {
    const pinned = profile.columns?.[role];
    if (pinned) { const i = normed.indexOf(pinned); if (i >= 0) { idx[role] = i; continue; } }
    for (const a of ROLE_ALIASES[role]) { const i = normed.indexOf(a); if (i >= 0) { idx[role] = i; break; } }
  }
  // the store column must not double as the country or quantity
  if (idx.store !== undefined && (idx.store === idx.country || idx.store === idx.quantity)) delete idx.store;
  const kindSet = profile.kind ?? [...KIND_COLUMNS];
  // A column can be both store and sale type only when a profile says so (e.g. Royalty Share "Source" = DS/DT/DA).
  const kindIdx = normed.map((h, i) => (kindSet.includes(h) && (i !== idx.store || profile.kind !== undefined) ? i : -1)).filter((i) => i >= 0);
  const storeExtra = (profile.storeExtra ?? []).map((h) => normed.indexOf(h)).filter((i) => i >= 0);
  return { idx, kindIdx, storeExtra };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Parse already-read tables (CSV rows, or one table per Excel sheet). */
export function parseStatementTables(tables: Table[], opts: ParseOptions = {}): ParseResult {
  const warnings: string[] = [];
  const empty = (w: string): ParseResult => ({ rows: [], monthly: [], excluded: { streams: 0, byReason: {}, byStore: {} }, warnings: [...warnings, w] });
  const profile = PROFILES[opts.target ?? ""] ?? {};
  if (profile.unsupported) return empty(`Unsupported statement: ${profile.unsupported}`);

  const loc = locate(tables);
  if (!loc && profile.noCounts) return empty(`Unsupported statement: ${profile.noCounts}`);
  if (!loc) return empty("Missing required column: quantity. Couldn't find a line-item table with quantities in this file.");
  const { idx, kindIdx, storeExtra } = mapColumns(loc.header, profile);
  const hdrNorm = loc.header.map(norm);
  if (idx.isrc === undefined && hdrNorm.some((h) => /^(writers?|composers?|songwriters?|allcomposers)$/.test(h)))
    return empty("Unsupported statement: This is a publishing statement (songwriter royalties). RIAA certification counts recordings, so we need the label or distributor statement.");
  const pairs = (profile.periodPairs ?? []).map(([y, m]) => [hdrNorm.indexOf(y), hdrNorm.indexOf(m)]).filter(([y, m]) => y >= 0 && m >= 0);
  const hasQty = idx.quantity !== undefined || idx.streamsQty !== undefined || idx.downloadsQty !== undefined;
  if (!hasQty && profile.noCounts) return empty(`Unsupported statement: ${profile.noCounts}`);
  if (!hasQty) return empty(`Missing required column: quantity. Headers were: ${loc.header.join(" | ").slice(0, 300)}`);
  if (idx.store === undefined && !kindIdx.length) return empty(`Missing required column: store. Headers were: ${loc.header.join(" | ").slice(0, 300)}`);
  if (idx.isrc === undefined && idx.title === undefined) return empty("Report has neither ISRC nor title");
  if (idx.country === undefined && !profile.allUs) warnings.push("No country column — counting all territories (RIAA is US-only, so this overstates progress)");

  // Excel "text" quoting: ="00123" → 00123
  const get = (r: string[], i?: number) => (i === undefined ? "" : String(r[i] ?? "").trim().replace(/^="(.*)"$/, "$1").trim());
  const fallback = toPeriod(opts.fallbackPeriod ?? "", opts.fallbackPeriod ?? "");
  const usExtra = (profile.usValues ?? []).map(norm);
  const rows: UsageRow[] = [];
  const excluded: ExcludedSummary = { streams: 0, byReason: {}, byStore: {} };
  let dataRows = 0;

  const add = (row: UsageRow) => {
    rows.push(row);
    if (row.kind === "excluded") {
      const reason = row.excludedReason!;
      excluded.streams += row.quantity;
      excluded.byReason[reason] = (excluded.byReason[reason] ?? 0) + row.quantity;
      if (reason !== "Outside the US" && reason !== "No country breakdown") excluded.byStore[row.store || "(none)"] = (excluded.byStore[row.store || "(none)"] ?? 0) + row.quantity;
    }
  };

  for (const r of loc.table.rows.slice(loc.headerRow + 1)) {
    if (r.length < 2 || r.every((c) => !String(c ?? "").trim())) continue;
    // repeated header rows / total rows inside the data
    if (idx.quantity !== undefined && norm(get(r, idx.quantity)) === norm(loc.header[idx.quantity])) continue;
    if (/^(totals?|grand total|subtotal)$/i.test(String(r[0] ?? "").trim())) continue;
    dataRows++;

    const storePrimary = get(r, idx.store);
    const storeText = [storePrimary, ...storeExtra.map((i) => get(r, i))].filter(Boolean).join(" · ");
    const kindText = kindIdx.map((i) => get(r, i)).filter(Boolean).join(" | ");
    const country = get(r, idx.country);
    let period = "";
    for (const [yi, mi] of pairs) {
      const y = get(r, yi), mo = get(r, mi);
      if (y && mo) { period = toPeriod(`${y.length === 2 ? "20" + y : y}-${mo.padStart(2, "0")}`, ""); if (period) break; }
    }
    if (!period && idx.year !== undefined && idx.month !== undefined)
      period = toPeriod(`${get(r, idx.year)}-${get(r, idx.month)}`, "") || toPeriod(`${get(r, idx.month)} ${get(r, idx.year)}`, "");
    if (!period) period = toPeriod(get(r, idx.period), fallback);
    if (!period || +period.slice(0, 4) < 1990 || +period.slice(0, 4) > 2100) period = fallback;
    const isrcRaw = get(r, idx.isrc).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const base = {
      period, store: storePrimary || storeText, country,
      artist: get(r, idx.artist), title: get(r, idx.title) || get(r, idx.album), album: get(r, idx.album),
      isrc: ISRC_RE.test(isrcRaw) ? isrcRaw : "",
      // a shared ISRC/UPC column holds letters on ISRC rows: those aren't UPCs
      upc: /[A-Za-z]/.test(get(r, idx.upc)) ? "" : get(r, idx.upc).replace(/\.0+$/, "").replace(/\D/g, ""),
    };
    const outsideUs = idx.country !== undefined && !profile.allUs && !isUS(country, usExtra);
    const geoReason = isWorldwide(country) || (!country && idx.country !== undefined) ? "No country breakdown" : "Outside the US";

    // RouteNote-style: separate streams and downloads columns on one row
    if (idx.quantity === undefined) {
      for (const [col, k] of [[idx.streamsQty, "stream"], [idx.downloadsQty, "track_download"]] as const) {
        const q = num(get(r, col));
        if (q <= 0) continue;
        let { kind, reason } = classify(storeText, k === "stream" ? "stream" : "download");
        if (kind !== "excluded" && outsideUs) { kind = "excluded"; reason = geoReason; }
        add({ ...base, quantity: q, kind, ...(reason ? { excludedReason: reason } : {}) });
      }
      continue;
    }

    let quantity = num(get(r, idx.quantity));
    if (profile.reversal?.test(kindText)) quantity = -Math.abs(quantity);
    if (quantity === 0) continue;
    let { kind, reason } = classify(storeText, kindText.replace(profile.reversal ?? /$^/, ""));
    if (kind !== "excluded" && outsideUs) { kind = "excluded"; reason = geoReason; }
    if (kind !== "excluded" && profile.productLevel && !base.isrc) { kind = "excluded"; reason = "Album totals with no per-track split"; }
    // Returns and reversals net out of counted usage; they're never "excluded plays".
    if (quantity < 0 && kind === "excluded") continue;
    add({ ...base, quantity, kind, ...(reason ? { excludedReason: reason } : {}) });
  }

  const columns: Record<string, string> = {};
  for (const [k, v] of Object.entries(idx)) if (v !== undefined) columns[k] = loc.header[v as number];
  if (kindIdx.length) columns.type = kindIdx.map((i) => loc.header[i]).join(" + ");
  if (!rows.length && dataRows) warnings.push("Every line had a zero or negative quantity");
  return { rows, monthly: aggregateMonthly(rows), excluded, warnings, meta: { sheet: loc.table.name, headerRow: loc.headerRow, columns, dataRows } };
}

/** Parse a delimited text statement (CSV / TSV / ...). */
export function parseStatementText(text: string, opts: ParseOptions = {}): ParseResult {
  return parseStatementTables([{ rows: parseDelimited(text) }], opts);
}

/** Parse raw statement bytes when the file is text. Excel goes through workbook.ts. */
export function parseStatementBytes(bytes: Uint8Array, opts: ParseOptions = {}): ParseResult {
  const kind = sniffBinary(bytes);
  if (kind === "pdf") return { rows: [], monthly: [], excluded: { streams: 0, byReason: {}, byStore: {} }, warnings: ["Unsupported statement: PDF statements can't be read yet."] };
  if (kind !== "text") throw new UnsupportedStatement(`${kind} workbook: read it with workbook.ts first`);
  return parseStatementText(decodeText(bytes), opts);
}

/** Back-compat name used across the app. */
export const parseDistroKidReport = parseStatementText;

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function aggregateMonthly(rows: UsageRow[]): UsageMonthly[] {
  const map = new Map<string, UsageMonthly>();
  for (const r of rows) {
    if (r.kind === "excluded") continue;
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
    if (!m.title && r.title && r.kind !== "album_download") m.title = r.title;
  }
  return [...map.values()];
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

export function mergeExcluded(list: ExcludedSummary[]): ExcludedSummary {
  const out: ExcludedSummary = { streams: 0, byReason: {}, byStore: {} };
  for (const e of list) {
    out.streams += e.streams;
    for (const [k, v] of Object.entries(e.byReason)) out.byReason[k] = (out.byReason[k] ?? 0) + v;
    for (const [k, v] of Object.entries(e.byStore)) out.byStore[k] = (out.byStore[k] ?? 0) + v;
  }
  return out;
}
