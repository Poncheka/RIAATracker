// Runs after `vite build`. Writes the crawlable parts of the site into dist/:
// guides, works-with, calculator, sitemap.xml, robots.txt, llms.txt, llms-full.txt,
// RSS, and a Markdown copy of every page for AI agents.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const content = join(root, "content");
const SITE = "https://wheresmyplaque.com";
const NAME = "Where's My Plaque?";
const UPDATED = "2026-11-12";

const guides = JSON.parse(readFileSync(join(content, "guides.json"), "utf8")).map((g) => ({
  ...g, md: readFileSync(join(content, "guides", `${g.slug}.md`), "utf8"),
}));
const sources = JSON.parse(readFileSync(join(content, "sources.json"), "utf8"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const out = (path, body) => { const f = join(dist, path); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

// Wrap tables so they scroll on phones.
const md = (src) => marked.parse(src).replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>");

const PUBLISHER = { "@type": "Organization", name: "Mogul", url: "https://usemogul.com" };
const sourceNote = `Checked against the RIAA's <a href="https://www.riaa.com/gold-platinum/about-awards/">award criteria</a>, <a href="https://www.riaa.com/gold-platinum/apply/">application rules</a> and GR&amp;F audit requirements, November 2026.`;

function page({ path, title, description, body, current, jsonld = [], type = "website" }) {
  const url = SITE + path;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" type="text/markdown" href="${url.replace(/\/$/, "")}.md" title="Markdown">
<link rel="alternate" type="application/rss+xml" href="${SITE}/guides/feed.xml" title="${esc(NAME)} guides">
<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${SITE}/og.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@600;700;800&family=Inter:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/site.css">
${jsonld.map(ld).join("\n")}
</head><body>
<nav class="nav wrap"><a class="brand" href="/"><img src="/static/wmp-icon.svg" alt=""><span>${esc(NAME)}</span></a>
<div class="nav-links">
<a href="/guides/"${current === "guides" ? ' aria-current="page"' : ""}>Guides</a>
<a href="/riaa-calculator/"${current === "calc" ? ' aria-current="page"' : ""}>Calculator</a>
<a href="/works-with/"${current === "works" ? ' aria-current="page"' : ""}>Works with</a>
</div></nav>
<main class="wrap">${body}</main>
<footer class="wrap"><p>Estimates from your label or distributor statements, using the RIAA's published unit rules. Not affiliated with or endorsed by the RIAA. Official certification requires an application to the RIAA and an audit by Gelfand, Rennert &amp; Feldman.</p>
<div class="foot-links"><a href="/guides/">Guides</a><a href="/riaa-calculator/">Calculator</a><a href="/works-with/">Works with</a><a href="/llms.txt">llms.txt</a></div>
<a class="built-by" href="https://usemogul.com"><span>Built by</span><img src="/static/mogul-logo.svg" alt="Mogul"></a></footer>
</body></html>`;
}

const cta = `<div class="cta"><h2>How close are your songs?</h2><p>Connect your label or distributor. We read your statements and count only what the RIAA would.</p><a class="btn" href="/">Check my catalog, free</a></div>`;
const crumbs = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: SITE + path })) });

// ---------- guides ----------
const mdPages = {}; // path → markdown, for agents
for (const g of guides) {
  const path = `/guides/${g.slug}/`;
  const faqHtml = g.faq.length ? `<section class="faq"><h2>Quick answers</h2>${g.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>` : "";
  const body = `<article class="narrow">
<p class="eyebrow">Guide</p><h1>${esc(g.title)}</h1>
<p class="meta">Updated ${new Date(UPDATED).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} · ${NAME} by Mogul</p>
${md(g.md)}
${faqHtml}
<p class="meta">${sourceNote}</p>
${cta}
<p><a href="/guides/">← All guides</a></p>
</article>`;
  out(`${path}index.html`, page({ path, title: `${g.title} | ${NAME}`, description: g.description, current: "guides", type: "article", body, jsonld: [
    { "@context": "https://schema.org", "@type": "Article", headline: g.title, description: g.description, datePublished: UPDATED, dateModified: UPDATED,
      author: { "@type": "Organization", name: NAME, url: SITE }, publisher: PUBLISHER, mainEntityOfPage: SITE + path, image: `${SITE}/og.png` },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: g.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    crumbs([["Home", "/"], ["Guides", "/guides/"], [g.title, path]]),
  ] }));
  mdPages[path] = `# ${g.title}\n\n> ${g.description}\n\n${g.md}\n\n## Quick answers\n\n${g.faq.map(([q, a]) => `**${q}**\n${a}`).join("\n\n")}\n\nSource: ${SITE}${path}\n`;
}

out("guides/index.html", page({ path: "/guides/", title: `RIAA certification guides | ${NAME}`, current: "guides",
  description: "Plain-English guides to RIAA Gold, Platinum and Diamond: how many streams it takes, what counts, how independent artists apply, and how to get an official plaque.",
  body: `<section class="page"><p class="eyebrow">Guides</p><h1>Everything about going Gold</h1>
<p class="lede">How RIAA certification works, in plain English, for independent artists and labels.</p>
<div class="cards">${guides.map((g) => `<a class="card" href="/guides/${g.slug}/"><b>${esc(g.title)}</b><span>${esc(g.description)}</span></a>`).join("")}</div>${cta}</section>`,
  jsonld: [{ "@context": "https://schema.org", "@type": "CollectionPage", name: "RIAA certification guides", url: `${SITE}/guides/`,
    hasPart: guides.map((g) => ({ "@type": "Article", headline: g.title, url: `${SITE}/guides/${g.slug}/` })) }] }));
mdPages["/guides/"] = `# RIAA certification guides\n\n${guides.map((g) => `- [${g.title}](${SITE}/guides/${g.slug}.md): ${g.description}`).join("\n")}\n`;

// ---------- works with ----------
{
  const c = sources.counts;
  const body = `<section class="page narrow"><p class="eyebrow">Works with</p><h1>Which statements can show your plaque progress?</h1>
<p class="lede">RIAA certification counts US on-demand streams and paid downloads, song by song. A statement has to break those out for us to count them. Here's where each source stands.</p>
<h2>Counts toward Gold and Platinum</h2>
<p>These statements report US streams and downloads per track. Connect one and you'll see every song's distance to Gold.</p>
${Object.entries(c).map(([k, v]) => `<h3>${esc(k)}</h3><ul class="chips ok">${v.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`).join("")}
<h2>Should work</h2>
<p>We read these formats. We just haven't verified US totals on a live account yet.</p>
<ul class="chips">${sources.likely.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
<h2>Can't count toward a plaque</h2>
<p>These statements are real income, but they don't carry what the RIAA counts.</p>
<ul class="no">${sources.cannot.map(([s, why]) => `<li><b>${esc(s)}</b> · ${esc(why)}</li>`).join("")}</ul>
<h2>Releasing through more than one?</h2>
<p>Each connection covers what came through that distributor or label. If your catalog is split, your real total is higher than any single one shows.</p>
<p>Don't see yours? Most standard statement layouts read fine. Connect it and we'll tell you what we found.</p>
${cta}</section>`;
  out("works-with/index.html", page({ path: "/works-with/", current: "works", title: `Distributors and labels that work with ${NAME}`,
    description: "DistroKid, TuneCore, CD Baby, The Orchard, EMPIRE, Sony, Warner, Universal and more. Which royalty statements can show your RIAA Gold progress, and which can't.", body,
    jsonld: [crumbs([["Home", "/"], ["Works with", "/works-with/"]])] }));
  mdPages["/works-with/"] = `# Distributors and labels that work with ${NAME}\n\nRIAA certification counts US on-demand streams and paid downloads per track. Statements must break those out.\n\n## Counts toward Gold and Platinum\n\n${Object.entries(c).map(([k, v]) => `**${k}:** ${v.join(", ")}`).join("\n\n")}\n\n## Should work (format supported, not yet verified live)\n\n${sources.likely.join(", ")}\n\n## Can't count toward a plaque\n\n${sources.cannot.map(([s, w]) => `- ${s}: ${w}`).join("\n")}\n`;
}

// ---------- calculator ----------
{
  const calcJs = `(()=>{const $=id=>document.getElementById(id),n=v=>Math.max(0,+String(v).replace(/[^\\d.]/g,"")||0),f=x=>Math.round(x).toLocaleString("en-US");
const L=u=>u>=1e7?"Diamond":u>=2e6?Math.floor(u/1e6)+"× Platinum":u>=1e6?"Platinum":u>=5e5?"Gold":"Not certified yet";
const N=u=>{if(u<5e5)return[5e5,"Gold"];if(u<1e6)return[1e6,"Platinum"];const m=Math.floor(u/1e6)+1;return m===10?[1e7,"Diamond"]:[m*1e6,m+"× Platinum"];};
function go(){const a=$("t").value==="album",s=n($("s").value),td=n($("td").value),ad=a?n($("ad").value):0;$("adw").hidden=!a;
const per=a?1500:150,u=s/per+(a?td/10+ad:td),[nx,nl]=N(u);
$("o").innerHTML=f(Math.floor(u))+" units<small>"+L(u)+" · "+f(Math.ceil(nx-u))+" units to "+nl+" ≈ "+f(Math.ceil((nx-u)*per))+" more US streams</small>";}
["t","s","td","ad"].forEach(i=>$(i).addEventListener("input",go));go();})();`;
  const body = `<section class="page narrow"><p class="eyebrow">Calculator</p><h1>RIAA units calculator</h1>
<p class="lede">Turn US streams and downloads into RIAA units, and see how far you are from Gold, Platinum and Diamond.</p>
<form class="calc" onsubmit="return false">
<label>Release type<select id="t"><option value="single">Single</option><option value="album">Album or EP</option></select></label>
<div class="row"><label>US on-demand streams<input id="s" inputmode="numeric" value="45,000,000"></label>
<label>Paid track downloads (US)<input id="td" inputmode="numeric" value="20,000"></label>
<label id="adw" hidden>Album downloads (US)<input id="ad" inputmode="numeric" value="0"></label></div>
<div class="out" id="o" aria-live="polite"></div></form>
<h2>The math</h2>
<p>Single: 150 US on-demand streams = 1 unit, and 1 paid download = 1 unit. Album: 1,500 streams = 1 unit, 10 track downloads = 1 unit, 1 album download = 1 unit. Gold is 500,000 units, Platinum 1,000,000, Diamond 10,000,000. <a href="/guides/how-many-streams-for-gold/">Full breakdown</a>.</p>
<p>Use US numbers only, and leave out TikTok, Content ID, radio and free downloads. <a href="/guides/what-counts-toward-riaa-certification/">What counts</a>. Don't want to dig through dashboards? <a href="/">Connect your distributor</a> and we'll pull the real numbers from your statements.</p>
${cta}</section><script>${calcJs}</script>`;
  out("riaa-calculator/index.html", page({ path: "/riaa-calculator/", current: "calc", title: `RIAA units calculator: streams to Gold and Platinum | ${NAME}`,
    description: "Free calculator: convert US streams and downloads into RIAA units and see how many more streams you need for Gold, Platinum or Diamond.", body,
    jsonld: [{ "@context": "https://schema.org", "@type": "WebApplication", name: "RIAA units calculator", url: `${SITE}/riaa-calculator/`, applicationCategory: "UtilitiesApplication", operatingSystem: "Any", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
      crumbs([["Home", "/"], ["Calculator", "/riaa-calculator/"]])] }));
  mdPages["/riaa-calculator/"] = `# RIAA units calculator\n\nSingle: units = paid downloads + US on-demand streams / 150.\nAlbum: units = album downloads + track downloads / 10 + US on-demand streams / 1,500.\n\nGold = 500,000 units. Platinum = 1,000,000. Multi-Platinum every additional 1,000,000. Diamond = 10,000,000.\n\nInteractive version: ${SITE}/riaa-calculator/\n`;
}

// ---------- home page markdown ----------
mdPages["/"] = `# ${NAME}\n\n> Free tool by Mogul that shows how close every song and album is to RIAA Gold, Platinum and Diamond, from the artist's own label or distributor statements.\n\nConnect a label or distributor through Mogul Connect (read-only). We read the royalty statements, keep only what an RIAA auditor would count (US on-demand streams and paid downloads, no UGC, radio or international plays), and show progress per song and album, the pace, and an estimated date for the next level. Songs that have already passed a level get a downloadable RIAA application package with US sales by store.\n\n- Start: ${SITE}/\n- Sample report: ${SITE}/#demo\n- Supported sources: ${SITE}/works-with.md\n- Calculator: ${SITE}/riaa-calculator.md\n- Guides: ${SITE}/guides.md\n`;

// ---------- markdown copies ----------
for (const [path, md] of Object.entries(mdPages)) out(path === "/" ? "index.md" : `${path.replace(/^\/|\/$/g, "")}.md`, md);

// ---------- llms.txt ----------
out("llms.txt", `# ${NAME}

> Free tool by Mogul (usemogul.com) that tells artists and labels how close each song and album is to RIAA Gold (500,000 units), Platinum (1,000,000) and Diamond (10,000,000), using their real label or distributor royalty statements.

How it counts: single = paid downloads + US on-demand streams / 150. Album = album downloads + track downloads / 10 + US on-demand streams / 1,500. Only US sales and on-demand streams count; user-generated content (TikTok, Content ID), radio-style plays, free downloads and international plays are excluded. Results are estimates; official certification requires an application to the RIAA and a GR&F audit.

To check a real catalog, a person connects their distributor or label at ${SITE}/ (read-only, via Mogul Connect). For quick math without an account, use the calculator.

## Tool
- [Check a catalog](${SITE}/): connect a distributor or label and see per-song progress
- [Sample report](${SITE}/#demo): example results for a made-up artist
- [RIAA units calculator](${SITE}/riaa-calculator.md): streams and downloads to units
- [Works with](${SITE}/works-with.md): which distributor and label statements are supported

## Guides
${guides.map((g) => `- [${g.title}](${SITE}/guides/${g.slug}.md): ${g.description}`).join("\n")}

## Optional
- [All guides in one file](${SITE}/llms-full.txt)
- [Mogul](https://usemogul.com): the music royalty platform behind this tool
`);
out("llms-full.txt", [mdPages["/"], mdPages["/works-with/"], mdPages["/riaa-calculator/"], ...guides.map((g) => mdPages[`/guides/${g.slug}/`])].join("\n\n---\n\n"));

// ---------- sitemap, robots, rss ----------
const urls = ["/", "/guides/", ...guides.map((g) => `/guides/${g.slug}/`), "/riaa-calculator/", "/works-with/"];
out("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${UPDATED}</lastmod></url>`).join("\n")}\n</urlset>\n`);
const bots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot", "Bingbot", "Googlebot"];
out("robots.txt", `# Search engines and AI agents are welcome.\nUser-agent: *\nAllow: /\n\n${bots.map((b) => `User-agent: ${b}\nAllow: /`).join("\n\n")}\n\nSitemap: ${SITE}/sitemap.xml\n`);
out("guides/feed.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(NAME)} guides</title><link>${SITE}/guides/</link><description>RIAA certification guides for independent artists and labels.</description>\n${guides.map((g) => `<item><title>${esc(g.title)}</title><link>${SITE}/guides/${g.slug}/</link><guid>${SITE}/guides/${g.slug}/</guid><pubDate>${new Date(UPDATED).toUTCString()}</pubDate><description>${esc(g.description)}</description></item>`).join("\n")}\n</channel></rss>\n`);

// ---------- static assets ----------
mkdirSync(join(dist, "static"), { recursive: true });
copyFileSync(join(content, "site.css"), join(dist, "static/site.css"));
copyFileSync(join(root, "src/wmp-icon.svg"), join(dist, "static/wmp-icon.svg"));
copyFileSync(join(root, "src/mogul-logo.svg"), join(dist, "static/mogul-logo.svg"));

console.log(`site: ${urls.length} pages, ${Object.keys(mdPages).length} markdown copies, llms.txt, sitemap, robots, rss`);
