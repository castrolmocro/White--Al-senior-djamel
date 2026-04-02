const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const CACHE = path.join(__dirname, "cache");
const PROGRESS_FILE = path.join(CACHE, "manga_progress.json");
const CHAPTER_CACHE_FILE = path.join(CACHE, "manga_chapter_cache.json");
const CHAPTERS_PER_PAGE = 25;
const PAGE_BATCH = 8;
const CHAPTER_CACHE_TTL = 30 * 60 * 1000;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UA2 = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// ─── Progress ────────────────────────────────────────────────────────────────

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return {}; }
}

function saveProgress(userId, mangaTitle, chapterNum) {
  fs.ensureDirSync(CACHE);
  const data = loadProgress();
  if (!data[userId]) data[userId] = {};
  data[userId][mangaTitle] = { chapter: chapterNum, timestamp: Date.now() };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ─── Chapter Cache ────────────────────────────────────────────────────────────

function loadChapterCache() {
  if (!fs.existsSync(CHAPTER_CACHE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CHAPTER_CACHE_FILE, "utf8")); } catch { return {}; }
}

function getCachedChapters(key) {
  const cache = loadChapterCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CHAPTER_CACHE_TTL) return null;
  return entry.chapters;
}

function setCachedChapters(key, chapters) {
  fs.ensureDirSync(CACHE);
  const cache = loadChapterCache();
  cache[key] = { chapters, timestamp: Date.now() };
  try { fs.writeFileSync(CHAPTER_CACHE_FILE, JSON.stringify(cache, null, 2), "utf8"); } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLangFlag(lang) {
  return {
    ar: "🇸🇦", en: "🇬🇧", ko: "🇰🇷", zh: "🇨🇳", "zh-hk": "🇨🇳",
    fr: "🇫🇷", es: "🇪🇸", tr: "🇹🇷", ru: "🇷🇺", de: "🇩🇪", id: "🇮🇩", ja: "🇯🇵"
  }[lang] || `[${lang}]`;
}

function getStatusLabel(s) {
  return {
    ongoing: "مستمرة 🟢", completed: "مكتملة ✅",
    hiatus: "متوقفة ⏸", cancelled: "ملغاة ❌"
  }[s] || (s || "—");
}

// تنظيف اسم المانغا للبحث
function cleanTitle(t) {
  return (t || "").toLowerCase()
    .replace(/[^\w\u0600-\u06FF\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function httpGet(url, opts = {}, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, {
        timeout: 20000,
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate, br" },
        ...opts
      });
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function httpPost(url, data, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.post(url, data, {
        timeout: 20000,
        headers: { "User-Agent": UA },
        ...opts
      });
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

// ─── SOURCE 1: MangaDex ───────────────────────────────────────────────────────

const MangaDex = {
  name: "MangaDex",
  base: "https://api.mangadex.org",

  async search(query, { ratings = ["safe", "suggestive", "erotica", "pornographic"], origLangs = [], limit = 20 } = {}) {
    const trySearch = async (q) => {
      try {
        const p = new URLSearchParams();
        p.set("title", q); p.set("limit", limit);
        p.set("order[relevance]", "desc");
        p.append("includes[]", "cover_art");
        ratings.forEach(r => p.append("contentRating[]", r));
        origLangs.forEach(l => p.append("originalLanguage[]", l));
        const res = await httpGet(`${this.base}/manga?${p}`);
        return (res.data.data || []).map(m => ({
          _mdxId: m.id,
          source: "MangaDex",
          title: (() => {
            const t = m.attributes.title;
            return t.ar || t.en || t["ja-ro"] || t["ko-ro"] || Object.values(t)[0] || "Unknown";
          })(),
          status: m.attributes.status,
          lastChapter: m.attributes.lastChapter,
          availableLangs: m.attributes.availableTranslatedLanguages || [],
          hasAr: (m.attributes.availableTranslatedLanguages || []).includes("ar"),
          originalLang: m.attributes.originalLanguage,
          tags: (m.attributes.tags || []).filter(t => t.attributes.group === "genre").map(t => t.attributes.name.en || Object.values(t.attributes.name)[0]).slice(0, 5),
          description: (m.attributes.description?.ar || m.attributes.description?.en || "").replace(/<[^>]+>/g, "").slice(0, 200)
        }));
      } catch (e) { console.log("[MDX:search]", e.message?.slice(0, 60)); return []; }
    };

    let results = await trySearch(query);
    // إذا لم تجد نتائج بالإنجليزي، جرب بالعربي
    if (!results.length && /[\u0600-\u06FF]/.test(query)) {
      results = await trySearch(query.replace(/[\u0600-\u06FF\s]/g, " ").trim());
    }
    return results;
  },

  async getChapters(mangaId, { langs = ["ar", "en"], ratings = ["safe", "suggestive", "erotica", "pornographic"] } = {}) {
    const cacheKey = `mdx_${mangaId}_${langs.join("")}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;

    let all = [], offset = 0;
    while (true) {
      try {
        const p = new URLSearchParams();
        p.set("order[chapter]", "asc"); p.set("order[volume]", "asc");
        p.set("limit", 96); p.set("offset", offset);
        langs.forEach(l => p.append("translatedLanguage[]", l));
        ratings.forEach(r => p.append("contentRating[]", r));
        const res = await httpGet(`${this.base}/manga/${mangaId}/feed?${p}`);
        const data = res.data.data || [];
        all = all.concat(data);
        if (data.length < 96) break;
        offset += 96;
        if (offset > 5000) break; // حد أقصى لتجنب الحلقات اللانهائية
        await new Promise(r => setTimeout(r, 400));
      } catch { break; }
    }

    const result = all.map(ch => ({
      num: String(ch.attributes.chapter || "0"),
      numF: parseFloat(ch.attributes.chapter) || 0,
      title: ch.attributes.title || "",
      lang: ch.attributes.translatedLanguage,
      isAr: ch.attributes.translatedLanguage === "ar",
      source: "MangaDex",
      priority: ch.attributes.translatedLanguage === "ar" ? 2 : 1,
      _dxId: ch.id
    }));

    setCachedChapters(cacheKey, result);
    return result;
  },

  async getImages(chapterId) {
    for (let i = 0; i < 3; i++) {
      try {
        const res = await httpGet(`${this.base}/at-home/server/${chapterId}`);
        const { baseUrl, chapter } = res.data;
        if (!chapter) throw new Error("no chapter data");
        const pages = chapter.data?.length ? chapter.data : (chapter.dataSaver || []);
        if (!pages.length) throw new Error("no pages");
        const quality = chapter.data?.length ? "data" : "data-saver";
        const urls = pages.map(f => `${baseUrl}/${quality}/${chapter.hash}/${f}`);
        return { urls, referer: "https://mangadex.org" };
      } catch (e) {
        if (i === 2) throw new Error(`MDX: ${e.message}`);
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  },

  async getImagesSaver(chapterId) {
    try {
      const res = await httpGet(`${this.base}/at-home/server/${chapterId}`);
      const { baseUrl, chapter } = res.data;
      if (!chapter) throw new Error("no chapter data");
      const pages = chapter.dataSaver?.length ? chapter.dataSaver : (chapter.data || []);
      if (!pages.length) throw new Error("no pages in saver");
      const quality = chapter.dataSaver?.length ? "data-saver" : "data";
      return { urls: pages.map(f => `${baseUrl}/${quality}/${chapter.hash}/${f}`), referer: "https://mangadex.org" };
    } catch (e) { throw new Error(`MDX-saver: ${e.message}`); }
  }
};

// ─── SOURCE 2: GManga ─────────────────────────────────────────────────────────

const GManga = {
  name: "GManga",
  base: "https://gmanga.org/api",
  headers: {
    "User-Agent": UA, "Accept": "application/json",
    "Origin": "https://gmanga.org", "Referer": "https://gmanga.org/"
  },

  async search(query) {
    const endpoints = [
      { method: "post", url: `${this.base}/mangas/search`, data: { search: query } },
      { method: "get", url: `${this.base}/mangas`, params: { search: query } },
      { method: "get", url: `https://gmanga.org/api/mangas`, params: { title: query } }
    ];
    for (const ep of endpoints) {
      try {
        const res = ep.method === "post"
          ? await httpPost(ep.url, ep.data, { headers: this.headers })
          : await httpGet(ep.url, { headers: this.headers, params: ep.params });
        const list = res.data?.mangas || res.data?.data || (Array.isArray(res.data) ? res.data : []);
        if (list.length) return list.slice(0, 10).map(m => ({
          _gmId: m.id, _gmSlug: m.slug || m.id,
          source: "GManga",
          title: m.title || m.ar_title || m.en_title || "Unknown",
          hasAr: true, status: m.status
        }));
      } catch {}
    }
    return [];
  },

  async getChapters(mangaId) {
    const cacheKey = `gm_${mangaId}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;

    const endpoints = [
      `${this.base}/mangas/${mangaId}/releases`,
      `${this.base}/mangas/${mangaId}/chapters`,
      `${this.base}/chapters?manga_id=${mangaId}`,
      `https://gmanga.org/api/mangas/${mangaId}/chapters`
    ];
    for (const url of endpoints) {
      try {
        const res = await httpGet(url, { headers: this.headers });
        const list = res.data?.releases || res.data?.chapters || res.data?.data || (Array.isArray(res.data) ? res.data : []);
        if (list.length) {
          const result = list.map(r => ({
            num: String(r.chapter || r.chapter_number || r.num || "0"),
            numF: parseFloat(r.chapter || r.chapter_number || r.num) || 0,
            title: r.title || r.chapter_title || "",
            lang: "ar", isAr: true, source: "GManga", priority: 3,
            _gmId: r.id
          })).sort((a, b) => a.numF - b.numF);
          setCachedChapters(cacheKey, result);
          return result;
        }
      } catch {}
    }
    return [];
  },

  async getImages(releaseId) {
    const endpoints = [
      `${this.base}/releases/${releaseId}`,
      `${this.base}/chapters/${releaseId}/images`,
      `${this.base}/releases/${releaseId}/pages`
    ];
    for (const url of endpoints) {
      try {
        const res = await httpGet(url, { headers: this.headers });
        const pages = res.data?.pages || res.data?.images || res.data?.data || (Array.isArray(res.data) ? res.data : []);
        const urls = pages.map(p => typeof p === "string" ? p : p.url || p.src || p.image).filter(Boolean);
        if (urls.length) return { urls, referer: "https://gmanga.org/" };
      } catch {}
    }
    throw new Error("GManga: فشل تحميل الصور");
  }
};

// ─── SOURCE 3: ComicK ─────────────────────────────────────────────────────────

const ComicK = {
  name: "ComicK",
  base: "https://api.comick.io",

  async search(query) {
    try {
      const res = await httpGet(`${this.base}/v1.0/search`, {
        params: { q: query, limit: 20, tachiyomi: true }
      });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      return list.map(m => ({
        _ckHid: m.hid, source: "ComicK",
        title: m.title || m.slug || "Unknown",
        status: m.status === 1 ? "ongoing" : "completed",
        availableLangs: Array.isArray(m.iso2) ? m.iso2 : [],
        hasAr: Array.isArray(m.iso2) && m.iso2.includes("ar")
      }));
    } catch (e) { console.log("[ComicK:search]", e.message?.slice(0, 60)); return []; }
  },

  async getChapters(hid, { langs = ["ar", "en"] } = {}) {
    const cacheKey = `ck_${hid}_${langs.join("")}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;

    const all = [];
    for (const lang of langs) {
      let page = 1;
      while (true) {
        try {
          const res = await httpGet(`${this.base}/comic/${hid}/chapters`, {
            params: { lang, limit: 500, page, tachiyomi: true }
          });
          const chapters = res.data?.chapters || [];
          if (!chapters.length) break;
          chapters.forEach(ch => all.push({
            num: String(ch.chap || ch.chapter || "0"),
            numF: parseFloat(ch.chap || ch.chapter) || 0,
            title: ch.title || "",
            lang, isAr: lang === "ar",
            source: "ComicK",
            priority: lang === "ar" ? 2 : 1,
            _ckHid: ch.hid
          }));
          if (chapters.length < 500) break;
          page++;
          await new Promise(r => setTimeout(r, 300));
        } catch { break; }
      }
    }
    setCachedChapters(cacheKey, all);
    return all;
  },

  async getImages(chapterHid) {
    try {
      const res = await httpGet(`${this.base}/chapter/${chapterHid}/get_images`);
      const images = Array.isArray(res.data) ? res.data : (res.data?.images || []);
      const urls = images.map(img => {
        if (typeof img === "string") return img;
        if (img.url) return img.url;
        if (img.b2key) return `https://meo.comick.pictures/${img.b2key}`;
        return null;
      }).filter(Boolean);
      if (!urls.length) throw new Error("no images");
      return { urls, referer: "https://comick.io/" };
    } catch (e) { throw e; }
  }
};

