// Smoke test: mogul.ts against a local mock of the Connect API + S3.
// deno run -A scripts/smoke-mogul-client.ts
const files = [...Deno.readDirSync("sample-data")].map((f) => f.name).sort();
const srv = Deno.serve({ port: 8787, onListen() {} }, (req) => {
  const u = new URL(req.url);
  if (req.headers.get("authorization") !== "Basic " + btoa("id:secret") && !u.pathname.startsWith("/s3/")) return new Response("no", { status: 401 });
  if (u.pathname === "/connect/v1/sources/1") return Response.json({ id: 1, target: "DISTROKID", syncStatus: "SUCCESS", lastSync: "2026-10-01 01:02:00.000000",
    availableReports: files.map((f, i) => ({ id: 100 + i, sourceId: 1, cadence: "MONTHLY", period: f.slice(0, 7), originalFileName: f })) });
  const m = u.pathname.match(/\/sources\/reports\/(\d+)/);
  if (m) return Response.json({ url: `http://localhost:8787/s3/${files[Number(m[1]) - 100]}` });
  if (u.pathname.startsWith("/s3/")) return new Response(Deno.readTextFileSync(`sample-data/${u.pathname.slice(4)}`));
  return new Response("nf", { status: 404 });
});
Deno.env.set("MOGUL_API_BASE", "http://localhost:8787/connect/v1");
Deno.env.set("MOGUL_CLIENT_ID", "id"); Deno.env.set("MOGUL_CLIENT_SECRET", "secret");
const { getSource, downloadReport } = await import("../supabase/functions/_shared/mogul.ts");
const { parseDistroKidReport, mergeExcluded } = await import("../supabase/functions/_shared/distrokid.ts");
const { computeCertifications } = await import("../supabase/functions/_shared/riaa.ts");
const src = await getSource(1);
const parsed = [];
for (const r of src.availableReports) parsed.push(parseDistroKidReport(await downloadReport(r.id), { fallbackPeriod: r.period }));
const res = computeCertifications(parsed.flatMap((p) => p.monthly), mergeExcluded(parsed.map((p) => p.excluded)));
console.log(`reports=${src.availableReports.length} eligible=${res.totals.certifiedCount} top=${res.singles[0].title} ${res.singles[0].current.label}`);
await srv.shutdown();
