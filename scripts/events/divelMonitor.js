// divelMonitor.js — يراقب كل رسائل الغروبات التي فُعّل فيها Divel
// يشتغل تلقائياً مع كل رسالة (بما فيها الصامتة)

module.exports = {
  config: {
    name: "divelMonitor",
    version: "1.0",
    author: "Saint",
    category: "events"
  },

  onStart: async function ({ api, event }) {
    // نشتغل فقط على رسائل عادية أو ردود
    if (event.type !== "message" && event.type !== "message_reply") return;

    const { threadID, senderID } = event;

    // تجاهل رسائل البوت نفسه
    let botID;
    try { botID = api.getCurrentUserID(); } catch (_) { return; }
    if (String(senderID) === String(botID)) return;

    // تحقق من أن Divel مفعّل في هذا الغروب
    if (!global.GoatBot.divelWatchers) return;
    const watcher = global.GoatBot.divelWatchers[threadID];
    if (!watcher || !watcher.active || !watcher.message) return;

    // ─── Debounce: إلغاء المؤقت السابق وبدء جديد ────────────────────────────
    // كل رسالة جديدة تُعيد العدّ من الصفر
    if (watcher.timer) {
      clearTimeout(watcher.timer);
      watcher.timer = null;
    }

    const ms = (watcher.waitMinutes || 5) * 60 * 1000;

    watcher.timer = setTimeout(async () => {
      watcher.timer = null;
      try {
        await api.sendMessage(watcher.message, threadID);
      } catch (e) {
        console.log("[divelMonitor] فشل الإرسال:", e.message?.slice(0, 60));
      }
    }, ms);
  }
};
