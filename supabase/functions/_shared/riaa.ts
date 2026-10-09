// RIAA Gold & Platinum estimator.
// Rules (RIAA Digital Single + Album audit requirements, Sept 2023):
//   Single: 1 unit = 1 permanent download = 150 on-demand audio/video streams
//   Album:  1 unit = 1 album download = 10 track downloads (TEA) = 1,500 on-demand streams (SEA)
//           Only tracks that appear on a version of the album count.
//   Levels: Gold 500K · Platinum 1M · Multi-Platinum every 1M · Diamond 10M
//   US only. Counting starts at release. No UGC, no programmed radio.
// Pure TypeScript — shared by the Supabase functions and the web app.

import type { ExcludedSummary, UsageMonthly } from "./distrokid.ts";

export const STREAMS_PER_SINGLE_UNIT = 150;
export const STREAMS_PER_ALBUM_UNIT = 1500;
export const TRACK_DOWNLOADS_PER_ALBUM_UNIT = 10;
export const GOLD = 500_000;
export const PLATINUM = 1_000_000;
export const DIAMOND = 10_000_000;
export const MIN_ALBUM_TRACKS = 3; // RIAA EP/shortform floor

export type Level = "none" | "gold" | "platinum" | "multi_platinum" | "diamond";

export interface Tier { level: Level; multiplier: number; label: string; threshold: number }

export interface CertItem {
  id: string;
  type: "single" | "album";
  title: string;
  artist: string;
  isrcs: string[];
  upc?: string;
  trackCount?: number;
  units: number;
  usStreams: number;
  trackDownloads: number;
  albumDownloads: number;
  current: Tier;
  next: Tier & { remaining: number; pct: number };
  monthlyPace: number; // avg units/month over the trailing window
  monthsToNext: number | null; // null = no recent activity
  firstPeriod: string;
  lastPeriod: string;
  monthly: Array<{ period: string; units: number }>;
  headline: string; // human copy for the card
}

