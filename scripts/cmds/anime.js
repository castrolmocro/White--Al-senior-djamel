const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");
const { execSync, exec } = require("child_process");

const JIKAN = "https://api.jikan.moe/v4";
const TMP_DIR = path.join(process.cwd(), "scripts/cmds/tmp");
const MAX_MB = 700;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept-Language": "ar,en;q=0.9" };

fs.ensureDirSync(TMP_DIR);

// ─── Jikan API (MyAnimeList) ──────────────────────────────────────────────────

async function searchAnime(query) {
  const res = await axios.get(`${JIKAN}/anime`, {
    params: { q: query, limit: 5, sfw: true, type: "tv" },
    timeout: 12000
  });
  return res.data.data || [];
}

async function getAnimeFull(malId) {
  const res = await axios.get(`${JIKAN}/anime/${malId}/full`, { timeout: 12000 });
  return res.data.data;
}

function getTitle(m) {
  return (m.title_english || m.title || m.title_japanese || "Unknown").trim();
}

function getStatus(s) {
  if (!s) return "";
  if (s.includes("Finished") || s === "FINISHED") return "منتهى ✅";
  if (s.includes("Airing") || s.includes("Currently") || s === "RELEASING") return "يُعرض الآن 🟢";
  if (s.includes("Not yet") || s === "NOT_YET_RELEASED") return "قريباً 🔜";
  if (s === "CANCELLED") return "ملغى ❌";
  return s;
}

function getSeason(s) {
  return { winter: "شتاء ❄️", spring: "ربيع 🌸", summer: "صيف ☀️", fall: "خريف 🍂", WINTER: "شتاء ❄️", SPRING: "ربيع 🌸", SUMMER: "صيف ☀️", FALL: "خريف 🍂" }[s] || (s || "");
}

