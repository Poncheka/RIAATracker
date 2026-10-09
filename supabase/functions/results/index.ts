// GET ?token=<results_token> → { source, results }
import { background, cors, db, ingestSource, json } from "../_shared/ingest.ts";
import { computeCertifications } from "../_shared/riaa.ts";
import { mergeExcluded, type ExcludedSummary, type UsageMonthly } from "../_shared/distrokid.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "token required" }, 400);

  const sb = db();
  const { data: src } = await sb.from("sources").select("id, identity, sync_status, last_sync, target, last_ingested_at").eq("results_token", token).maybeSingle();
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

  // Self-heal: if we're still waiting, re-check Mogul ourselves (at most every 20s)
  // instead of relying only on the webhook. Also retries failed reports.
  const pendingOrFailed = (reports ?? []).some((r) => r.status !== "ingested");
  const waiting = !reports?.length || pendingOrFailed || src.sync_status === "IN_PROGRESS" || !src.sync_status;
  const stale = !src.last_ingested_at || Date.now() - new Date(src.last_ingested_at).getTime() > 20_000;
  if (waiting && stale) {
    await sb.from("sources").update({ last_ingested_at: new Date().toISOString() }).eq("id", src.id);
    background(ingestSource(src.id));
  }

  const excluded = mergeExcluded((reports ?? []).map((r) => r.excluded as ExcludedSummary).filter(Boolean));
  const total = reports?.length ?? 0;
  const done = reports?.filter((r) => r.status === "ingested").length ?? 0;
  const failed = reports?.filter((r) => r.status === "failed").length ?? 0;

  return json({
    source: {
      target: src.target, identity: src.identity, syncStatus: src.sync_status, lastSync: src.last_sync,
      reports: { total, ingested: done, failed },
      // ready once Mogul finished syncing and every report has been processed
      ready: src.sync_status !== "IN_PROGRESS" && !!src.sync_status && done + failed === total &&
        (total > 0 || src.sync_status === "SUCCESS"),
      needsReconnect: ["REAUTHENTICATE_REQUIRED", "USER_ACTION_REQUIRED"].includes(src.sync_status ?? ""),
      syncError: src.sync_status === "UNEXPECTED_ERROR",
      warnings: [...new Set((reports ?? []).flatMap((r) => r.warnings ?? []))],
    },
    results: computeCertifications(usage, excluded),
  });
});
