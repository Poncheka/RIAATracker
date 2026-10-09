// GET ?token=<results_token>&item=<CertItem.id> → application/zip RIAA package
import { strToU8, zipSync } from "npm:fflate@0.8.2";
import { cors, db, json } from "../_shared/ingest.ts";
import { computeCertifications } from "../_shared/riaa.ts";
import type { UsageByStore, UsageMonthly } from "../_shared/distrokid.ts";
import { buildRiaaPackage, packageFileName } from "../_shared/riaa-package.ts";
import { downloadReport } from "../_shared/mogul.ts";

const NAMES: Record<string, string> = { DISTROKID: "DistroKid" };

async function all<T>(q: (from: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const itemId = url.searchParams.get("item") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token) || !itemId) return json({ error: "token and item required" }, 400);

  try {
    const sb = db();
    const { data: src } = await sb.from("sources").select("id, target").eq("results_token", token).maybeSingle();
    if (!src) return json({ error: "Not found" }, 404);

    // deno-lint-ignore no-explicit-any
    const monthly = await all<any>((f) => sb.from("usage_monthly").select("period, isrc, upc, title, artist, album, streams, track_downloads, album_downloads").eq("source_id", src.id).range(f, f + 999));
    const usage: UsageMonthly[] = monthly.map((r) => ({ period: r.period, isrc: r.isrc, upc: r.upc, title: r.title ?? "", artist: r.artist ?? "", album: r.album ?? "",
      streams: Number(r.streams), trackDownloads: Number(r.track_downloads), albumDownloads: Number(r.album_downloads) }));
    const results = computeCertifications(usage);
    const item = [...results.singles, ...results.albums].find((i) => i.id === itemId);
    if (!item) return json({ error: "Release not found" }, 404);

    // deno-lint-ignore no-explicit-any
    const store = await all<any>((f) => sb.from("usage_by_store").select("period, isrc, upc, store, title, artist, streams, track_downloads, album_downloads").eq("source_id", src.id).range(f, f + 999));
    const byStore: UsageByStore[] = store.map((r) => ({ period: r.period, isrc: r.isrc, upc: r.upc, store: r.store, title: r.title ?? "", artist: r.artist ?? "",
      streams: Number(r.streams), trackDownloads: Number(r.track_downloads), albumDownloads: Number(r.album_downloads) }));

    const { data: reps } = await sb.from("reports").select("id, period, file_name").eq("source_id", src.id).eq("status", "ingested").order("period");
    const statements: Array<{ name: string; text: string }> = [];
    for (const r of reps ?? []) {
      try { statements.push({ name: `${r.period ?? r.id}-${r.file_name ?? `report-${r.id}.csv`}`.replace(/[^\w.-]+/g, "_"), text: await downloadReport(r.id) }); }
      catch (e) { console.error("statement download failed", r.id, e); }
    }

    const files = buildRiaaPackage({ item, artist: item.artist, sourceName: NAMES[src.target] ?? src.target, asOf: results.asOf, byStore, statements });
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
    return new Response(zip, { headers: { ...cors, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${packageFileName(item)}"` } });
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn't build the package", detail: String(e).slice(0, 300) }, 500);
  }
});
