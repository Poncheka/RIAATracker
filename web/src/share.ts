// Share cards: "Countdown" (one song's distance to its next level) and
// "I went Gold!" (celebration summary). Rendered as 1080x1920 story images.
import { toPng } from "html-to-image";
import logoUrl from "./mogul-logo.svg";
import { formatUnits as fmt, STREAMS_PER_ALBUM_UNIT, STREAMS_PER_SINGLE_UNIT, type CertItem, type Level, type Results } from "../../supabase/functions/_shared/riaa.ts";

type Kind = "countdown" | "celebrate";
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
  const kicker = pct >= 0.9 ? "Almost there" : pct >= 0.5 ? "Halfway up" : "On the way";
  return `<div class="sc sc-count ${medalClass(i.next.level)}">
    <div class="sc-grid"></div><div class="sc-glow"></div>
    <div class="sc-kicker">${kicker}</div>
    <div class="sc-ring">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="#1d211f" stroke-width="3.2"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="var(--tone)" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - Math.max(0.01, pct))).toFixed(2)}"/></svg>
      <div class="sc-medal ${medalClass(i.next.level)}"><span>${medalLabel(i.next.level, i.next.multiplier)}</span></div>
      <div class="sc-pct">${pct >= 0.995 ? (pct * 100).toFixed(1) : Math.round(pct * 100)}%</div>
    </div>
    <h2>${fmt(i.next.remaining)} units from <em>${esc(i.next.label)}</em></h2>
    <div class="sc-song">${esc(i.title)}<small>${esc(artist)}${i.type === "album" ? " · album" : ""}</small></div>
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
    <div class="sc-kicker">${esc(artist)}</div>
    <h2 class="sc-shout">I went <em>${esc(word)}!</em></h2>
    <div class="sc-hero"><div class="sc-medal xl ${medalClass(top.current.level)}"><span>${medalLabel(top.current.level, top.current.multiplier)}</span></div></div>
    <div class="sc-sub"><b>${esc(top.title)}</b> crossed ${fmt(top.current.threshold)} US units</div>
    <div class="sc-list">${list}${earned.length > 4 ? `<div class="sc-more">+${earned.length - 4} more</div>` : ""}</div>
    <div class="sc-fine">Estimate from distributor data. Not an official RIAA certification.</div>
    <div class="sc-foot"><span>wheresmyplaque.com</span><img src="${logoUrl}" alt="Mogul"></div>
  </div>`;
}

export function openShare(r: Results, artist: string, shareUrl: string) {
  const items = [...r.singles, ...r.albums].filter((i) => i.units > 0).sort((a, b) => b.next.pct - a.next.pct);
  const hasEarned = [...r.singles, ...r.albums].some((i) => i.current.level !== "none");
  let kind: Kind = hasEarned ? "celebrate" : "countdown";
  let pick = items[0]?.id;

  const m = document.createElement("div");
  m.className = "modal share-modal";
  document.body.appendChild(m);
  const close = () => m.remove();

  const render = () => {
    const item = items.find((i) => i.id === pick) ?? items[0];
    const card = kind === "celebrate" ? celebrateCard(r, artist) : item ? countdownCard(item, artist) : "";
    m.innerHTML = `<div class="modal-box share-box" role="dialog" aria-modal="true" aria-label="Share your progress">
      <div class="modal-head"><span>Share your progress</span><button data-x aria-label="Close">×</button></div>
      <div class="share-body">
        <div class="share-controls">
          <div class="tabs" role="tablist">
            <button role="tab" data-kind="celebrate" aria-selected="${kind === "celebrate"}" ${hasEarned ? "" : "disabled title=\"Unlocks when a release reaches Gold\""}>I went Gold!</button>
            <button role="tab" data-kind="countdown" aria-selected="${kind === "countdown"}">Countdown</button>
          </div>
          ${kind === "countdown" ? `<label class="share-pick">Song or album
            <select id="share-pick">${items.slice(0, 40).map((i) => `<option value="${esc(i.id)}" ${i.id === item?.id ? "selected" : ""}>${esc(i.title)}${i.type === "album" ? " (album)" : ""} · ${Math.round(i.next.pct * 100)}% to ${esc(i.next.label)}</option>`).join("")}</select></label>`
            : `<p class="share-hint">Shows your top plaque and up to four releases at certification level.</p>`}
          <div class="share-actions">
            <button class="btn btn-primary btn-sm" data-dl>Download image</button>
            <button class="btn btn-ghost btn-sm" data-share>Share</button>
            <button class="btn btn-ghost btn-sm" data-copy>Copy link</button>
          </div>
          <p class="share-status" aria-live="polite"></p>
        </div>
        <div class="share-preview"><div class="share-scale">${card}</div></div>
      </div>
    </div>`;
  };
  render();

  const status = (t: string) => { const s = m.querySelector(".share-status"); if (s) s.textContent = t; };
  const png = async () => {
    const node = m.querySelector<HTMLElement>(".sc")!;
    return toPng(node, { width: 1080, height: 1920, pixelRatio: 1, cacheBust: true, style: { transform: "none" } });
  };
  const blob = async () => (await fetch(await png())).blob();
  const fname = () => `wheresmyplaque-${kind}.png`;

  m.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    const k = t.closest<HTMLButtonElement>("[data-kind]");
    if (k && !k.disabled) { kind = k.dataset.kind as Kind; render(); return; }
    if (t.closest("[data-dl]")) {
      status("Rendering…");
      try { const a = document.createElement("a"); a.href = await png(); a.download = fname(); a.click(); status("Saved."); }
      catch { status("Couldn't render the image. Try again, or screenshot the preview."); }
    }
    if (t.closest("[data-share]")) {
      try {
        const file = new File([await blob()], fname(), { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: "How close are you to Gold?", url: shareUrl }); status(""); }
        else { await navigator.clipboard.writeText(shareUrl); status("This browser can't share images directly. Link copied; download the image to post it."); }
      } catch (err) { if ((err as Error).name !== "AbortError") status("Sharing didn't go through. Use Download instead."); }
    }
    if (t.closest("[data-copy]")) {
      try { await navigator.clipboard.writeText(shareUrl); status("Link copied."); } catch { status(shareUrl); }
    }
  });
  m.addEventListener("change", (e) => { const s = e.target as HTMLSelectElement; if (s.id === "share-pick") { pick = s.value; render(); } });
}
