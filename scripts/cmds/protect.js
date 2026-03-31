// ===================================================
//   /protect — حماية الكُنيات فقط
//   • أدمن البوت يغيّر الكُنية → تُحفظ تلقائياً
//   • أي شخص آخر يغيّر الكُنية → تُعاد للمحفوظة
// ===================================================

function isBotAdmin(id) {
  const admins = global.GoatBot.config.adminBot || [];
  return admins.includes(String(id)) || admins.includes(id);
}

module.exports = {
  config: {
    name: "protect",
    version: "2.0",
    author: "Djamel",
    role: 2,
    shortDescription: "حماية كُنيات أعضاء المجموعة",
    category: "group",
    guide: {
      en: "{pn} on           — تفعيل الحماية\n" +
          "{pn} off          — إيقاف الحماية\n" +
          "{pn} set @شخص كُنية — ضبط كُنية عضو\n" +
          "{pn} list         — عرض الكُنيات المحفوظة"
    }
  },

  onStart: async ({ api, event, message, threadsData, args }) => {
    const { threadID, mentions } = event;

    // ─── تفعيل ─────────────────────────────────────────────────────────
    if (args[0] === "on") {
      const info = await api.getThreadInfo(threadID).catch(() => null);
      if (!info) return message.reply("❌ تعذّر جلب معلومات المجموعة.");

      const nicknames = {};
      (info.members || []).forEach(u => {
        nicknames[u.userID] = u.nickname || "";
      });

      await threadsData.set(threadID, { enable: true, nicknames }, "data.protect");

      return message.reply(
        "🛡️ تم تفعيل حماية الكُنيات!\n" +
        `📋 تم حفظ كُنيات ${Object.keys(nicknames).length} عضو.\n\n` +
        "• أدمن البوت يمكنه تغيير الكُنيات بحرية.\n" +
        "• أي شخص آخر سيتم إعادة كُنيته تلقائياً."
      );
    }

    // ─── إيقاف ─────────────────────────────────────────────────────────
    if (args[0] === "off") {
      await threadsData.set(threadID, { enable: false, nicknames: {} }, "data.protect");
      return message.reply("🔓 تم إيقاف حماية الكُنيات.");
    }

    // ─── ضبط كُنية يدوياً ──────────────────────────────────────────────
    if (args[0] === "set") {
      const targetID = Object.keys(mentions || {})[0];
      if (!targetID) return message.reply("⚠️ حدد الشخص بالإشارة إليه: /protect set @شخص كُنيته");

      const nickname = args.slice(2).join(" ").trim();
      if (!nickname) return message.reply("⚠️ أرسل الكُنية بعد اسم الشخص.");

      const protect = await threadsData.get(threadID, "data.protect");
      if (!protect?.enable) return message.reply("⚠️ الحماية غير مفعّلة. شغّلها أولاً بـ /protect on");

      // تغيير الكُنية
      await api.changeNickname(nickname, threadID, targetID).catch(() => {});
      await threadsData.set(threadID, nickname, `data.protect.nicknames.${targetID}`);

      return message.reply(`✅ تم ضبط كُنية الشخص إلى: "${nickname}" وحفظها.`);
    }

    // ─── عرض القائمة ───────────────────────────────────────────────────
    if (args[0] === "list") {
      const protect = await threadsData.get(threadID, "data.protect");
      if (!protect?.enable) return message.reply("⚠️ الحماية غير مفعّلة.");

      const nicks = protect.nicknames || {};
      const entries = Object.entries(nicks).filter(([, v]) => v);
      if (!entries.length) return message.reply("📋 لا توجد كُنيات مضبوطة حالياً.");

      let msg = `📋 الكُنيات المحمية (${entries.length}):\n━━━━━━━━━━━━━━━\n`;
      entries.forEach(([id, nick]) => {
        msg += `• ${nick}  (${id})\n`;
      });
      return message.reply(msg);
    }

    return message.reply(
      "⚙️ الاستخدام:\n" +
      "• /protect on — تفعيل\n" +
      "• /protect off — إيقاف\n" +
      "• /protect set @شخص كُنية — ضبط كُنية\n" +
      "• /protect list — عرض الكُنيات"
    );
  },

  // ─── مراقبة تغيير الكُنيات ─────────────────────────────────────────────
  onEvent: async ({ api, event, threadsData }) => {
    const { threadID, author, logMessageType, logMessageData } = event;

    // فقط نتفاعل مع تغيير الكُنيات
    if (logMessageType !== "log:user-nickname") return;

    const protect = await threadsData.get(threadID, "data.protect");
    if (!protect?.enable) return;

    const { participant_id, nickname } = logMessageData;
    const botID = api.getCurrentUserID();

    // البوت نفسه غيّر الكُنية — لا نتدخل
    if (String(author) === String(botID)) return;

    // أدمن البوت غيّر الكُنية → احفظها تلقائياً
    if (isBotAdmin(author)) {
      await threadsData.set(
        threadID,
        nickname || "",
        `data.protect.nicknames.${participant_id}`
      );
      return;
    }

    // شخص عادي حاول التغيير → أعد الكُنية المحفوظة
    const savedNick = protect.nicknames?.[participant_id] ?? "";
    await api.changeNickname(savedNick, threadID, participant_id).catch(() => {});
  }
};
