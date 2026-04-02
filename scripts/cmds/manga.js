const path = require("path");
const {
  MangaDex, GManga, ComicK, ARABIC_MADARA_SOURCES,
  fetchAllChapters, buildChapterList, sendChapterPages, handleReply,
  loadProgress, getLangFlag, getStatusLabel, CHAPTERS_PER_PAGE
} = require(path.join(__dirname, "mangaUtils"));

// ─── Search ───────────────────────────────────────────────────────────────────

async function searchManga(query) {
  const [dxRes, ckRes, gmRes] = await Promise.allSettled([
    MangaDex.search(query, { ratings: ["safe", "suggestive", "erotica"], limit: 20 }),
    ComicK.search(query),
    GManga.search(query)
  ]);

  const dx = dxRes.status === "fulfilled" ? dxRes.value : [];
  const ck = ckRes.status === "fulfilled" ? ckRes.value : [];
  const gm = gmRes.status === "fulfilled" ? gmRes.value : [];

  const madaraResults = await Promise.allSettled(
    ARABIC_MADARA_SOURCES.map(src => src.search(query))
  );
  const madara = madaraResults.filter(r => r.status === "fulfilled").flatMap(r => r.value);

  const seen = new Set();
  const merged = [];
  for (const m of [...gm, ...madara, ...dx, ...ck]) {
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
    name: "manga",
    aliases: ["man", "مانغا", "مانجا", "مانغة"],
    version: "10.0",
    author: "Djamel",
    countDown: 5,
    role: 0,
    shortDescription: "اقرأ المانغا بالعربية — 30+ مصدر",
    longDescription: "يبحث في 30+ مصدر عربي وعالمي: GManga · Mangalek · 3asq · MangaSwat · TeamX · GalaxyManga · OzulScans · KelManga · WeManga · FlixManga · Manga4up · ArabsManga · MangaArab · Onimanga · ComicK · MangaDex · MangaSee وأكثر",
    category: "anime",
    guide: { en: "{pn} <اسم المانغا>\nمثال: {pn} naruto\n{pn} jujutsu kaisen\n{pn} one piece\n{pn} تقدم — لعرض تقدم القراءة" }
  },

  onStart: async function ({ api, event, args, commandName }) {
    const { threadID, messageID, senderID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "📚 اكتب اسم المانغا.\n\nأمثلة:\n/manga naruto\n/manga jujutsu kaisen\n/manga one piece\n/manga black clover\n/manga attack on titan\n/manga demon slayer\n\n📡 المصادر (15+):\n🇸🇦 GManga · Mangalek · 3asq · MangaSwat · TeamX · GalaxyManga · OzulScans\n🇸🇦 PerfectManga · ArabsManga · KelManga · MangaArab · Onimanga · MangaKey\n🌐 ComicK · MangaDex · MangaSee\n\n/manga تقدم — آخر فصل قرأته",
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
      const results = await searchManga(query);
      if (!results.length) {
        api.setMessageReaction("❌", messageID, () => {}, true);
        return api.sendMessage(
          `❌ لم أجد نتائج لـ "${query}".\n💡 جرب الاسم بالإنجليزي أو تأكد من الإملاء.`,
          threadID, messageID
        );
      }

      let body = `🔍 نتائج: "${query}"\n━━━━━━━━━━━━━━━━━━\n\n`;
      results.forEach((m, i) => {
        const hasAr = m.availableLangs?.includes("ar") || m.hasAr;
        const lang = hasAr ? "🇸🇦 عربي" : "🌐 أخرى";
        const status = m.status ? ` · ${getStatusLabel(m.status)}` : "";
        body += `${i + 1}️⃣ ${m.title}\n   ${lang}${status} · ${m.source}\n\n`;
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
      console.error("[manga:search]", e.message);
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
      api.sendMessage(`⏳ جاري جلب الفصول من كل المصادر العربية...\n📚 "${m.title}"`, threadID);

      try {
        // نمرر الكائن كاملاً لتجنب البحث المزدوج
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

        let body = `📕 ${m.title}\n━━━━━━━━━━━━━━━━━━\n`;
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
        console.error("[manga:chapters]", e.message);
        api.setMessageReaction("❌", messageID, () => {}, true);
        api.sendMessage("❌ خطأ في جلب الفصول. جرب مرة أخرى.", threadID, messageID);
      }

    } else {
      await handleReply({ api, event, Reply, commandName });
    }
  }
};
