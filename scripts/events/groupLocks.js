module.exports = {
  config: {
    name: "groupLocks",
    version: "3.0",
    author: "Djamel",
    description: "يراقب تغيير الكُنيات ويعيدها أو يحفظها حسب صلاحية أدمن البوت",
    category: "events"
  },

  onStart: async ({ api, event, threadsData }) => {
    // نتفاعل فقط مع تغيير الكُنيات
    if (event.logMessageType !== "log:user-nickname") return;

    const { threadID, logMessageData, senderID } = event;
    const botID  = String(global.GoatBot?.botID || "");
    const sender = String(senderID || "");

    // تجاهل إذا كان البوت نفسه من غيّر (لتجنب الحلقة اللانهائية)
    if (sender === botID) return;

    let locks;
    try {
      const tData = await threadsData.get(threadID);
      locks = tData?.groupLocks || {};
    } catch (_) { return; }

    // إذا لم يكن قفل الكُنيات مفعّلاً → لا شيء
    if (!locks.lockNick) return;

    const { participant_id, nickname } = logMessageData || {};
    if (!participant_id) return;

    if (!locks.protectedNicks) locks.protectedNicks = {};

    const newNick  = nickname || "";
    const savedNick = locks.protectedNicks[participant_id] ?? "";

    // هل المُغيِّر أدمن البوت؟
    const adminBot = global.GoatBot.config.adminBot || [];
    const senderIsBotAdmin = adminBot.includes(sender) || adminBot.includes(senderID);

    if (senderIsBotAdmin) {
      // أدمن البوت غيّر الكُنية → احفظها تلقائياً
      if (newNick !== savedNick) {
        locks.protectedNicks[participant_id] = newNick;
        try {
          await threadsData.set(threadID, locks, "groupLocks");
          const msg = newNick
            ? `✅ تم حفظ الكُنية المحمية:\n"${newNick}"`
            : `✅ تم مسح الكُنية المحمية لهذا العضو.`;
          await api.sendMessage(msg, threadID);
        } catch (_) {}
      }
    } else {
      // شخص عادي حاول التغيير → أعِد الكُنية المحفوظة
      if (newNick === savedNick) return;

      setTimeout(async () => {
        try {
          await api.changeNickname(savedNick, threadID, participant_id);
          const msg = savedNick
            ? `🔒 تم إعادة الكُنية المحمية:\n"${savedNick}"`
            : `🔒 تم حذف الكُنية تلقائياً.\nالكُنيات مقفلة في هذه المجموعة.`;
          await api.sendMessage(msg, threadID);
        } catch (_) {}
      }, 1500);
    }
  }
};
