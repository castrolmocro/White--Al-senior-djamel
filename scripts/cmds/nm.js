const pendingTimers = new Map();

function isBotAdmin(senderID) {
  const adminBot = global.GoatBot?.config?.adminBot || [];
  return adminBot.map(id => String(id).trim()).includes(String(senderID));
}

module.exports = {
  config: {
    name: "nm",
    version: "1.0",
    author: "Custom",
    countDown: 5,
    role: 0,
    description: "نكسوة تعمك امر باين من اسم ملف",
    category: "group",
    guide: {
      en:
        "  {pn} [name]        — Lock group name\n" +
        "  /unm               — Unlock group name\n" +
        "  {pn} time [secs]   — Set restore delay (default: 9s)"
    }
  },

  onStart: async function ({ api, event, args, message, threadsData }) {
    const { senderID, threadID } = event;

    if (!isBotAdmin(senderID)) return;

    const sub = (args[0] || "").toLowerCase();

    if (sub === "time") {
      const secs = parseInt(args[1]);
      if (isNaN(secs) || secs < 1) {
        return message.reply("❌ Please provide a valid number of seconds.\nExample: /nm time 5");
      }
      const current = await threadsData.get(threadID, "data.nmLock") || {};
      if (!current.name) {
        return message.reply("❌ No name is locked yet. Use /nm [name] first.");
      }
      current.delay = secs;
      await threadsData.set(threadID, current, "data.nmLock");
      return message.reply(`✅ Restore delay updated to ${secs} seconds.`);
    }

    const name = args.join(" ").trim();
    if (!name) {
      return message.reply(
        "📋 Name Lock Command\n\n" +
        "• /nm [name]       — Lock the group name\n" +
        "• /unm             — Unlock the group name\n" +
        "• /nm time [secs]  — Change restore delay\n\n" +
        "Default delay: 9 seconds"
      );
    }

    await threadsData.set(threadID, { name, delay: 9, enabled: true }, "data.nmLock");

    try {
      await api.setTitle(name, threadID);
    } catch (e) {}

    return message.reply(
      `🔒 Group name locked!\n\n` +
      `📛 Name: ${name}\n` +
      `⏱ Restore delay: 9s\n\n` +
      `If anyone changes the name it will be restored automatically.\n` +
      `Use /unm to unlock.`
    );
  },

  onEvent: async function ({ api, event, threadsData }) {
    const { threadID, author, logMessageType } = event;

    if (logMessageType !== "log:thread-name") return;

    const botID = api.getCurrentUserID();
    if (author === botID) return;

    const nmLock = await threadsData.get(threadID, "data.nmLock");
    if (!nmLock?.enabled || !nmLock?.name) return;

    const delay = (nmLock.delay || 9) * 1000;

    if (pendingTimers.has(threadID)) {
      clearTimeout(pendingTimers.get(threadID));
    }

    const timer = setTimeout(async () => {
      pendingTimers.delete(threadID);
      try {
        await api.setTitle(nmLock.name, threadID);
      } catch (e) {}
    }, delay);

    pendingTimers.set(threadID, timer);
  }
};
