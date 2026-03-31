const fs = require("fs");
const path = require("path");

// ===================================================
//   ملف إعدادات الـ lockdown لكل مجموعة
// ===================================================
const settingsPath = path.join(__dirname, "autoinvite_settings.json");

function loadSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}

// ===================================================
//   ✏️ عدّل الرسالة هنا بسهولة
// ===================================================
function buildMessage(userName) {
  return `🚫 يا ${userName}!
ولد قح وين راك هارب ارواح لهنا😈

━━━━━━━━━━━━━━━
🤖 اني شايفك يال97 حاب تهرب 👀
━━━━━━━━━━━━━━━`;
}

// ===================================================

module.exports = {
  config: {
    name: "autoinvite",
    version: "3.0",
    author: "Djamel",
    category: "events"
  },

  onStart: async ({ api, event, usersData, message }) => {
    if (event.logMessageType !== "log:unsubscribe") return;

    const { threadID, logMessageData, author } = event;
    const leftID = logMessageData.leftParticipantFbId;

    // فقط إذا خرج الشخص بنفسه (وليس طرده أدمن)
    if (leftID !== author) return;

    // تحقق من حالة lockdown للمجموعة
    const settings = loadSettings();
    if (settings[threadID] === false) return; // مُعطَّل لهذه المجموعة

    const userName = await usersData.getName(leftID);
    const msg = buildMessage(userName);

    try {
      await api.addUserToGroup(leftID, threadID);
      await message.send(msg);
    } catch (err) {
      message.send("⚠️تعذّر الإضافة.");
    }
  }
};
