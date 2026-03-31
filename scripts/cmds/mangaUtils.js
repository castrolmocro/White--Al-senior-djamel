const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const CACHE = path.join(__dirname, "cache");
const PROGRESS_FILE = path.join(CACHE, "manga_progress.json");
const CHAPTER_CACHE_FILE = path.join(CACHE, "manga_chapter_cache.json");
const CHAPTERS_PER_PAGE = 25;
const PAGE_BATCH = 8;
const CHAPTER_CACHE_TTL = 30 * 60 * 1000; // 30 دقيقة

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

// ─── Chapter Cache (لتجنب طلبات API متكررة) ──────────────────────────────────

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
    fr: "🇫🇷", es: "🇪🇸", tr: "🇹🇷", ru: "🇷🇺", de: "🇩🇪", id: "🇮🇩"
  }[lang] || `[${lang}]`;
}

function getStatusLabel(s) {
  return {
    ongoing: "مستمرة 🟢", completed: "مكتملة ✅",
    hiatus: "متوقفة ⏸", cancelled: "ملغاة ❌"
  }[s] || (s || "—");
}

// ─── HTTP Helper مع retry ─────────────────────────────────────────────────────

async function httpGet(url, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, { timeout: 18000, headers: { "User-Agent": UA }, ...opts });
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

async function httpPost(url, data, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.post(url, data, { timeout: 18000, headers: { "User-Agent": UA }, ...opts });
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

// ─── SOURCE 1: MangaDex (عربي + إنجليزي) ─────────────────────────────────────

const MangaDex = {
  name: "MangaDex",
  base: "https://api.mangadex.org",

  async search(query, { ratings = ["safe", "suggestive", "erotica", "pornographic"], origLangs = [], limit = 15 } = {}) {
    try {
      const p = new URLSearchParams();
      p.set("title", query); p.set("limit", limit);
      p.set("order[relevance]", "desc");
      p.append("includes[]", "cover_art");
      ratings.forEach(r => p.append("contentRating[]", r));
      origLangs.forEach(l => p.append("originalLanguage[]", l));
      const res = await httpGet(`${this.base}/manga?${p}`);
      return (res.data.data || []).map(m => ({
        _mdxId: m.id,
        source: "MangaDex",
        title: (() => { const t = m.attributes.title; return t.ar || t.en || t["ja-ro"] || t["ko-ro"] || Object.values(t)[0] || "Unknown"; })(),
        status: m.attributes.status,
        lastChapter: m.attributes.lastChapter,
        availableLangs: m.attributes.availableTranslatedLanguages || [],
        originalLang: m.attributes.originalLanguage,
        tags: (m.attributes.tags || []).filter(t => t.attributes.group === "genre").map(t => t.attributes.name.en || Object.values(t.attributes.name)[0]).slice(0, 5),
        description: (m.attributes.description?.ar || m.attributes.description?.en || "").replace(/<[^>]+>/g, "").slice(0, 200)
      }));
    } catch (e) { console.log("[MDX:search]", e.message?.slice(0, 60)); return []; }
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
        await new Promise(r => setTimeout(r, 300));
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
        if (!chapter?.data?.length) throw new Error("no pages");
        return { urls: chapter.data.map(f => `${baseUrl}/data/${chapter.hash}/${f}`), referer: "https://mangadex.org" };
      } catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 1500)); }
    }
  }
};

// ─── SOURCE 2: GManga (عربي — الأولوية القصوى) ───────────────────────────────