export interface Results {
  asOf: string;
  singles: CertItem[];
  albums: CertItem[];
  totals: {
    certifiedCount: number;
    certifiedUnits: number;
    trackedCount: number;
    usStreams: number;
    usDownloads: number;
    excludedQuantity: number;
  };
  excluded: ExcludedSummary;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export function tierFor(units: number): Tier {
  if (units >= DIAMOND) {
    const m = Math.floor(units / PLATINUM);
    return { level: "diamond", multiplier: m, label: m > 10 ? `Diamond (${m}× Platinum)` : "Diamond", threshold: m * PLATINUM };
  }
  if (units >= 2 * PLATINUM) {
    const m = Math.floor(units / PLATINUM);
    return { level: "multi_platinum", multiplier: m, label: `${m}× Platinum`, threshold: m * PLATINUM };
  }
  if (units >= PLATINUM) return { level: "platinum", multiplier: 1, label: "Platinum", threshold: PLATINUM };
  if (units >= GOLD) return { level: "gold", multiplier: 1, label: "Gold", threshold: GOLD };
  return { level: "none", multiplier: 0, label: "Not yet certified", threshold: 0 };
}

export function nextTier(units: number): Tier {
  if (units < GOLD) return { level: "gold", multiplier: 1, label: "Gold", threshold: GOLD };
  if (units < PLATINUM) return { level: "platinum", multiplier: 1, label: "Platinum", threshold: PLATINUM };
  const m = Math.floor(units / PLATINUM) + 1;
  if (m === 10) return { level: "diamond", multiplier: 10, label: "Diamond", threshold: DIAMOND };
  if (m > 10) return { level: "diamond", multiplier: m, label: `${m}× Platinum`, threshold: m * PLATINUM };
  return { level: "multi_platinum", multiplier: m, label: `${m}× Platinum`, threshold: m * PLATINUM };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERSION_TAGS = /\s*[\(\[](clean|explicit|radio edit|edit|album version|radio mix|single version|dirty)[\)\]]\s*/gi;
const normTitle = (t: string) => t.replace(VERSION_TAGS, " ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const fmt = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`;

function headline(item: Pick<CertItem, "next" | "monthsToNext" | "monthlyPace" | "current">): string {
  const { next, monthsToNext } = item;
  if (monthsToNext === null) return `No US activity in the last 3 months.`;
  if (next.pct >= 0.97 || monthsToNext <= 1) return `${next.label} could land this month.`;
  if (monthsToNext <= 6) return `${next.label} is about ${monthsToNext} months out at this pace.`;
  if (monthsToNext <= 24) return `Roughly ${monthsToNext} months to ${next.label} at your current pace.`;
  if (monthsToNext <= 120) return `${next.label} is ${Math.floor(monthsToNext / 12)}+ years out at this pace.`;
  return `Long road to ${next.label} at this pace. One playlist or sync can change that.`;
}

function finish(
  base: Omit<CertItem, "current" | "next" | "monthlyPace" | "monthsToNext" | "headline" | "firstPeriod" | "lastPeriod">,
  asOf: string,
  paceWindow: number,
): CertItem {
  const current = tierFor(base.units);
  const nt = nextTier(base.units);
  const remaining = Math.max(0, nt.threshold - base.units);
  const pct = Math.min(1, base.units / nt.threshold);
  const windowStart = addMonths(asOf, -(paceWindow - 1));
  const recent = base.monthly.filter((m) => m.period >= windowStart && m.period <= asOf);
  const monthlyPace = recent.reduce((s, m) => s + m.units, 0) / paceWindow;
  const monthsToNext = monthlyPace > 0 ? Math.max(1, Math.ceil(remaining / monthlyPace)) : null;
  const periods = base.monthly.map((m) => m.period).sort();
  const item = {
    ...base,
    current,
    next: { ...nt, remaining, pct },
    monthlyPace,
    monthsToNext,
    firstPeriod: periods[0] ?? asOf,
    lastPeriod: periods[periods.length - 1] ?? asOf,
    headline: "",
  };
  item.headline = headline(item);
  return item;
}

function monthlySeries(map: Map<string, number>) {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, units]) => ({ period, units }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function computeCertifications(
  usage: UsageMonthly[],
  excluded: ExcludedSummary = { streams: 0, byReason: {}, byStore: {} },
  opts: { paceWindowMonths?: number; asOf?: string } = {},
): Results {
  const paceWindow = opts.paceWindowMonths ?? 3;
  const asOf = opts.asOf ?? usage.reduce((mx, u) => (u.period > mx ? u.period : mx), "");
  const notes: string[] = [];

  // ---- Singles: group ISRCs that are clean/explicit/edit versions of one song
  type SAcc = { title: string; artist: string; isrcs: Set<string>; streams: number; dl: number; monthly: Map<string, number>; titleVotes: Map<string, number> };
  const singles = new Map<string, SAcc>();
  for (const u of usage) {
    if (!u.isrc) continue; // album-download rows
    const key = `${u.artist.toLowerCase().trim()}::${normTitle(u.title) || u.isrc}`;
    let s = singles.get(key);
    if (!s) singles.set(key, (s = { title: u.title, artist: u.artist, isrcs: new Set(), streams: 0, dl: 0, monthly: new Map(), titleVotes: new Map() }));
    s.isrcs.add(u.isrc);
    s.streams += u.streams;
    s.dl += u.trackDownloads;
    s.titleVotes.set(u.title, (s.titleVotes.get(u.title) ?? 0) + u.streams + 1);
    const units = u.trackDownloads + u.streams / STREAMS_PER_SINGLE_UNIT;
    s.monthly.set(u.period, (s.monthly.get(u.period) ?? 0) + units);
  }
  const singleItems = [...singles.entries()].map(([key, s]) => {
    const title = [...s.titleVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0].replace(VERSION_TAGS, " ").trim() ?? s.title;
    return finish({
      id: `single:${key}`, type: "single", title, artist: s.artist, isrcs: [...s.isrcs],
      units: s.dl + s.streams / STREAMS_PER_SINGLE_UNIT,
      usStreams: s.streams, trackDownloads: s.dl, albumDownloads: 0,
      monthly: monthlySeries(s.monthly),
    }, asOf, paceWindow);
  });

  // ---- Albums: any UPC with 3+ distinct ISRCs. All usage of those ISRCs
  // counts (incl. the pre-release single's own UPC), per RIAA album rules.
  const tracksByUpc = new Map<string, Set<string>>();
  const albumMeta = new Map<string, { album: string; artist: string }>();
  for (const u of usage) {
    if (!u.upc) continue;
    if (!albumMeta.has(u.upc) || (!albumMeta.get(u.upc)!.album && u.album)) albumMeta.set(u.upc, { album: u.album, artist: u.artist });
    if (!u.isrc) continue;
    if (!tracksByUpc.has(u.upc)) tracksByUpc.set(u.upc, new Set());
    tracksByUpc.get(u.upc)!.add(u.isrc);
  }
  const byIsrc = new Map<string, UsageMonthly[]>();
  for (const u of usage) if (u.isrc) (byIsrc.get(u.isrc) ?? byIsrc.set(u.isrc, []).get(u.isrc)!).push(u);

  const albumItems: CertItem[] = [];
  for (const [upc, isrcs] of tracksByUpc) {
    if (isrcs.size < MIN_ALBUM_TRACKS) continue;
    let streams = 0, dl = 0, albumDl = 0;
    const monthly = new Map<string, number>();
    const trackStreams = new Map<string, { title: string; streams: number }>();
    for (const isrc of isrcs) {
      for (const u of byIsrc.get(isrc) ?? []) {
        streams += u.streams; dl += u.trackDownloads;
        const units = u.streams / STREAMS_PER_ALBUM_UNIT + u.trackDownloads / TRACK_DOWNLOADS_PER_ALBUM_UNIT;
        monthly.set(u.period, (monthly.get(u.period) ?? 0) + units);
        const t = trackStreams.get(isrc) ?? { title: u.title, streams: 0 };
        t.streams += u.streams; trackStreams.set(isrc, t);
      }
    }
    for (const u of usage) if (u.upc === upc && u.albumDownloads) {
      albumDl += u.albumDownloads;
      monthly.set(u.period, (monthly.get(u.period) ?? 0) + u.albumDownloads);
    }
    const meta = albumMeta.get(upc)!;
    const top = [...trackStreams.values()].sort((a, b) => b.streams - a.streams)[0];
    const title = meta.album || (top ? `${top.title.replace(VERSION_TAGS, " ").trim()} + ${isrcs.size - 1} more` : `UPC ${upc}`);
    albumItems.push(finish({
      id: `album:${upc}`, type: "album", title, artist: meta.artist, isrcs: [...isrcs], upc, trackCount: isrcs.size,
      units: albumDl + dl / TRACK_DOWNLOADS_PER_ALBUM_UNIT + streams / STREAMS_PER_ALBUM_UNIT,
      usStreams: streams, trackDownloads: dl, albumDownloads: albumDl,
      monthly: monthlySeries(monthly),
    }, asOf, paceWindow));
  }
  if (albumItems.length && albumItems.some((a) => !albumMeta.get(a.upc!)?.album)) {
    notes.push("Album titles aren't in DistroKid statements, so albums are named after their biggest track.");
  }

  const all = [...singleItems, ...albumItems];
  const certified = all.filter((i) => i.current.level !== "none");
  const sortUnits = (a: CertItem, b: CertItem) => b.units - a.units;

  return {
    asOf,
    singles: singleItems.sort(sortUnits),
    albums: albumItems.sort(sortUnits),
    totals: {
      certifiedCount: certified.length,
      certifiedUnits: certified.reduce((s, i) => s + i.units, 0),
      trackedCount: all.length,
      usStreams: singleItems.reduce((s, i) => s + i.usStreams, 0),
      usDownloads: singleItems.reduce((s, i) => s + i.trackDownloads, 0),
      excludedQuantity: excluded.streams,
    },
    excluded,
    notes,
  };
}

/** "On the rise": everything not yet at its next tier, closest first. */
export function onTheRise(r: Results, filter?: Level): CertItem[] {
  return [...r.singles, ...r.albums]
    .filter((i) => i.units > 0 && (!filter || i.next.level === filter || (filter === "platinum" && i.next.level === "multi_platinum")))
    .sort((a, b) => b.next.pct - a.next.pct);
}

export const formatUnits = fmt;
