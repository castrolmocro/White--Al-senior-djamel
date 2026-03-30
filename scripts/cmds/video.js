const fs = require("fs-extra");
const path = require("path");
const ytSearch = require("yt-search");

const TMP_DIR = path.join(process.cwd(), "scripts/cmds/tmp");
const MAX_FILE_SIZE_MB = 700;

function cleanFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}
}

function isYoutubeLink(text) {
  return /youtube\.com\/watch|youtu\.be|youtube\.com\/shorts/i.test(text);
}

function formatViews(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString();
}

module.exports = {
  config: {
    name: "video",
    aliases: ["vid", "يوتيوب", "yt", "فيديو"],
    version: "5.0",
    author: "Saint",
    countDown: 8,
    role: 0,
    shortDescription: "بحث وتحميل فيديو من يوتيوب",
    longDescription: "أرسل رابط يوتيوب لتحميله مباشرة، أو اكتب اسم الفيديو للبحث عنه وتحميله",
    category: "media",
    guide: {
      en: "{pn} <رابط يوتيوب أو اسم الفيديو أو القناة>"
    }
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;
    const input = args.join(" ").trim();

    if (!input) {
      return api.sendMessage(
        "🔍 أرسل رابط يوتيوب أو اكتب اسم الفيديو.\n\nأمثلة:\n/video https://youtu.be/xxxx\n/video despacito\n/video اغنية حزينة",
        threadID,
        messageID
      );
    }

    const { downloadVideo } = require("sagor-video-downloader");
    fs.ensureDirSync(TMP_DIR);

    api.setMessageReaction("⏳", messageID, () => {}, true);

    let videoUrl = null;
    let videoTitle = null;
    let videoInfo = null;

    try {
      if (isYoutubeLink(input)) {
        videoUrl = input;
      } else {
        const results = await ytSearch(input);
        if (!results?.videos?.length) {
          api.setMessageReaction("❌", messageID, () => {}, true);
          return api.sendMessage(
            `❌ لم أجد نتائج لـ "${input}"\nجرب كلمات بحث مختلفة.`,
            threadID,
            messageID
          );
        }

        const best = results.videos[0];
        videoUrl = `https://www.youtube.com/watch?v=${best.videoId}`;
        videoInfo = best;
      }

      const result = await downloadVideo(videoUrl);
      let filePath = result?.filePath;
      videoTitle = result?.title || videoInfo?.title || "Video";

      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error("File not found after download");
      }

      const stats = fs.statSync(filePath);
      const sizeMB = stats.size / (1024 * 1024);

      if (sizeMB > MAX_FILE_SIZE_MB) {
        cleanFile(filePath);
        api.setMessageReaction("❌", messageID, () => {}, true);
        return api.sendMessage(
          `❌ الفيديو كبير جداً (${sizeMB.toFixed(1)} MB)، الحد الأقصى ${MAX_FILE_SIZE_MB} MB.`,
          threadID,
          messageID
        );
      }

      const safeFilePath = path.join(TMP_DIR, path.basename(filePath));
      if (filePath !== safeFilePath) {
        fs.moveSync(filePath, safeFilePath, { overwrite: true });
        filePath = safeFilePath;
      }

      let body = `🎬 ${videoTitle}\n📦 ${sizeMB.toFixed(2)} MB`;
      if (videoInfo) {
        body +=
          `\n📺 القناة: ${videoInfo.author?.name || ""}\n` +
          `⏱ المدة: ${videoInfo.timestamp}\n` +
          `👁 المشاهدات: ${formatViews(videoInfo.views)}`;
      }

      await new Promise((resolve, reject) => {
        api.sendMessage(
          { body, attachment: fs.createReadStream(filePath) },
          threadID,
          (err) => {
            cleanFile(filePath);
            if (err) reject(err);
            else resolve();
          }
        );
      });

      api.setMessageReaction("✅", messageID, () => {}, true);

    } catch (err) {
      console.error("[video]", err.message);
      api.setMessageReaction("❌", messageID, () => {}, true);
      api.sendMessage(
        "❌ حدث خطأ أثناء التحميل، تأكد من الرابط أو جرب كلمات بحث مختلفة.",
        threadID,
        messageID
      );
    }
  }
};