// ─── SOURCE 4: MangaSee ───────────────────────────────────────────────────────

const MangaSee = {
  name: "MangaSee",
  base: "https://mangasee123.com",

  async search(query) {
    try {
      const res = await httpGet(`${this.base}/_search.php`, {
        params: { type: "series", phrase: query },
        headers: { "User-Agent": UA, "Referer": this.base }
      });
      const list = Array.isArray(res.data) ? res.data : [];
      return list.slice(0, 8).map(m => ({
        _msSlug: m.i,
        source: "MangaSee",
        title: m.s || m.i?.replace(/-/g, " ") || "Unknown",
        status: m.ss === "Ongoing" ? "ongoing" : "completed",
        availableLangs: ["en"], hasAr: false
      }));
    } catch { return []; }
  },

  async getChapters(slug) {
    const cacheKey = `ms_${slug}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;

    try {
      const res = await httpGet(`${this.base}/manga/${slug}`, {
        headers: { "User-Agent": UA, "Referer": this.base }
      });
      const match = res.data.match(/vm\.Chapters\s*=\s*(\[.*?\]);/s);
      if (!match) return [];
      const raw = JSON.parse(match[1]);
      const result = raw.map(ch => {
        const num = String(parseInt(ch.Chapter.slice(1, -1)) || 0);
        const minor = parseInt(ch.Chapter.slice(-1)) || 0;
        const fullNum = minor ? `${num}.${minor}` : num;
        return {
          num: fullNum, numF: parseFloat(fullNum),
          title: ch.ChapterName || "",
          lang: "en", isAr: false,
          source: "MangaSee", priority: 1,
          _msSlug: slug, _msChNum: ch.Chapter
        };
      }).sort((a, b) => a.numF - b.numF);
      setCachedChapters(cacheKey, result);
      return result;
    } catch { return []; }
  },

  async getImages(slug, chNum) {
    try {
      const pageRes = await httpGet(`${this.base}/read-online/${slug}-chapter-${parseInt(chNum.slice(1, -1))}.html`, {
        headers: { "User-Agent": UA, "Referer": this.base }
      });
      const match = pageRes.data.match(/vm\.CurChapter\s*=\s*(\{.*?\});/s);
      const pathMatch = pageRes.data.match(/vm\.CurPathName\s*=\s*"([^"]+)"/);
      if (!match || !pathMatch) throw new Error("no data");
      const ch = JSON.parse(match[1]);
      const host = pathMatch[1];
      const pages = parseInt(ch.Page) || 0;
      const chNum2 = String(parseInt(chNum.slice(1, -1)));
      const urls = Array.from({ length: pages }, (_, i) => {
        const pg = String(i + 1).padStart(3, "0");
        return `https://${host}/manga/${slug}/${String(parseInt(ch.Chapter)).padStart(4, "0")}-${pg}.png`;
      });
      return { urls, referer: this.base };
    } catch (e) { throw new Error(`MangaSee: ${e.message}`); }
  }
};

