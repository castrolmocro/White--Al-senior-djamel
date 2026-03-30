const fs        = require("fs-extra");
const path      = require("path");
const axios     = require("axios");
const { spawn } = require("child_process");
const ytSearch  = require("yt-search");

// ─────────────────────────────────────────
// إعدادات عامة
// ─────────────────────────────────────────
const TMP_DIR    = process.env.RAILWAY_ENVIRONMENT ? "/tmp/ytbot" : path.join(__dirname, "cache");
const MAX_MB     = 90;
const MAX_BYTES  = MAX_MB * 1024 * 1024;
const DL_TIMEOUT = 8 * 60 * 1000;  // 8 دقائق

// اختيار الجودة بناءً على مدة الفيديو (للبقاء تحت 90 ميغابايت)
function qualityForDuration(durationSecs) {
  if (!durationSecs)        return "480";
  if (durationSecs <  5*60) return "720";   // < 5 دقائق
  if (durationSecs < 15*60) return "480";   // < 15 دقيقة
  if (durationSecs < 40*60) return "360";   // < 40 دقيقة
  return "240";                              // فيديوهات طويلة جداً
}

// ─────────────────────────────────────────
// بحث يوتيوب
// ─────────────────────────────────────────
async function findBestVideo(query, channelHint) {
  const result = await ytSearch(query);
  let videos   = (result.videos || []).filter(v => v.url && v.videoId);
  if (!videos.length) return null;

  if (channelHint) {
    const hint     = channelHint.toLowerCase().trim();
    const filtered = videos.filter(v =>
      (v.author?.name || "").toLowerCase().includes(hint)
    );
    if (filtered.length > 0) videos = filtered;
  }

  videos.sort((a, b) => (b.views || 0) - (a.views || 0));
  return videos[0];
}

