const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const API = "https://api.mangadex.org";
const CACHE = path.join(__dirname, "cache");
const CHAPTERS_PER_PAGE = 20;
const PAGE_BATCH = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTitle(manga) {
  const t = manga.attributes.title;
  return t.en || t["ja-ro"] || t.ja_ro || Object.values(t)[0] || "Unknown";
}

function getLangFlag(lang) {
  return lang === "ar" ? "🇸🇦" : lang === "en" ? "🇬🇧" : `[${lang}]`;
}

function getStatusLabel(s) {
  return {
    ongoing: "مستمرة 🟢", completed: "مكتملة ✅",
    hiatus: "متوقفة ⏸", cancelled: "ملغاة ❌"
  }[s] || s || "—";
}

// ─── MangaDex API — محتوى للبالغين ───────────────────────────────────────────

// الفلترات الضرورية لمحتوى +18
const ADULT_RATINGS = ["erotica", "pornographic"];
const ALL_RATINGS   = ["safe", "suggestive", "erotica", "pornographic"];

function buildQ(query, { langs = [], limit = 15 } = {}) {
  const p = [
    `title=${encodeURIComponent(query)}`,
    `limit=${limit}`,
    "order[relevance]=desc",
    "includes[]=cover_art"
  ];
  langs.forEach(l => p.push(`availableTranslatedLanguage[]=${l}`));
  ADULT_RATINGS.forEach(r => p.push(`contentRating[]=${r}`));
  return `${API}/manga?${p.join("&")}`;
}

async function mdGet(url) {
  try {
    const res = await axios.get(url, { timeout: 25000 });
    return res.data.data || [];
  } catch (e) {
    console.log("[hentai:search_fail]", e.message?.slice(0, 60));
    return [];
  }
}

async function searchHentai(query) {
  // بحث رباعي: عربي فقط، عربي+إنجليزي، إنجليزي فقط، بدون فلتر لغة
  const [arOnly, arEn, enOnly, broad] = await Promise.all([
    mdGet(buildQ(query, { langs: ["ar"],       limit: 15 })),
    mdGet(buildQ(query, { langs: ["ar", "en"], limit: 15 })),
    mdGet(buildQ(query, { langs: ["en"],       limit: 15 })),
    mdGet(buildQ(query, { langs: [],           limit: 20 }))
  ]);

  const seen = new Set();
  const merged = [];
  for (const list of [arOnly, arEn, enOnly, broad]) {
    for (const m of list) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }
  }

  // العربي دائماً أولاً
  merged.sort((a, b) => {
    const aAr = a.attributes.availableTranslatedLanguages?.includes("ar") ? 0 : 1;
    const bAr = b.attributes.availableTranslatedLanguages?.includes("ar") ? 0 : 1;
    return aAr - bAr;
  });

  return merged.slice(0, 15);
}

// ─── جلب الفصول — يجب تضمين contentRating للمحتوى الكبار ─────────────────────

async function getAllChapters(mangaId) {
  let all = [];
  let offset = 0;
  const limit = 96;

  while (true) {
    const p = [
      "translatedLanguage[]=ar",
      "translatedLanguage[]=en",
      "order[chapter]=asc",
      `limit=${limit}`,
      `offset=${offset}`,
      // ⚠️ ضروري: بدون هذا الـ MangaDex يُرجع safe فقط ويخفي فصول +18
      "contentRating[]=safe",
      "contentRating[]=suggestive",
      "contentRating[]=erotica",
      "contentRating[]=pornographic"
    ];
    try {
      const res = await axios.get(`${API}/manga/${mangaId}/feed?${p.join("&")}`, { timeout: 25000 });
      const data = res.data.data || [];
      all = all.concat(data);
      if (all.length >= (res.data.total || 0) || data.length < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      console.log("[hentai:feed_error]", e.message?.slice(0, 60));
      break;
    }
  }
  return all;
}

async function getChapterPages(chapterId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(`${API}/at-home/server/${chapterId}`, { timeout: 20000 });
      const { baseUrl, chapter } = res.data;
      if (!chapter?.data?.length) throw new Error("no pages");
      return chapter.data.map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

// ─── معالجة الفصول ────────────────────────────────────────────────────────────

function dedupeChapters(chapters) {
  const seen = new Map();
  for (const ch of chapters) {
    const num = ch.attributes.chapter ?? "0";
    const lang = ch.attributes.translatedLanguage;
    if (!seen.has(num)) {
      seen.set(num, ch);
    } else if (lang === "ar") {
      seen.set(num, ch);
    }
  }
  return [...seen.values()].sort((a, b) =>
    parseFloat(a.attributes.chapter || "0") - parseFloat(b.attributes.chapter || "0")
  );
}

function buildChapterList(title, chapters, page) {
  const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);
  const start = page * CHAPTERS_PER_PAGE;
  const slice = chapters.slice(start, start + CHAPTERS_PER_PAGE);
  const arCount = chapters.filter(c => c.attributes.translatedLanguage === "ar").length;
  const enCount = chapters.filter(c => c.attributes.translatedLanguage === "en").length;

  let body = `🔞 ${title}\n`;
  body += `📚 ${chapters.length} فصل | 🇸🇦 ${arCount} · 🇬🇧 ${enCount} · صفحة ${page + 1}/${totalPages}\n`;
  body += "━━━━━━━━━━━━━━━━━━\n\n";

  slice.forEach(ch => {
    const num = ch.attributes.chapter || "؟";
    const flag = getLangFlag(ch.attributes.translatedLanguage);
    const chTitle = ch.attributes.title ? ` — ${ch.attributes.title.slice(0, 28)}` : "";
    body += `${flag} فصل ${num}${chTitle}\n`;
  });

  body += "\n↩️ رد برقم الفصل لقراءته.";
  if (start + CHAPTERS_PER_PAGE < chapters.length) body += '\n↩️ "next" للصفحة التالية.';
  if (page > 0) body += '\n↩️ "prev" للصفحة السابقة.';
  return body;
}

// ─── إرسال صفحات الفصل ───────────────────────────────────────────────────────

async function downloadPage(url, filePath, attempt = 0) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 35000,
      headers: { "Referer": "https://mangadex.org" }
    });
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return true;
  } catch (e) {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1000));
      return downloadPage(url, filePath, attempt + 1);
    }
    console.log("[hentai:page_fail]", e.message?.slice(0, 50));
    return false;
  }
}

