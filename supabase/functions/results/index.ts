// GET ?token=<results_token> → { source, results }
import { cors, db, json } from "../_shared/ingest.ts";
import { computeCertifications } from "../_shared/riaa.ts";
import { mergeExcluded, type ExcludedSummary, type UsageMonthly } from "../_shared/distrokid.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "token required" }, 400);

  const sb = db();
  const { data: src } = await sb.from("sources").select("id, identity, sync_status, last_sync, target").eq("results_token", token).maybeSingle();
  if (!src) return json({ error: "Not found" }, 404);

  const { data: reports } = await sb.from("reports").select("status, excluded, warnings").eq("source_id", src.id);
  const usage: UsageMonthly[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("usage_monthly")
      .select("period, isrc, upc, title, artist, album, streams, track_downloads, album_downloads")
      .eq("source_id", src.id).range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    for (const r of data ?? []) usage.push({
      period: r.period, isrc: r.isrc, upc: r.upc, title: r.title ?? "", artist: r.artist ?? "", album: r.album ?? "",
      streams: Number(r.streams), trackDownloads: Number(r.track_downloads), albumDownloads: Number(r.album_downloads),
    });
    if (!data || data.length < 1000) break;
  }

  const excluded = mergeExcluded((reports ?? []).map((r) => r.excluded as ExcludedSummary).filter(Boolean));
  const total = reports?.length ?? 0;
  const done = reports?.filter((r) => r.status === "ingested").length ?? 0;
  const failed = reports?.filter((r) => r.status === "failed").length ?? 0;

  return json({
    source: {
      target: src.target, identity: src.identity, syncStatus: src.sync_status, lastSync: src.last_sync,
      reports: { total, ingested: done, failed },
      ready: total > 0 && done + failed === total,
      warnings: [...new Set((reports ?? []).flatMap((r) => r.warnings ?? []))],
    },
    results: computeCertifications(usage, excluded),
  });
});
