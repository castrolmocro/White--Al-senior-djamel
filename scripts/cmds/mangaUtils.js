const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

// تحميل canvas لمعالجة الصور
let canvasLib = null;
try { canvasLib = require("canvas"); } catch {}

const CACHE = path.join(__dirname, "cache");
const PROGRESS_FILE = path.join(CACHE, "manga_progress.json");
const CHAPTER_CACHE_FILE = path.join(CACHE, "manga_chapter_cache.json");
const CHAPTERS_PER_PAGE = 25;
const PAGE_BATCH = 6;
const CHAPTER_CACHE_TTL = 2 * 60 * 60 * 1000; // ساعتان

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─── Progress ─────────────────────────────────────────────────────────────────

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

function cleanTitle(t) {
  return (t || "").toLowerCase().replace(/[^\w\u0600-\u06FF\s]/g, " ").replace(/\s+/g, " ").trim();
}

// ─── HTTP Helper (بـ timeout قصير للبحث) ──────────────────────────────────────

async function httpGet(url, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, {
        timeout: opts._searchMode ? 8000 : 22000,
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate, br" },
        ...opts
      });
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function httpPost(url, data, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.post(url, data, {
        timeout: opts._searchMode ? 8000 : 18000,
        headers: { "User-Agent": UA },
        ...opts
      });
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ─── معالجة الصور: تقسيم وضغط لتناسب المسنجر ────────────────────────────────

const MAX_IMG_HEIGHT = 1400; // أقصى ارتفاع للصورة الواحدة
const MAX_IMG_WIDTH  = 900;  // أقصى عرض مناسب للموبايل

async function processImage(filePath) {
  if (!canvasLib) return [filePath];

  try {
    const img = await canvasLib.loadImage(filePath);
    const origW = img.width;
    const origH = img.height;

    // احسب العرض المستهدف
    const targetW = Math.min(origW, MAX_IMG_WIDTH);
    const scale   = targetW / origW;
    const targetH = Math.round(origH * scale);

    const ext = path.extname(filePath).toLowerCase();
    const baseNoExt = filePath.replace(/\.[^.]+$/, "");

    // إذا الصورة تناسب صفحة واحدة
    if (targetH <= MAX_IMG_HEIGHT) {
      if (targetW === origW && ext === ".jpg") return [filePath]; // لا حاجة لمعالجة
      const canvas = canvasLib.createCanvas(targetW, targetH);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const outPath = baseNoExt + ".jpg";
      fs.writeFileSync(outPath, canvas.toBuffer("image/jpeg", { quality: 0.87 }));
      if (outPath !== filePath) try { fs.unlinkSync(filePath); } catch {}
      return [outPath];
    }

    // تقسيم الصورة الطويلة إلى أجزاء
    const numParts = Math.ceil(targetH / MAX_IMG_HEIGHT);
    const partOrigH = Math.ceil(origH / numParts);
    const parts = [];

    for (let i = 0; i < numParts; i++) {
      const srcY     = i * partOrigH;
      const srcH     = Math.min(partOrigH, origH - srcY);
      const partH    = Math.round(srcH * scale);
      if (srcH <= 0 || partH <= 0) continue;

      const canvas = canvasLib.createCanvas(targetW, partH);
      const ctx    = canvas.getContext("2d");
      ctx.drawImage(img, 0, srcY, origW, srcH, 0, 0, targetW, partH);

      const partPath = `${baseNoExt}_s${i + 1}.jpg`;
      fs.writeFileSync(partPath, canvas.toBuffer("image/jpeg", { quality: 0.87 }));
      parts.push(partPath);
    }

    try { fs.unlinkSync(filePath); } catch {}
    return parts.length ? parts : [filePath];
  } catch (e) {
    console.log("[processImage]", e.message?.slice(0, 60));
    return [filePath];
  }
}

// ─── SOURCE 1: MangaDex ───────────────────────────────────────────────────────

const MangaDex = {
  name: "MangaDex",
  base: "https://api.mangadex.org",

  async search(query, { ratings = ["safe", "suggestive", "erotica", "pornographic"], origLangs = [], limit = 20 } = {}) {
    const tryQ = async (q) => {
      try {
        const p = new URLSearchParams();
        p.set("title", q); p.set("limit", limit);
        p.set("order[relevance]", "desc");
        p.append("includes[]", "cover_art");
        ratings.forEach(r => p.append("contentRating[]", r));
        origLangs.forEach(l => p.append("originalLanguage[]", l));
        const res = await httpGet(`${this.base}/manga?${p}`, { _searchMode: true });
        return (res.data.data || []).map(m => ({
          _mdxId: m.id, source: "MangaDex",
          title: (() => { const t = m.attributes.title; return t.ar || t.en || t["ja-ro"] || t["ko-ro"] || Object.values(t)[0] || "Unknown"; })(),
          status: m.attributes.status,
          lastChapter: m.attributes.lastChapter,
          availableLangs: m.attributes.availableTranslatedLanguages || [],
          hasAr: (m.attributes.availableTranslatedLanguages || []).includes("ar"),
          originalLang: m.attributes.originalLanguage,
          tags: (m.attributes.tags || []).filter(t => t.attributes.group === "genre").map(t => t.attributes.name.en || Object.values(t.attributes.name)[0]).slice(0, 5),
          description: (m.attributes.description?.ar || m.attributes.description?.en || "").replace(/<[^>]+>/g, "").slice(0, 200)
        }));
      } catch { return []; }
    };
    let r = await tryQ(query);
    if (!r.length && /[\u0600-\u06FF]/.test(query)) r = await tryQ(cleanTitle(query));
    return r;
  },

  async getChapters(mangaId, { langs = ["ar", "en"], ratings = ["safe", "suggestive", "erotica", "pornographic"] } = {}) {
    const cacheKey = `mdx_${mangaId}_${langs.sort().join("")}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;

    let all = [], offset = 0;
    while (true) {
      try {
        const p = new URLSearchParams();
        p.set("order[chapter]", "asc"); p.set("limit", 96); p.set("offset", offset);
        langs.forEach(l => p.append("translatedLanguage[]", l));
        ratings.forEach(r => p.append("contentRating[]", r));
        const res = await httpGet(`${this.base}/manga/${mangaId}/feed?${p}`);
        const data = res.data.data || [];
        all = all.concat(data);
        if (data.length < 96 || offset > 9000) break;
        offset += 96;
        await new Promise(r => setTimeout(r, 250));
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
        return { urls: pages.map(f => `${baseUrl}/${quality}/${chapter.hash}/${f}`), referer: "https://mangadex.org" };
      } catch (e) {
        if (i === 2) throw new Error(`MDX: ${e.message}`);
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  },

  async getImagesSaver(chapterId) {
    const res = await httpGet(`${this.base}/at-home/server/${chapterId}`);
    const { baseUrl, chapter } = res.data;
    const pages = chapter.dataSaver?.length ? chapter.dataSaver : (chapter.data || []);
    if (!pages.length) throw new Error("no pages");
    const quality = chapter.dataSaver?.length ? "data-saver" : "data";
    return { urls: pages.map(f => `${baseUrl}/${quality}/${chapter.hash}/${f}`), referer: "https://mangadex.org" };
  }
};

// ─── SOURCE 2: GManga ─────────────────────────────────────────────────────────

const GManga = {
  name: "GManga",
  base: "https://gmanga.org/api",
  headers: { "User-Agent": UA, "Accept": "application/json", "Origin": "https://gmanga.org", "Referer": "https://gmanga.org/" },

  async search(query) {
    for (const ep of [
      { method: "post", url: `${this.base}/mangas/search`, data: { search: query } },
      { method: "get",  url: `${this.base}/mangas`, params: { search: query } }
    ]) {
      try {
        const res = ep.method === "post"
          ? await httpPost(ep.url, ep.data, { headers: this.headers, _searchMode: true })
          : await httpGet(ep.url, { headers: this.headers, params: ep.params, _searchMode: true });
        const list = res.data?.mangas || res.data?.data || (Array.isArray(res.data) ? res.data : []);
        if (list.length) return list.slice(0, 10).map(m => ({
          _gmId: m.id, source: "GManga",
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
    for (const url of [`${this.base}/mangas/${mangaId}/releases`, `${this.base}/mangas/${mangaId}/chapters`]) {
      try {
        const res = await httpGet(url, { headers: this.headers });
        const list = res.data?.releases || res.data?.chapters || res.data?.data || (Array.isArray(res.data) ? res.data : []);
        if (list.length) {
          const result = list.map(r => ({
            num: String(r.chapter || r.chapter_number || r.num || "0"),
            numF: parseFloat(r.chapter || r.chapter_number || r.num) || 0,
            title: r.title || "", lang: "ar", isAr: true,
            source: "GManga", priority: 3, _gmId: r.id
          })).sort((a, b) => a.numF - b.numF);
          setCachedChapters(cacheKey, result);
          return result;
        }
      } catch {}
    }
    return [];
  },

  async getImages(releaseId) {
    for (const url of [`${this.base}/releases/${releaseId}`, `${this.base}/chapters/${releaseId}/images`]) {
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
      const res = await httpGet(`${this.base}/v1.0/search`, { params: { q: query, limit: 20, tachiyomi: true }, _searchMode: true });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      return list.map(m => ({
        _ckHid: m.hid, source: "ComicK",
        title: m.title || m.slug || "Unknown",
        status: m.status === 1 ? "ongoing" : "completed",
        availableLangs: Array.isArray(m.iso2) ? m.iso2 : [],
        hasAr: Array.isArray(m.iso2) && m.iso2.includes("ar")
      }));
    } catch { return []; }
  },

  async getChapters(hid, { langs = ["ar", "en"] } = {}) {
    const cacheKey = `ck_${hid}_${langs.sort().join("")}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;
    const all = [];
    for (const lang of langs) {
      let page = 1;
      while (true) {
        try {
          const res = await httpGet(`${this.base}/comic/${hid}/chapters`, { params: { lang, limit: 500, page, tachiyomi: true } });
          const chapters = res.data?.chapters || [];
          if (!chapters.length) break;
          chapters.forEach(ch => all.push({
            num: String(ch.chap || ch.chapter || "0"),
            numF: parseFloat(ch.chap || ch.chapter) || 0,
            title: ch.title || "", lang, isAr: lang === "ar",
            source: "ComicK", priority: lang === "ar" ? 2 : 1, _ckHid: ch.hid
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
        headers: { "User-Agent": UA, "Referer": this.base },
        _searchMode: true
      });
      return (Array.isArray(res.data) ? res.data : []).slice(0, 8).map(m => ({
        _msSlug: m.i, source: "MangaSee",
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
      const res = await httpGet(`${this.base}/manga/${slug}`, { headers: { "User-Agent": UA, "Referer": this.base } });
      const match = res.data.match(/vm\.Chapters\s*=\s*(\[.*?\]);/s);
      if (!match) return [];
      const raw = JSON.parse(match[1]);
      const result = raw.map(ch => {
        const n = parseInt(ch.Chapter.slice(1, -1)) || 0;
        const minor = parseInt(ch.Chapter.slice(-1)) || 0;
        const num = minor ? `${n}.${minor}` : String(n);
        return { num, numF: parseFloat(num), title: ch.ChapterName || "", lang: "en", isAr: false, source: "MangaSee", priority: 1, _msSlug: slug, _msChNum: ch.Chapter };
      }).sort((a, b) => a.numF - b.numF);
      setCachedChapters(cacheKey, result);
      return result;
    } catch { return []; }
  },

  async getImages(slug, chNum) {
    try {
      const base = "https://mangasee123.com";
      const n = parseInt(chNum.slice(1, -1));
      const res = await httpGet(`${base}/read-online/${slug}-chapter-${n}.html`, { headers: { "User-Agent": UA, "Referer": base } });
      const chMatch = res.data.match(/vm\.CurChapter\s*=\s*(\{.*?\});/s);
      const pathMatch = res.data.match(/vm\.CurPathName\s*=\s*"([^"]+)"/);
      if (!chMatch || !pathMatch) throw new Error("no data");
      const ch = JSON.parse(chMatch[1]);
      const host = pathMatch[1];
      const pages = parseInt(ch.Page) || 0;
      const padded = String(n).padStart(4, "0");
      const urls = Array.from({ length: pages }, (_, i) => `https://${host}/manga/${slug}/${padded}-${String(i + 1).padStart(3, "0")}.png`);
      return { urls, referer: base };
    } catch (e) { throw new Error(`MangaSee: ${e.message}`); }
  }
};

// ─── SOURCE 5: Madara (WordPress عربي) ────────────────────────────────────────

class MadaraSource {
  constructor({ name, base, lang = "ar" }) {
    this.name = name;
    this.base = base.replace(/\/$/, "");
    this.lang = lang;
    this.headers = {
      "User-Agent": UA, "Referer": base + "/",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
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
    for (const method of ["ajax", "url"]) {
      try {
        let html = "";
        if (method === "ajax") {
          const form = new URLSearchParams();
          form.set("action", "madara_read_manga_data");
          form.set("page", "1"); form.set("vars[s]", query); form.set("vars[paged]", "1");
          const res = await httpPost(`${this.base}/wp-admin/admin-ajax.php`, form.toString(), { headers: this.ajaxHeaders, _searchMode: true });
          html = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        } else {
          const res = await httpGet(`${this.base}/?s=${encodeURIComponent(query)}&post_type=wp-manga`, { headers: this.headers, _searchMode: true });
          html = res.data;
        }
        const r = this._parseSearchHTML(html);
        if (r.length) return r;
      } catch {}
    }
    return [];
  }

  _parseSearchHTML(html) {
    if (!html || typeof html !== "string") return [];
    const slugs = new Set();
    const patterns = [
      /href="(https?:\/\/[^"]+\/(?:manga|series|manhwa|manhua|مانغا)\/[^/"?#]+\/?)[^"]*"/gi,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(html)) !== null) {
        const u = m[1];
        if (u.startsWith(this.base) && !u.includes("page")) slugs.add(u);
      }
    }
    // fallback: any internal link
    if (!slugs.size) {
      const re2 = /class="[^"]*post-title[^"]*"[\s\S]*?href="([^"]+)"/gi;
      let m;
      while ((m = re2.exec(html)) !== null) slugs.add(m[1]);
    }

    const titleRe = /class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi;
    const titles = [];
    let tm;
    while ((tm = titleRe.exec(html)) !== null) titles.push(tm[1].trim());

    return [...slugs].slice(0, 8).map((slug, i) => {
      const fallback = decodeURIComponent(slug.replace(/\/$/, "").split("/").pop()).replace(/-/g, " ");
      return {
        _madaraSlug: slug, _madaraSource: this, source: this.name,
        title: titles[i] || fallback, hasAr: this.lang === "ar"
      };
    });
  }

  async getChapters(mangaSlug) {
    const cacheKey = `madara_${this.name}_${mangaSlug.replace(/\W/g, "_").slice(0, 40)}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;
    try {
      const page = await httpGet(mangaSlug, { headers: this.headers });
      const html = page.data;
      const idM = html.match(/(?:data-id|manga-id|post_id|manga_id)['":\s=]+(\d+)/i);
      const mangaId = idM?.[1];
      let chapters = [];
      if (mangaId) {
        try {
          const form = new URLSearchParams();
          form.set("action", "manga_get_chapters"); form.set("manga", mangaId);
          const res = await httpPost(`${this.base}/wp-admin/admin-ajax.php`, form.toString(), { headers: this.ajaxHeaders });
          chapters = this._parseChapterListHTML(typeof res.data === "string" ? res.data : JSON.stringify(res.data), mangaSlug);
        } catch {}
      }
      if (!chapters.length) chapters = this._parseChapterListHTML(html, mangaSlug);
      setCachedChapters(cacheKey, chapters);
      return chapters;
    } catch { return []; }
  }

  _parseChapterListHTML(html, mangaSlug) {
    if (!html || typeof html !== "string") return [];
    const seen = new Set();
    const chapters = [];
    const pats = [
      /href="([^"]+(?:chapter|فصل|ch)[/-]([\d.]+)[^"]*)"[^>]*>/gi,
      /<a[^>]+href="([^"]+)"[^>]*>[^<]*(?:chapter|فصل|الفصل)\s*[:#]?\s*([\d.]+)/gi,
      /class="[^"]*wp-manga-chapter[^"]*"[\s\S]*?href="([^"]+)"[\s\S]*?(?:chapter|فصل)\s*([\d.]+)/gi
    ];
    for (const re of pats) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(html)) !== null) {
        const url = m[1], rawNum = m[2];
        if (!rawNum || seen.has(rawNum) || !url.startsWith("http")) continue;
        seen.add(rawNum);
        const numF = parseFloat(rawNum) || 0;
        chapters.push({
          num: String(numF), numF, title: "", lang: this.lang, isAr: this.lang === "ar",
          source: this.name, priority: this.lang === "ar" ? 3 : 1,
          _madaraUrl: url, _madaraSource: this
        });
      }
      if (chapters.length) break;
    }
    return chapters.sort((a, b) => a.numF - b.numF);
  }

  async getImages(chapterUrl) {
    const res = await httpGet(chapterUrl, { headers: this.headers });
    const html = res.data;
    const jsPatterns = [
      /chapter_preloaded_images\s*=\s*(\[[^\]]+\])/,
      /var\s+images\s*=\s*(\[[^\]]+\])/,
      /"images"\s*:\s*(\[[^\]]+\])/,
      /page_urls\s*=\s*(\[[^\]]+\])/,
      /readerImages\s*=\s*(\[[^\]]+\])/
    ];
    for (const re of jsPatterns) {
      const match = html.match(re);
      if (match) {
        try {
          let parsed = JSON.parse(match[1]);
          if (typeof parsed[0] === "object") parsed = parsed.map(u => u.url || u.src || u.image);
          const urls = parsed.filter(u => u && (u.startsWith("http") || u.startsWith("//")))
                             .map(u => u.startsWith("//") ? "https:" + u : u);
          if (urls.length) return { urls, referer: this.base + "/" };
        } catch {}
      }
    }
    const chapMatch = html.match(/chapImages\s*=\s*'([^']+)'/);
    if (chapMatch) {
      const urls = chapMatch[1].split(",").filter(u => u.startsWith("http"));
      if (urls.length) return { urls, referer: this.base + "/" };
    }
    // img tags
    const imgRe = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+(?:\.jpg|\.jpeg|\.png|\.webp)[^"]*)"/gi;
    const urls = []; const seenU = new Set();
    let im;
    while ((im = imgRe.exec(html)) !== null) {
      if (!seenU.has(im[1])) { seenU.add(im[1]); urls.push(im[1]); }
    }
    if (urls.length > 1) return { urls, referer: this.base + "/" };
    throw new Error(`${this.name}: لم يتم العثور على صور`);
  }
}

// ─── تهيئة مصادر Madara العربية (30+ موقع) ────────────────────────────────────

const Mangalek    = new MadaraSource({ name: "Mangalek",    base: "https://mangalek.com" });
const Asq3        = new MadaraSource({ name: "3asq",        base: "https://3asq.org" });
const MangaSwat   = new MadaraSource({ name: "MangaSwat",   base: "https://mangaswat.com" });
const ArTeamManga = new MadaraSource({ name: "ArTeam",      base: "https://arteamone.com" });
const MangaAE     = new MadaraSource({ name: "MangaAE",     base: "https://manga.ae" });
const TeamX       = new MadaraSource({ name: "TeamX",       base: "https://teamxmanga.com" });
const GalaxyManga = new MadaraSource({ name: "Galaxy",      base: "https://galaxymanga.net" });
const OzulScans   = new MadaraSource({ name: "OzulScans",   base: "https://ozulscans.com" });
const PerfectMng  = new MadaraSource({ name: "Perfect",     base: "https://perfectmanga.com" });
const ArabsManga  = new MadaraSource({ name: "ArabsWorld",  base: "https://arabsworld.net" });
const KelManga    = new MadaraSource({ name: "KelManga",    base: "https://kelmanga.com" });
const MangaArab   = new MadaraSource({ name: "MangaArab",   base: "https://manga-arab.com" });
const Onimanga    = new MadaraSource({ name: "Onimanga",    base: "https://www.onimanga.com" });
const MangaKey    = new MadaraSource({ name: "MangaKey",    base: "https://mangakey.net" });
const WeManga     = new MadaraSource({ name: "WeManga",     base: "https://we-manga.com" });
const FlixManga   = new MadaraSource({ name: "FlixManga",   base: "https://flixmanga.com" });
const IManga      = new MadaraSource({ name: "iManga",      base: "https://i-mang.net" });
const KolManga    = new MadaraSource({ name: "KolManga",    base: "https://kolmanga.net" });
const Manga4Ever  = new MadaraSource({ name: "Manga4Ever",  base: "https://almanga4ever.com" });
const Hamasa10    = new MadaraSource({ name: "Hamasa10",    base: "https://hamasa10.com" });
const MgToon      = new MadaraSource({ name: "MgToon",      base: "https://mgtoon.com" });
const Manga4up    = new MadaraSource({ name: "Manga4up",    base: "https://manga4up.com" });
const ArabMangaI  = new MadaraSource({ name: "ArabManga",   base: "https://arabmanga.info" });
const MangaGatos  = new MadaraSource({ name: "MangaGatos",  base: "https://mangagatos.com" });
const AzManga     = new MadaraSource({ name: "AzManga",     base: "https://azmanga.net" });
const R2Manga     = new MadaraSource({ name: "R2Manga",     base: "https://r2manga.com" });
const ShoujoManga = new MadaraSource({ name: "Shoujo",      base: "https://shoujo.ae" });
const Manga4ar    = new MadaraSource({ name: "Manga4ar",    base: "https://manga4ar.com" });
const LightManga  = new MadaraSource({ name: "LightManga",  base: "https://lightmanga.org" });
const MangaLion   = new MadaraSource({ name: "MangaLion",   base: "https://mangalion.net" });

// مصادر الهنتاي
const Hentaimama  = new MadaraSource({ name: "Hentaimama",  base: "https://hentaimama.io" });
const Manhwa18    = new MadaraSource({ name: "Manhwa18",    base: "https://manhwa18.net" });
const Hentai3z    = new MadaraSource({ name: "Hentai3z",    base: "https://hentai3z.net" });

// ─── قوائم المصادر ────────────────────────────────────────────────────────────

// المجموعة الأولى: الأكثر موثوقية (تُبحث دائماً)
const TIER1_ARABIC = [Mangalek, Asq3, MangaSwat, ArTeamManga, MangaAE, TeamX, GalaxyManga];

// المجموعة الثانية: إضافية (تُبحث بالتوازي مع المجموعة الأولى)
const TIER2_ARABIC = [
  OzulScans, PerfectMng, ArabsManga, KelManga, MangaArab, Onimanga, MangaKey,
  WeManga, FlixManga, IManga, KolManga, Manga4Ever, Hamasa10, MgToon, Manga4up,
  ArabMangaI, MangaGatos, AzManga, R2Manga, ShoujoManga, Manga4ar, LightManga, MangaLion
];

const ARABIC_MADARA_SOURCES = [...TIER1_ARABIC, ...TIER2_ARABIC];
const HENTAI_MADARA_SOURCES = [Hentaimama, Manhwa18, Hentai3z, Mangalek, Asq3, MangaSwat, MangaAE];

// ─── findBestMatch ────────────────────────────────────────────────────────────

function findBestMatch(query, list) {
  const q = cleanTitle(query);
  let best = null, bestScore = 0;
  for (const item of list) {
    const t = cleanTitle(item.title || "");
    if (t === q) return item;
    const qWords = q.split(" ").filter(w => w.length > 2);
    const score = qWords.length ? qWords.filter(w => t.includes(w)).length / qWords.length : 0;
    const bonus = (t.includes(q) || q.includes(t)) ? 0.4 : 0;
    const total = score + bonus;
    if (total > bestScore) { bestScore = total; best = item; }
  }
  return bestScore > 0.25 ? best : null;
}

// ─── mergeChapters ────────────────────────────────────────────────────────────
// الأولوية: Arabic Madara (3) > MDX/ComicK Arabic (2) > English (1)

function mergeChapters(allChapters) {
  const map = new Map();
  for (const ch of allChapters) {
    const key = String(parseFloat(ch.num) || 0);
    const ex = map.get(key);
    if (!ex) {
      map.set(key, {
        num: ch.num, numF: ch.numF,
        flag: ch.isAr ? "🇸🇦" : getLangFlag(ch.lang),
        isAr: ch.isAr, title: ch.title || "",
        source: ch.source, lang: ch.lang, priority: ch.priority,
        _dxId: ch._dxId || null, _gmId: ch._gmId || null,
        _ckHid: ch._ckHid || null, _madaraUrl: ch._madaraUrl || null,
        _madaraSource: ch._madaraSource || null,
        _msSlug: ch._msSlug || null, _msChNum: ch._msChNum || null
      });
    } else {
      if (ch.priority > ex.priority) {
        ex.flag = ch.isAr ? "🇸🇦" : getLangFlag(ch.lang);
        ex.isAr = ch.isAr; ex.source = ch.source;
        ex.lang = ch.lang; ex.priority = ch.priority;
        if (!ex.title && ch.title) ex.title = ch.title;
      }
      if (ch._dxId        && !ex._dxId)        ex._dxId        = ch._dxId;
      if (ch._gmId        && !ex._gmId)         ex._gmId        = ch._gmId;
      if (ch._ckHid       && !ex._ckHid)        ex._ckHid       = ch._ckHid;
      if (ch._madaraUrl   && !ex._madaraUrl)    ex._madaraUrl   = ch._madaraUrl;
      if (ch._madaraSource && !ex._madaraSource) ex._madaraSource = ch._madaraSource;
      if (ch._msSlug      && !ex._msSlug)        ex._msSlug      = ch._msSlug;
      if (ch._msChNum     && !ex._msChNum)       ex._msChNum     = ch._msChNum;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.numF - b.numF);
}

// ─── fetchAllChapters ─────────────────────────────────────────────────────────

async function fetchAllChapters(mangaOrTitle, _mdxId, _ckHid, opts = {}) {
  let title, mdxId, ckHid, gmId, madaraSlug, madaraSource;

  if (typeof mangaOrTitle === "object" && mangaOrTitle !== null) {
    title        = mangaOrTitle.title;
    mdxId        = mangaOrTitle._mdxId   || _mdxId;
    ckHid        = mangaOrTitle._ckHid   || _ckHid;
    gmId         = mangaOrTitle._gmId;
    madaraSlug   = mangaOrTitle._madaraSlug;
    madaraSource = mangaOrTitle._madaraSource;
  } else {
    title = mangaOrTitle; mdxId = _mdxId; ckHid = _ckHid;
  }

  const { ratings, langs = ["ar", "en"], hentaiMode = false } = opts;
  const tasks = [];

  // ── MangaDex: يجلب دائماً بالعربي + الإنجليزي للحصول على كل الفصول ──
  const mdxTask = mdxId
    ? MangaDex.getChapters(mdxId, { langs: ["ar", "en"], ratings }).catch(() => [])
    : MangaDex.search(title, { limit: 5, ratings })
        .then(r => {
          const best = (r.length ? findBestMatch(title, r) || r[0] : null);
          return best ? MangaDex.getChapters(best._mdxId, { langs: ["ar", "en"], ratings }) : [];
        }).catch(() => []);
  tasks.push(mdxTask);

  // ── ComicK ──
  const ckTask = ckHid
    ? ComicK.getChapters(ckHid, { langs: ["ar", "en"] }).catch(() => [])
    : ComicK.search(title)
        .then(r => {
          const best = r.length ? findBestMatch(title, r) || r[0] : null;
          return best ? ComicK.getChapters(best._ckHid, { langs: ["ar", "en"] }) : [];
        }).catch(() => []);
  tasks.push(ckTask);

  // ── GManga ──
  tasks.push(
    gmId
      ? GManga.getChapters(gmId).catch(() => [])
      : GManga.search(title).then(r => {
          const best = r.length ? findBestMatch(title, r) || r[0] : null;
          return best ? GManga.getChapters(best._gmId) : [];
        }).catch(() => [])
  );

  // ── Madara: Tier 1 (يبحث دائماً) ──
  const madaraSources = hentaiMode ? HENTAI_MADARA_SOURCES : TIER1_ARABIC;
  if (madaraSlug && madaraSource) {
    tasks.push(madaraSource.getChapters(madaraSlug).catch(() => []));
    for (const src of madaraSources.filter(s => s.name !== madaraSource.name)) {
      tasks.push(src.search(title).then(r => {
        const b = r.length ? findBestMatch(title, r) || r[0] : null;
        return b ? src.getChapters(b._madaraSlug) : [];
      }).catch(() => []));
    }
  } else {
    for (const src of madaraSources) {
      tasks.push(src.search(title).then(r => {
        const b = r.length ? findBestMatch(title, r) || r[0] : null;
        return b ? src.getChapters(b._madaraSlug) : [];
      }).catch(() => []));
    }
  }

  // ── Madara: Tier 2 (بتوازٍ وبـ timeout أقصر) ──
  if (!hentaiMode) {
    for (const src of TIER2_ARABIC) {
      tasks.push(
        Promise.race([
          src.search(title).then(r => {
            const b = r.length ? findBestMatch(title, r) || r[0] : null;
            return b ? src.getChapters(b._madaraSlug) : [];
          }),
          new Promise(res => setTimeout(() => res([]), 12000))
        ]).catch(() => [])
      );
    }
  }

  // ── MangaSee (إنجليزي احتياطي) ──
  if (!hentaiMode) {
    tasks.push(
      MangaSee.search(title)
        .then(r => {
          const b = r.length ? findBestMatch(title, r) || r[0] : null;
          return b ? MangaSee.getChapters(b._msSlug) : [];
        }).catch(() => [])
    );
  }

  const results = await Promise.allSettled(tasks);
  const all = results.filter(r => r.status === "fulfilled").flatMap(r => r.value || []);
  return mergeChapters(all);
}

// ─── buildChapterList ─────────────────────────────────────────────────────────

function buildChapterList(mangaTitle, chapters, page) {
  const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);
  const start = page * CHAPTERS_PER_PAGE;
  const slice = chapters.slice(start, start + CHAPTERS_PER_PAGE);
  const arCount = chapters.filter(c => c.isAr).length;
  const enCount = chapters.length - arCount;
  const srcList = [...new Set(chapters.map(c => c.source))].join(" · ");

  let body = `📚 ${mangaTitle}\n`;
  body += `📖 ${chapters.length} فصل`;
  if (arCount > 0) body += ` · 🇸🇦 ${arCount} عربي`;
  if (enCount > 0 && arCount > 0) body += ` · 🇬🇧 ${enCount} إنجليزي`;
  body += ` · صفحة ${page + 1}/${totalPages}\n`;
  body += `📡 ${srcList}\n`;
  body += "━━━━━━━━━━━━━━━━━━\n\n";
  slice.forEach(ch => {
    const t = ch.title ? ` — ${ch.title.slice(0, 20)}` : "";
    body += `${ch.flag} فصل ${ch.num}${t}\n`;
  });
  body += "\n↩️ رد برقم الفصل للقراءة.";
  if (start + CHAPTERS_PER_PAGE < chapters.length) body += '\n↩️ "next" للصفحة التالية.';
  if (page > 0) body += '\n↩️ "prev" للصفحة السابقة.';
  return body;
}

// ─── getChapterImages ─────────────────────────────────────────────────────────

async function getChapterImages(chapter) {
  const errors = [];

  if (chapter._gmId) {
    try { const r = await GManga.getImages(chapter._gmId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`GManga: ${e.message?.slice(0, 50)}`); }
  }

  if (chapter._madaraUrl && chapter._madaraSource) {
    try { const r = await chapter._madaraSource.getImages(chapter._madaraUrl); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`${chapter._madaraSource.name}: ${e.message?.slice(0, 50)}`); }
  }

  if (chapter._dxId) {
    try { const r = await MangaDex.getImages(chapter._dxId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`MDX: ${e.message?.slice(0, 50)}`); }
    try { const r = await MangaDex.getImagesSaver(chapter._dxId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`MDX-saver: ${e.message?.slice(0, 50)}`); }
  }

  if (chapter._ckHid) {
    try { const r = await ComicK.getImages(chapter._ckHid); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`ComicK: ${e.message?.slice(0, 50)}`); }
  }

  if (chapter._msSlug && chapter._msChNum) {
    try { const r = await MangaSee.getImages(chapter._msSlug, chapter._msChNum); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`MangaSee: ${e.message?.slice(0, 50)}`); }
  }

  throw new Error(`⚠️ فشل تحميل فصل ${chapter.num}.\nالمصادر المجربة:\n${errors.slice(0, 5).join("\n")}`);
}

// ─── downloadPage ─────────────────────────────────────────────────────────────

async function downloadPage(url, filePath, referer, attempt = 0) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer", timeout: 45000,
      headers: { "Referer": referer || "https://mangadex.org", "User-Agent": UA, "Accept": "image/*,*/*;q=0.8" }
    });
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return true;
  } catch {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 1500)); return downloadPage(url, filePath, referer, attempt + 1); }
    return false;
  }
}

// ─── sendChapterPages (مع تقسيم الصور الطويلة) ───────────────────────────────

async function sendChapterPages(api, event, chapter, mangaTitle, chapters, currentIndex, commandName) {
  const { threadID } = event;
  const chNum = chapter.num;

  let waitMsgID = null;
  await new Promise(resolve => {
    api.sendMessage(
      `⏳ جاري تحميل ${chapter.flag} فصل ${chNum}\n📚 "${mangaTitle}"\n📡 ${chapter.source}`,
      threadID, (err, info) => { if (info) waitMsgID = info.messageID; resolve(); }
    );
  });

  try {
    fs.ensureDirSync(CACHE);
    const { urls: pages, referer } = await getChapterImages(chapter);
    if (!pages.length) throw new Error("لا توجد صور");

    // تحميل ومعالجة الصور (تقسيم الطويلة + ضغط)
    let allFiles = [];
    for (let j = 0; j < pages.length; j++) {
      const url = pages[j];
      const rawExt = path.extname(url.split("?")[0]).replace(".", "").toLowerCase();
      const ext = ["jpg", "jpeg", "png", "webp"].includes(rawExt) ? rawExt : "jpg";
      const filePath = path.join(CACHE, `pg_${Date.now()}_${j}.${ext}`);
      if (await downloadPage(url, filePath, referer)) {
        const processed = await processImage(filePath);
        allFiles.push(...processed);
      }
    }

    if (!allFiles.length) throw new Error("فشل تحميل الصور");

    const totalBatches = Math.ceil(allFiles.length / PAGE_BATCH);

    for (let i = 0; i < allFiles.length; i += PAGE_BATCH) {
      const batch = allFiles.slice(i, i + PAGE_BATCH);
      const bNum = Math.floor(i / PAGE_BATCH) + 1;
      const body =
        `${chapter.flag} ${mangaTitle} — فصل ${chNum}\n` +
        `🖼 الصور ${i + 1}–${i + batch.length} من ${allFiles.length}` +
        (totalBatches > 1 ? ` (جزء ${bNum}/${totalBatches})` : "") +
        `\n📡 ${chapter.source}`;

      await new Promise(resolve => {
        api.sendMessage(
          { body, attachment: batch.map(f => fs.createReadStream(f)) },
          threadID,
          () => { batch.forEach(f => { try { fs.unlinkSync(f); } catch {} }); resolve(); }
        );
      });
      await new Promise(r => setTimeout(r, 400));
    }

    if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch {}

    saveProgress(event.senderID, mangaTitle, chNum);

    const prev = currentIndex > 0 ? chapters[currentIndex - 1] : null;
    const next = chapters[currentIndex + 1];
    let nav = `✅ ${chapter.flag} فصل ${chNum} — "${mangaTitle}"\n📊 ${currentIndex + 1}/${chapters.length}\n\n`;
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
    if (waitMsgID) try { api.unsendMessage(waitMsgID); } catch {}
    throw e;
  }
}

// ─── handleReply ──────────────────────────────────────────────────────────────

async function handleReply({ api, event, Reply, commandName }) {
  const { threadID, messageID } = event;
  if (event.senderID !== Reply.author) return;
  const { state } = Reply;

  const findChapter = (input, chapters) => {
    const n = input.trim();
    return chapters.find(ch => String(ch.num) === n || String(ch.numF) === n || String(Math.floor(ch.numF)) === n);
  };

  if (state === "browse_chapters") {
    const { chapters, mangaTitle, page } = Reply;
    const input = event.body.trim().toLowerCase();
    const totalPages = Math.ceil(chapters.length / CHAPTERS_PER_PAGE);

    if (input === "next" || input === "التالي") {
      if (page + 1 >= totalPages) return api.sendMessage("❌ آخر صفحة.", threadID, messageID);
      const body = buildChapterList(mangaTitle, chapters, page + 1);
      api.sendMessage(body, threadID, (err, info) => {
        if (!err && info) global.GoatBot.onReply.set(info.messageID, { commandName, author: event.senderID, state: "browse_chapters", chapters, mangaTitle, page: page + 1, messageID: info.messageID });
      });
      try { api.unsendMessage(Reply.messageID); } catch {}
      return;
    }
    if (input === "prev" || input === "السابق") {
      if (page <= 0) return api.sendMessage("❌ أول صفحة.", threadID, messageID);
      const body = buildChapterList(mangaTitle, chapters, page - 1);
      api.sendMessage(body, threadID, (err, info) => {
        if (!err && info) global.GoatBot.onReply.set(info.messageID, { commandName, author: event.senderID, state: "browse_chapters", chapters, mangaTitle, page: page - 1, messageID: info.messageID });
      });
      try { api.unsendMessage(Reply.messageID); } catch {}
      return;
    }

    const chapter = findChapter(event.body, chapters);
    if (!chapter) return api.sendMessage(`❌ الفصل "${event.body.trim()}" غير موجود.`, threadID, messageID);
    const idx = chapters.indexOf(chapter);
    try {
      await sendChapterPages(api, event, chapter, mangaTitle, chapters, idx, commandName);
      try { api.unsendMessage(Reply.messageID); } catch {}
    } catch (e) {
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
        const n = event.body.trim();
        return String(ch.num) === n || String(ch.numF) === n || String(Math.floor(ch.numF)) === n;
      });
      if (found !== -1) targetIndex = found;
    }
    if (targetIndex < 0 || targetIndex >= chapters.length)
      return api.sendMessage("❌ لا يوجد فصل.", threadID, messageID);
    try {
      await sendChapterPages(api, event, chapters[targetIndex], mangaTitle, chapters, targetIndex, commandName);
      try { api.unsendMessage(Reply.messageID); } catch {}
    } catch (e) {
      api.sendMessage("❌ خطأ في تحميل الفصل.", threadID, messageID);
    }
  }
}

module.exports = {
  MangaDex, GManga, ComicK, MangaSee,
  Mangalek, Asq3, MangaSwat, ArTeamManga, MangaAE,
  TeamX, GalaxyManga, OzulScans, PerfectMng, ArabsManga,
  KelManga, MangaArab, Onimanga, MangaKey, WeManga, FlixManga,
  IManga, KolManga, Manga4Ever, Hamasa10, MgToon, Manga4up,
  ArabMangaI, MangaGatos, AzManga, R2Manga, ShoujoManga, Manga4ar,
  LightManga, MangaLion, Hentaimama, Manhwa18, Hentai3z,
  ARABIC_MADARA_SOURCES, HENTAI_MADARA_SOURCES, TIER1_ARABIC, TIER2_ARABIC, MadaraSource,
  mergeChapters, fetchAllChapters, findBestMatch,
  buildChapterList, sendChapterPages, handleReply,
  loadProgress, saveProgress, getLangFlag, getStatusLabel,
  CHAPTERS_PER_PAGE, PAGE_BATCH, CACHE
};
