const fs = require("fs");
const path = require("path");

// نفس ملف الإعدادات المستخدم في autoinvite.js
const settingsPath = path.join(__dirname, "../events/autoinvite_settings.json");

function loadSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}

function saveSettings(data) {
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf8");
}

module.exports = {
  config: {
    name: "lockdown",
    version: "1.0",
    author: "Djamel",
    countDown: 3,
    role: 2, // 1 = أدمن المجموعة فقط
    description: {
      en: "Control auto re-add feature for this group"
    },
    category: "group",
    guide: {
      en: "{pn} on  ─ تفعيل إعادة الإضافة التلقائية\n{pn} off ─ إيقاف إعادة الإضافة التلقائية\n{pn} status ─ معرفة الحالة الحالية"
    }
  },

  onStart: async ({ message, event, args }) => {
    const { threadID } = event;
    const settings = loadSettings();
    const action = (args[0] || "").toLowerCase();

    if (action === "on") {
      settings[threadID] = true;
      saveSettings(settings);
      return message.reply(
        "✅ تم تفعيل خاصية إعادة الإضافة التلقائية لهذه المجموعة.\n" +
        "أي شخص يغادر سيتم إعادته تلقائياً."
      );
    }

    if (action === "off") {
      settings[threadID] = false;
      saveSettings(settings);
      return message.reply(
        "🔴 تم إيقاف خاصية إعادة الإضافة التلقائية لهذه المجموعة.\n" +
        "يمكن للأعضاء المغادرة بحرية الآن."
      );
    }

    if (action === "status") {
      const isActive = settings[threadID] !== false;
      return message.reply(
        `📊 حالة الخاصية في هذه المجموعة:\n` +
        `${isActive ? "✅ مفعّلة" : "🔴 موقوفة"}`
      );
    }

    // إذا لم يُدخل أمر صحيح
    return message.reply(
      "⚙️ طريقة الاستخدام:\n" +
      "• /lockdown on ─ تفعيل إعادة الإضافة\n" +
      "• /lockdown off ─ إيقاف إعادة الإضافة\n" +
      "• /lockdown status ─ معرفة الحالة"
    );
  }
};
