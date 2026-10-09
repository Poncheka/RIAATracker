// Share sheet: Celebrate / Countdown / Plaque wall story cards (1080x1920),
// switchable in a centered carousel, with social, download and link actions.
import { toPng } from "html-to-image";
import logoUrl from "./mogul-logo.svg";
import { formatUnits as fmt, STREAMS_PER_ALBUM_UNIT, STREAMS_PER_SINGLE_UNIT, type CertItem, type Level, type Results } from "../../supabase/functions/_shared/riaa.ts";

type Kind = "celebrate" | "countdown" | "wall";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const RANK: Record<Level, number> = { none: 0, gold: 1, platinum: 2, multi_platinum: 3, diamond: 4 };
const medalClass = (l: Level) => (l === "gold" ? "gold" : l === "diamond" ? "diamond" : l === "none" ? "none" : "plat");
const medalLabel = (l: Level, m: number) => ({ gold: "Gold", platinum: "Plat", multi_platinum: `${m}×`, diamond: "Diam", none: "—" }[l]);

function eta(i: CertItem) {
  if (i.monthsToNext === null) return "—";
  if (i.monthsToNext <= 1) return "<1 mo";
  if (i.monthsToNext <= 24) return `~${i.monthsToNext} mo`;
  return i.monthsToNext <= 120 ? `${Math.floor(i.monthsToNext / 12)}+ yrs` : "10+ yrs";
}

function countdownCard(i: CertItem, artist: string) {
  const per = i.type === "album" ? STREAMS_PER_ALBUM_UNIT : STREAMS_PER_SINGLE_UNIT;
  const pct = i.next.pct;
  const C = 2 * Math.PI * 46;
  return `<div class="sc sc-count ${medalClass(i.next.level)}">
    <div class="sc-grid"></div><div class="sc-glow"></div>
    <div class="sc-ring">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="#1d211f" stroke-width="3.2"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="var(--tone)" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - Math.max(0.01, pct))).toFixed(2)}"/></svg>
      <div class="sc-medal ${medalClass(i.next.level)}"><span>${medalLabel(i.next.level, i.next.multiplier)}</span></div>
      <div class="sc-pct">${pct < 0.01 ? "<1" : pct >= 0.995 ? (pct * 100).toFixed(1) : Math.round(pct * 100)}%</div>
    </div>
    <h2>${fmt(i.next.remaining)} units from <em>${esc(i.next.label)}</em></h2>
    <div class="sc-song">${esc(i.title)}<small>${esc(i.artist || artist)}${i.type === "album" ? " · album" : ""}</small></div>
    <div class="sc-facts">
      <div><b>${fmt(i.next.remaining * per)}</b><span>More US streams</span></div>
      <div><b>${eta(i)}</b><span>At current pace</span></div>
    </div>
    <div class="sc-cta">Stream it and help push it over.</div>
    <div class="sc-foot"><span>wheresmyplaque.com</span><img src="${logoUrl}" alt="Mogul"></div>
  </div>`;
}

function celebrateCard(r: Results, artist: string) {
  const earned = [...r.singles, ...r.albums].filter((i) => i.current.level !== "none")
    .sort((a, b) => RANK[b.current.level] - RANK[a.current.level] || b.units - a.units);
  const top = earned[0];
  const word = top.current.level === "gold" ? "Gold" : top.current.level === "diamond" ? "Diamond" : top.current.label;
  // deterministic confetti
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const colors = ["#f6dc7a", "#c99a2e", "#3ddc84", "#f2f7f4", "#b7bec6"];
  const confetti = Array.from({ length: 70 }, () => {
    const x = rnd() * 100, y = rnd() * 62, rot = rnd() * 360, w = 10 + rnd() * 16, h = 6 + rnd() * 10;
    return `<i style="left:${x}%;top:${y}%;width:${w}px;height:${h}px;background:${colors[Math.floor(rnd() * colors.length)]};transform:rotate(${rot}deg);opacity:${0.55 + rnd() * 0.45}"></i>`;
  }).join("");
  const list = earned.slice(0, 4).map((i) => `<div class="sc-earn"><div class="sc-medal sm ${medalClass(i.current.level)}"><span>${medalLabel(i.current.level, i.current.multiplier)}</span></div>
    <div><b>${esc(i.title)}</b><small>${esc(i.current.label)} · ${fmt(i.units)} units</small></div></div>`).join("");
  return `<div class="sc sc-cele ${medalClass(top.current.level)}">
    <div class="sc-grid"></div><div class="sc-rays"></div><div class="sc-confetti">${confetti}</div>
    <h2 class="sc-shout">I went <em>${esc(word)}!</em></h2>
    <div class="sc-hero"><div class="sc-medal xl ${medalClass(top.current.level)}"><span>${medalLabel(top.current.level, top.current.multiplier)}</span></div></div>
    <div class="sc-sub"><b>${esc(top.title)}</b> crossed ${fmt(top.current.threshold)} US units</div>
    <div class="sc-list">${list}${earned.length > 4 ? `<div class="sc-more">+${earned.length - 4} more</div>` : ""}</div>
    <div class="sc-fine">Estimate from distributor data. Not an official RIAA certification.</div>
    <div class="sc-foot"><span>wheresmyplaque.com</span><img src="${logoUrl}" alt="Mogul"></div>
  </div>`;
}

