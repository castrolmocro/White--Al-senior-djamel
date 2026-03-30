const fs     = require("fs-extra");
const path   = require("path");
const axios  = require("axios");
const ytSearch = require("yt-search");
const ytdl   = require("@distube/ytdl-core");

const CACHE_DIR  = path.join(__dirname, "cache");
const MAX_BYTES  = 24 * 1024 * 1024; // 24 MB — حد فيسبوك للملفات

// ─────────────────────────────────────────
// بحث عن أشهر فيديو مطابق للاستعلام
// ─────────────────────────────────────────
async function findBestVideo(query, channelHint) {
  const result = await ytSearch(query);
  let videos = (result.videos || []).filter(v => v.url && v.videoId);
  if (!videos.length) return null;

  // تصفية بالقناة إذا طُلب ذلك
  if (channelHint) {
    const hint = channelHint.toLowerCase().trim();
    const filtered = videos.filter(v =>
      (v.author?.name || "").toLowerCase().includes(hint)
    );
    if (filtered.length > 0) videos = filtered;
  }

  // الأكثر مشاهدة أولاً
  videos.sort((a, b) => (b.views || 0) - (a.views || 0));
  return videos[0];
}

// ─────────────────────────────────────────
// اختيار أفضل صيغة للتنزيل (فيديو+صوت معاً)
// ─────────────────────────────────────────
function pickFormat(formats) {
  const combined = formats.filter(f =>
    f.hasVideo && f.hasAudio &&
    (f.container === "mp4" || (f.mimeType || "").includes("mp4"))
  );

  // رتّب من الأعلى جودة للأقل
  combined.sort((a, b) => {
    const qa = parseInt((a.qualityLabel || "0")) || 0;
    const qb = parseInt((b.qualityLabel || "0")) || 0;
    return qb - qa;
  });

  // اختر أعلى جودة لا يتجاوز حجمها 24 ميغابايت
  for (const fmt of combined) {
    const size = parseInt(fmt.contentLength || 0);
    if (!size || size <= MAX_BYTES) return fmt;
  }

  // إذا فشل التقدير بالحجم → خذ أقل جودة متاحة (أصغر حجماً)
  return combined[combined.length - 1] || null;
}

// ─────────────────────────────────────────
// تنزيل الفيديو وحفظه مؤقتاً
// ─────────────────────────────────────────
async function downloadVideo(videoUrl, outputPath) {
  const info    = await ytdl.getInfo(videoUrl);
  const format  = pickFormat(info.formats);
  if (!format) throw new Error("NO_FORMAT");

  await new Promise((resolve, reject) => {
    const stream = ytdl(videoUrl, { format });
    const file   = fs.createWriteStream(outputPath);
    stream.pipe(file);
    file.on("finish", resolve);
    file.on("error",  reject);
    stream.on("error", reject);
  });

  return { format, info };
}

// ─────────────────────────────────────────
// تنزيل بديل عبر cobalt.tools إذا فشل ytdl
// ─────────────────────────────────────────
async function downloadFallback(videoUrl, outputPath) {
  const resp = await axios.post(
    "https://api.cobalt.tools/",
    { url: videoUrl, vCodec: "h264", vQuality: "360", filenameStyle: "basic" },
    {
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      timeout: 20000
    }
  );

  const dlUrl = resp.data?.url;
  if (!dlUrl) throw new Error("COBALT_FAIL");

  const file = await axios.get(dlUrl, { responseType: "arraybuffer", timeout: 60000 });
  await fs.writeFile(outputPath, file.data);
}

// ─────────────────────────────────────────
// رسالة معلومات الفيديو
// ─────────────────────────────────────────
function buildInfoText(video, qualityLabel) {
  const views    = (video.views || 0).toLocaleString();
  const duration = video.timestamp  || "غير معروف";
  const channel  = video.author?.name || "غير معروف";
  const quality  = qualityLabel || "360p";

  return (
    `🎬 ${video.title}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📺 القناة   : ${channel}\n` +
    `⏱️ المدة    : ${duration}\n` +
    `👁️ المشاهدات: ${views}\n` +
    `🎞️ الجودة   : ${quality}\n` +
    `🔗 الرابط   : ${video.url}`
  );
}

