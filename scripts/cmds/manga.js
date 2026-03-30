const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const API = "https://api.mangadex.org";
const CACHE = path.join(__dirname, "cache");
const LANGS = ["ar", "en"];
const PAGE_BATCH = 30;
const CHAPTERS_PER_PAGE = 20;

async function searchManga(query) {
  const res = await axios.get(`${API}/manga`, {
    params: {
      title: query,
      limit: 5,
      "availableTranslatedLanguage[]": LANGS,
      "order[relevance]": "desc",
      "contentRating[]": ["safe", "suggestive"]
    }
  });
  return res.data.data || [];
}

async function getAllChapters(mangaId) {
  let all = [];
  let offset = 0;
  const limit = 96;
  while (true) {
    const res = await axios.get(`${API}/manga/${mangaId}/feed`, {
      params: {
        "translatedLanguage[]": LANGS,
        "order[chapter]": "asc",
        "order[volume]": "asc",
        limit,
        offset
      }
    });
    const data = res.data.data || [];
    all = all.concat(data);
    if (all.length >= res.data.total || data.length < limit) break;
    offset += limit;
  }
  return all;
}

async function getChapterPages(chapterId) {
  const res = await axios.get(`${API}/at-home/server/${chapterId}`, { timeout: 15000 });
  const { baseUrl, chapter } = res.data;
  return chapter.data.map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
}

function getMangaTitle(manga) {
  const t = manga.attributes.title;
  return t.en || t["ja-ro"] || t.ja_ro || Object.values(t)[0] || "Unknown";
}

function dedupeChapters(chapters) {
  const seen = new Map();
  for (const ch of chapters) {
    const num = ch.attributes.chapter || "0";
    const lang = ch.attributes.translatedLanguage;
    if (!seen.has(num) || lang === "ar") seen.set(num, ch);
  }
  return [...seen.values()];
}

function buildChapterListBody(mangaTitle, chapters, page, total) {
  const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);
  const start = page * CHAPTERS_PER_PAGE;
  const slice = chapters.slice(start, start + CHAPTERS_PER_PAGE);

  let body = `📖 ${mangaTitle}\n`;
  body += `📚 إجمالي الفصول: ${total} | صفحة ${page + 1}/${totalPages}\n`;
  body += "━━━━━━━━━━━━━━━━━━\n\n";

  slice.forEach(ch => {
    const num = ch.attributes.chapter || "؟";
    const lang = ch.attributes.translatedLanguage === "ar" ? "🇸🇦" : "🇬🇧";
    const title = ch.attributes.title ? ` — ${ch.attributes.title}` : "";
    body += `${lang} فصل ${num}${title}\n`;
  });

  body += "\n↩️ رد برقم الفصل لتحميله.";
  if (start + CHAPTERS_PER_PAGE < chapters.length) {
    body += "\n↩️ رد بـ \"next\" لرؤية المزيد من الفصول.";
  }
  if (page > 0) {
    body += "\n↩️ رد بـ \"prev\" للصفحة السابقة.";
  }
  return body;
}