// ─── SOURCE 5: Madara (نظام موحد لمواقع WordPress عربية) ─────────────────────

class MadaraSource {
  constructor({ name, base, lang = "ar", ajaxEndpoint = null }) {
    this.name = name;
    this.base = base.replace(/\/$/, "");
    this.lang = lang;
    this.ajaxEndpoint = ajaxEndpoint || `${this.base}/wp-admin/admin-ajax.php`;
    this.headers = {
      "User-Agent": UA,
      "Referer": base + "/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.7,en;q=0.3",
      "Accept-Encoding": "gzip, deflate, br"
    };
    this.ajaxHeaders = {
      ...this.headers,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    };
  }

  async search(query) {
    // محاولة متعددة للبحث
    for (const method of ["ajax", "url", "direct"]) {
      try {
        let html = "";
        if (method === "ajax") {
          const form = new URLSearchParams();
          form.set("action", "madara_read_manga_data");
          form.set("page", "1");
          form.set("vars[s]", query);
          form.set("vars[paged]", "1");
          const res = await httpPost(this.ajaxEndpoint, form.toString(), { headers: this.ajaxHeaders });
          html = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        } else if (method === "url") {
          const res = await httpGet(`${this.base}/?s=${encodeURIComponent(query)}&post_type=wp-manga`, { headers: this.headers });
          html = res.data;
        } else {
          const res = await httpGet(`${this.base}/search/${encodeURIComponent(query)}`, { headers: this.headers });
          html = res.data;
        }
        const results = this._parseSearchHTML(html, query);
        if (results.length) return results;
      } catch {}
    }
    return [];
  }