function buildSeasons(media) {
  const seen = new Set();
  const list = [];

  const add = (entry) => {
    if (seen.has(entry.mal_id || entry.id)) return;
    seen.add(entry.mal_id || entry.id);
    list.push({
      id: entry.mal_id || entry.id,
      title: entry.title_english || entry.title || entry.name || getTitle(entry),
      episodes: entry.episodes || 0,
      season: entry.season,
      seasonYear: entry.year || entry.seasonYear,
      status: entry.status,
      format: entry.type || entry.format
    });
  };

  add(media);

  for (const rel of (media.relations || [])) {
    if (rel.relation === "Sequel" || rel.relation === "Prequel") {
      for (const e of (rel.entry || [])) {
        if (e.type === "anime") add(e);
      }
    }
  }

  list.sort((a, b) => (a.seasonYear || 9999) - (b.seasonYear || 9999));
  list.forEach((s, i) => { s.label = `الموسم ${i + 1}`; });
  return list;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function titleToSlug(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[:\u2019\u2018'`]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function getSlugsFromAnime(anime) {
  const slugs = new Set();
  const candidates = [
    anime.title_english,
    anime.title,
    anime.title_japanese
  ].filter(Boolean);
  for (const t of candidates) {
    const s = titleToSlug(t);
    if (s) slugs.add(s);
  }
  return [...slugs];
}

// ─── Downloader ───────────────────────────────────────────────────────────────

function downloadWithFFmpeg(videoUrl, referer, outFile) {
  return new Promise((resolve, reject) => {
    const ref = referer || "https://animelek.vip/";
    const cmd = `ffmpeg -y -headers "Referer: ${ref}" -i "${videoUrl}" -c:v copy -c:a aac "${outFile}" 2>&1`;
    exec(cmd, { timeout: 720000 }, (err) => {
      if (err) return reject(new Error(err.message));
      resolve(outFile);
    });
  });
}

function downloadWithFFmpegAndSub(videoUrl, subUrl, referer, outFile) {
  return new Promise((resolve, reject) => {
    const ref = referer || "https://hianime.to/";
    const cmd = `ffmpeg -y -headers "Referer: ${ref}" -i "${videoUrl}" -i "${subUrl}" -map 0:v -map 0:a -map 1:0 -c:v copy -c:a aac -c:s mov_text -metadata:s:s:0 language=ara "${outFile}" 2>&1`;
    exec(cmd, { timeout: 720000 }, (err) => {
      if (err) return reject(new Error(err.message));
      resolve(outFile);
    });
  });
}

async function downloadDirect(url, outFile, referer) {
  const res = await axios.get(url, {
    responseType: "stream",
    headers: { ...UA, "Referer": referer || "https://animelek.vip/" },
    timeout: 720000,
    maxContentLength: MAX_MB * 1024 * 1024
  });
  const writer = fs.createWriteStream(outFile);
  res.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

function checkFile(outFile) {
  if (!fs.existsSync(outFile)) return null;
  const mb = fs.statSync(outFile).size / (1024 * 1024);
  return mb > 1 && mb <= MAX_MB ? mb : null;
}

// ─── Hoster resolver ─────────────────────────────────────────────────────────
// Tries to download from any file hosting link

const SKIP_HOSTERS = ["mega.nz", "drive.google.com", "4shared.com", "meganz", "mega.co.nz"];

async function resolveAndDownload(url, outFile, referer) {
  if (!url || !url.startsWith("http")) return null;
  if (SKIP_HOSTERS.some(h => url.includes(h))) return null;

  const ref = referer || "https://animelek.vip/";

  // ── Direct m3u8/mp4 URL → ffmpeg or stream ───────────────────────────────
  if (url.includes(".m3u8")) {
    try {
      await downloadWithFFmpeg(url, ref, outFile);
      return checkFile(outFile);
    } catch (_) { return null; }
  }

  // ── mp4upload: parse embed for jwplayer source ────────────────────────────
  if (url.includes("mp4upload.com")) {
    try {
      const embedId = url.match(/embed-([a-z0-9]+)\.html/)?.[1] || url.match(/mp4upload\.com\/([a-z0-9]+)/)?.[1];
      if (embedId) {
        const r = await axios.get(`https://www.mp4upload.com/embed-${embedId}.html`, {
          headers: { ...UA, Referer: ref }, timeout: 12000
        });
        // jwplayer file source
        const src = r.data.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/)?.[1] ||
                    r.data.match(/src\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/)?.[1];
        if (src) {
          await downloadDirect(src, outFile, `https://www.mp4upload.com/`);
          return checkFile(outFile);
        }
      }
    } catch (_) {}
    return null;
  }

  // ── HEAD check → direct video response ───────────────────────────────────
  try {
    const head = await axios.head(url, {
      headers: { ...UA, Referer: ref }, timeout: 10000, maxRedirects: 6
    });
    const ct = (head.headers["content-type"] || "").toLowerCase();
    if (ct.includes("video") || ct.includes("octet-stream") || url.match(/\.(mp4|mkv|avi)(\?|$)/i)) {
      await downloadDirect(url, outFile, ref);
      return checkFile(outFile);
    }
  } catch (_) {}

  return null;
}

// ─── Source 1: animelek.vip (Primary – confirmed working) ────────────────────
// Episode URL pattern: /episode/{slug}-{N}-الحلقة/
// Download links: #downloads li.watch a[href]

async function tryAnimelek(slugs, epNum, outFile) {
  const epAr = "%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9"; // الحلقة URL-encoded
  const ref = "https://animelek.vip/";

  for (const slug of slugs) {
    // Try episode URL directly
    const epUrl = `https://animelek.vip/episode/${slug}-${epNum}-${epAr}/`;
    try {
      const r = await axios.get(epUrl, { headers: UA, timeout: 15000 });
      if (r.status !== 200) continue;

      const $ = cheerio.load(r.data);
      // Collect all external download links from the page
      const links = [];
      $("a[href]").each((_, el) => {
        const h = $(el).attr("href") || "";
        const t = $(el).text().toLowerCase();
        if (!h.startsWith("http") || h.includes("animelek")) return;
        // Prioritise HD quality
        const q = (t.match(/fhd|1080/) ? 4 : t.match(/hd|720/) ? 3 : t.match(/sd|480/) ? 2 : 1);
        links.push({ url: h, q });
      });
      links.sort((a, b) => b.q - a.q);

      for (const { url } of links) {
        try {
          if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
          const mb = await resolveAndDownload(url, outFile, ref);
          if (mb) return { filePath: outFile, sizeMB: mb, source: "AnimeLeK 🎌 (مترجم عربي)" };
        } catch (_) { continue; }
      }
    } catch (_) { continue; }
  }
  return null;
}

// ─── Source 2: shahiid-anime.net (Secondary – confirmed working) ─────────────
// Navigation: search → /series/ → /seasons/ → episode list → /episodes/ + /?download=

async function tryShahiid(searchTitles, epNum, outFile) {
  const ref = "https://shahiid-anime.net/";

  for (const query of searchTitles) {
    try {
      // Step 1: Search
      const sRes = await axios.get(`https://shahiid-anime.net/?s=${encodeURIComponent(query)}`, {
        headers: UA, timeout: 15000
      });
      const $s = cheerio.load(sRes.data);

      // Step 2: Find /seasons/ URL (direct season page)
      let seasonsUrl = null;
      $s("a[href*='/seasons/']").each((_, el) => {
        if (!seasonsUrl) seasonsUrl = $s(el).attr("href");
      });
      if (!seasonsUrl) continue;

      // Step 3: Get season page – list episodes
      const aRes = await axios.get(seasonsUrl, { headers: UA, timeout: 15000 });
      const $a = cheerio.load(aRes.data);

      // Episode padding (shahiid uses 01, 02...)
      const padded = String(epNum).padStart(2, "0");

      // Step 4: Find episode link + download ID
      let epPageUrl = null;
      let downloadId = null;

      $a("a[href]").each((_, el) => {
        const h = $a(el).attr("href") || "";
        const t = $a(el).text().trim();
        // Episode page: /episodes/anime-title-الحلقة-{XX}-...
        if (!epPageUrl && h.includes("/episodes/") &&
            (h.includes(`-%d8%a7%d9%84%d8%ad%d9%84%d9%82%d8%a9-${padded}`) ||
             h.includes(`الحلقة-${padded}`) ||
             new RegExp(`[^\\d]0*${epNum}[^\\d]`).test(h))) {
          epPageUrl = h;
        }
        // Download link: /?download=ID shown next to episode
        if (!downloadId && h.includes("?download=") &&
            (t.includes(padded) || t.includes(String(epNum)))) {
          downloadId = h.split("?download=")[1];
        }
      });

      // If no specific match, try positional (episode N = Nth item)
      if (!epPageUrl) {
        const epLinks = [];
        $a("a[href*='/episodes/']").each((_, el) => epLinks.push($a(el).attr("href")));
        const unique = [...new Set(epLinks)];
        if (epNum <= unique.length) epPageUrl = unique[epNum - 1];
      }
      if (!downloadId) {
        const dlLinks = [];
        $a("a[href*='?download=']").each((_, el) => dlLinks.push($a(el).attr("href").split("?download=")[1]));
        const unique = [...new Set(dlLinks)];
        if (epNum <= unique.length) downloadId = unique[epNum - 1];
      }

      // Step 5a: Try direct download endpoint
      if (downloadId) {
        const dlUrl = `https://shahiid-anime.net/?download=${downloadId}`;
        try {
          const mb = await resolveAndDownload(dlUrl, outFile, ref);
          if (mb) return { filePath: outFile, sizeMB: mb, source: "Shahiid Anime 📺 (عربي)" };
        } catch (_) {}
      }

      // Step 5b: Navigate episode page and collect stream/download links
      if (epPageUrl) {
        try {
          const eRes = await axios.get(epPageUrl, { headers: UA, timeout: 15000 });
          const $e = cheerio.load(eRes.data);
          const links = [];
          // m3u8 streams in source
          const m3u8s = (eRes.data.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g) || []);
          for (const u of m3u8s) links.push({ url: u, q: 10 });
          // mp4 download links
          $e("a[href]").each((_, el) => {
            const h = $e(el).attr("href") || "";
            const t = $e(el).text().toLowerCase();
            if (!h.startsWith("http") || h.includes("shahiid")) return;
            const q = t.includes("1080") ? 4 : t.includes("720") ? 3 : t.includes("480") ? 2 : 1;
            links.push({ url: h, q });
          });
          links.sort((a, b) => b.q - a.q);
          for (const { url } of links) {
            try {
              if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
              const mb = await resolveAndDownload(url, outFile, ref);
              if (mb) return { filePath: outFile, sizeMB: mb, source: "Shahiid Anime 📺 (عربي)" };
            } catch (_) { continue; }
          }
        } catch (_) {}
      }
    } catch (_) { continue; }
  }
  return null;
}

// ─── Source 3: animelek search fallback ──────────────────────────────────────
// When title slug guessing fails, search the site to find correct slug

async function tryAnimelekSearch(searchTitles, epNum, outFile) {
  const epAr = "%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9";
  const ref = "https://animelek.vip/";

  for (const query of searchTitles) {
    try {
      const r = await axios.get(`https://animelek.vip/?s=${encodeURIComponent(query)}`, {
        headers: UA, timeout: 15000
      });
      const $ = cheerio.load(r.data);
      const slugs = new Set();
      $("a[href*='/anime/']").each((_, el) => {
        const h = $(el).attr("href") || "";
        const slug = h.match(/\/anime\/([^/]+)\/?$/)?.[1];
        if (slug) slugs.add(slug);
      });
      if (!slugs.size) continue;

      for (const slug of slugs) {
        const epUrl = `https://animelek.vip/episode/${slug}-${epNum}-${epAr}/`;
        try {
          const er = await axios.get(epUrl, { headers: UA, timeout: 12000 });
          if (er.status !== 200) continue;
          const $e = cheerio.load(er.data);
          const links = [];
          $e("a[href]").each((_, el) => {
            const h = $e(el).attr("href") || "";
            const t = $e(el).text().toLowerCase();
            if (!h.startsWith("http") || h.includes("animelek")) return;
            const q = t.includes("fhd") || t.includes("1080") ? 4 : t.includes("hd") || t.includes("720") ? 3 : 1;
            links.push({ url: h, q });
          });
          links.sort((a, b) => b.q - a.q);
          for (const { url } of links) {
            try {
              if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
              const mb = await resolveAndDownload(url, outFile, ref);
              if (mb) return { filePath: outFile, sizeMB: mb, source: "AnimeLeK 🔍 (بحث)" };
            } catch (_) { continue; }
          }
        } catch (_) { continue; }
      }
    } catch (_) { continue; }
  }
  return null;
}

// ─── Main fetchEpisode ────────────────────────────────────────────────────────

async function fetchEpisode(animeTitle, epNum, seasonTitle, animeMeta) {
  const titles = [seasonTitle, animeTitle].filter(Boolean);
  const outFile = path.join(TMP_DIR, `anime_${Date.now()}_ep${epNum}.mp4`);

  // Build slug list from all known titles
  const slugCandidates = [];
  for (const t of titles) {
    const s = titleToSlug(t);
    if (s) slugCandidates.push(s);
  }
  // Also add slugs from MAL metadata if available
  if (animeMeta) {
    for (const s of getSlugsFromAnime(animeMeta)) {
      if (!slugCandidates.includes(s)) slugCandidates.push(s);
    }
  }

  const sources = [
    // Source 1: animelek.vip direct by slug
    () => tryAnimelek(slugCandidates, epNum, outFile),
    // Source 2: shahiid-anime.net via search
    () => tryShahiid(titles, epNum, outFile),
    // Source 3: animelek.vip via search (slug guessing fallback)
    () => tryAnimelekSearch(titles, epNum, outFile)
  ];

  for (const src of sources) {
    try {
      if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
      const result = await src();
      if (result) return result;
    } catch (_) { continue; }
  }

  return null;
}

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "anime",
    aliases: ["اني", "انمي", "أنمي"],
    version: "3.0",
    author: "Saint",
    countDown: 10,
    role: 0,
    shortDescription: "ابحث وشاهد الأنمي بترجمة عربية",
    longDescription: "ابحث عن أنمي، استعرض مواسمه وحلقاته، وحمّلها من مصادر عربية مثل AniméSlayer وanimelek",
    category: "anime",
    guide: { en: "{pn} <اسم الأنمي>" }
  },

  onStart: async function ({ api, event, args, commandName }) {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();
    if (!query) return api.sendMessage("🎌 اكتب اسم الأنمي.\nمثال: /anime naruto\n/anime attack on titan", threadID, messageID);

    api.setMessageReaction("⏳", messageID, () => {}, true);
    try {
      const results = await searchAnime(query);
      if (!results.length) {
        api.setMessageReaction("❌", messageID, () => {}, true);
        return api.sendMessage(`❌ لم أجد أنمي باسم "${query}".`, threadID, messageID);
      }
      let body = `🔍 نتائج: "${query}"\n━━━━━━━━━━━━━━━━━━\n\n`;
      results.forEach((a, i) => {
        body += `${i + 1}️⃣ ${getTitle(a)}\n`;
        body += `   📺 ${a.episodes || "?"} حلقة | ${getStatus(a.status)} | ⭐${a.score || "?"}/10\n\n`;
      });
      body += "↩️ رد برقم الأنمي.";
      api.setMessageReaction("✅", messageID, () => {}, true);
      api.sendMessage(body, threadID, (err, info) => {
        if (!info) return;
        global.GoatBot.onReply.set(info.messageID, { commandName, author: event.senderID, state: "select_anime", results, messageID: info.messageID });
      });
    } catch (e) {
      api.setMessageReaction("❌", messageID, () => {}, true);
      api.sendMessage("❌ خطأ في البحث.", threadID, messageID);
    }
  },

  onReply: async function ({ api, event, Reply, commandName }) {
    const { threadID, messageID } = event;
    const { state } = Reply;
    if (event.senderID !== Reply.author) return;

    // ── اختيار الأنمي
    if (state === "select_anime") {
      const n = parseInt(event.body);
      if (isNaN(n) || n < 1 || n > Reply.results.length) return api.sendMessage(`❌ اختر 1-${Reply.results.length}.`, threadID, messageID);
      const basicAnime = Reply.results[n - 1];

      api.setMessageReaction("⏳", messageID, () => {}, true);

      // Fetch full details including relations
      let anime = basicAnime;
      try { anime = await getAnimeFull(basicAnime.mal_id); } catch (_) {}

      const title = getTitle(anime);
      const desc = (anime.synopsis || "").replace(/<[^>]+>/g, "").substring(0, 300);
      const genreNames = (anime.genres || []).map(g => g.name).join(", ");
      const seasons = buildSeasons(anime);

      api.setMessageReaction("✅", messageID, () => {}, true);

      let body = `🎌 ${title}\n━━━━━━━━━━━━━━━━━━\n`;
      body += `📺 الحلقات: ${anime.episodes || "?"} | ${getStatus(anime.status)}\n`;
      body += `⭐ التقييم: ${anime.score || "؟"}/10\n`;
      body += `📅 ${getSeason(anime.season)} ${anime.year || ""}\n`;
      body += `🎭 ${genreNames}\n\n`;
      if (desc) body += `📝 ${desc}...\n\n`;

      if (seasons.length > 1) {
        body += `🗂 المواسم:\n`;
        seasons.forEach(s => body += `  📌 ${s.label}: ${s.title} — ${s.episodes || "?"} حلقة\n`);
        body += `\n↩️ رد بـ "1" أو "الموسم 1" لاختيار الموسم.`;
      } else {
        const eps = anime.episodes || 0;
        body += `📋 الحلقات: ${eps > 0 ? `1 — ${eps}` : "غير محدد"}\n`;
        body += "↩️ رد برقم الحلقة لتحميلها.";
      }

      try { api.unsendMessage(Reply.messageID); } catch (_) {}
      api.sendMessage(body, threadID, (err, info) => {
        if (!info) return;
        global.GoatBot.onReply.set(info.messageID, {
          commandName, author: event.senderID,
          state: seasons.length > 1 ? "select_season" : "select_episode",
          seasons, animeTitle: title, animeMeta: anime,
          totalEpisodes: seasons.length === 1 ? (anime.episodes || basicAnime.episodes || 0) : 0,
          seasonTitle: getTitle(anime),
          messageID: info.messageID
        });
      });

    // ── اختيار الموسم
    } else if (state === "select_season") {
      const { seasons, animeTitle } = Reply;
      const m = event.body.match(/\d+/);
      if (!m) return api.sendMessage("❌ اكتب رقم الموسم. مثال: 1", threadID, messageID);
      const idx = parseInt(m[0]) - 1;
      if (idx < 0 || idx >= seasons.length) return api.sendMessage(`❌ اختر 1-${seasons.length}.`, threadID, messageID);
      const season = seasons[idx];
      const eps = season.episodes || 0;

      let body = `📺 ${animeTitle} — ${season.label}\n━━━━━━━━━━━━━━━━━━\n`;
      body += `🎌 ${season.title}\n📊 ${eps || "?"} حلقة | ${getStatus(season.status)}\n`;
      body += `📅 ${getSeason(season.season)} ${season.seasonYear || ""}\n\n`;
      if (eps > 0) {
        body += `📋 الحلقات:\n`;
        for (let r = 0; r < Math.ceil(eps / 10); r++) {
          const from = r * 10 + 1, to = Math.min((r + 1) * 10, eps);
          body += `  ${Array.from({ length: to - from + 1 }, (_, i) => from + i).join(" • ")}\n`;
        }
      }
      body += `\n↩️ رد برقم الحلقة لتحميلها.`;

      try { api.unsendMessage(Reply.messageID); } catch (_) {}
      api.sendMessage(body, threadID, (err, info) => {
        if (!info) return;
        global.GoatBot.onReply.set(info.messageID, {
          commandName, author: event.senderID, state: "select_episode",
          seasons, animeTitle, animeMeta: Reply.animeMeta, season, seasonTitle: season.title,
          seasonIdx: idx, totalEpisodes: eps, messageID: info.messageID
        });
      });

    // ── تحميل الحلقة
    } else if (state === "select_episode" || state === "navigate_episode") {
      const { animeTitle, season, seasons, seasonIdx, seasonTitle, totalEpisodes } = Reply;
      const input = event.body.trim().toLowerCase();

      let epNum = null;
      if (input === "next" && Reply.currentEp) epNum = Reply.currentEp + 1;
      else if (input === "prev" && Reply.currentEp) epNum = Math.max(1, Reply.currentEp - 1);
      else { const n = parseInt(event.body); if (!isNaN(n) && n > 0) epNum = n; }

      if (!epNum) return api.sendMessage("❌ اكتب رقم الحلقة.", threadID, messageID);
      if (totalEpisodes > 0 && epNum > totalEpisodes)
        return api.sendMessage(`❌ الحلقة ${epNum} غير موجودة. الحد الأقصى ${totalEpisodes}.`, threadID, messageID);

      const seasonLabel = season?.label || "الموسم 1";
      let waitMsgID = null;
      api.sendMessage(
        `⏳ جاري البحث عن الحلقة ${epNum} من ${animeTitle} — ${seasonLabel}\n🔍 مصادر: animelek ← shahiid-anime ← بحث...`,
        threadID, (e, info) => { if (info) waitMsgID = info.messageID; }
      );

      try {
        const result = await fetchEpisode(animeTitle, epNum, seasonTitle, Reply.animeMeta);
        if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch (_) {}

        if (!result) {
          return api.sendMessage(
            `❌ لم أجد الحلقة ${epNum} من ${animeTitle}.\n` +
            `💡 جرب رقماً مختلفاً أو تحقق من اسم الأنمي.`,
            threadID, messageID
          );
        }

        const body =
          `🎌 ${animeTitle} — ${seasonLabel}\n` +
          `📺 الحلقة ${epNum}\n` +
          `✅ المصدر: ${result.source}\n` +
          `📦 الحجم: ${result.sizeMB.toFixed(1)} MB`;

        api.sendMessage(
          { body, attachment: fs.createReadStream(result.filePath) },
          threadID,
          (err, info) => {
            try { fs.unlinkSync(result.filePath); } catch (_) {}
            if (!info) return;

            const hasNext = !totalEpisodes || epNum + 1 <= totalEpisodes;
            let nav = `✅ انتهت الحلقة ${epNum} من ${animeTitle}.\n\n`;
            if (hasNext) nav += `▶️ ↩️ رد بـ "next" للحلقة التالية.\n`;
            if (epNum > 1) nav += `◀️ ↩️ رد بـ "prev" للسابقة.\n`;
            nav += `↩️ أو رد برقم أي حلقة للانتقال إليها.`;

            api.sendMessage(nav, threadID, (e2, navInfo) => {
              if (!navInfo) return;
              global.GoatBot.onReply.set(navInfo.messageID, {
                commandName, author: event.senderID, state: "navigate_episode",
                animeTitle, animeMeta: Reply.animeMeta, season, seasons, seasonIdx, seasonTitle,
                totalEpisodes, currentEp: epNum, messageID: navInfo.messageID
              });
            });
          }
        );
        try { api.unsendMessage(Reply.messageID); } catch (_) {}

      } catch (e) {
        if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch (_) {}
        console.error("[anime:dl]", e.message);
        api.sendMessage("❌ خطأ أثناء التحميل. جرب مرة أخرى.", threadID, messageID);
      }
    }
  }
};
