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

// ─── AniméSlayer Scraper ──────────────────────────────────────────────────────

async function slayerSearch(query) {
  try {
    const url = `https://animeslayer.net/?search_param=animes&s=${encodeURIComponent(query)}`;
    const res = await axios.get(url, { headers: UA, timeout: 15000 });
    const $ = cheerio.load(res.data);
    const results = [];
    $("article, .anime-card, .post, .blog-card, .AnimeCard").each((i, el) => {
      const a = $(el).find("a[href*='animeslayer']").first();
      const title = ($(el).find("h2, h3, .title, .post-title, .AnimeTitle").first().text() || a.attr("title") || "").trim();
      const link = a.attr("href") || $(el).find("a").first().attr("href");
      if (title && link && link.includes("animeslayer")) results.push({ title, link });
    });
    return results.slice(0, 5);
  } catch (_) { return []; }
}

async function slayerGetEpisodeUrl(animePageUrl, epNum) {
  try {
    const res = await axios.get(animePageUrl, { headers: UA, timeout: 15000 });
    const $ = cheerio.load(res.data);
    let epUrl = null;
    $("a[href]").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (epUrl) return;
      const epPatterns = [
        new RegExp(`episode[\\-_\\s]?0*${epNum}(?:[^\\d]|$)`, "i"),
        new RegExp(`ep[\\-_\\s]?0*${epNum}(?:[^\\d]|$)`, "i"),
        new RegExp(`حلقة[\\s\\-]?0*${epNum}(?:[^\\d]|$)`)
      ];
      if (epPatterns.some(p => p.test(href) || p.test(text))) {
        epUrl = href;
      }
    });
    return epUrl;
  } catch (_) { return null; }
}

async function slayerGetDownloadLinks(epUrl) {
  try {
    const res = await axios.get(epUrl, { headers: UA, timeout: 15000 });
    const $ = cheerio.load(res.data);
    const links = [];

    // Direct MP4 links
    $("a[href]").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (href.match(/\.(mp4|mkv|avi)(\?|$)/i) || text.match(/تحميل|download/i)) {
        const quality = text.match(/1080|720|480|360/) ? text.match(/1080|720|480|360/)[0] : "720";
        links.push({ url: href, quality, type: "direct" });
      }
    });

    // Embedded players (m3u8 sources)
    const html = res.data;
    const m3u8Matches = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g) || [];
    for (const u of m3u8Matches) links.push({ url: u, quality: "auto", type: "hls" });

    return links;
  } catch (_) { return []; }
}

// ─── animelek.me Scraper ──────────────────────────────────────────────────────

async function animelek_search(query) {
  try {
    const url = `https://animelek.me/?s=${encodeURIComponent(query)}`;
    const res = await axios.get(url, { headers: UA, timeout: 15000 });
    const $ = cheerio.load(res.data);
    const results = [];
    $(".anime-card, article, .item").each((i, el) => {
      const a = $(el).find("a").first();
      const title = ($(el).find("h2, h3, .title").first().text() || a.attr("title") || "").trim();
      const link = a.attr("href");
      if (title && link) results.push({ title, link });
    });
    return results.slice(0, 5);
  } catch (_) { return []; }
}

async function animelek_episode(animeUrl, epNum) {
  try {
    const res = await axios.get(animeUrl, { headers: UA, timeout: 15000 });
    const $ = cheerio.load(res.data);
    let epUrl = null;
    $("a[href]").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (epUrl) return;
      if (new RegExp(`(episode|ep)[\\-_]?0*${epNum}(?:[^\\d]|$)`, "i").test(href) ||
          new RegExp(`حلقة[\\s\\-]?0*${epNum}(?:[^\\d]|$)`).test(text)) {
        epUrl = href;
      }
    });
    if (!epUrl) return [];
    const epRes = await axios.get(epUrl, { headers: UA, timeout: 15000 });
    const $ep = cheerio.load(epRes.data);
    const links = [];
    $ep("a[href]").each((i, el) => {
      const href = $ep(el).attr("href") || "";
      const text = $ep(el).text().trim();
      if (href.match(/\.(mp4|mkv)(\?|$)/i) || text.match(/تحميل|download/i)) {
        links.push({ url: href, quality: (text.match(/1080|720|480/) || ["720"])[0], type: "direct" });
      }
    });
    return links;
  } catch (_) { return []; }
}

// ─── aniwatch API (fallback with Arabic subs) ─────────────────────────────────

const ANIWATCH_INSTANCES = [
  "https://aniwatch-api-nine.vercel.app",
  "https://aniwatch-api-dusky.vercel.app"
];

async function aniwatchSearch(query) {
  for (const base of ANIWATCH_INSTANCES) {
    try {
      const res = await axios.get(`${base}/api/v2/hianime/search`, {
        params: { q: query, page: 1 },
        timeout: 10000
      });
      return { base, results: res.data.data?.animes || [] };
    } catch (_) { continue; }
  }
  return { base: null, results: [] };
}

async function aniwatchEpisodes(base, animeId) {
  try {
    const res = await axios.get(`${base}/api/v2/hianime/anime/${animeId}/episodes`, { timeout: 10000 });
    return res.data.data?.episodes || [];
  } catch (_) { return []; }
}