  _parseSearchHTML(html, query) {
    if (!html || typeof html !== "string") return [];
    const results = [];

    // استخراج روابط المانغا
    const patterns = [
      /href="(https?:\/\/[^"]+\/manga\/[^/"]+\/?)[^"]*"/gi,
      /href="(https?:\/\/[^"]+\/series\/[^/"]+\/?)[^"]*"/gi,
      /href="(https?:\/\/[^"]+\/manhwa\/[^/"]+\/?)[^"]*"/gi,
      /href="(https?:\/\/[^"]+\/manhua\/[^/"]+\/?)[^"]*"/gi,
      /href="(https?:\/\/[^"]+\/مانغا\/[^/"]+\/?)[^"]*"/gi
    ];

    const slugs = new Set();
    for (const re of patterns) {
      let m;
      while ((m = re.exec(html)) !== null) {
        const url = m[1];
        if (url.startsWith(this.base) && !url.includes("page") && !url.includes("?")) {
          slugs.add(url);
        }
      }
    }

    // استخراج العناوين أيضاً
    const titleRe = /class="[^"]*post-title[^"]*"[^>]*>\s*<[^>]+>\s*<a[^>]*>([^<]+)<\/a>/gi;
    const titleMap = new Map();
    let tm;
    while ((tm = titleRe.exec(html)) !== null) {
      const title = tm[1].trim();
      if (title) titleMap.set(title.toLowerCase().slice(0, 20), title);
    }

    [...slugs].slice(0, 10).forEach((slug, i) => {
      const slugPart = decodeURIComponent(slug.replace(/\/$/, "").split("/").pop());
      const cleanSlug = slugPart.replace(/-/g, " ");
      // حاول إيجاد العنوان الحقيقي من الخريطة
      const realTitle = [...titleMap.values()][i] || cleanSlug.replace(/\b\w/g, l => l.toUpperCase());
      results.push({
        _madaraSlug: slug,
        _madaraSource: this,
        source: this.name,
        title: realTitle,
        hasAr: this.lang === "ar"
      });
    });
    return results;
  }

  async getChapters(mangaSlug) {
    const cacheKey = `madara_${this.name}_${mangaSlug.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;

    try {
      const page = await httpGet(mangaSlug, { headers: this.headers });
      const html = page.data;

      // استخراج ID المانغا
      const idPatterns = [
        /(?:data-id|manga-id|post_id|manga_id)['":\s=]+(\d+)/i,
        /(?:data-manga|data-post)['":\s=]+(\d+)/i,
        /manga_id['":\s=]+(\d+)/i
      ];
      let mangaId = null;
      for (const p of idPatterns) {
        const m = html.match(p);
        if (m) { mangaId = m[1]; break; }
      }

      let chapters = [];

      if (mangaId) {
        // طريقة AJAX
        const form = new URLSearchParams();
        form.set("action", "manga_get_chapters");
        form.set("manga", mangaId);
        try {
          const res = await httpPost(this.ajaxEndpoint, form.toString(), { headers: this.ajaxHeaders });
          chapters = this._parseChapterListHTML(typeof res.data === "string" ? res.data : JSON.stringify(res.data), mangaSlug);
        } catch {}
      }

      if (!chapters.length) {
        chapters = this._parseChapterListHTML(html, mangaSlug);
      }

      // محاولة ثالثة: endpoint مختلف
      if (!chapters.length && mangaId) {
        try {
          const res = await httpGet(`${this.base}/wp-json/manga/get-chapters/${mangaId}`, { headers: this.headers });
          const data = Array.isArray(res.data) ? res.data : (res.data?.chapters || []);
          if (data.length) {
            chapters = data.map(ch => ({
              num: String(ch.chapter_number || ch.num || "0"),
              numF: parseFloat(ch.chapter_number || ch.num) || 0,
              title: ch.chapter_name || ch.title || "",
              lang: this.lang, isAr: this.lang === "ar",
              source: this.name, priority: this.lang === "ar" ? 3 : 1,
              _madaraUrl: ch.chapter_link || ch.url,
              _madaraSource: this
            }));
          }
        } catch {}
      }

      setCachedChapters(cacheKey, chapters);
      return chapters;
    } catch (e) {
      console.log(`[${this.name}:chapters]`, e.message?.slice(0, 50));
      return [];
    }
  }

  _parseChapterListHTML(html, mangaSlug) {
    if (!html || typeof html !== "string") return [];
    const chapters = [];
    const seen = new Set();

    // أنماط شاملة لمواقع Madara
    const patterns = [
      // رابط يحتوي على chapter + رقم
      /href="([^"]+(?:chapter|فصل|الفصل|ch)[/-]([\d.]+)[^"]*)"[^>]*>/gi,
      // رابط مع نص chapter
      /<a[^>]+href="([^"]+)"[^>]*>[^<]*(?:chapter|فصل|الفصل|الفصل)\s*[#:]?\s*([\d.]+)/gi,
      // span أو li يحتوي رقم الفصل
      /href="([^"]+)"[^>]*>[\s\S]*?(?:chapter|فصل)\s*([\d.]+)/gi
    ];

    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(html)) !== null) {
        const url = m[1];
        const rawNum = m[2];
        if (!rawNum || seen.has(rawNum)) continue;
        if (!url.startsWith("http")) continue;
        seen.add(rawNum);
        const numF = parseFloat(rawNum) || 0;
        chapters.push({
          num: String(numF),
          numF,
          title: "",
          lang: this.lang, isAr: this.lang === "ar",
          source: this.name, priority: this.lang === "ar" ? 3 : 1,
          _madaraUrl: url,
          _madaraSource: this
        });
      }
      if (chapters.length > 0) break;
    }

    // نمط بديل: li.wp-manga-chapter
    if (!chapters.length) {
      const liRe = /class="[^"]*wp-manga-chapter[^"]*"[\s\S]*?href="([^"]+)"[\s\S]*?chapter\s*([\d.]+)/gi;
      let m;
      while ((m = liRe.exec(html)) !== null) {
        const rawNum = m[2];
        if (!rawNum || seen.has(rawNum)) continue;
        seen.add(rawNum);
        const numF = parseFloat(rawNum) || 0;
        chapters.push({
          num: String(numF),
          numF,
          title: "",
          lang: this.lang, isAr: this.lang === "ar",
          source: this.name, priority: this.lang === "ar" ? 3 : 1,
          _madaraUrl: m[1],
          _madaraSource: this
        });
      }
    }

    return chapters.sort((a, b) => a.numF - b.numF);
  }

  async getImages(chapterUrl) {
    try {
      const res = await httpGet(chapterUrl, { headers: this.headers });
      const html = res.data;

      // نمط 1: JavaScript array
      const jsPatterns = [
        /chapter_preloaded_images\s*=\s*(\[[^\]]+\])/,
        /var\s+images\s*=\s*(\[[^\]]+\])/,
        /(?:chapImages|CHAPTER_IMAGES)\s*=\s*'([^']+)'/,
        /"images"\s*:\s*(\[[^\]]+\])/,
        /page_urls\s*=\s*(\[[^\]]+\])/,
        /readerImages\s*=\s*(\[[^\]]+\])/
      ];

      for (const re of jsPatterns) {
        const match = html.match(re);
        if (match) {
          try {
            let data = match[1];
            // إذا كان مفصولاً بفواصل وليس JSON
            if (!data.startsWith("[")) {
              const urls = data.split(",").filter(u => u.startsWith("http"));
              if (urls.length) return { urls, referer: this.base + "/" };
            }
            let parsed = JSON.parse(data);
            if (typeof parsed[0] === "object") {
              parsed = parsed.map(u => u.url || u.src || u.image || u.img);
            }
            const urls = parsed.filter(u => u && (u.startsWith("http") || u.startsWith("//")));
            const fixedUrls = urls.map(u => u.startsWith("//") ? "https:" + u : u);
            if (fixedUrls.length) return { urls: fixedUrls, referer: this.base + "/" };
          } catch {}
        }
      }

      // نمط 2: chapImages كنص
      const chapMatch = html.match(/chapImages\s*=\s*'([^']+)'/);
      if (chapMatch) {
        const urls = chapMatch[1].split(",").filter(u => u.startsWith("http"));
        if (urls.length) return { urls, referer: this.base + "/" };
      }

      // نمط 3: img tags بـ data-src أو src
      const imgPatterns = [
        /<img[^>]+data-src="(https?:\/\/[^"]+(?:\.jpg|\.jpeg|\.png|\.webp)(?:\?[^"]*)?)"[^>]*>/gi,
        /<img[^>]+src="(https?:\/\/[^"]+(?:\.jpg|\.jpeg|\.png|\.webp)(?:\?[^"]*)?)"[^>]*class="[^"]*wp-manga-chapter-img[^"]*"/gi,
        /<img[^>]+class="[^"]*chapter[^"]*"[^>]+(?:data-src|src)="(https?:\/\/[^"]+)"/gi
      ];

      const urls = [];
      const seen = new Set();
      for (const re of imgPatterns) {
        re.lastIndex = 0;
        let im;
        while ((im = re.exec(html)) !== null) {
          const u = im[1];
          if (!seen.has(u) && (u.includes(".jpg") || u.includes(".jpeg") || u.includes(".png") || u.includes(".webp"))) {
            seen.add(u);
            urls.push(u);
          }
        }
      }
      if (urls.length > 1) return { urls, referer: this.base + "/" };

      throw new Error("لم يتم العثور على صور");
    } catch (e) {
      console.log(`[${this.name}:images]`, e.message?.slice(0, 50));
      throw e;
    }
  }
}

// ─── SOURCE 6: MangaBuddy ────────────────────────────────────────────────────

const MangaBuddy = {
  name: "MangaBuddy",
  base: "https://mangabuddy.com",

  async search(query) {
    try {
      const res = await httpGet(`${this.base}/api/search`, {
        params: { q: query, page: 1 },
        headers: { "User-Agent": UA, "Referer": this.base }
      });
      const list = res.data?.data || [];
      return list.slice(0, 8).map(m => ({
        _mbSlug: m.slug || m.id,
        source: "MangaBuddy",
        title: m.title || m.name || "Unknown",
        status: m.status,
        availableLangs: ["en"], hasAr: false
      }));
    } catch { return []; }
  },

  async getChapters(slug) {
    const cacheKey = `mb_${slug}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;

    try {
      const res = await httpGet(`${this.base}/api/manga/${slug}/chapters`, {
        params: { page: 1, limit: 500 },
        headers: { "User-Agent": UA, "Referer": this.base }
      });
      const list = res.data?.data || res.data?.chapters || [];
      const result = list.map(ch => ({
        num: String(ch.chapter_number || ch.num || ch.id || "0"),
        numF: parseFloat(ch.chapter_number || ch.num) || 0,
        title: ch.chapter_name || ch.title || "",
        lang: "en", isAr: false,
        source: "MangaBuddy", priority: 1,
        _mbSlug: slug, _mbId: ch.id
      })).sort((a, b) => a.numF - b.numF);
      setCachedChapters(cacheKey, result);
      return result;
    } catch { return []; }
  },

  async getImages(slug, chId) {
    try {
      const res = await httpGet(`${this.base}/api/chapter/${chId}/images`, {
        headers: { "User-Agent": UA, "Referer": this.base }
      });
      const imgs = res.data?.data || res.data?.images || [];
      const urls = imgs.map(i => i.url || i.src || (typeof i === "string" ? i : "")).filter(u => u.startsWith("http"));
      if (urls.length) return { urls, referer: this.base };
      throw new Error("no images");
    } catch (e) { throw new Error(`MangaBuddy: ${e.message}`); }
  }
};

