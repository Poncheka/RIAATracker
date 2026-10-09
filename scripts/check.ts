import { readFileSync, readdirSync } from "node:fs";
import { parseDistroKidReport, mergeExcluded } from "../supabase/functions/_shared/distrokid.ts";
import { computeCertifications, onTheRise, formatUnits } from "../supabase/functions/_shared/riaa.ts";
const dir = process.argv[2] ?? "sample-data";
const parsed = readdirSync(dir).sort().map(f => parseDistroKidReport(readFileSync(`${dir}/${f}`, "utf8"), { fallbackPeriod: f.slice(0,7) }));
const r = computeCertifications(parsed.flatMap(p => p.monthly), mergeExcluded(parsed.map(p => p.excluded)));
console.log("asOf", r.asOf, r.totals, r.notes, parsed.flatMap(p=>p.warnings));
for (const i of [...r.singles, ...r.albums]) console.log(i.type.padEnd(6), i.title.padEnd(22), formatUnits(i.units).padStart(6), i.current.label.padEnd(18), "->", i.next.label, (i.next.pct*100).toFixed(0)+"%", i.monthsToNext, "|", i.headline);
console.log(r.excluded.byReason);