async function aniwatchSources(base, episodeId) {
  for (const cat of ["sub", "dub"]) {
    for (const server of ["vidstreaming", "vidcloud", "streamsb"]) {
      try {
        const res = await axios.get(`${base}/api/v2/hianime/episode/sources`, {
          params: { animeEpisodeId: episodeId, server, category: cat },
          timeout: 12000
        });
        const sources = res.data.data?.sources || [];
        const subs = res.data.data?.subtitles || [];
        if (sources.length) return { sources, subtitles: subs };
      } catch (_) { continue; }
    }
  }
  return null;
}

// ─── Downloader ───────────────────────────────────────────────────────────────

function downloadWithFFmpeg(videoUrl, subUrl, outFile) {
  return new Promise((resolve, reject) => {
    let cmd;
    if (subUrl) {
      const subFile = outFile.replace(".mp4", ".vtt");
      cmd = `ffmpeg -y -i "${videoUrl}" -i "${subUrl}" -map 0:v -map 0:a -map 1:0 -c:v copy -c:a aac -c:s mov_text -metadata:s:s:0 language=ara "${outFile}" 2>&1`;
    } else {
      cmd = `ffmpeg -y -i "${videoUrl}" -c:v copy -c:a aac "${outFile}" 2>&1`;
    }
    exec(cmd, { timeout: 600000 }, (err, stdout) => {
      if (err) return reject(new Error(`ffmpeg error: ${err.message}`));
      resolve(outFile);
    });
  });
}

async function downloadDirect(url, outFile) {
  const res = await axios.get(url, {
    responseType: "stream",
    headers: { ...UA, "Referer": "https://animeslayer.net/" },
    timeout: 600000
  });
  const writer = fs.createWriteStream(outFile);
  res.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function fetchEpisode(animeTitle, epNum, seasonTitle) {
  const searchTitle = seasonTitle || animeTitle;
  const outFile = path.join(TMP_DIR, `anime_${Date.now()}_ep${epNum}.mp4`);

  // ── 1. AniméSlayer ────────────────────────────────────────────────────────
  try {
    const slayerResults = await slayerSearch(searchTitle);
    if (slayerResults.length > 0) {
      const epUrl = await slayerGetEpisodeUrl(slayerResults[0].link, epNum);
      if (epUrl) {
        const links = await slayerGetDownloadLinks(epUrl);
        const best = links.sort((a, b) => {
          const qOrder = { "1080": 3, "720": 2, "480": 1 };
          return (qOrder[b.quality] || 0) - (qOrder[a.quality] || 0);
        })[0];
        if (best) {
          if (best.type === "direct") {
            await downloadDirect(best.url, outFile);
          } else {
            await downloadWithFFmpeg(best.url, null, outFile);
          }
          if (fs.existsSync(outFile)) {
            const mb = fs.statSync(outFile).size / (1024 * 1024);
            if (mb > 1 && mb <= MAX_MB) return { filePath: outFile, sizeMB: mb, source: "AniméSlayer 🗡️" };
          }
        }
      }
    }
  } catch (_) {}

  // ── 2. animelek.me ────────────────────────────────────────────────────────
  try {
    const anilekResults = await animelek_search(searchTitle);
    if (anilekResults.length > 0) {
      const links = await animelek_episode(anilekResults[0].link, epNum);
      const best = links[0];
      if (best) {
        if (best.type === "direct") await downloadDirect(best.url, outFile);
        else await downloadWithFFmpeg(best.url, null, outFile);
        if (fs.existsSync(outFile)) {
          const mb = fs.statSync(outFile).size / (1024 * 1024);
          if (mb > 1 && mb <= MAX_MB) return { filePath: outFile, sizeMB: mb, source: "AnimeLeK 📺" };
        }
      }
    }
  } catch (_) {}

  // ── 3. aniwatch (Arabic subs + ffmpeg) ────────────────────────────────────
  try {
    const { base, results } = await aniwatchSearch(searchTitle);
    if (base && results.length > 0) {
      const animeId = results[0].id;
      const episodes = await aniwatchEpisodes(base, animeId);
      const targetEp = episodes.find(e => String(e.number) === String(epNum));
      if (targetEp) {
        const data = await aniwatchSources(base, targetEp.episodeId);
        if (data) {
          const hlsSource = data.sources.find(s => s.type === "hls") || data.sources[0];
          const arabicSub = data.subtitles.find(s => s.lang?.toLowerCase().includes("arabic") || s.lang?.toLowerCase().includes("arab"));
          const subUrl = arabicSub?.url || null;
          if (hlsSource) {
            await downloadWithFFmpeg(hlsSource.url, subUrl, outFile);
            if (fs.existsSync(outFile)) {
              const mb = fs.statSync(outFile).size / (1024 * 1024);
              if (mb > 1 && mb <= MAX_MB) return { filePath: outFile, sizeMB: mb, source: "aniwatch 🎌 (ترجمة عربية)" };
            }
          }
        }
      }
    }
  } catch (_) {}

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
          seasons, animeTitle: title,
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
          seasons, animeTitle, season, seasonTitle: season.title,
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
        `⏳ جاري البحث عن الحلقة ${epNum} من ${animeTitle} — ${seasonLabel}\n🔍 مصادر: AniméSlayer ← animelek ← aniwatch`,
        threadID, (e, info) => { if (info) waitMsgID = info.messageID; }
      );

      try {
        const result = await fetchEpisode(animeTitle, epNum, seasonTitle);
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
                animeTitle, season, seasons, seasonIdx, seasonTitle,
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