// ─── تهيئة مصادر Madara العربية ───────────────────────────────────────────────

const Mangalek = new MadaraSource({ name: "Mangalek", base: "https://mangalek.com" });
const Asq3 = new MadaraSource({ name: "3asq", base: "https://3asq.org" });
const MangaSwat = new MadaraSource({ name: "MangaSwat", base: "https://mangaswat.com" });
const ArTeamManga = new MadaraSource({ name: "ArTeam", base: "https://arteamone.com" });
const MangaAE = new MadaraSource({ name: "MangaAE", base: "https://manga.ae" });
const TeamX = new MadaraSource({ name: "TeamX", base: "https://teamxmanga.com" });
const GalaxyManga = new MadaraSource({ name: "GalaxyManga", base: "https://galaxymanga.net" });
const OzulScans = new MadaraSource({ name: "OzulScans", base: "https://ozulscans.com" });
const PerfectManga = new MadaraSource({ name: "PerfectManga", base: "https://perfectmanga.com" });
const ArabsManga = new MadaraSource({ name: "ArabsManga", base: "https://arabsworld.net" });
const KelManga = new MadaraSource({ name: "KelManga", base: "https://kelmanga.com" });
const MangaArab2 = new MadaraSource({ name: "MangaArab", base: "https://manga-arab.com" });
const OnimangaAr = new MadaraSource({ name: "Onimanga", base: "https://www.onimanga.com" });
const MangaKey = new MadaraSource({ name: "MangaKey", base: "https://mangakey.net" });