const GManga = {
  name: "GManga",
  base: "https://gmanga.org/api",
  headers: { "User-Agent": UA, "Accept": "application/json", "Origin": "https://gmanga.org", "Referer": "https://gmanga.org/" },

  async search(query) {
    const endpoints = [
      { method: "post", url: `${this.base}/mangas/search`, data: { search: query } },
      { method: "get",  url: `${this.base}/mangas`,        data: null, params: { search: query } },
      { method: "get",  url: `${this.base}/search`,        data: null, params: { query } }
    ];
    for (const ep of endpoints) {
      try {
        const res = ep.method === "post"
          ? await httpPost(ep.url, ep.data, { headers: this.headers })
          : await httpGet(ep.url, { headers: this.headers, params: ep.params });
        const list = res.data?.mangas || res.data?.data || (Array.isArray(res.data) ? res.data : []);
        if (list.length) return list.slice(0, 8).map(m => ({
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

    const endpoints = [
      `${this.base}/mangas/${mangaId}/releases`,
      `${this.base}/mangas/${mangaId}/chapters`,
      `${this.base}/chapters?manga_id=${mangaId}`
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
      const res = await httpGet(`${this.base}/v1.0/search`, { params: { q: query, limit: 15 } });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      return list.map(m => ({
        _ckHid: m.hid, source: "ComicK",
        title: m.title || m.slug || "Unknown",
        status: m.status,
        availableLangs: Array.isArray(m.iso2) ? m.iso2 : []
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
          const res = await httpGet(`${this.base}/comic/${hid}/chapters`, { params: { lang, limit: 300, page } });
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
          if (chapters.length < 300) break;
          page++;
          await new Promise(r => setTimeout(r, 200));
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

// ─── SOURCE 4: Madara (نظام موحد لمواقع WordPress عربية) ─────────────────────
// يعمل مع: mangalek.com · 3asq.org · arteammanga.com · mangaswat.com وغيرها

class MadaraSource {
  constructor({ name, base, lang = "ar" }) {
    this.name = name;
    this.base = base.replace(/\/$/, "");
    this.lang = lang;
    this.headers = {
      "User-Agent": UA,
      "Referer": base + "/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en;q=0.5"
    };
    this.ajaxHeaders = { ...this.headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" };
  }

  async search(query) {
    try {
      // طريقة 1: AJAX madara
      const form = new URLSearchParams();
      form.set("action", "madara_read_manga_data");
      form.set("page", "1");
      form.set("vars[s]", query);
      form.set("vars[paged]", "1");
      const res = await httpPost(`${this.base}/wp-admin/admin-ajax.php`, form.toString(), { headers: this.ajaxHeaders });
      const html = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      return this._parseSearchHTML(html, query);
    } catch {
      try {
        // طريقة 2: URL search
        const res = await httpGet(`${this.base}/?s=${encodeURIComponent(query)}&post_type=wp-manga`, { headers: this.headers });
        return this._parseSearchHTML(res.data, query);
      } catch (e) {
        console.log(`[${this.name}:search]`, e.message?.slice(0, 50));
        return [];
      }
    }
  }

  _parseSearchHTML(html, query) {
    const results = [];
    const titleRe = /<div class="post-title[^"]*"[^>]*>[\s\S]*?<(?:h3|h4)[^>]*>\s*(?:<a[^>]*>)?\s*([^<\n]+)/gi;
    const slugRe = /href="([^"]+\/manga\/[^/"]+\/?)[^"]*"/gi;
    const slugRe2 = /href="(https?:\/\/[^"]+\/[^/"]+\/?)"/gi;

    const slugs = [];
    let m;
    while ((m = slugRe.exec(html)) !== null) slugs.push(m[1]);
    if (!slugs.length) {
      while ((m = slugRe2.exec(html)) !== null) {
        const url = m[1];
        if (!url.includes("?") && !url.includes("#") && url !== this.base + "/")
          slugs.push(url);
      }
    }

    const slugSet = [...new Set(slugs)].slice(0, 8);
    slugSet.forEach((slug, i) => {
      const slugPart = slug.replace(/\/$/, "").split("/").pop();
      results.push({
        _madaraSlug: slug,
        _madaraSource: this,
        source: this.name,
        title: slugPart.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        hasAr: true
      });
    });
    return results;
  }

  async getChapters(mangaSlug) {
    const cacheKey = `madara_${this.name}_${mangaSlug}`;
    const cached = getCachedChapters(cacheKey);
    if (cached) return cached;

    try {
      // جلب ID المانغا أولاً
      const page = await httpGet(mangaSlug, { headers: this.headers });
      const idMatch = page.data.match(/(?:data-id|manga-id|post_id|manga_id)['":\s]+(\d+)/i);
      const mangaId = idMatch?.[1];

      let chapters = [];

      if (mangaId) {
        // طريقة AJAX
        const form = new URLSearchParams();
        form.set("action", "manga_get_chapters");
        form.set("manga", mangaId);
        try {
          const res = await httpPost(`${this.base}/wp-admin/admin-ajax.php`, form.toString(), { headers: this.ajaxHeaders });
          chapters = this._parseChapterListHTML(typeof res.data === "string" ? res.data : JSON.stringify(res.data), mangaSlug);
        } catch {}
      }

      // إذا فشل AJAX، حلل الصفحة مباشرة
      if (!chapters.length) {
        chapters = this._parseChapterListHTML(page.data, mangaSlug);
      }

      setCachedChapters(cacheKey, chapters);
      return chapters;
    } catch (e) {
      console.log(`[${this.name}:chapters]`, e.message?.slice(0, 50));
      return [];
    }
  }

  _parseChapterListHTML(html, mangaSlug) {
    const chapters = [];
    const seen = new Set();

    // نمط شائع في مواقع Madara
    const patterns = [
      /href="([^"]+chapter[^"]+)"[^>]*>[^<]*(?:chapter|فصل|الفصل)\s*([\d.]+)/gi,
      /href="([^"]+\/(?:chapter|ch|الفصل)-?([\d.]+)[^"]*)"[^>]*>/gi,
      /<a[^>]+href="([^"]+)"[^>]*>[^<]*(?:chapter|الفصل|فصل)\s*([\d.]+)/gi
    ];

    for (const re of patterns) {
      let m;
      while ((m = re.exec(html)) !== null) {
        const url = m[1];
        const num = m[2];
        if (!num || seen.has(num)) continue;
        seen.add(num);
        chapters.push({
          num: String(parseFloat(num)),
          numF: parseFloat(num),
          title: "",
          lang: this.lang, isAr: this.lang === "ar",
          source: this.name, priority: this.lang === "ar" ? 3 : 1,
          _madaraUrl: url,
          _madaraSource: this
        });
      }
      if (chapters.length > 0) break;
    }

    return chapters.sort((a, b) => a.numF - b.numF);
  }

  async getImages(chapterUrl) {
    try {
      // طريقة 1: صفحة القراءة العادية
      const res = await httpGet(chapterUrl, { headers: this.headers });
      const html = res.data;

      // ابحث عن مصفوفة الصور في JavaScript
      const patterns = [
        /chapter_preloaded_images\s*=\s*(\[[^\]]+\])/,
        /var\s+images\s*=\s*(\[[^\]]+\])/,
        /chapImages\s*=\s*'([^']+)'/,
        /"images"\s*:\s*(\[[^\]]+\])/
      ];

      for (const re of patterns) {
        const match = html.match(re);
        if (match) {
          try {
            let urls = JSON.parse(match[1]);
            if (typeof urls[0] === "object") urls = urls.map(u => u.url || u.src);
            urls = urls.filter(u => u && u.startsWith("http"));
            if (urls.length) return { urls, referer: this.base + "/" };
          } catch {}
        }
      }

      // chapImages كنص مفصول بفواصل
      const chapMatch = html.match(/chapImages\s*=\s*'([^']+)'/);
      if (chapMatch) {
        const urls = chapMatch[1].split(",").filter(u => u.startsWith("http"));
        if (urls.length) return { urls, referer: this.base + "/" };
      }

      // استخراج img tags مباشرة
      const imgRe = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+(?:\.jpg|\.jpeg|\.png|\.webp)[^"]*)"/gi;
      const urls = [];
      let im;
      while ((im = imgRe.exec(html)) !== null) {
        const u = im[1];
        if (!urls.includes(u)) urls.push(u);
      }
      if (urls.length > 2) return { urls, referer: this.base + "/" };

      throw new Error("لم يتم العثور على صور");
    } catch (e) {
      console.log(`[${this.name}:images]`, e.message?.slice(0, 50));
      throw e;
    }
  }
}

// ─── تهيئة مصادر Madara العربية ───────────────────────────────────────────────

const Mangalek = new MadaraSource({ name: "Mangalek", base: "https://mangalek.com" });
const Asq3 = new MadaraSource({ name: "3asq", base: "https://3asq.org" });
const MangaSwat = new MadaraSource({ name: "MangaSwat", base: "https://mangaswat.com" });
const ArTeamManga = new MadaraSource({ name: "ArTeam", base: "https://arteamone.com" });
const MangaAE = new MadaraSource({ name: "MangaAE", base: "https://manga.ae" });

// قائمة كل المصادر العربية Madara
const ARABIC_MADARA_SOURCES = [Mangalek, Asq3, MangaSwat, ArTeamManga, MangaAE];

// ─── SOURCE 5: Webtoons (ويبتون العربي) ──────────────────────────────────────

const Webtoons = {
  name: "Webtoons",
  base: "https://www.webtoons.com",

  async search(query) {
    try {
      const res = await httpGet(`${this.base}/en/search`, {
        params: { keyword: query },
        headers: { "User-Agent": UA }
      });
      const html = res.data;
      const results = [];
      const re = /href="(https:\/\/www\.webtoons\.com\/(?:ar|en)\/[^"]+\/([^"\/]+)\/list[^"]+)"[^>]*>[\s\S]*?<p class="[^"]*title[^"]*"[^>]*>([^<]+)/gi;
      let m;
      while ((m = re.exec(html)) !== null && results.length < 8) {
        results.push({
          _webtoonUrl: m[1],
          source: "Webtoons",
          title: m[3].trim(),
          hasAr: m[1].includes("/ar/"),
          lang: m[1].includes("/ar/") ? "ar" : "en"
        });
      }
      return results;
    } catch { return []; }
  }
};

// ─── Chapter Merger ───────────────────────────────────────────────────────────
// الأولوية لكل فصل: GManga/Madara(AR)=3 > MDX(AR)=2 = ComicK(AR)=2 > إنجليزي=1

function mergeChapters(allChapters) {
  const map = new Map();
  for (const ch of allChapters) {
    const existing = map.get(ch.num);
    if (!existing || ch.priority > existing.priority) {
      map.set(ch.num, {
        num: ch.num, numF: ch.numF,
        flag: ch.isAr ? "🇸🇦" : getLangFlag(ch.lang),
        isAr: ch.isAr, title: ch.title || "",
        source: ch.source, lang: ch.lang,
        _dxId: ch._dxId || null,
        _gmId: ch._gmId || null,
        _ckHid: ch._ckHid || null,
        _madaraUrl: ch._madaraUrl || null,
        _madaraSource: ch._madaraSource || null
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.numF - b.numF);
}

// ─── جلب الفصول من كل المصادر ────────────────────────────────────────────────

async function fetchAllChapters(title, mdxId, ckHid, opts = {}) {
  const { ratings, langs = ["ar", "en"] } = opts;
  const tasks = [];

  // MangaDex
  if (mdxId) {
    tasks.push(MangaDex.getChapters(mdxId, { langs, ratings }).catch(() => []));
  } else {
    tasks.push(
      MangaDex.search(title, { limit: 3, ratings })
        .then(r => r.length ? MangaDex.getChapters(r[0]._mdxId, { langs, ratings }) : [])
        .catch(() => [])
    );
  }

  // ComicK
  if (ckHid) {
    tasks.push(ComicK.getChapters(ckHid, { langs }).catch(() => []));
  } else {
    tasks.push(
      ComicK.search(title)
        .then(r => r.length ? ComicK.getChapters(r[0]._ckHid, { langs }) : [])
        .catch(() => [])
    );
  }

  // GManga
  tasks.push(
    GManga.search(title)
      .then(r => r.length ? GManga.getChapters(r[0]._gmId) : [])
      .catch(() => [])
  );

  // المصادر العربية Madara — يبحث فيهم بالتوازي
  for (const src of ARABIC_MADARA_SOURCES) {
    tasks.push(
      src.search(title)
        .then(r => r.length ? src.getChapters(r[0]._madaraSlug) : [])
        .catch(() => [])
    );
  }

  const results = await Promise.allSettled(tasks);
  const all = results.filter(r => r.status === "fulfilled").flatMap(r => r.value);
  return mergeChapters(all);
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

  // ترتيب: GManga > Madara عربي > MangaDex > ComicK
  if (chapter._gmId) {
    try { const r = await GManga.getImages(chapter._gmId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`GManga: ${e.message}`); }
  }
  if (chapter._madaraUrl && chapter._madaraSource) {
    try { const r = await chapter._madaraSource.getImages(chapter._madaraUrl); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`${chapter._madaraSource.name}: ${e.message}`); }
  }
  if (chapter._dxId) {
    try { const r = await MangaDex.getImages(chapter._dxId); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`MDX: ${e.message}`); }
  }
  if (chapter._ckHid) {
    try { const r = await ComicK.getImages(chapter._ckHid); if (r?.urls?.length) return r; }
    catch (e) { errors.push(`ComicK: ${e.message}`); }
  }

  throw new Error(`فشلت كل المصادر:\n${errors.slice(0, 3).join("\n")}`);
}

// ─── Page Downloader ──────────────────────────────────────────────────────────

async function downloadPage(url, filePath, referer, attempt = 0) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer", timeout: 35000,
      headers: { "Referer": referer || "https://mangadex.org", "User-Agent": UA }
    });
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return true;
  } catch (e) {
    if (attempt < 2) { await new Promise(r => setTimeout(r, 1200)); return downloadPage(url, filePath, referer, attempt + 1); }
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

    const chapter = chapters.find(ch => String(ch.num) === input);
    if (!chapter) return api.sendMessage(`❌ الفصل "${input}" غير موجود في القائمة.`, threadID, messageID);

    const idx = chapters.indexOf(chapter);
    try {
      await sendChapterPages(api, event, chapter, mangaTitle, chapters, idx, commandName);
      try { api.unsendMessage(Reply.messageID); } catch (_) {}
    } catch (e) {
      console.error(`[${commandName}:pages]`, e.message);
      api.sendMessage(`❌ خطأ في تحميل الفصل:\n${e.message?.slice(0, 120)}`, threadID, messageID);
    }

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
      console.error(`[${commandName}:navigate]`, e.message);
      api.sendMessage("❌ خطأ في تحميل الفصل.", threadID, messageID);
    }
  }
}

module.exports = {
  MangaDex, GManga, ComicK, Mangalek, Asq3, MangaSwat, ArTeamManga, MangaAE,
  ARABIC_MADARA_SOURCES, MadaraSource, Webtoons,
  mergeChapters, fetchAllChapters,
  buildChapterList, sendChapterPages, handleReply,
  loadProgress, saveProgress,
  getLangFlag, getStatusLabel,
  CHAPTERS_PER_PAGE, PAGE_BATCH, CACHE
};