async function sendChapterPages(api, event, chapter, title, chapters, currentIndex, commandName) {
  const { threadID } = event;
  const chNum = chapter.attributes.chapter || "؟";
  const flag = getLangFlag(chapter.attributes.translatedLanguage);
  const chTitle = chapter.attributes.title ? ` — ${chapter.attributes.title}` : "";

  let waitMsgID = null;
  await new Promise(resolve => {
    api.sendMessage(
      `⏳ جاري تحميل ${flag} فصل ${chNum}${chTitle}`,
      threadID,
      (err, info) => { if (info) waitMsgID = info.messageID; resolve(); }
    );
  });

  try {
    fs.ensureDirSync(CACHE);
    const pages = await getChapterPages(chapter.id);
    const totalBatches = Math.ceil(pages.length / PAGE_BATCH);

    for (let i = 0; i < pages.length; i += PAGE_BATCH) {
      const batch = pages.slice(i, i + PAGE_BATCH);
      const pageFiles = [];

      for (let j = 0; j < batch.length; j++) {
        const url = batch[j];
        const ext = path.extname(url.split("?")[0]).replace(".", "") || "jpg";
        const filePath = path.join(CACHE, `hentai_${chapter.id}_p${i + j + 1}.${ext}`);
        const ok = await downloadPage(url, filePath);
        if (ok) pageFiles.push(filePath);
      }

      if (!pageFiles.length) continue;

      const batchNum = Math.floor(i / PAGE_BATCH) + 1;
      const body =
        `🔞 ${title} — فصل ${chNum}${chTitle}\n` +
        `${flag} الصفحات ${i + 1}–${i + pageFiles.length} من ${pages.length}` +
        (totalBatches > 1 ? ` (جزء ${batchNum}/${totalBatches})` : "");

      await new Promise(resolve => {
        api.sendMessage(
          { body, attachment: pageFiles.map(f => fs.createReadStream(f)) },
          threadID,
          () => {
            pageFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
            resolve();
          }
        );
      });
    }

    if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch (_) {}

    const prev = currentIndex > 0 ? chapters[currentIndex - 1] : null;
    const next = chapters[currentIndex + 1];
    let nav = `✅ انتهى ${flag} فصل ${chNum}.\n\n`;
    if (next) nav += `▶️ ↩️ "next" — فصل ${next.attributes.chapter} ${getLangFlag(next.attributes.translatedLanguage)}\n`;
    if (prev) nav += `◀️ ↩️ "prev" — فصل ${prev.attributes.chapter} ${getLangFlag(prev.attributes.translatedLanguage)}\n`;
    nav += `↩️ أو رد برقم أي فصل.`;

    api.sendMessage(nav, threadID, (err, info) => {
      if (err || !info) return;
      global.GoatBot.onReply.set(info.messageID, {
        commandName, author: event.senderID, state: "navigate_chapter",
        chapters, currentIndex, mangaTitle: title, messageID: info.messageID
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
    name: "hentai",
    aliases: ["h", "هنتاي", "adult", "18+"],
    version: "2.0",
    author: "Saint",
    countDown: 5,
    role: 2,
    shortDescription: "🔞 مانغا للكبار فقط (للأدمن)",
    longDescription: "ابحث عن مانغا +18 واقرأ فصولها — للأدمن فقط",
    category: "anime",
    guide: {
      en: "{pn} <اسم المانغا>\nمثال:\n{pn} domestic girlfriend\n{pn} citrus\n{pn} overflow\n{pn} nana"
    }
  },

  onStart: async function ({ api, event, args, commandName }) {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "🔞 اكتب اسم المانغا.\n\nهذا الأمر للأدمن فقط.\n\nأمثلة:\n/hentai domestic girlfriend\n/hentai citrus\n/hentai overflow\n/hentai nana\n/hentai ntr",
        threadID, messageID
      );
    }

    api.setMessageReaction("⏳", messageID, () => {}, true);

    try {
      const results = await searchHentai(query);

      if (!results.length) {
        api.setMessageReaction("❌", messageID, () => {}, true);
        return api.sendMessage(
          `❌ لم أجد نتائج لـ "${query}".\n💡 جرب اسماً مختلفاً بالإنجليزي.`,
          threadID, messageID
        );
      }

      let body = `🔞 نتائج: "${query}"\n━━━━━━━━━━━━━━━━━━\n\n`;
      results.forEach((manga, i) => {
        const title = getTitle(manga);
        const status = getStatusLabel(manga.attributes.status);
        const rating = manga.attributes.contentRating;
        const hasAr = manga.attributes.availableTranslatedLanguages?.includes("ar");
        const langBadge = hasAr ? "🇸🇦 عربي" : "🇬🇧 إنجليزي";
        const ratingLabel = rating === "pornographic" ? "🔞" : "🔥";
        body += `${i + 1}️⃣ ${title} ${ratingLabel}\n`;
        body += `   ${status} · ${langBadge}\n\n`;
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
      console.error("[hentai:search]", e.message);
      api.setMessageReaction("❌", messageID, () => {}, true);
      api.sendMessage("❌ خطأ في البحث.", threadID, messageID);
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
      const title = getTitle(manga);

      api.setMessageReaction("⏳", messageID, () => {}, true);

      try {
        const rawChapters = await getAllChapters(manga.id);
        const chapters = dedupeChapters(rawChapters);

        if (!chapters.length) {
          api.setMessageReaction("❌", messageID, () => {}, true);
          return api.sendMessage(
            `❌ لا توجد فصول متاحة لـ "${title}".\n💡 جرب مانغا أخرى.`,
            threadID, messageID
          );
        }

        api.setMessageReaction("✅", messageID, () => {}, true);
        const body = buildChapterList(title, chapters, 0);

        api.sendMessage(body, threadID, (err, info) => {
          if (err || !info) return;
          global.GoatBot.onReply.set(info.messageID, {
            commandName, author: event.senderID,
            state: "browse_chapters", chapters, mangaTitle: title, page: 0, messageID: info.messageID
          });
        });
        try { api.unsendMessage(Reply.messageID); } catch (_) {}

      } catch (e) {
        console.error("[hentai:chapters]", e.message);
        api.setMessageReaction("❌", messageID, () => {}, true);
        api.sendMessage("❌ خطأ في جلب الفصول. جرب مرة أخرى.", threadID, messageID);
      }

    // ── تصفح الفصول
    } else if (state === "browse_chapters") {
      const { chapters, mangaTitle, page } = Reply;
      const input = event.body.trim().toLowerCase();
      const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);

      if (input === "next" || input === "prev") {
        const newPage = input === "next" ? page + 1 : page - 1;
        if (newPage < 0 || newPage >= totalPages)
          return api.sendMessage("❌ لا توجد صفحات أخرى.", threadID, messageID);
        const body = buildChapterList(mangaTitle, chapters, newPage);
        api.sendMessage(body, threadID, (err, info) => {
          if (err || !info) return;
          global.GoatBot.onReply.set(info.messageID, {
            commandName, author: event.senderID,
            state: "browse_chapters", chapters, mangaTitle, page: newPage, messageID: info.messageID
          });
        });
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
        return;
      }

      const chapter = chapters.find(ch => String(ch.attributes.chapter) === input);
      if (!chapter)
        return api.sendMessage(
          `❌ الفصل "${input}" غير موجود.\n💡 تأكد من الرقم في القائمة.`,
          threadID, messageID
        );

      try {
        await sendChapterPages(api, event, chapter, mangaTitle, chapters, chapters.indexOf(chapter), commandName);
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
      } catch (e) {
        console.error("[hentai:pages]", e.message);
        api.sendMessage("❌ خطأ في تحميل الفصل.", threadID, messageID);
      }

    // ── التنقل بين الفصول
    } else if (state === "navigate_chapter") {
      const { chapters, mangaTitle, currentIndex } = Reply;
      const input = event.body.trim().toLowerCase();
      let targetIndex = currentIndex;

      if (input === "next") targetIndex = currentIndex + 1;
      else if (input === "prev") targetIndex = currentIndex - 1;
      else {
        const found = chapters.findIndex(ch => String(ch.attributes.chapter) === event.body.trim());
        if (found !== -1) targetIndex = found;
      }

      if (targetIndex < 0 || targetIndex >= chapters.length)
        return api.sendMessage("❌ لا يوجد فصل في هذا الاتجاه.", threadID, messageID);

      try {
        await sendChapterPages(api, event, chapters[targetIndex], mangaTitle, chapters, targetIndex, commandName);
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
      } catch (e) {
        console.error("[hentai:navigate]", e.message);
        api.sendMessage("❌ خطأ في تحميل الفصل.", threadID, messageID);
      }
    }
  }
};