// مصادر للهنتاي
const Hentaimama = new MadaraSource({ name: "Hentaimama", base: "https://hentaimama.io" });
const Manhwa18 = new MadaraSource({ name: "Manhwa18", base: "https://manhwa18.net" });
const Hentai3z = new MadaraSource({ name: "Hentai3z", base: "https://hentai3z.net" });

// قوائم المصادر
const ARABIC_MADARA_SOURCES = [
  Mangalek, Asq3, MangaSwat, ArTeamManga, MangaAE,
  TeamX, GalaxyManga, OzulScans, PerfectManga,
  ArabsManga, KelManga, MangaArab2, OnimangaAr, MangaKey
];

const HENTAI_MADARA_SOURCES = [
  Hentaimama, Manhwa18, Hentai3z,
  Mangalek, Asq3, MangaSwat
];

// ─── Chapter Merger ───────────────────────────────────────────────────────────
// الأولوية: GManga/Madara(AR)=3 > MDX(AR)=2 = ComicK(AR)=2 > إنجليزي=1

function mergeChapters(allChapters) {
  const map = new Map();

  for (const ch of allChapters) {
    const key = String(parseFloat(ch.num) || 0);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        num: ch.num, numF: ch.numF,
        flag: ch.isAr ? "🇸🇦" : getLangFlag(ch.lang),
        isAr: ch.isAr, title: ch.title || "",
        source: ch.source, lang: ch.lang, priority: ch.priority,
        _dxId:         ch._dxId         || null,
        _gmId:         ch._gmId         || null,
        _ckHid:        ch._ckHid        || null,
        _madaraUrl:    ch._madaraUrl    || null,
        _madaraSource: ch._madaraSource || null,
        _msSlug:       ch._msSlug       || null,
        _msChNum:      ch._msChNum      || null,
        _mbSlug:       ch._mbSlug       || null,
        _mbId:         ch._mbId         || null
      });
    } else {
      // تحديث إذا كان المصدر الجديد ذو أولوية أعلى
      if (ch.priority > existing.priority) {
        existing.flag     = ch.isAr ? "🇸🇦" : getLangFlag(ch.lang);
        existing.isAr     = ch.isAr;
        existing.source   = ch.source;
        existing.lang     = ch.lang;
        existing.priority = ch.priority;
        if (!existing.title && ch.title) existing.title = ch.title;
      }
      // دائماً احفظ كل IDs
      if (ch._dxId         && !existing._dxId)         existing._dxId         = ch._dxId;
      if (ch._gmId         && !existing._gmId)         existing._gmId         = ch._gmId;
      if (ch._ckHid        && !existing._ckHid)        existing._ckHid        = ch._ckHid;
      if (ch._madaraUrl    && !existing._madaraUrl)    existing._madaraUrl    = ch._madaraUrl;
      if (ch._madaraSource && !existing._madaraSource) existing._madaraSource = ch._madaraSource;
      if (ch._msSlug       && !existing._msSlug)       existing._msSlug       = ch._msSlug;
      if (ch._msChNum      && !existing._msChNum)      existing._msChNum      = ch._msChNum;
      if (ch._mbSlug       && !existing._mbSlug)       existing._mbSlug       = ch._mbSlug;
      if (ch._mbId         && !existing._mbId)         existing._mbId         = ch._mbId;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.numF - b.numF);
}

// ─── جلب الفصول من كل المصادر ────────────────────────────────────────────────
// يقبل إما كائن مانغا كامل أو (title, mdxId, ckHid) للتوافق الخلفي

async function fetchAllChapters(mangaOrTitle, mdxId, ckHid, opts = {}) {
  let title, gmId, madaraSlug, madaraSource, isHentai;

  if (typeof mangaOrTitle === "object" && mangaOrTitle !== null) {
    title       = mangaOrTitle.title;
    mdxId       = mangaOrTitle._mdxId    || mdxId;
    ckHid       = mangaOrTitle._ckHid    || ckHid;
    gmId        = mangaOrTitle._gmId;
    madaraSlug  = mangaOrTitle._madaraSlug;
    madaraSource = mangaOrTitle._madaraSource;
  } else {
    title = mangaOrTitle;
  }

  const { ratings, langs = ["ar", "en"], hentaiMode = false } = opts;
  isHentai = hentaiMode;

  const tasks = [];

  // ── MangaDex ──
  if (mdxId) {
    tasks.push(MangaDex.getChapters(mdxId, { langs, ratings }).catch(() => []));
  } else {
    tasks.push(
      MangaDex.search(title, { limit: 5, ratings })
        .then(r => {
          if (!r.length) return [];
          // أفضل تطابق
          const best = findBestMatch(title, r) || r[0];
          return MangaDex.getChapters(best._mdxId, { langs, ratings });
        })
        .catch(() => [])
    );
  }

  // ── ComicK ──
  if (ckHid) {
    tasks.push(ComicK.getChapters(ckHid, { langs }).catch(() => []));
  } else {
    tasks.push(
      ComicK.search(title)
        .then(r => {
          if (!r.length) return [];
          const best = findBestMatch(title, r) || r[0];
          return ComicK.getChapters(best._ckHid, { langs });
        })
        .catch(() => [])
    );
  }

  // ── GManga ──
  if (gmId) {
    tasks.push(GManga.getChapters(gmId).catch(() => []));
  } else {
    tasks.push(
      GManga.search(title)
        .then(r => {
          if (!r.length) return [];
          const best = findBestMatch(title, r) || r[0];
          return GManga.getChapters(best._gmId);
        })
        .catch(() => [])
    );
  }

  // ── Madara العربية ──
  const madaraSources = isHentai ? HENTAI_MADARA_SOURCES : ARABIC_MADARA_SOURCES;

  // إذا كان لدينا slug مباشر من نتيجة البحث، استخدمه
  if (madaraSlug && madaraSource) {
    tasks.push(madaraSource.getChapters(madaraSlug).catch(() => []));
    // ابحث في باقي المصادر أيضاً
    for (const src of madaraSources) {
      if (src.name !== madaraSource.name) {
        tasks.push(
          src.search(title)
            .then(r => r.length ? src.getChapters((findBestMatch(title, r) || r[0])._madaraSlug) : [])
            .catch(() => [])
        );
      }
    }
  } else {
    for (const src of madaraSources) {
      tasks.push(
        src.search(title)
          .then(r => r.length ? src.getChapters((findBestMatch(title, r) || r[0])._madaraSlug) : [])
          .catch(() => [])
      );
    }
  }

  // ── MangaSee (احتياط إنجليزي) ──
  if (!isHentai) {
    tasks.push(
      MangaSee.search(title)
        .then(r => r.length ? MangaSee.getChapters((findBestMatch(title, r) || r[0])._msSlug) : [])
        .catch(() => [])
    );
  }

  const results = await Promise.allSettled(tasks);
  const all = results.filter(r => r.status === "fulfilled").flatMap(r => r.value || []);
  return mergeChapters(all);
}