function wallCard(r: Results, artist: string) {
  const all = [...r.singles, ...r.albums];
  const earned = all.filter((i) => i.current.level !== "none").sort((a, b) => RANK[b.current.level] - RANK[a.current.level] || b.units - a.units);
  const filling = all.filter((i) => i.units > 0).sort((a, b) => b.next.pct - a.next.pct);
  const slots = [
    ...earned.slice(0, 6).map((i) => `<div class="slot">${`<div class="sc-medal ${medalClass(i.current.level)}"><span>${medalLabel(i.current.level, i.current.multiplier)}</span></div>`}<b>${esc(i.title)}</b><small>${esc(i.current.label)}</small></div>`),
    ...filling.slice(0, Math.max(0, 6 - Math.min(6, earned.length))).map((i) => {
      const p = Math.max(1, Math.round(i.next.pct * 100));
      return `<div class="slot prog"><div class="hole ${i.next.level === "gold" ? "" : "plat"}" style="--p:${p}"><i>${i.next.pct < 0.01 ? "<1" : p}%</i></div><b>${esc(i.title)}${i.type === "album" ? " (album)" : ""}</b><small>→ ${esc(i.next.label.replace("Platinum", "Plat"))}</small></div>`;
    }),
  ];
  const inProgress = filling.filter((i) => i.current.level === "none").length;
  return `<div class="sc sc-wall"><div class="sc-grid"></div><div class="sc-glow"></div>
    <div class="who">${esc(artist)}</div>
    <div class="tally"><b>${earned.length} earned</b> · ${inProgress} filling in</div>
    <div class="wall">${slots.join("")}</div>
    <div class="sc-foot"><span>wheresmyplaque.com</span><img src="${logoUrl}" alt="Mogul"></div>
  </div>`;
}

const ICONS = {
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.4 7.4 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.5-1 .9-1H17V2.2L14.1 2C10.9 2 10.2 4.4 10.2 5.9v2.6H8v3.7h2.2V22H14v-9.8h2.8l.4-3.7H14z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11H3v-11zm6.5 0h3.8v1.5h.1c.5-1 1.8-1.9 3.7-1.9 4 0 4.7 2.5 4.7 5.8v5.6h-4v-5c0-1.2 0-2.7-1.7-2.7s-1.9 1.3-1.9 2.6v5.1h-4v-11z"/></svg>`,
};

