const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const API = "https://api.mangadex.org";
const MB_BASE = "https://mangabuddy.com";
const CACHE = path.join(__dirname, "cache");
const CHAPTERS_PER_PAGE = 25;
const PAGE_BATCH = 30;

const MB_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": MB_BASE + "/"
};

const MB_NAV = new Set(["home","popular","latest","manga-list","discussions","settings",
  "bookmarks","history","notifications","search","genres","az-list","contact",
  "privacy-policy","terms-of-service","dmca","newest","login","register"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMangaTitle(manga) {
  const t = manga.attributes.title;
  return t.en || t["ja-ro"] || t.ja_ro || Object.values(t)[0] || "Unknown";
}

function getLangFlag(lang) {
  const flags = {
    ar: "🇸🇦", en: "🇬🇧", fr: "🇫🇷", es: "🇪🇸", "es-la": "🇲🇽",
    "pt-br": "🇧🇷", pt: "🇵🇹", ru: "🇷🇺", tr: "🇹🇷", it: "🇮🇹",
    de: "🇩🇪", id: "🇮🇩", vi: "🇻🇳", th: "🇹🇭", ko: "🇰🇷",
    ja: "🇯🇵", zh: "🇨🇳", "zh-hk": "🇭🇰", pl: "🇵🇱", uk: "🇺🇦"
  };
  return flags[lang] || `[${lang}]`;
}

function getContentTypeLabel(lang) {
  if (lang === "ko") return "📗 مانهوا";
  if (lang === "zh" || lang === "zh-hk") return "📘 مانهوا صينية";
  return "📕 مانغا";
}

function getStatusLabel(s) {
  return { ongoing: "مستمرة 🟢", completed: "مكتملة ✅", hiatus: "متوقفة ⏸", cancelled: "ملغاة ❌" }[s] || s || "—";
}

// ─── MangaDex API ─────────────────────────────────────────────────────────────

async function searchManga(query) {
  try {
    const url = `${API}/manga?title=${encodeURIComponent(query)}&limit=15&order[relevance]=desc&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`;
    const res = await axios.get(url, { timeout: 20000 });
    return res.data.data || [];
  } catch (_) { return []; }
}

async function fetchFeed(mangaId, langs = []) {
  let all = [];
  let offset = 0;
  const limit = 96;
  while (true) {
    const parts = [
      `order[chapter]=asc`, `order[volume]=asc`,
      `limit=${limit}`, `offset=${offset}`,
      `contentRating[]=safe`, `contentRating[]=suggestive`,
      `contentRating[]=erotica`, `contentRating[]=pornographic`
    ];
    langs.forEach(l => parts.push(`translatedLanguage[]=${l}`));
    try {
      const res = await axios.get(`${API}/manga/${mangaId}/feed?${parts.join("&")}`, { timeout: 20000 });
      const data = res.data.data || [];
      all = all.concat(data);
      if (all.length >= res.data.total || data.length < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 200));
    } catch (_) { break; }
  }
  return all;
}

async function getDxArabicChapters(mangaId) {
  const arFeed = await fetchFeed(mangaId, ["ar"]);
  if (arFeed.length > 0) return arFeed;
  return [];
}

async function getDxChapterPages(chapterId) {
  const res = await axios.get(`${API}/at-home/server/${chapterId}`, { timeout: 15000 });
  const { baseUrl, chapter } = res.data;
  return chapter.data.map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
}

// ─── MangaBuddy API ───────────────────────────────────────────────────────────

async function mbSearch(query) {
  try {
    const res = await axios.get(`${MB_BASE}/search?q=${encodeURIComponent(query)}`, {
      timeout: 15000, headers: MB_HEADERS
    });
    const links = [...new Set(res.data.match(/href="\/([a-z0-9-]+)"/g) || [])];
    const slugs = links
      .map(l => l.replace(/^href="\//, "").replace(/"$/, ""))
      .filter(l => l.length > 2 && !MB_NAV.has(l));
    return slugs.length > 0 ? slugs[0] : null;
  } catch (_) { return null; }
}

async function mbGetChapters(mangaSlug) {
  try {
    const res = await axios.get(`${MB_BASE}/${mangaSlug}`, {
      timeout: 15000, headers: MB_HEADERS
    });
    const matches = [...res.data.matchAll(/href="\/[a-z0-9-]+\/(chapter-[a-z0-9-]+)"/g)];
    const seen = new Set();
    const chapters = [];
    for (const m of matches) {
      const slug = m[1];
      const numMatch = slug.match(/chapter-(\d+(?:\.\d+)?)/);
      if (!numMatch) continue;
      const num = numMatch[1];
      if (seen.has(num)) continue;
      seen.add(num);
      chapters.push({ num, slug, mangaSlug });
    }
    chapters.sort((a, b) => parseFloat(a.num) - parseFloat(b.num));
    return chapters;
  } catch (_) { return []; }
}

async function mbGetChapterImages(mangaSlug, chapterSlug) {
  const res = await axios.get(`${MB_BASE}/${mangaSlug}/${chapterSlug}`, {
    timeout: 20000, headers: MB_HEADERS
  });
  const chapImages = res.data.match(/var chapImages = '([^']+)'/)?.[1];
  if (!chapImages) throw new Error("chapImages not found");
  return chapImages.split(",").filter(u => u.startsWith("http"));
}