// إيجاد أفضل تطابق للعنوان
function findBestMatch(query, list) {
  const q = cleanTitle(query);
  let bestScore = 0;
  let best = null;
  for (const item of list) {
    const t = cleanTitle(item.title || "");
    // تطابق تام
    if (t === q) return item;
    // يحتوي أحدهما على الآخر
    const score = (t.includes(q) || q.includes(t)) ? 0.8 :
      // كلمات مشتركة
      q.split(" ").filter(w => w.length > 2 && t.includes(w)).length / Math.max(q.split(" ").length, 1);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore > 0.3 ? best : null;
}

// ─── Chapter List Display ─────────────────────────────────────────────────────

function buildChapterList(mangaTitle, chapters, page) {
  const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);
  const start = page * CHAPTERS_PER_PAGE;
  const slice = chapters.slice(start, start + CHAPTERS_PER_PAGE);
  const arCount = chapters.filter(c => c.isAr).length;
  const srcList = [...new Set(chapters.map(c => c.source))].join(" · ");

  let body = `📚 ${mangaTitle}\n`;
  body += `📖 ${chapters.length} فصل`;
  if (arCount > 0) body += ` · 🇸🇦 ${arCount} بالعربية`;
  body += ` · صفحة ${page + 1}/${totalPages}\n`;
  body += `📡 ${srcList}\n`;
  body += "━━━━━━━━━━━━━━━━━━\n\n";
  slice.forEach(ch => {
    const t = ch.title ? ` — ${ch.title.slice(0, 22)}` : "";
    body += `${ch.flag} فصل ${ch.num}${t}\n`;
  });
  body += "\n↩️ رد برقم الفصل لقراءته.";
  if (start + CHAPTERS_PER_PAGE < chapters.length) body += '\n↩️ "next" للصفحة التالية.';
  if (page > 0) body += '\n↩️ "prev" للصفحة السابقة.';
  return body;
}

// ─── جلب صور الفصل مع تجربة كل المصادر ──────────────────────────────────────

async function getChapterImages(chapter) {
  const errors = [];

  // 1) GManga (أعلى أولوية — عربي رسمي)
  if (chapter._gmId) {
    try { const r = await GManga.getImages(chapter._gmId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`GManga: ${e.message?.slice(0, 50)}`); }
  }

  // 2) Madara (مصادر WordPress العربية)
  if (chapter._madaraUrl && chapter._madaraSource) {
    try { const r = await chapter._madaraSource.getImages(chapter._madaraUrl); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`${chapter._madaraSource.name}: ${e.message?.slice(0, 50)}`); }
  }

  // 3) MangaDex — جودة عالية أولاً
  if (chapter._dxId) {
    try { const r = await MangaDex.getImages(chapter._dxId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`MDX: ${e.message?.slice(0, 50)}`); }

    try { const r = await MangaDex.getImagesSaver(chapter._dxId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`MDX-saver: ${e.message?.slice(0, 50)}`); }
  }

  // 4) ComicK
  if (chapter._ckHid) {
    try { const r = await ComicK.getImages(chapter._ckHid); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`ComicK: ${e.message?.slice(0, 50)}`); }
  }

  // 5) MangaSee
  if (chapter._msSlug && chapter._msChNum) {
    try { const r = await MangaSee.getImages(chapter._msSlug, chapter._msChNum); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`MangaSee: ${e.message?.slice(0, 50)}`); }
  }

  // 6) MangaBuddy
  if (chapter._mbSlug && chapter._mbId) {
    try { const r = await MangaBuddy.getImages(chapter._mbSlug, chapter._mbId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`MangaBuddy: ${e.message?.slice(0, 50)}`); }
  }

  throw new Error(
    `⚠️ فشل تحميل فصل ${chapter.num} من كل المصادر.\n` +
    `المصادر المجربة:\n${errors.slice(0, 5).join("\n")}`
  );
}

// ─── Page Downloader ──────────────────────────────────────────────────────────

async function downloadPage(url, filePath, referer, attempt = 0) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer", timeout: 40000,
      headers: {
        "Referer": referer || "https://mangadex.org",
        "User-Agent": UA,
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return true;
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 1500));
      return downloadPage(url, filePath, referer, attempt + 1);
    }
    return false;
  }
}

// ─── Chapter Sender ───────────────────────────────────────────────────────────