// ─────────────────────────────────────────
// المنطق الرئيسي للبحث والتنزيل والإرسال
// ─────────────────────────────────────────
async function handleSearch(api, event, rawQuery) {
  const tid = event.threadID;
  const mid = event.messageID;

  // تحليل الاستعلام: "قناة | عنوان"  أو  "عنوان"
  let channelHint = null, searchQuery = rawQuery.trim();
  if (rawQuery.includes("|")) {
    const parts  = rawQuery.split("|");
    channelHint  = parts[0].trim();
    searchQuery  = parts.slice(1).join("|").trim();
  }

  // ── البحث ──
  const statusMsg = await api.sendMessage(
    `🔍 جاري البحث عن: "${searchQuery}"${channelHint ? `\n📺 في قناة: "${channelHint}"` : ""}`,
    tid
  );

  const video = await findBestVideo(searchQuery, channelHint).catch(() => null);
  try { api.unsendMessage(statusMsg.messageID); } catch (_) {}

  if (!video) {
    return api.sendMessage(
      `❌ لم يُعثر على أي فيديو مطابق لـ: "${searchQuery}"`,
      tid, mid
    );
  }

  // ── التنزيل ──
  const dlMsg = await api.sendMessage(
    `⏬ جاري تنزيل الفيديو...\n🎬 ${video.title}`,
    tid
  );

  await fs.ensureDir(CACHE_DIR);
  const safeName  = `${video.videoId}.mp4`;
  const filePath  = path.join(CACHE_DIR, safeName);

  let qualityLabel = "360p";
  let usedFallback = false;

  try {
    const { format } = await downloadVideo(video.url, filePath);
    qualityLabel = format.qualityLabel || "360p";
  } catch (_) {
    try {
      await downloadFallback(video.url, filePath);
      usedFallback = true;
    } catch (e2) {
      try { api.unsendMessage(dlMsg.messageID); } catch (_) {}
      return api.sendMessage(
        `❌ فشل تنزيل الفيديو.\n🔗 يمكنك مشاهدته مباشرة:\n${video.url}`,
        tid, mid
      );
    }
  }

  try { api.unsendMessage(dlMsg.messageID); } catch (_) {}

  // ── الإرسال ──
  const infoText = buildInfoText(video, usedFallback ? "360p" : qualityLabel);
  await api.sendMessage(
    { body: infoText, attachment: fs.createReadStream(filePath) },
    tid,
    () => { fs.remove(filePath).catch(() => {}); },
    mid
  );
}

// ═════════════════════════════════════════
// تصدير الأمر
// ═════════════════════════════════════════
module.exports = {
  config: {
    name: "video",
    aliases: ["vid", "v"],
    version: "2.0",
    author: "GoatBot",
    countDown: 10,
    role: 0,
    shortDescription: "تنزيل فيديو من يوتيوب",
    longDescription: "يبحث عن أشهر فيديو مطابق في يوتيوب ويرسله مباشرة",
    category: "media",
    guide: {
      en: "{pn} <عنوان الفيديو>\n"
        + "{pn} <اسم القناة> | <عنوان الفيديو>\n"
        + "أو اكتب {pn} وحده وسيطلب منك الاستعلام"
    }
  },

  // ── الأمر ──
  onStart: async function ({ api, event, args }) {
    const tid = event.threadID;
    const mid = event.messageID;

    // إذا لم يُعطَ استعلام → اطلبه عبر onReply
    if (!args.length) {
      const prompt = await api.sendMessage(
        `🎬 أرسل عنوان الفيديو الذي تريده.\n\n` +
        `📌 الصيغ المدعومة:\n` +
        `• عنوان الفيديو فقط\n` +
        `• اسم القناة | عنوان الفيديو\n\n` +
        `مثال: MrBeast | Extreme Survival\n` +
        `مثال: شاهد نت | مسلسل`,
        tid, mid
      );

      global.GoatBot.onReply.set(prompt.messageID, {
        commandName: this.config.name,
        author: event.senderID,
        type: "awaitQuery"
      });
      return;
    }

    await handleSearch(api, event, args.join(" "));
  },

  // ── الرد على طلب الاستعلام ──
  onReply: async function ({ api, event, Reply }) {
    if (event.senderID !== Reply.author) return;

    global.GoatBot.onReply.delete(event.messageReply.messageID);
    try { api.unsendMessage(event.messageReply.messageID); } catch (_) {}

    if (Reply.type === "awaitQuery") {
      const query = event.body?.trim();
      if (!query) {
        return api.sendMessage("❌ لم تكتب شيئاً. أعد المحاولة بكتابة /video", event.threadID, event.messageID);
      }
      await handleSearch(api, event, query);
    }
  }
};
