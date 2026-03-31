const fs = require("fs-extra");
const path = require("path");

// ملف الإعدادات المشترك مع lockdown.js
const settingsPath = path.join(__dirname, "autoinvite_settings.json");

// ─── تحميل الإعدادات بأمان ────────────────────────────────────────────────────
function loadSettings() {
  try {
    if (!fs.existsSync(settingsPath)) return {};
    const raw = fs.readFileSync(settingsPath, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ─── رسالة الإعادة ───────────────────────────────────────────────────────────
function buildMessage(userName) {
  return (
    `🚫 يا ${userName}!\n` +
    `ولد قح وين راك هارب ارواح لهنا😈\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🤖 اني شايفك يال97 حاب تهرب 👀\n` +
    `━━━━━━━━━━━━━━━`
  );
}

// ─── الحصول على اسم المستخدم بأمان ───────────────────────────────────────────
async function getUserName(api, usersData, userID) {
  // محاولة 1: من قاعدة بيانات البوت
  try {
    const name = await usersData.getName(userID);
    if (name && name !== "Facebook User") return name;
  } catch {}

  // محاولة 2: من API فيسبوك مباشرة
  try {
    const info = await api.getUserInfo([userID]);
    if (info && info[userID]) {
      const u = info[userID];
      const name = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim();
      if (name) return name;
    }
  } catch {}

  return "صديق"; // اسم افتراضي إذا فشلت كل المحاولات
}

// ─── Module ───────────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name: "autoinvite",
    version: "4.0",
    author: "Djamel",
    category: "events"
  },

  // ✅ في GoatBot v2، الأحداث تستخدم onStart (وليس onEvent)
  onStart: async ({ api, event, usersData, message }) => {
    // ✅ تأكد أن الحدث هو مغادرة عضو
    if (event.logMessageType !== "log:unsubscribe") return;

    const { threadID, logMessageData, author } = event;

    // ✅ تأكد أن البيانات موجودة
    if (!logMessageData) return;

    const leftID = logMessageData.leftParticipantFbId;
    if (!leftID) return;

    // ✅ تجاهل إذا كان طرداً من أدمن (الشخص الذي غادر ≠ من أصدر الأمر)
    if (leftID !== author) return;

    // ✅ تجاهل إذا غادر البوت نفسه
    try {
      const botID = api.getCurrentUserID();
      if (leftID === botID) return;
    } catch {}

    // ✅ تحقق من إعداد lockdown لهذه المجموعة
    const settings = loadSettings();
    if (!settings[threadID]) return; // لا يعمل إلا إذا تم تفعيله بـ /lockdown on

    // ✅ تنفيذ الإعادة مع معالجة كاملة للأخطاء
    try {
      const userName = await getUserName(api, usersData, leftID);

      // حاول إعادة المستخدم للمجموعة
      await api.addUserToGroup(leftID, threadID);

      // أرسل رسالة في المجموعة
      await api.sendMessage(buildMessage(userName), threadID);

    } catch (err) {
      const errMsg = err?.message || "";

      // إذا البوت لا يملك صلاحية الإضافة
      if (
        errMsg.includes("admin") ||
        errMsg.includes("permission") ||
        errMsg.includes("not allowed") ||
        errMsg.includes("1545010")
      ) {
        try {
          await api.sendMessage(
            "⚠️ لا أستطيع إعادة العضو لأنني لست أدمناً في هذه المجموعة.\n" +
            "اجعلني أدمناً لتفعيل هذه الخاصية.",
            threadID
          );
        } catch {}
      } else if (errMsg.includes("blocked") || errMsg.includes("1545012")) {
        // المستخدم حجب البوت أو المجموعة
        try {
          await api.sendMessage("⚠️ تعذّرت إعادة إضافة العضو.", threadID);
        } catch {}
      }
      // لا ترسل رسالة خطأ لأسباب أخرى (لتجنب إزعاج المجموعة)
      console.error("[autoinvite]", errMsg.slice(0, 100));
    }
  }
};