// Most-streamed artist name in the statements (the account holder's name is often not the artist).
function primaryArtist(r: Results) {
  const w = new Map<string, number>();
  for (const i of [...r.singles, ...r.albums]) if (i.artist) w.set(i.artist, (w.get(i.artist) ?? 0) + i.units);
  return [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export function openShare(r: Results, shareUrl: string, opts: { kind?: Kind; itemId?: string } = {}) {
  const artist = primaryArtist(r);
  const items = [...r.singles, ...r.albums].filter((i) => i.units > 0).sort((a, b) => b.next.pct - a.next.pct);
  const hasEarned = [...r.singles, ...r.albums].some((i) => i.current.level !== "none");
  const kinds: Array<{ k: Kind; label: string }> = [
    ...(hasEarned ? [{ k: "celebrate" as Kind, label: "Celebrate" }] : []),
    ...(items.length ? [{ k: "countdown" as Kind, label: "Countdown" }] : []),
    { k: "wall", label: "Plaque wall" },
  ];
  let idx = Math.max(0, kinds.findIndex((k) => k.k === opts.kind));
  let pick = opts.itemId && items.some((i) => i.id === opts.itemId) ? opts.itemId : items[0]?.id;
  const text = hasEarned ? "Went and checked where my plaque is." : "How close are you to Gold?";

  const m = document.createElement("div");
  m.className = "modal share-modal";
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Share">
    <div class="sheet-head"><b>Share</b><button class="sheet-x" data-x aria-label="Close">×</button></div>
    ${kinds.length > 1 ? `<div class="seg" role="tablist" style="grid-template-columns:repeat(${kinds.length},1fr)">${kinds.map((k, i) => `<button role="tab" data-i="${i}">${k.label}</button>`).join("")}</div>` : ""}
    <div class="carousel">
      <button class="arrow" data-step="-1" aria-label="Previous card" ${kinds.length < 2 ? "hidden" : ""}>‹</button>
      <div class="share-preview"><div class="share-scale" id="share-card"></div></div>
      <button class="arrow" data-step="1" aria-label="Next card" ${kinds.length < 2 ? "hidden" : ""}>›</button>
    </div>
    ${kinds.length > 1 ? `<div class="dots">${kinds.map(() => "<i></i>").join("")}</div>` : ""}
    <label class="pick" id="share-pick-wrap" hidden>Song
      <select id="share-pick">${items.slice(0, 40).map((i) => `<option value="${esc(i.id)}">${esc(i.title)}${i.type === "album" ? " (album)" : ""} · ${i.next.pct < 0.01 ? "<1" : Math.round(i.next.pct * 100)}% to ${esc(i.next.label)}</option>`).join("")}</select>
    </label>
    <div class="sheet-actions">
      <div class="socials">
        <button class="soc" data-soc="native"><span class="ic">${ICONS.instagram}</span>Instagram</button>
        <button class="soc" data-soc="native"><span class="ic">${ICONS.tiktok}</span>TikTok</button>
        <button class="soc" data-soc="x"><span class="ic">${ICONS.x}</span>X</button>
        <button class="soc" data-soc="facebook"><span class="ic">${ICONS.facebook}</span>Facebook</button>
        <button class="soc" data-soc="linkedin"><span class="ic">${ICONS.linkedin}</span>LinkedIn</button>
      </div>
      <div class="row2">
        <button class="btn btn-primary btn-sm" data-dl>Download image</button>
        <button class="btn btn-ghost btn-sm" data-soc="native">Share…</button>
      </div>
      <div class="linkrow"><code>${esc(shareUrl.replace(/^https?:\/\//, ""))}</code><button class="btn btn-ghost btn-sm" data-copy>Copy link</button></div>
      <p class="share-status" aria-live="polite"></p>
    </div>
  </div>`;
  document.body.appendChild(m);

  const $ = <T extends HTMLElement>(sel: string) => m.querySelector<T>(sel)!;
  const status = (t: string) => ($(".share-status").textContent = t);
  const render = () => {
    const k = kinds[idx].k;
    const item = items.find((i) => i.id === pick) ?? items[0];
    $("#share-card").innerHTML = k === "celebrate" ? celebrateCard(r, artist) : k === "countdown" && item ? countdownCard(item, artist) : wallCard(r, artist);
    m.querySelectorAll(".seg button").forEach((b, i) => b.setAttribute("aria-selected", String(i === idx)));
    m.querySelectorAll(".dots i").forEach((d, i) => d.classList.toggle("on", i === idx));
    $("#share-pick-wrap").hidden = k !== "countdown";
    status("");
  };
  const go = (n: number) => { idx = (idx + n + kinds.length) % kinds.length; render(); };
  render();
  ($("#share-pick") as unknown as HTMLSelectElement).value = pick ?? "";

  const png = () => toPng($(".sc"), { width: 1080, height: 1920, pixelRatio: 1, cacheBust: true });
  const fname = () => `wheresmyplaque-${kinds[idx].k}.png`;
  const download = async () => { const a = document.createElement("a"); a.href = await png(); a.download = fname(); a.click(); };
  const copy = async () => { try { await navigator.clipboard.writeText(shareUrl); status("Link copied."); } catch { status(shareUrl); } };

  m.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return m.remove();
    const seg = t.closest<HTMLElement>(".seg button");
    if (seg) { idx = Number(seg.dataset.i); render(); return; }
    const step = t.closest<HTMLElement>("[data-step]");
    if (step) return go(Number(step.dataset.step));
    if (t.closest("[data-copy]")) return copy();
    if (t.closest("[data-dl]")) {
      status("Rendering…");
      try { await download(); status("Saved."); } catch { status("Couldn't render the image. Try again."); }
      return;
    }
    const soc = t.closest<HTMLElement>("[data-soc]")?.dataset.soc;
    if (!soc) return;
    if (soc === "native") {
      try {
        status("Rendering…");
        const file = new File([await (await fetch(await png())).blob()], fname(), { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, url: shareUrl }); status(""); }
        else { await download(); await navigator.clipboard?.writeText(shareUrl).catch(() => {}); status("Image saved and link copied. Post it from your phone's Instagram or TikTok app."); }
      } catch (err) { if ((err as Error).name !== "AbortError") status("Sharing didn't go through. Use Download instead."); else status(""); }
      return;
    }
    const u = encodeURIComponent(shareUrl), tx = encodeURIComponent(text);
    const href = soc === "x" ? `https://x.com/intent/post?text=${tx}&url=${u}`
      : soc === "facebook" ? `https://www.facebook.com/sharer/sharer.php?u=${u}`
      : `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    window.open(href, "_blank", "noopener,width=640,height=640");
  });
  m.addEventListener("change", (e) => { const s = e.target as HTMLSelectElement; if (s.id === "share-pick") { pick = s.value; render(); } });
  let tx0: number | null = null;
  const pv = $(".share-preview");
  pv.addEventListener("touchstart", (e) => (tx0 = e.touches[0].clientX), { passive: true });
  pv.addEventListener("touchend", (e) => { if (tx0 === null) return; const dx = e.changedTouches[0].clientX - tx0; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); tx0 = null; });
}
