import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { parseDistroKidReport } from "./distrokid.ts";
import { downloadReport, getSource } from "./mogul.ts";

export const db = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

/**
 * Pull the latest source metadata from Mogul, register any new reports and
 * ingest every report that hasn't been processed yet. Idempotent.
 */
export async function ingestSource(sourceId: number): Promise<{ ingested: number; failed: number }> {
  const sb = db();
  const src = await getSource(sourceId);

  await sb.from("sources").update({
    sync_status: src.syncStatus,
    last_sync: src.lastSync ? new Date(src.lastSync.replace(" ", "T") + (src.lastSync.endsWith("Z") ? "" : "Z")).toISOString() : null,
    target: src.target ?? "DISTROKID",
  }).eq("id", sourceId);

  if (src.availableReports.length) {
    await sb.from("reports").upsert(
      src.availableReports.map((r) => ({ id: r.id, source_id: sourceId, period: r.period ?? null, cadence: r.cadence ?? null, file_name: r.originalFileName ?? null })),
      { onConflict: "id", ignoreDuplicates: true },
    );
  }

  const { data: pending } = await sb.from("reports").select("id, period").eq("source_id", sourceId).neq("status", "ingested");
  let ingested = 0, failed = 0;

  for (const rep of pending ?? []) {
    try {
      const text = await downloadReport(rep.id);
      const parsed = parseDistroKidReport(text, { fallbackPeriod: rep.period ?? undefined });
      await sb.from("usage_monthly").delete().eq("report_id", rep.id);
      const rows = parsed.monthly.map((m) => ({
        source_id: sourceId, report_id: rep.id, period: m.period, isrc: m.isrc, upc: m.upc,
        title: m.title, artist: m.artist, album: m.album || null,
        streams: Math.round(m.streams), track_downloads: Math.round(m.trackDownloads), album_downloads: Math.round(m.albumDownloads),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from("usage_monthly").upsert(rows.slice(i, i + 500));
        if (error) throw error;
      }
      await sb.from("reports").update({
        status: "ingested", error: null, row_count: parsed.rows.length, excluded: parsed.excluded,
        warnings: parsed.warnings, ingested_at: new Date().toISOString(),
      }).eq("id", rep.id);
      ingested++;
    } catch (e) {
      failed++;
      await sb.from("reports").update({ status: "failed", error: String(e).slice(0, 1000) }).eq("id", rep.id);
    }
  }
  await sb.from("sources").update({ last_ingested_at: new Date().toISOString() }).eq("id", sourceId);
  return { ingested, failed };
}

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Run work after the response is sent (Supabase Edge Runtime), or inline locally. */
export function background(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch((e) => console.error(e)));
  else p.catch((e) => console.error(e));
}