// ─────────────────────────────────────────
// التنزيل بـ yt-dlp (الأكثر موثوقية)
// ─────────────────────────────────────────
function downloadWithYtDlp(videoUrl, outputPath, quality) {
  return new Promise((resolve, reject) => {
    // صيغة الاختيار: فيديو + صوت مع حد جودة + fallback لأي صيغة متاحة
    const formatStr =
      `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]` +
      `/bestvideo[height<=${quality}]+bestaudio` +
      `/best[height<=${quality}]` +
      `/best`;

    const args = [
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "-f", formatStr,
      "--merge-output-format", "mp4",
      "--max-filesize", `${MAX_MB}M`,
      "--socket-timeout", "30",
      "--retries", "3",
      "-o", outputPath,
      videoUrl
    ];

    const proc   = spawn("yt-dlp", args);
    const timer  = setTimeout(() => { proc.kill(); reject(new Error("TIMEOUT")); }, DL_TIMEOUT);
    let   stderr = "";

    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.stdout.on("data", () => {});

    proc.on("close", code => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // yt-dlp exit 1 يمكن أن يكون بسبب max-filesize → نتحقق
      if (stderr.includes("File is larger than max-filesize")) {
        return reject(new Error("TOO_LARGE"));
      }
      reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-400)}`));
    });

    proc.on("error", e => { clearTimeout(timer); reject(e); });
  });
}

// ─────────────────────────────────────────
// تنزيل بديل — cobalt.tools API
// ─────────────────────────────────────────
async function downloadCobalt(videoUrl, outputPath, quality) {
  const resp = await axios.post(
    "https://api.cobalt.tools/",
    {
      url:           videoUrl,
      vCodec:        "h264",
      vQuality:      quality,
      filenameStyle: "basic",
      isNoTTWatermark: true
    },
    {
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      timeout: 30000
    }
  );

  const dlUrl = resp.data?.url;
  if (!dlUrl) throw new Error("COBALT_NO_URL");

  const response = await axios.get(dlUrl, {
    responseType: "stream",
    timeout:      DL_TIMEOUT
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    let   size   = 0;
    response.data.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        response.data.destroy();
        writer.destroy();
        reject(new Error("TOO_LARGE"));
      }
    });
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error",  reject);
  });
}

// ─────────────────────────────────────────
// تحقق من وجود yt-dlp في النظام
// ─────────────────────────────────────────
function checkYtDlp() {
  return new Promise(resolve => {
    const p = spawn("yt-dlp", ["--version"]);
    p.on("close", code => resolve(code === 0));
    p.on("error", ()   => resolve(false));
  });
}

// ─────────────────────────────────────────
// بناء رسالة المعلومات
// ─────────────────────────────────────────
function buildInfoText(video, quality, sizeMB) {
  const views    = (video.views || 0).toLocaleString();
  const duration = video.timestamp || "غير معروف";
  const channel  = video.author?.name || "غير معروف";
  const sizeStr  = sizeMB ? ` — ${sizeMB} MB` : "";

  return (
    `🎬 ${video.title}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📺 القناة    : ${channel}\n` +
    `⏱️ المدة     : ${duration}\n` +
    `👁️ المشاهدات : ${views}\n` +
    `🎞️ الجودة    : ${quality}p${sizeStr}\n` +
    `🔗 الرابط    : ${video.url}`
  );
}

// ─────────────────────────────────────────
// المنطق الرئيسي
// ─────────────────────────────────────────
async function handleSearch(api, event, rawQuery) {
  const tid = event.threadID;
  const mid = event.messageID;

  // تحليل "قناة | عنوان" أو "عنوان"
  let channelHint = null, searchQuery = rawQuery.trim();
  if (rawQuery.includes("|")) {
    const [ch, ...rest] = rawQuery.split("|");
    channelHint  = ch.trim();
    searchQuery  = rest.join("|").trim();
  }

  // ── البحث ──
  const searchMsg = await api.sendMessage(
    `🔍 جاري البحث عن: "${searchQuery}"` +
    (channelHint ? `\n📺 القناة: "${channelHint}"` : ""),
    tid
  );

  const video = await findBestVideo(searchQuery, channelHint).catch(() => null);
  try { api.unsendMessage(searchMsg.messageID); } catch (_) {}

  if (!video) {
    return api.sendMessage(`❌ لم يُعثر على فيديو مطابق لـ: "${searchQuery}"`, tid, mid);
  }

  // احسب الجودة المناسبة بناءً على مدة الفيديو
  const quality = qualityForDuration(video.seconds || 0);

  // ── التنزيل ──
  const dlMsg = await api.sendMessage(
    `⏬ جاري التنزيل (${quality}p)...\n🎬 ${video.title}\n⏱️ المدة: ${video.timestamp || "غير معروف"}`,
    tid
  );

  await fs.ensureDir(TMP_DIR);
  const outputPath = path.join(TMP_DIR, `${video.videoId}_${Date.now()}.mp4`);

  let   success   = false;
  let   usedQuality = quality;

  // ── المحاولة الأولى: yt-dlp ──
  const ytDlpAvail = await checkYtDlp();
  if (ytDlpAvail) {
    try {
      await downloadWithYtDlp(video.url, outputPath, quality);
      success = true;
    } catch (e) {
      if (e.message === "TOO_LARGE") {
        // جرب جودة أقل
        const lower = quality === "720" ? "480" : quality === "480" ? "360" : "240";
        try {
          await downloadWithYtDlp(video.url, outputPath, lower);
          usedQuality = lower;
          success = true;
        } catch (_) {}
      }
    }
  }

  // ── المحاولة الثانية: cobalt.tools ──
  if (!success) {
    try {
      await downloadCobalt(video.url, outputPath, quality);
      success = true;
    } catch (_) {}
  }

  try { api.unsendMessage(dlMsg.messageID); } catch (_) {}

  if (!success || !(await fs.pathExists(outputPath))) {
    return api.sendMessage(
      `❌ فشل تنزيل الفيديو.\n\n` +
      `🔗 يمكنك مشاهدته مباشرة:\n${video.url}\n\n` +
      `💡 تأكد أن yt-dlp مثبت على السيرفر`,
      tid, mid
    );
  }

  // حجم الملف النهائي
  let sizeMB = null;
  try {
    const stat = await fs.stat(outputPath);
    sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

    // تحقق أخير من الحجم
    if (stat.size > MAX_BYTES) {
      await fs.remove(outputPath).catch(() => {});
      return api.sendMessage(
        `⚠️ الفيديو كبير جداً بعد التنزيل (${sizeMB} MB).\n` +
        `الحد الأقصى لفيسبوك هو ${MAX_MB} MB.\n\n` +
        `🔗 رابط يوتيوب:\n${video.url}`,
        tid, mid
      );
    }
  } catch (_) {}

  const infoText = buildInfoText(video, usedQuality, sizeMB);

  await api.sendMessage(
    { body: infoText, attachment: fs.createReadStream(outputPath) },
    tid,
    () => { fs.remove(outputPath).catch(() => {}); },
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
    version: "4.0",
    author: "GoatBot",
    countDown: 15,
    role: 0,
    shortDescription: "تنزيل فيديو من يوتيوب",
    longDescription: "يبحث عن أشهر فيديو مطابق ويُنزّله بأعلى جودة ممكنة",
    category: "media",
    guide: {
      en: "{pn} <عنوان>\n{pn} <قناة> | <عنوان>\nأو {pn} وحده للكتابة التفاعلية"
    }
  },

  onStart: async function ({ api, event, args }) {
    const tid = event.threadID;
    const mid = event.messageID;

    if (!args.length) {
      const prompt = await api.sendMessage(
        `🎬 أرسل عنوان الفيديو الذي تريده.\n\n` +
        `📌 الصيغ المدعومة:\n` +
        `• عنوان الفيديو فقط\n` +
        `• اسم القناة | عنوان الفيديو\n\n` +
        `مثال: MrBeast | Extreme Survival\n` +
        `مثال: شاهد نت | مسلسل النهاية`,
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

  onReply: async function ({ api, event, Reply }) {
    if (event.senderID !== Reply.author) return;

    global.GoatBot.onReply.delete(event.messageReply.messageID);
    try { api.unsendMessage(event.messageReply.messageID); } catch (_) {}

    if (Reply.type === "awaitQuery") {
      const query = (event.body || "").trim();
      if (!query) {
        return api.sendMessage(
          "❌ لم تكتب شيئاً. أعد المحاولة بكتابة /video",
          event.threadID, event.messageID
        );
      }
      await handleSearch(api, event, query);
    }
  }
};