async function sendChapterPages(api, event, chapter, mangaTitle, chapters, currentIndex, commandName) {
  const { threadID } = event;
  const chNum = chapter.attributes.chapter || "؟";
  const lang = chapter.attributes.translatedLanguage === "ar" ? "🇸🇦 عربي" : "🇬🇧 إنجليزي";

  let waitMsgID = null;
  await new Promise(resolve => {
    api.sendMessage(
      `⏳ جاري تحميل فصل ${chNum} من "${mangaTitle}"...\n${lang}`,
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
        const ext = (path.extname(url.split("?")[0]).replace(".", "") || "jpg");
        const filePath = path.join(CACHE, `manga_${chapter.id}_p${i + j + 1}.${ext}`);
        const res = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
          headers: { "Referer": "https://mangadex.org" }
        });
        fs.writeFileSync(filePath, Buffer.from(res.data));
        pageFiles.push(filePath);
      }

      const batchNum = Math.floor(i / PAGE_BATCH) + 1;
      const body =
        `📖 ${mangaTitle} — فصل ${chNum}\n` +
        `${lang}\n` +
        `🖼 الصفحات ${i + 1}–${i + pageFiles.length} من ${pages.length}` +
        (totalBatches > 1 ? ` (جزء ${batchNum}/${totalBatches})` : "");

      const attachments = pageFiles.map(f => fs.createReadStream(f));
      await new Promise(resolve => {
        api.sendMessage({ body, attachment: attachments }, threadID, () => {
          pageFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
          resolve();
        });
      });
    }

    if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch (_) {}

    const nextChapter = chapters[currentIndex + 1];
    let navBody = `✅ انتهى فصل ${chNum} من "${mangaTitle}".\n\n`;
    if (nextChapter) {
      const nextLang = nextChapter.attributes.translatedLanguage === "ar" ? "🇸🇦" : "🇬🇧";
      navBody += `▶️ التالي: ${nextLang} فصل ${nextChapter.attributes.chapter}\n`;
      navBody += `↩️ رد بـ "next" للفصل التالي.\n`;
    }
    navBody += `↩️ أو رد برقم أي فصل للانتقال إليه.`;

    api.sendMessage(navBody, threadID, (err, info) => {
      if (err || !info) return;
      global.GoatBot.onReply.set(info.messageID, {
        commandName,
        author: event.senderID,
        state: "navigate_chapter",
        chapters,
        currentIndex,
        mangaTitle,
        messageID: info.messageID
      });
    });

  } catch (e) {
    if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch (_) {}
    throw e;
  }
}

