const fs = require("fs-extra");
const path = require("path");

const lockDataPath = path.join(process.cwd(), "database/data/lockData.json");

function loadLockData() {
  try {
    if (fs.existsSync(lockDataPath)) {
      return JSON.parse(fs.readFileSync(lockDataPath, "utf8"));
    }
  } catch (e) {}
  return {};
}

function saveLockData(data) {
  try {
    fs.ensureDirSync(path.dirname(lockDataPath));
    fs.writeFileSync(lockDataPath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[LOCK] Failed to save lock data:", e.message);
  }
}

// تحميل البيانات المحفوظة عند تشغيل البوت
if (!global.GoatBot._lockDataLoaded) {
  if (!global.GoatBot.lockedThreads) global.GoatBot.lockedThreads = {};
  const savedData = loadLockData();
  Object.assign(global.GoatBot.lockedThreads, savedData);
  global.GoatBot._lockDataLoaded = true;
}

// ===================================================
//   دالة التحقق من أدمن البوت فقط
// ===================================================
function isAdmin(senderID) {
  const adminBot = global.GoatBot.config.adminBot || [];
  return adminBot.includes(String(senderID)) || adminBot.includes(senderID);
}

module.exports = {
  config: {
    name: "lock",
    version: "5.0",
    author: "MOHAMMAD AKASH",
    countDown: 5,
    role: 1,
    description: "قفل/فتح المجموعة — فقط الأدمن يمكنه استخدام البوت عند القفل",
    category: "box chat",
  },

  onStart: async function ({ api, event, args, threadsData }) {
    const { threadID, senderID } = event;

    if (!isAdmin(senderID)) {
      return api.sendMessage("❌ هذا الأمر للأدمن فقط!", threadID);
    }

    const lockedThreads = global.GoatBot.lockedThreads;
    const action = (args[0] || "").toLowerCase();

    if (action === "on" || action === "lock") {
      if (lockedThreads[threadID])
        return api.sendMessage("🔒 المجموعة مقفلة بالفعل!", threadID);

      lockedThreads[threadID] = true;
      saveLockData(lockedThreads);

      return api.sendMessage(
        "🔒 تم قفل المجموعة!\n" +
        "البوت سيتجاهل جميع الرسائل والأوامر تلقائياً.\n" +
        "فقط الأدمن يمكنه استخدام البوت الآن.",
        threadID
      );
    }

    if (action === "off" || action === "unlock") {
      if (!lockedThreads[threadID])
        return api.sendMessage("🔓 المجموعة مفتوحة بالفعل!", threadID);

      delete lockedThreads[threadID];
      saveLockData(lockedThreads);

      return api.sendMessage(
        "🔓 تم فتح المجموعة!\n" +
        "يمكن للجميع استخدام البوت الآن.",
        threadID
      );
    }

    if (action === "status") {
      const isLocked = !!lockedThreads[threadID];
      return api.sendMessage(
        `📊 حالة المجموعة: ${isLocked ? "🔒 مقفلة" : "🔓 مفتوحة"}`,
        threadID
      );
    }

    return api.sendMessage(
      "⚙️ طريقة الاستخدام:\n" +
      "• /lock on — قفل المجموعة\n" +
      "• /lock off — فتح المجموعة\n" +
      "• /lock status — معرفة الحالة",
      threadID
    );
  },

  // حذف رسائل غير الأدمن عند القفل
  onEvent: async function ({ api, event }) {
    const { threadID, senderID, messageID } = event;
    if (!global.GoatBot.lockedThreads?.[threadID]) return;

    const botID = global.GoatBot.botID || global.botID;
    if (String(senderID) === String(botID)) return;

    if (isAdmin(senderID)) return;

    try {
      await api.unsendMessage(messageID);
    } catch (e) {}
  },
};
