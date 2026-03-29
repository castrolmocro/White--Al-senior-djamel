const fs = require("fs-extra");
const path = require("path");

const dataPath = path.join(process.cwd(), "database/data/angelData.json");

function loadData() {
  try {
    if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch (e) {}
  return {};
}

function saveData(data) {
  fs.ensureDirSync(path.dirname(dataPath));
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function isBotAdmin(senderID) {
  const adminBot = global.GoatBot.config.adminBot || [];
  return adminBot.includes(String(senderID)) || adminBot.includes(senderID);
}

if (!global.GoatBot.angelIntervals) {
  global.GoatBot.angelIntervals = {};
}

function restoreIntervals(api) {
  if (global.GoatBot.angelRestored) return;
  global.GoatBot.angelRestored = true;

  const data = loadData();
  let restored = 0;

  for (const [threadID, threadData] of Object.entries(data)) {
    if (threadData.active && threadData.message && !global.GoatBot.angelIntervals[threadID]) {
      const ms = (threadData.intervalMinutes || 10) * 60 * 1000;
      global.GoatBot.angelIntervals[threadID] = setInterval(() => {
        api.sendMessage(threadData.message, threadID).catch(() => {});
      }, ms);
      restored++;
    }
  }

  if (restored > 0) {
    global.utils.log.info("ANGEL", `✅ Restored ${restored} auto-send interval(s) after restart`);
  }
}

module.exports = {
  config: {
    name: "angel",
    version: "1.0",
    author: "Custom",
    countDown: 3,
    role: 0,
    description: "Auto-send a message repeatedly in a group at a set interval.",
    category: "admin",
    guide: {
      en: "  {pn} on — start auto-sending in this group\n"
        + "  {pn} off — stop auto-sending in this group\n"
        + "  {pn} change [message] — set the message to send\n"
        + "  {pn} time [number] — set the interval in minutes\n\n"
        + "Example:\n"
        + "  /angel change Hello everyone!\n"
        + "  /angel time 10\n"
        + "  /angel on"
    }
  },

  onStart: async function ({ api, event, args, message }) {
    const { senderID, threadID } = event;

    if (!isBotAdmin(senderID)) return;

    restoreIntervals(api);

    const action = args[0]?.toLowerCase();
    const data = loadData();

    if (!data[threadID]) {
      data[threadID] = { message: null, intervalMinutes: 10, active: false };
    }

    const threadData = data[threadID];

    switch (action) {

      case "change": {
        const newMsg = args.slice(1).join(" ").trim();
        if (!newMsg) {
          return message.reply("❌ Please provide a message.\n\nExample: /angel change Hello everyone!");
        }
        threadData.message = newMsg;
        saveData(data);
        return message.reply(`✅ Message updated!\n\n📝 New message:\n"${newMsg}"`);
      }

      case "time": {
        const mins = parseFloat(args[1]);
        if (isNaN(mins) || mins <= 0) {
          return message.reply("❌ Please provide a valid number of minutes.\n\nExample: /angel time 10");
        }
        threadData.intervalMinutes = mins;
        saveData(data);

        if (global.GoatBot.angelIntervals[threadID]) {
          clearInterval(global.GoatBot.angelIntervals[threadID]);
          delete global.GoatBot.angelIntervals[threadID];

          if (threadData.message && threadData.active) {
            global.GoatBot.angelIntervals[threadID] = setInterval(() => {
              api.sendMessage(threadData.message, threadID).catch(() => {});
            }, mins * 60 * 1000);
          }
        }

        return message.reply(`✅ Interval updated!\n\n⏱️ New interval: every ${mins} minute(s)${threadData.active ? "\n♻️ Restarted with new interval." : ""}`);
      }

      case "on": {
        if (!threadData.message) {
          return message.reply("❌ No message set yet.\n\nPlease set one first:\n/angel change [your message]");
        }

        if (global.GoatBot.angelIntervals[threadID]) {
          return message.reply("⚠️ Auto-send is already running in this group.");
        }

        threadData.active = true;
        saveData(data);

        const ms = threadData.intervalMinutes * 60 * 1000;

        global.GoatBot.angelIntervals[threadID] = setInterval(() => {
          api.sendMessage(threadData.message, threadID).catch(() => {});
        }, ms);

        return message.reply(
          `✅ Auto-send started!\n\n`
          + `📝 Message: "${threadData.message}"\n`
          + `⏱️ Every: ${threadData.intervalMinutes} minute(s)`
        );
      }

      case "off": {
        if (!global.GoatBot.angelIntervals[threadID]) {
          return message.reply("⚠️ Auto-send is not running in this group.");
        }

        clearInterval(global.GoatBot.angelIntervals[threadID]);
        delete global.GoatBot.angelIntervals[threadID];

        threadData.active = false;
        saveData(data);

        return message.reply("✅ Auto-send stopped in this group.");
      }

      case "status": {
        const isRunning = !!global.GoatBot.angelIntervals[threadID];
        return message.reply(
          `📊 Angel Status — This Group\n\n`
          + `▪️ Status: ${isRunning ? "🟢 Running" : "🔴 Stopped"}\n`
          + `▪️ Message: ${threadData.message ? `"${threadData.message}"` : "Not set"}\n`
          + `▪️ Interval: ${threadData.intervalMinutes} minute(s)`
        );
      }

      default: {
        return message.reply(
          "📖 Angel Command — Usage:\n\n"
          + "/angel change [message] — set the message\n"
          + "/angel time [minutes] — set the interval\n"
          + "/angel on — start auto-sending\n"
          + "/angel off — stop auto-sending\n"
          + "/angel status — check current status"
        );
      }
    }
  }
};
