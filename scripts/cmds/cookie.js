const fs = require("fs-extra");
const path = require("path");

module.exports = {
  config: {
    name: "cookie",
    version: "1.0",
    author: "Custom",
    countDown: 10,
    role: 2,
    description: "Force save current session cookies to account.txt",
    category: "admin",
    guide: {
      en: "  {pn} update — Save current cookies to account.txt immediately"
    }
  },

  onStart: async function ({ api, event, args, message }) {
    const { senderID } = event;

    const sub = (args[0] || "").toLowerCase();

    if (sub !== "update") {
      return message.reply(
        "📋 Cookie Command\n\n" +
        "Usage:\n" +
        "• /cookie update — Force save current cookies to account.txt\n\n" +
        "This saves the live session cookies to disk immediately."
      );
    }

    try {
      const appState = api.getAppState();

      if (!appState || !appState.length) {
        return message.reply("❌ No active session cookies found. Is the bot logged in?");
      }

      const accountPath = path.join(process.cwd(), "account.txt");
      const newData = JSON.stringify(appState, null, 2);

      const current = await fs.readFile(accountPath, "utf-8").catch(() => "");

      if (current.trim() === newData.trim()) {
        return message.reply("✅ Cookies are already up to date. No changes needed.");
      }

      await fs.writeFile(accountPath, newData, "utf-8");

      const cookieCount = appState.length;
      const now = new Date().toLocaleString("en-US", { timeZone: global.GoatBot.config?.timeZone || "UTC" });

      return message.reply(
        `✅ Cookies saved successfully!\n\n` +
        `🍪 Cookies count: ${cookieCount}\n` +
        `🕐 Saved at: ${now}\n` +
        `📁 File: account.txt`
      );

    } catch (err) {
      return message.reply(`❌ Failed to save cookies.\nError: ${err.message}`);
    }
  }
};
