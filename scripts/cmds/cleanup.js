const fs = require("fs-extra");
const path = require("path");

const TEMP_DIRS = [
  "scripts/cmds/tmp",
  "scripts/events/tmp",
  "scripts/cmds/cache"
];

const TEMP_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".mp4", ".mp3", ".wav", ".ogg", ".flac",
  ".pdf", ".zip", ".tar", ".rar", ".7z",
  ".txt", ".json"
];

function getMemoryMB() {
  const mem = process.memoryUsage();
  return {
    rss: (mem.rss / 1024 / 1024).toFixed(1),
    heap: (mem.heapUsed / 1024 / 1024).toFixed(1),
    heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(1),
    external: (mem.external / 1024 / 1024).toFixed(1)
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getDirSize(dirPath) {
  let total = 0;
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) total += stat.size;
      } catch (e) {}
    }
  } catch (e) {}
  return total;
}

function cleanTempDirs() {
  let deletedFiles = 0;
  let freedBytes = 0;

  for (const dir of TEMP_DIRS) {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const files = fs.readdirSync(fullPath);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!TEMP_EXTENSIONS.includes(ext)) continue;

        const filePath = path.join(fullPath, file);
        try {
          const stat = fs.statSync(filePath);
          const ageMs = Date.now() - stat.mtimeMs;
          if (ageMs < 60 * 1000) continue;
          freedBytes += stat.size;
          fs.removeSync(filePath);
          deletedFiles++;
        } catch (e) {}
      }
    } catch (e) {}
  }

  return { deletedFiles, freedBytes };
}

function cleanBotCache() {
  let cleared = 0;

  if (global.client?.cache) {
    const before = Object.keys(global.client.cache).length;
    global.client.cache = {};
    cleared += before;
  }

  if (global.GoatBot?.onReply) {
    const stale = [];
    const now = Date.now();
    global.GoatBot.onReply.forEach((val, key) => {
      if (val.time && now - val.time > 10 * 60 * 1000) stale.push(key);
    });
    stale.forEach(k => global.GoatBot.onReply.delete(k));
    cleared += stale.length;
  }

  if (global.GoatBot?.onReaction) {
    const stale = [];
    const now = Date.now();
    global.GoatBot.onReaction.forEach((val, key) => {
      if (val.time && now - val.time > 10 * 60 * 1000) stale.push(key);
    });
    stale.forEach(k => global.GoatBot.onReaction.delete(k));
    cleared += stale.length;
  }

  return cleared;
}

function forceGC() {
  if (global.gc) {
    global.gc();
    return true;
  }
  return false;
}

module.exports = {
  config: {
    name: "cleanup",
    version: "1.0",
    author: "Custom",
    countDown: 30,
    role: 2,
    description: "Clean temporary files and bot cache to reduce RAM and CPU usage on Railway.",
    category: "admin",
    guide: {
      en: "  {pn} — run full cleanup\n  {pn} files — clean temp files only\n  {pn} cache — clean bot cache only\n  {pn} status — show current memory usage"
    }
  },

  onStart: async function ({ event, args, message }) {
    const action = args[0]?.toLowerCase() || "all";

    if (action === "status") {
      const mem = getMemoryMB();
      let totalTempSize = 0;
      for (const dir of TEMP_DIRS) {
        totalTempSize += getDirSize(path.join(process.cwd(), dir));
      }

      return message.reply(
        `📊 Bot Resource Status\n\n`
        + `🧠 Memory (RAM):\n`
        + `  ▪️ Used (RSS): ${mem.rss} MB\n`
        + `  ▪️ Heap Used: ${mem.heap} MB\n`
        + `  ▪️ Heap Total: ${mem.heapTotal} MB\n`
        + `  ▪️ External: ${mem.external} MB\n\n`
        + `📁 Temp Files Size: ${formatBytes(totalTempSize)}\n`
        + `💬 Pending Replies: ${global.GoatBot?.onReply?.size || 0}\n`
        + `💬 Pending Reactions: ${global.GoatBot?.onReaction?.size || 0}\n`
        + `⏱️ Uptime: ${Math.floor(process.uptime() / 60)} minute(s)`
      );
    }

    const memBefore = getMemoryMB();

    let filesResult = { deletedFiles: 0, freedBytes: 0 };
    let cacheCleared = 0;
    let gcRan = false;

    if (action === "all" || action === "files") {
      filesResult = cleanTempDirs();
    }

    if (action === "all" || action === "cache") {
      cacheCleared = cleanBotCache();
      gcRan = forceGC();
    }

    const memAfter = getMemoryMB();
    const ramSaved = (parseFloat(memBefore.heap) - parseFloat(memAfter.heap)).toFixed(1);

    return message.reply(
      `✅ Cleanup Complete!\n\n`
      + `📁 Temp Files:\n`
      + `  ▪️ Deleted: ${filesResult.deletedFiles} file(s)\n`
      + `  ▪️ Freed: ${formatBytes(filesResult.freedBytes)}\n\n`
      + `🧹 Cache:\n`
      + `  ▪️ Cleared entries: ${cacheCleared}\n`
      + `  ▪️ GC ran: ${gcRan ? "✅ Yes" : "⚠️ No (start bot with --expose-gc to enable)"}\n\n`
      + `🧠 RAM:\n`
      + `  ▪️ Before: ${memBefore.heap} MB\n`
      + `  ▪️ After: ${memAfter.heap} MB\n`
      + `  ▪️ Saved: ~${ramSaved} MB`
    );
  }
};
