const fs = require("fs-extra");
const path = require("path");

const TMP_DIR = path.join(process.cwd(), "scripts/cmds/tmp");
const MAX_FILE_SIZE_MB = 25;
const MAX_CONCURRENT = 2;

let activeDownloads = 0;

function cleanFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}
}

function isVideoLink(url) {
  return /tiktok\.com|youtube\.com\/shorts|youtu\.be|instagram\.com\/reel|facebook\.com\/.*\/videos|fb\.watch|twitter\.com\/.*\/status|x\.com\/.*\/status|threads\.net/i.test(url);
}

module.exports = {
  config: {
    name: "autolink",
    version: "2.0",
    author: "Djamel | Optimized",
    countDown: 5,
    role: 0,
    shortDescription: "Auto-download & send videos, then delete the file immediately",
    category: "media",
  },

  onStart: async function () {},

  onChat: async function ({ api, event }) {
    const { threadID, messageID, body } = event;
    const message = body || "";

    const linkMatches = message.match(/(https?:\/\/[^\s]+)/g);
    if (!linkMatches) return;

    const videoLinks = [...new Set(linkMatches)].filter(isVideoLink);
    if (videoLinks.length === 0) return;

    if (activeDownloads >= MAX_CONCURRENT) {
      api.setMessageReaction("⏳", messageID, () => {}, true);
      return;
    }

    fs.ensureDirSync(TMP_DIR);

    let { downloadVideo } = require("sagor-video-downloader");

    for (const url of videoLinks) {
      if (activeDownloads >= MAX_CONCURRENT) break;

      activeDownloads++;
      api.setMessageReaction("⏳", messageID, () => {}, true);

      let filePath = null;

      try {
        const result = await downloadVideo(url);
        filePath = result?.filePath;

        if (!filePath || !fs.existsSync(filePath)) throw new Error("File not found after download");

        const stats = fs.statSync(filePath);
        const sizeMB = stats.size / (1024 * 1024);

        if (sizeMB > MAX_FILE_SIZE_MB) {
          cleanFile(filePath);
          api.setMessageReaction("❌", messageID, () => {}, true);
          api.sendMessage(`❌ Video is too large (${sizeMB.toFixed(1)} MB). Max allowed: ${MAX_FILE_SIZE_MB} MB`, threadID);
          continue;
        }

        const safeFilePath = path.join(TMP_DIR, path.basename(filePath));
        if (filePath !== safeFilePath) {
          fs.moveSync(filePath, safeFilePath, { overwrite: true });
          filePath = safeFilePath;
        }

        await new Promise((resolve, reject) => {
          api.sendMessage(
            {
              body: `📥 ${result?.title || "Video"}\n📦 ${sizeMB.toFixed(2)} MB`,
              attachment: fs.createReadStream(filePath)
            },
            threadID,
            (err) => {
              cleanFile(filePath);
              if (err) reject(err);
              else resolve();
            }
          );
        });

        api.setMessageReaction("✅", messageID, () => {}, true);

      } catch (e) {
        cleanFile(filePath);
        api.setMessageReaction("❌", messageID, () => {}, true);
      } finally {
        activeDownloads = Math.max(0, activeDownloads - 1);
      }
    }
  }
};
