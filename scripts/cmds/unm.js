function isBotAdmin(senderID) {
  const adminBot = global.GoatBot?.config?.adminBot || [];
  return adminBot.map(id => String(id).trim()).includes(String(senderID));
}

module.exports = {
  config: {
    name: "unm",
    version: "1.0",
    author: "Custom",
    countDown: 5,
    role: 0,
    description: "عكس امر nm نكمك حمار",
    category: "group",
    guide: {
      en: "  {pn} — Stop locking the group name"
    }
  },

  onStart: async function ({ api, event, message, threadsData }) {
    const { senderID, threadID } = event;

    if (!isBotAdmin(senderID)) return;

    const nmLock = await threadsData.get(threadID, "data.nmLock");

    if (!nmLock?.enabled) {
      return message.reply("ℹ️ No name lock is active in this group.");
    }

    await threadsData.set(threadID, { enabled: false }, "data.nmLock");

    return message.reply(
      `🔓 Group name unlocked!\n\n` +
      `📛 Was locked to: ${nmLock.name}\n\n` +
      `Anyone can now change the group name freely.`
    );
  }
};
