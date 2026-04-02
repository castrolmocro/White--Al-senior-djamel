const path = require("path");
const {
  MangaDex, GManga, ComicK, ARABIC_MADARA_SOURCES,
  fetchAllChapters, buildChapterList, sendChapterPages, handleReply,
  loadProgress, getLangFlag, getStatusLabel, CHAPTERS_PER_PAGE
} = require(path.join(__dirname, "mangaUtils"));

// ─── Search ───────────────────────────────────────────────────────────────────

async function searchManhwa(query) {
  const KO_ZH = ["ko", "zh", "zh-hk"];

  const [dxKo, dxAll, ckRes, gmRes] = await Promise.allSettled([
    MangaDex.search(query, { origLangs: KO_ZH, ratings: ["safe", "suggestive", "erotica"], limit: 20 }),
    MangaDex.search(query, { ratings: ["safe", "suggestive", "erotica"], limit: 10 }),
    ComicK.search(query),
    GManga.search(query)
  ]);

  const dx1 = dxKo.status === "fulfilled" ? dxKo.value : [];
  const dx2 = dxAll.status === "fulfilled" ? dxAll.value : [];
  const ck  = ckRes.status === "fulfilled" ? ckRes.value : [];
  const gm  = gmRes.status === "fulfilled" ? gmRes.value : [];

  const madaraResults = await Promise.allSettled(
    ARABIC_MADARA_SOURCES.map(src => src.search(query))
  );
  const madara = madaraResults.filter(r => r.status === "fulfilled").flatMap(r => r.value);

  const seen = new Set();
  const merged = [];
  for (const m of [...gm, ...madara, ...dx1, ...dx2, ...ck]) {
    const key = (m.title || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, "").slice(0, 30);
    if (!seen.has(key)) { seen.add(key); merged.push(m); }
  }

  merged.sort((a, b) => {
    const aAr = (a.availableLangs?.includes("ar") || a.hasAr) ? 0 : 1;
    const bAr = (b.availableLangs?.includes("ar") || b.hasAr) ? 0 : 1;
    return aAr - bAr;
  });

  return merged.slice(0, 15);
}

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "manhwa",
    aliases: ["مانهوا", "manhua", "webtoon", "ويبتون", "manhwas"],
    version: "6.0",
    author: "Djamel",
    countDown: 5,
    role: 0,
    shortDescription: "اقرأ المانهوا الكورية والصينية بالعربية — 15+ مصدر",
    longDescription: "يبحث في GManga · Mangalek · 3asq · MangaSwat · TeamX · GalaxyManga · OzulScans · PerfectManga · ArabsManga · KelManga · MangaArab · Onimanga · MangaKey · ComicK · MangaDex · MangaSee",
    category: "anime",
    guide: {
      en: "{pn} <اسم المانهوا>\nمثال:\n{pn} solo leveling\n{pn} tower of god\n{pn} lookism\n{pn} true beauty\n{pn} omniscient reader\n{pn} تقدم — لعرض تقدم القراءة"
    }
  },

  onStart: async function ({ api, event, args, commandName }) {
    const { threadID, messageID, senderID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "📗 اكتب اسم المانهوا الكورية أو الصينية.\n\nأمثلة شهيرة:\n/manhwa solo leveling\n/manhwa tower of god\n/manhwa noblesse\n/manhwa lookism\n/manhwa true beauty\n/manhwa omniscient reader\n/manhwa windbreaker\n/manhwa the beginning after the end\n/manhwa return of the mount hua sect\n\n📡 المصادر (15+):\n🇸🇦 GManga · Mangalek · 3asq · MangaSwat · TeamX · GalaxyManga\n🇸🇦 OzulScans · PerfectManga · ArabsManga · KelManga · MangaArab\n🌐 ComicK · MangaDex · MangaSee\n\n/manhwa تقدم — آخر فصل قرأته",
        threadID, messageID
      );
    }

    if (query === "تقدم" || query.toLowerCase() === "progress") {
      const data = loadProgress();
      const user = data[senderID];
      if (!user || !Object.keys(user).length)
        return api.sendMessage("📊 لا يوجد تقدم محفوظ لك بعد.", threadID, messageID);
      let body = "📊 تقدمك في القراءة:\n━━━━━━━━━━━━━━━━━━\n\n";
      Object.entries(user)
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .forEach(([title, info]) => {
          const date = new Date(info.timestamp).toLocaleDateString("ar-SA");
          body += `📖 ${title}\n   آخر فصل: ${info.chapter} · ${date}\n\n`;
        });
      return api.sendMessage(body, threadID, messageID);
    }

    api.setMessageReaction("⏳", messageID, () => {}, true);
    try {
      const results = await searchManhwa(query);
      if (!results.length) {
        api.setMessageReaction("❌", messageID, () => {}, true);
        return api.sendMessage(
          `❌ لم أجد نتائج لـ "${query}".\n💡 جرب الاسم بالإنجليزي مثل: solo leveling`,
          threadID, messageID
        );
      }

      let body = `🔍 نتائج: "${query}"\n━━━━━━━━━━━━━━━━━━\n\n`;
      results.forEach((m, i) => {
        const hasAr = m.availableLangs?.includes("ar") || m.hasAr;
        const origLang = m.originalLang ? getLangFlag(m.originalLang) : "";
        const lang = hasAr ? "🇸🇦 عربي" : "🌐 أخرى";
        const status = m.status ? ` · ${getStatusLabel(m.status)}` : "";
        body += `${i + 1}️⃣ ${m.title}\n   ${origLang} ${lang}${status} · ${m.source}\n\n`;
      });
      body += "↩️ رد برقم للقراءة.";

      api.setMessageReaction("✅", messageID, () => {}, true);
      api.sendMessage(body, threadID, (err, info) => {
        if (err || !info) return;
        global.GoatBot.onReply.set(info.messageID, {
          commandName, author: senderID,
          state: "select_manga", results, messageID: info.messageID
        });
      });
    } catch (e) {
      console.error("[manhwa:search]", e.message);
      api.setMessageReaction("❌", messageID, () => {}, true);
      api.sendMessage("❌ خطأ في البحث. جرب مرة أخرى.", threadID, messageID);
    }
  },

  onReply: async function ({ api, event, Reply, commandName }) {
    const { threadID, messageID } = event;
    if (event.senderID !== Reply.author) return;

    if (Reply.state === "select_manga") {
      const n = parseInt(event.body);
      if (isNaN(n) || n < 1 || n > Reply.results.length)
        return api.sendMessage(`❌ اختر رقماً بين 1 و${Reply.results.length}.`, threadID, messageID);

      const m = Reply.results[n - 1];
      api.setMessageReaction("⏳", messageID, () => {}, true);
      api.sendMessage(`⏳ جاري جلب الفصول من كل المصادر العربية...\n📗 "${m.title}"`, threadID);

      try {
        const chapters = await fetchAllChapters(m, null, null, {
          ratings: ["safe", "suggestive", "erotica"]
        });

        if (!chapters.length) {
          api.setMessageReaction("❌", messageID, () => {}, true);
          return api.sendMessage(
            `❌ لا توجد فصول متاحة لـ "${m.title}".\n💡 جرب باسم مختلف أو مصدر آخر.`,
            threadID, messageID
          );
        }

        const arCount = chapters.filter(c => c.isAr).length;
        const sources = [...new Set(chapters.map(c => c.source))].join(" · ");

        let body = `📗 ${m.title}\n━━━━━━━━━━━━━━━━━━\n`;
        body += `📖 ${chapters.length} فصل`;
        if (arCount > 0) body += ` · 🇸🇦 ${arCount} بالعربية`;
        body += `\n📡 المصادر: ${sources}\n`;
        if (m.status) body += `📊 ${getStatusLabel(m.status)}\n`;
        if (m.tags?.length) body += `🏷 ${m.tags.join(" · ")}\n`;
        if (m.description) body += `\n📝 ${m.description}...\n`;
        body += "\n" + buildChapterList(m.title, chapters, 0);

        api.setMessageReaction("✅", messageID, () => {}, true);
        api.sendMessage(body, threadID, (err, info) => {
          if (err || !info) return;
          global.GoatBot.onReply.set(info.messageID, {
            commandName, author: event.senderID,
            state: "browse_chapters", chapters, mangaTitle: m.title,
            page: 0, messageID: info.messageID
          });
        });
        try { api.unsendMessage(Reply.messageID); } catch (_) {}

      } catch (e) {
        console.error("[manhwa:chapters]", e.message);
        api.setMessageReaction("❌", messageID, () => {}, true);
        api.sendMessage("❌ خطأ في جلب الفصول. جرب مرة أخرى.", threadID, messageID);
      }

    } else {
      await handleReply({ api, event, Reply, commandName });
    }
  }
};