module.exports = {
  config: {
    name: "manga",
    aliases: ["man", "مانغا", "مانجا"],
    version: "4.0",
    author: "Saint",
    countDown: 5,
    role: 0,
    shortDescription: "ابحث وحمّل فصول المانغا بالعربية أو الإنجليزية",
    longDescription: "ابحث عن مانغا عبر MangaDex واستعرض فصولها وحمّلها مباشرة",
    category: "anime",
    guide: {
      en: "{pn} <اسم المانغا>"
    }
  },

  onStart: async function ({ api, event, args, commandName }) {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "📚 اكتب اسم المانغا بعد الأمر.\n\nأمثلة:\n/manga naruto\n/manga one piece\n/manga attack on titan",
        threadID,
        messageID
      );
    }

    try {
      const results = await searchManga(query);

      if (!results.length) {
        return api.sendMessage(
          `❌ لم أجد مانغا باسم "${query}" متوفرة بالعربية أو الإنجليزية.\nجرب اسماً مختلفاً.`,
          threadID,
          messageID
        );
      }

      let body = `🔍 نتائج البحث عن: "${query}"\n`;
      body += "━━━━━━━━━━━━━━━━━━\n\n";

      results.forEach((manga, i) => {
        const title = getMangaTitle(manga);
        const chapters = manga.attributes.lastChapter || "?";
        const status = {
          ongoing: "مستمرة 🟢",
          completed: "مكتملة ✅",
          hiatus: "متوقفة ⏸",
          cancelled: "ملغاة ❌"
        }[manga.attributes.status] || manga.attributes.status;
        body += `${i + 1}️⃣ ${title}\n`;
        body += `   📖 الفصول: ${chapters} | ${status}\n\n`;
      });

      body += "↩️ رد برقم المانغا للحصول على قائمة الفصول.";

      api.sendMessage(body, threadID, (err, info) => {
        if (err || !info) return;
        global.GoatBot.onReply.set(info.messageID, {
          commandName,
          author: event.senderID,
          state: "select_manga",
          results,
          messageID: info.messageID
        });
      });

    } catch (e) {
      console.error("[manga:search]", e.message);
      api.sendMessage("❌ حدث خطأ أثناء البحث. جرب مرة أخرى.", threadID, messageID);
    }
  },

  onReply: async function ({ api, event, Reply, commandName }) {
    const { threadID, messageID } = event;
    const { state } = Reply;

    if (event.senderID !== Reply.author) return;

    if (state === "select_manga") {
      const choice = parseInt(event.body);
      if (isNaN(choice) || choice < 1 || choice > Reply.results.length) {
        return api.sendMessage(
          `❌ اختر رقماً بين 1 و${Reply.results.length}.`,
          threadID,
          messageID
        );
      }

      const manga = Reply.results[choice - 1];
      const mangaId = manga.id;
      const title = getMangaTitle(manga);

      api.setMessageReaction("⏳", messageID, () => {}, true);

      try {
        const rawChapters = await getAllChapters(mangaId);
        const chapters = dedupeChapters(rawChapters);

        if (!chapters.length) {
          api.setMessageReaction("❌", messageID, () => {}, true);
          return api.sendMessage(
            `❌ لا توجد فصول متاحة بالعربية أو الإنجليزية لـ "${title}".`,
            threadID,
            messageID
          );
        }

        api.setMessageReaction("✅", messageID, () => {}, true);

        const body = buildChapterListBody(title, chapters, 0, rawChapters.length);

        api.sendMessage(body, threadID, (err, info) => {
          if (err || !info) return;
          global.GoatBot.onReply.set(info.messageID, {
            commandName,
            author: event.senderID,
            state: "browse_chapters",
            chapters,
            mangaTitle: title,
            totalFetched: rawChapters.length,
            page: 0,
            messageID: info.messageID
          });
        });

        try { api.unsendMessage(Reply.messageID); } catch (_) {}

      } catch (e) {
        console.error("[manga:chapters]", e.message);
        api.setMessageReaction("❌", messageID, () => {}, true);
        api.sendMessage("❌ حدث خطأ أثناء جلب الفصول. جرب مرة أخرى.", threadID, messageID);
      }

    } else if (state === "browse_chapters") {
      const { chapters, mangaTitle, totalFetched, page } = Reply;
      const input = event.body.trim().toLowerCase();

      let newPage = page;
      if (input === "next") {
        newPage = page + 1;
      } else if (input === "prev") {
        newPage = Math.max(0, page - 1);
      }

      const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);

      if (input === "next" || input === "prev") {
        if (newPage >= totalPages) {
          return api.sendMessage("❌ لا توجد صفحات أخرى.", threadID, messageID);
        }

        const body = buildChapterListBody(mangaTitle, chapters, newPage, totalFetched);
        api.sendMessage(body, threadID, (err, info) => {
          if (err || !info) return;
          global.GoatBot.onReply.set(info.messageID, {
            commandName,
            author: event.senderID,
            state: "browse_chapters",
            chapters,
            mangaTitle,
            totalFetched,
            page: newPage,
            messageID: info.messageID
          });
        });
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
        return;
      }

      const chapter = chapters.find(ch => String(ch.attributes.chapter) === input);
      if (!chapter) {
        return api.sendMessage(
          `❌ الفصل "${input}" غير موجود.\nتأكد من رقم الفصل.`,
          threadID,
          messageID
        );
      }

      const currentIndex = chapters.indexOf(chapter);
      try {
        await sendChapterPages(api, event, chapter, mangaTitle, chapters, currentIndex, commandName);
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
      } catch (e) {
        console.error("[manga:pages]", e.message);
        api.sendMessage("❌ حدث خطأ أثناء تحميل الفصل. جرب مرة أخرى.", threadID, messageID);
      }

    } else if (state === "navigate_chapter") {
      const { chapters, mangaTitle, currentIndex } = Reply;
      const input = event.body.trim().toLowerCase();

      let targetIndex = currentIndex;

      if (input === "next") {
        targetIndex = currentIndex + 1;
      } else {
        const found = chapters.findIndex(ch => String(ch.attributes.chapter) === event.body.trim());
        if (found !== -1) targetIndex = found;
      }

      if (targetIndex < 0 || targetIndex >= chapters.length) {
        return api.sendMessage("❌ لا يوجد فصل في هذا الاتجاه.", threadID, messageID);
      }

      const chapter = chapters[targetIndex];

      try {
        await sendChapterPages(api, event, chapter, mangaTitle, chapters, targetIndex, commandName);
        try { api.unsendMessage(Reply.messageID); } catch (_) {}
      } catch (e) {
        console.error("[manga:navigate]", e.message);
        api.sendMessage("❌ حدث خطأ أثناء تحميل الفصل. جرب مرة أخرى.", threadID, messageID);
      }
    }
  }
};
