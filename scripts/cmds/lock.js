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

if (!global.GoatBot._lockDataLoaded) {
  const savedData = loadLockData();
  Object.assign(global.GoatBot.lockedThreads, savedData);
  global.GoatBot._lockDataLoaded = true;
}

const lockedThreads = global.GoatBot.lockedThreads;

function isBotAdmin(senderID) {
  const adminBot = global.GoatBot.config.adminBot || [];
  return adminBot.includes(String(senderID)) || adminBot.includes(senderID);
}

module.exports = {
  config: {
    name: "lock",
    version: "4.0",
    author: "MOHAMMAD AKASH | Modified",
    countDown: 5,
    role: 1,
    description: "Lock/unlock group — only bot admins can send messages when locked. State persists across bot restarts.",
    category: "box chat",
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, senderID } = event;

    const info = await api.getThreadInfo(threadID);
    const groupAdminIDs = info.adminIDs.map((i) => i.id);

    if (!groupAdminIDs.includes(String(senderID)) && !isBotAdmin(senderID)) {
      return api.sendMessage(
        "❌ Only group admins or bot admins can use this command!",
        threadID
      );
    }

    const action = args[0]?.toLowerCase();

    if (action === "on" || action === "lock") {
      if (lockedThreads[threadID])
        return api.sendMessage("✅ Group is already locked!", threadID);

      lockedThreads[threadID] = true;
      saveLockData(lockedThreads);
      return api.sendMessage(
        "🔒 Group locked!\nOnly bot admins can send messages now.\nAll other messages will be deleted automatically.",
        threadID
      );
    }

    if (action === "off" || action === "unlock") {
      if (!lockedThreads[threadID])
        return api.sendMessage("✅ Group is already unlocked!", threadID);

      delete lockedThreads[threadID];
      saveLockData(lockedThreads);
      return api.sendMessage(
        "🔓 Group unlocked!\nEveryone can send messages again.",
        threadID
      );
    }

    return api.sendMessage(
      "❌ Usage:\n/lock on  — lock the group\n/lock off — unlock the group",
      threadID
    );
  },

  onEvent: async function ({ api, event }) {
    const { threadID, senderID, messageID } = event;

    if (!lockedThreads[threadID]) return;

    if (isBotAdmin(senderID)) return;

    const botID = global.GoatBot.botID || global.botID;
    if (senderID === botID || String(senderID) === String(botID)) return;

    try {
      await api.unsendMessage(messageID);
    } catch (e) {}
  },
};