// ─── Unified chapter merging ───────────────────────────────────────────────────
// Unified chapter: { num, flag, dxId, mbSlug, mbMangaSlug, title }
// dxId → read from MangaDex (Arabic preferred)
// mbSlug → read from MangaBuddy (English)

function buildUnifiedChapters(mbChapters, dxArChapters) {
  // Build a map of Arabic MangaDex chapters by chapter number
  const dxArMap = new Map();
  for (const ch of dxArChapters) {
    const num = ch.attributes.chapter || "0";
    if (!dxArMap.has(num)) dxArMap.set(num, ch);
  }

  // Use MangaBuddy as base (full list), tag Arabic when available
  const chapters = mbChapters.map(mb => {
    const dxCh = dxArMap.get(mb.num);
    return {
      num: mb.num,
      flag: dxCh ? "🇸🇦" : "🇬🇧",
      title: dxCh?.attributes?.title || "",
      dxId: dxCh?.id || null,
      mbSlug: mb.slug,
      mbMangaSlug: mb.mangaSlug
    };
  });

  // If MangaBuddy has no chapters but MangaDex does, use MangaDex
  if (chapters.length === 0 && dxArChapters.length > 0) {
    const seen = new Map();
    for (const ch of dxArChapters) {
      const num = ch.attributes.chapter || "0";
      if (!seen.has(num)) seen.set(num, ch);
    }
    return [...seen.values()]
      .sort((a, b) => parseFloat(a.attributes.chapter || 0) - parseFloat(b.attributes.chapter || 0))
      .map(ch => ({
        num: ch.attributes.chapter || "؟",
        flag: getLangFlag(ch.attributes.translatedLanguage),
        title: ch.attributes.title || "",
        dxId: ch.id,
        mbSlug: null,
        mbMangaSlug: null
      }));
  }

  return chapters;
}

// ─── Chapter list display ──────────────────────────────────────────────────────

function buildChapterListBody(mangaTitle, chapters, page, source) {
  const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);
  const start = page * CHAPTERS_PER_PAGE;
  const slice = chapters.slice(start, start + CHAPTERS_PER_PAGE);
  const arCount = chapters.filter(c => c.flag === "🇸🇦").length;

  let body = `📖 ${mangaTitle}\n`;
  body += `📚 ${chapters.length} فصل`;
  if (arCount > 0) body += ` | 🇸🇦 ${arCount} بالعربية`;
  if (source === "mb") body += ` | 🇬🇧 إنجليزي`;
  body += `\n📄 الصفحة ${page + 1}/${totalPages}\n`;
  body += "━━━━━━━━━━━━━━━━━━\n\n";

  slice.forEach(ch => {
    const title = ch.title ? ` — ${ch.title.slice(0, 25)}` : "";
    body += `${ch.flag} فصل ${ch.num}${title}\n`;
  });

  body += "\n↩️ رد برقم الفصل لقراءته.";
  if (start + CHAPTERS_PER_PAGE < chapters.length) body += '\n↩️ رد بـ "next" للصفحة التالية.';
  if (page > 0) body += '\n↩️ رد بـ "prev" للصفحة السابقة.';
  return body;
}