async function sendChapterPages(api, event, chapter, mangaTitle, chapters, currentIndex, commandName) {
  const { threadID } = event;
  const chNum = chapter.num;

  let waitMsgID = null;
  await new Promise(resolve => {
    api.sendMessage(
      `⏳ جاري تحميل ${chapter.flag} فصل ${chNum}\n📚 "${mangaTitle}"\n📡 المصدر: ${chapter.source}`,
      threadID, (err, info) => { if (info) waitMsgID = info.messageID; resolve(); }
    );
  });

  try {
    fs.ensureDirSync(CACHE);
    const { urls: pages, referer } = await getChapterImages(chapter);
    if (!pages.length) throw new Error("لا توجد صور لهذا الفصل");

    const totalBatches = Math.ceil(pages.length / PAGE_BATCH);

    for (let i = 0; i < pages.length; i += PAGE_BATCH) {
      const batch = pages.slice(i, i + PAGE_BATCH);
      const pageFiles = [];

      for (let j = 0; j < batch.length; j++) {
        const url = batch[j];
        const rawExt = path.extname(url.split("?")[0]).replace(".", "").toLowerCase();
        const ext = ["jpg", "jpeg", "png", "webp"].includes(rawExt) ? rawExt : "jpg";
        const filePath = path.join(CACHE, `pg_${Date.now()}_${j}.${ext}`);
        if (await downloadPage(url, filePath, referer)) pageFiles.push(filePath);
      }

      if (!pageFiles.length) continue;

      const bNum = Math.floor(i / PAGE_BATCH) + 1;
      const body =
        `${chapter.flag} ${mangaTitle} — فصل ${chNum}\n` +
        `🖼 الصفحات ${i + 1}–${i + pageFiles.length} من ${pages.length}` +
        (totalBatches > 1 ? ` (جزء ${bNum}/${totalBatches})` : "") +
        `\n📡 ${chapter.source}`;

      await new Promise(resolve => {
        api.sendMessage(
          { body, attachment: pageFiles.map(f => fs.createReadStream(f)) },
          threadID,
          () => { pageFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} }); resolve(); }
        );
      });

      await new Promise(r => setTimeout(r, 500)); // تجنب الحظر
    }

    if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch (_) {}

    saveProgress(event.senderID, mangaTitle, chNum);

    const prev = currentIndex > 0 ? chapters[currentIndex - 1] : null;
    const next = chapters[currentIndex + 1];
    let nav = `✅ انتهى ${chapter.flag} فصل ${chNum} من "${mangaTitle}".\n`;
    nav += `📊 التقدم: ${currentIndex + 1}/${chapters.length}\n\n`;
    if (next) nav += `▶️ ↩️ "next" — فصل ${next.num} ${next.flag}\n`;
    if (prev) nav += `◀️ ↩️ "prev" — فصل ${prev.num} ${prev.flag}\n`;
    nav += `↩️ أو رد برقم أي فصل.`;

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

// ─── Shared onReply ───────────────────────────────────────────────────────────

async function handleReply({ api, event, Reply, commandName }) {
  const { threadID, messageID } = event;
  if (event.senderID !== Reply.author) return;
  const { state } = Reply;

  if (state === "browse_chapters") {
    const { chapters, mangaTitle, page } = Reply;
    const input = event.body.trim().toLowerCase();
    const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);

    if (input === "next" || input === "التالي" || input === "next") {
      const newPage = page + 1;
      if (newPage >= totalPages) return api.sendMessage("❌ لا توجد صفحات أخرى.", threadID, messageID);
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

    if (input === "prev" || input === "السابق" || input === "back") {
      const newPage = page - 1;
      if (newPage < 0) return api.sendMessage("❌ لا توجد صفحات سابقة.", threadID, messageID);
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

    // البحث عن الفصل بالرقم
    const chapter = chapters.find(ch => {
      const inp = event.body.trim();
      return String(ch.num) === inp || String(ch.numF) === inp ||
        String(Math.floor(ch.numF)) === inp;
    });
    if (!chapter) return api.sendMessage(`❌ الفصل "${event.body.trim()}" غير موجود في القائمة.\n💡 تأكد من رقم الفصل.`, threadID, messageID);

    const idx = chapters.indexOf(chapter);
    try {
      await sendChapterPages(api, event, chapter, mangaTitle, chapters, idx, commandName);
      try { api.unsendMessage(Reply.messageID); } catch (_) {}
    } catch (e) {
      console.error(`[${commandName}:pages]`, e.message);
      api.sendMessage(`❌ خطأ في تحميل الفصل:\n${e.message?.slice(0, 150)}`, threadID, messageID);
    }

  } else if (state === "navigate_chapter") {
    const { chapters, mangaTitle, currentIndex } = Reply;
    const input = event.body.trim().toLowerCase();

    let targetIndex = currentIndex;
    if (input === "next" || input === "التالي") targetIndex = currentIndex + 1;
    else if (input === "prev" || input === "السابق") targetIndex = currentIndex - 1;
    else {
      const found = chapters.findIndex(ch => {
        const inp = event.body.trim();
        return String(ch.num) === inp || String(ch.numF) === inp ||
          String(Math.floor(ch.numF)) === inp;
      });
      if (found !== -1) targetIndex = found;
    }

    if (targetIndex < 0 || targetIndex >= chapters.length)
      return api.sendMessage("❌ لا يوجد فصل في هذا الاتجاه.", threadID, messageID);

    try {
      await sendChapterPages(api, event, chapters[targetIndex], mangaTitle, chapters, targetIndex, commandName);
      try { api.unsendMessage(Reply.messageID); } catch (_) {}
    } catch (e) {
      console.error(`[${commandName}:navigate]`, e.message);
      api.sendMessage("❌ خطأ في تحميل الفصل.", threadID, messageID);
    }
  }
}

module.exports = {
  MangaDex, GManga, ComicK, MangaSee, MangaBuddy,
  Mangalek, Asq3, MangaSwat, ArTeamManga, MangaAE,
  TeamX, GalaxyManga, OzulScans, PerfectManga,
  ArabsManga, KelManga, MangaArab2, OnimangaAr, MangaKey,
  Hentaimama, Manhwa18, Hentai3z,
  ARABIC_MADARA_SOURCES, HENTAI_MADARA_SOURCES, MadaraSource,
  mergeChapters, fetchAllChapters, findBestMatch,
  buildChapterList, sendChapterPages, handleReply,
  loadProgress, saveProgress,
  getLangFlag, getStatusLabel,
  CHAPTERS_PER_PAGE, PAGE_BATCH, CACHE
};
