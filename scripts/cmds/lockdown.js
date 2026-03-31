const fs = require("fs-extra");
const path = require("path");

// ملف الإعدادات المشترك مع autoinvite.js
const settingsPath = path.join(__dirname, "../events/autoinvite_settings.json");

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

function saveSettings(data) {
  try {
    fs.ensureDirSync(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("[lockdown:save]", e.message);
    return false;
  }
}

module.exports = {
  config: {
    name: "lockdown",
    aliases: ["ld", "autoadd", "lock"],
    version: "2.0",
    author: "Djamel",
    countDown: 3,
    role: 2, // ✅ أدمن البوت فقط (role 1 = group admin, role 2 = bot owner)
    shortDescription: "تحكم في إعادة الإضافة التلقائية للمجموعة",
    longDescription: "يفعّل أو يوقف خاصية إعادة إضافة من يغادر المجموعة تلقائياً",
    category: "group",
    guide: {
      en: [
        "{pn} on     ─ تفعيل إعادة الإضافة التلقائية",
        "{pn} off    ─ إيقاف إعادة الإضافة التلقائية",
        "{pn} status ─ معرفة الحالة الحالية"
      ].join("\n")
    }
  },

  onStart: async ({ message, event, args }) => {
    const { threadID } = event;
    const action = (args[0] || "").toLowerCase().trim();

    if (action === "on") {
      const settings = loadSettings();
      settings[threadID] = true;
      const saved = saveSettings(settings);
      if (!saved) return message.reply("❌ فشل حفظ الإعداد، تأكد من صلاحيات البوت.");
      return message.reply(
        "✅ تم تفعيل إعادة الإضافة التلقائية لهذه المجموعة.\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "🔒 أي شخص يغادر سيتم إعادته تلقائياً.\n" +
        "⚠️ تأكد أن البوت لديه صلاحية إضافة أعضاء."
      );
    }

    if (action === "off") {
      const settings = loadSettings();
      settings[threadID] = false;
      const saved = saveSettings(settings);
      if (!saved) return message.reply("❌ فشل حفظ الإعداد، تأكد من صلاحيات البوت.");
      return message.reply(
        "🔓 تم إيقاف إعادة الإضافة التلقائية لهذه المجموعة.\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "✅ يمكن للأعضاء المغادرة بحرية الآن."
      );
    }

    if (action === "status") {
      const settings = loadSettings();
      const isActive = settings[threadID] === true;
      return message.reply(
        `📊 حالة الإضافة التلقائية في هذه المجموعة:\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `${isActive ? "✅ مفعّلة — من يغادر يُعاد تلقائياً" : "🔓 موقوفة — يمكن للجميع المغادرة"}`
      );
    }

    // مساعدة
    return message.reply(
      "⚙️ أوامر الـ lockdown:\n" +
      "━━━━━━━━━━━━━━━━━━\n" +
      "• /lockdown on     ─ تفعيل الإضافة التلقائية\n" +
      "• /lockdown off    ─ إيقاف الإضافة التلقائية\n" +
      "• /lockdown status ─ عرض الحالة الحالية\n\n" +
      "⚠️ يتطلب أن يكون البوت أدمناً في المجموعة."
    );
  }
};