// ─── Page sender ──────────────────────────────────────────────────────────────

async function sendChapterPages(api, event, chapter, mangaTitle, chapters, currentIndex, commandName) {
  const { threadID } = event;
  const chNum = chapter.num;

  let waitMsgID = null;
  await new Promise(resolve => {
    api.sendMessage(
      `⏳ جاري تحميل ${chapter.flag} فصل ${chNum}\n📖 "${mangaTitle}"`,
      threadID,
      (err, info) => { if (info) waitMsgID = info.messageID; resolve(); }
    );
  });

  try {
    fs.ensureDirSync(CACHE);

    // Get image URLs: MangaDex Arabic first, then MangaBuddy
    let pages = [];
    let langUsed = chapter.flag;

    if (chapter.dxId) {
      try {
        pages = await getDxChapterPages(chapter.dxId);
        langUsed = "🇸🇦";
      } catch (e) {
        console.error("[manga:dx-pages]", e.message, "→ falling back to MangaBuddy");
      }
    }

    if (pages.length === 0 && chapter.mbSlug && chapter.mbMangaSlug) {
      pages = await mbGetChapterImages(chapter.mbMangaSlug, chapter.mbSlug);
      langUsed = "🇬🇧";
    }

    if (pages.length === 0) throw new Error("No images found for this chapter");

    const referer = langUsed === "🇸🇦" ? "https://mangadex.org" : MB_BASE + "/";
    const totalBatches = Math.ceil(pages.length / PAGE_BATCH);

    for (let i = 0; i < pages.length; i += PAGE_BATCH) {
      const batch = pages.slice(i, i + PAGE_BATCH);
      const pageFiles = [];

      for (let j = 0; j < batch.length; j++) {
        const url = batch[j];
        const ext = path.extname(url.split("?")[0]).replace(".", "") || "jpg";
        const filePath = path.join(CACHE, `manga_ch${chNum}_p${i + j + 1}.${ext}`);
        const imgRes = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
          headers: { "Referer": referer, "User-Agent": MB_HEADERS["User-Agent"] }
        });
        fs.writeFileSync(filePath, Buffer.from(imgRes.data));
        pageFiles.push(filePath);
      }

      const batchNum = Math.floor(i / PAGE_BATCH) + 1;
      const body =
        `📖 ${mangaTitle}\n` +
        `${langUsed} فصل ${chNum}\n` +
        `🖼 الصفحات ${i + 1}–${i + pageFiles.length} من ${pages.length}` +
        (totalBatches > 1 ? ` (جزء ${batchNum}/${totalBatches})` : "");

      await new Promise(resolve => {
        api.sendMessage(
          { body, attachment: pageFiles.map(f => fs.createReadStream(f)) },
          threadID,
          () => { pageFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} }); resolve(); }
        );
      });
    }

    if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch (_) {}

    const prev = currentIndex > 0 ? chapters[currentIndex - 1] : null;
    const next = chapters[currentIndex + 1];
    let nav = `✅ انتهى ${langUsed} فصل ${chNum} من "${mangaTitle}".\n\n`;
    if (next) nav += `▶️ ↩️ رد بـ "next" — فصل ${next.num} ${next.flag}\n`;
    if (prev) nav += `◀️ ↩️ رد بـ "prev" — فصل ${prev.num} ${prev.flag}\n`;
    nav += `↩️ أو رد برقم أي فصل للانتقال إليه.`;

    api.sendMessage(nav, threadID, (err, info) => {
      if (err || !info) return;
      global.GoatBot.onReply.set(info.messageID, {
        commandName, author: event.senderID, state: "navigate_chapter",
        chapters, currentIndex, mangaTitle, messageID: info.messageID
      });
    });

  } catch (e) {
    if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch (_) {}
    throw e;
  }
}

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "manga",
    aliases: ["man", "مانغا", "مانجا", "مانغة"],
    version: "7.0",
    author: "Saint",
    countDown: 5,
    role: 0,
    shortDescription: "اقرأ المانغا بالعربية أو الإنجليزية — فصول كاملة",
    longDescription: "ابحث عن أي مانغا أو مانهوا — الفصول العربية من MangaDex والفصول الإنجليزية الكاملة من MangaBuddy",
    category: "anime",
    guide: { en: "{pn} <اسم المانغا>\nمثال: {pn} naruto\n{pn} solo leveling\n{pn} jujutsu kaisen" }
  },

  onStart: async function ({ api, event, args, commandName }) {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "📚 اكتب اسم المانغا أو المانهوا.\n\nأمثلة:\n/manga naruto\n/manga jujutsu kaisen\n/manga solo leveling\n\n🇸🇦 الفصول العربية أولوية\n🇬🇧 الفصول الإنجليزية متوفرة دائماً",
        threadID, messageID
      );
    }

    api.setMessageReaction("⏳", messageID, () => {}, true);
    try {
      const results = await searchManga(query);
      if (!results.length) {
        api.setMessageReaction("❌", messageID, () => {}, true);
        return api.sendMessage(
          `❌ لم أجد نتائج لـ "${query}".\n💡 جرب الاسم بالإنجليزي.`,
          threadID, messageID
        );
      }

      let body = `🔍 نتائج: "${query}"\n━━━━━━━━━━━━━━━━━━\n\n`;
      results.forEach((manga, i) => {
        const title = getMangaTitle(manga);
        const type = getContentTypeLabel(manga.attributes.originalLanguage);
        const status = getStatusLabel(manga.attributes.status);
        const lastCh = manga.attributes.lastChapter || "?";
        const langs = manga.attributes.availableTranslatedLanguages || [];
        const hasAr = langs.includes("ar");
        const hasEn = langs.includes("en");
        const langBadge = hasAr ? "🇸🇦" : hasEn ? "🇬🇧" : "🌐";
        body += `${i + 1}️⃣ ${title}\n`;
        body += `   ${type} · ${status} · ${lastCh} فصل · ${langBadge}\n\n`;
      });
      body += "↩️ رد برقم للقراءة.";

      api.setMessageReaction("✅", messageID, () => {}, true);
      api.sendMessage(body, threadID, (err, info) => {
        if (err || !info) return;
        global.GoatBot.onReply.set(info.messageID, {
          commandName, author: event.senderID,
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
    const { state } = Reply;
    if (event.senderID !== Reply.author) return;

    // ── اختيار المانغا
    if (state === "select_manga") {
      const n = parseInt(event.body);
      if (isNaN(n) || n < 1 || n > Reply.results.length)
        return api.sendMessage(`❌ اختر رقماً بين 1 و${Reply.results.length}.`, threadID, messageID);

      const manga = Reply.results[n - 1];
      const title = getMangaTitle(manga);
      const type = getContentTypeLabel(manga.attributes.originalLanguage);
      const desc = (manga.attributes.description?.en || manga.attributes.description?.ar || "").replace(/<[^>]+>/g, "").slice(0, 200);
      const genres = (manga.attributes.tags || [])
        .filter(t => t.attributes.group === "genre")
        .map(t => t.attributes.name.en || Object.values(t.attributes.name)[0])
        .slice(0, 5).join(" · ");

      api.setMessageReaction("⏳", messageID, () => {}, true);

      try {
        // جلب الفصول بالتوازي: MangaDex العربية + MangaBuddy
        const [dxArChapters, mbSlug] = await Promise.all([
          getDxArabicChapters(manga.id),
          mbSearch(title)
        ]);

        let mbChapters = [];
        if (mbSlug) {
          mbChapters = await mbGetChapters(mbSlug);
        }

        // بناء القائمة الموحدة
        const chapters = buildUnifiedChapters(mbChapters, dxArChapters);

        if (!chapters.length) {
          api.setMessageReaction("❌", messageID, () => {}, true);
          return api.sendMessage(
            `❌ لا توجد فصول متاحة لـ "${title}".\n\n💡 قد تكون المانغا غير موجودة في المصادر المتاحة.`,
            threadID, messageID
          );
        }

        const arCount = chapters.filter(c => c.flag === "🇸🇦").length;
        const source = mbChapters.length > 0 ? "mb" : "dx";

        // رسالة تنبيه إذا كانت الفصول المتاحة أقل من الإجمالي
        const lastCh = manga.attributes.lastChapter;
        let sourceNote = "";
        if (source === "mb") {
          sourceNote = arCount > 0
            ? `\n🇸🇦 ${arCount} فصل بالعربية · 🇬🇧 ${chapters.length} فصل بالإنجليزية`
            : `\n🇬🇧 ${chapters.length} فصل بالإنجليزية (لا يوجد عربي)`;
        } else {
          sourceNote = `\n🇸🇦 ${arCount} فصل بالعربية (من MangaDex)`;
        }

        let warningNote = "";
        if (lastCh && parseInt(lastCh) > 0 && chapters.length < parseInt(lastCh) * 0.3) {
          warningNote = `\n⚠️ متاح ${chapters.length} من أصل ~${lastCh} فصل`;
        }

        api.setMessageReaction("✅", messageID, () => {}, true);

        let body = `${type} ${title}\n━━━━━━━━━━━━━━━━━━\n`;
        body += `📚 ${chapters.length} فصل | ${getStatusLabel(manga.attributes.status)}`;
        body += sourceNote + warningNote + "\n";
        if (genres) body += `🏷 ${genres}\n`;
        if (desc) body += `\n📝 ${desc}...\n`;
        body += `\n${buildChapterListBody(title, chapters, 0, source)}`;

        api.sendMessage(body, threadID, (err, info) => {
          if (err || !info) return;
          global.GoatBot.onReply.set(info.messageID, {
            commandName, author: event.senderID,
            state: "browse_chapters", chapters, mangaTitle: title,
            page: 0, source, messageID: info.messageID
          });
        });
        try { api.unsendMessage(Reply.messageID); } catch (_) {}

      } catch (e) {
        console.error("[manga:chapters]", e.message);
        api.setMessageReaction("❌", messageID, () => {}, true);
        api.sendMessage("❌ خطأ في جلب الفصول. جرب مرة أخرى.", threadID, messageID);
      }

    // ── تصفح الفصول
    } else if (state === "browse_chapters") {
      const { chapters, mangaTitle, page, source } = Reply;
      const input = event.body.trim().toLowerCase();
      const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);

      if (input === "next" || input === "prev") {
        const newPage = input === "next" ? page + 1 : page - 1;
        if (newPage < 0 || newPage >= totalPages)
          return api.sendMessage("❌ لا توجد صفحات أخرى.", threadID, messageID);
        const body = buildChapterListBody(mangaTitle, chapters, newPage, source);
        api.sendMessage(body, threadID, (err, info) => {
          if (err || !info) return;
          global.GoatBot.onReply.set(info.messageID, {
            commandName, author: event.senderID,
            state: "browse_chapters", chapters, mangaTitle, page: newPage, source,
            messageID: info.messageID
          });
        });
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
        return;
      }

      const chapter = chapters.find(ch => String(ch.num) === input);
      if (!chapter)
        return api.sendMessage(`❌ الفصل "${input}" غير موجود. تأكد من الرقم.`, threadID, messageID);

      const currentIndex = chapters.indexOf(chapter);
      try {
        await sendChapterPages(api, event, chapter, mangaTitle, chapters, currentIndex, commandName);
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
      } catch (e) {
        console.error("[manga:pages]", e.message);
        api.sendMessage("❌ خطأ في تحميل الفصل. جرب مرة أخرى.", threadID, messageID);
      }

    // ── التنقل بين الفصول
    } else if (state === "navigate_chapter") {
      const { chapters, mangaTitle, currentIndex } = Reply;
      const input = event.body.trim().toLowerCase();

      let targetIndex = currentIndex;
      if (input === "next") targetIndex = currentIndex + 1;
      else if (input === "prev") targetIndex = currentIndex - 1;
      else {
        const found = chapters.findIndex(ch => String(ch.num) === event.body.trim());
        if (found !== -1) targetIndex = found;
      }

      if (targetIndex < 0 || targetIndex >= chapters.length)
        return api.sendMessage("❌ لا يوجد فصل في هذا الاتجاه.", threadID, messageID);

      try {
        await sendChapterPages(api, event, chapters[targetIndex], mangaTitle, chapters, targetIndex, commandName);
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
      } catch (e) {
        console.error("[manga:navigate]", e.message);
        api.sendMessage("❌ خطأ في تحميل الفصل. جرب مرة أخرى.", threadID, messageID);
      }
    }
  }
};
