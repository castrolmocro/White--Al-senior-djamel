const fs = require("fs-extra");
const path = require("path");

function isBotAdmin(senderID) {
  const admins = global.GoatBot?.config?.adminBot || [];
  return admins.includes(String(senderID)) || admins.includes(senderID);
}

module.exports = {
  config: {
    name: "setaccount",
    version: "1.0",
    author: "Custom",
    countDown: 5,
    role: 2,
    description: "Set Facebook email and password for auto re-login. Bot admins only.",
    category: "admin",
    guide: {
      en: "  {pn} [email] [password]\n"
        + "  {pn} status — check if credentials are saved\n"
        + "  {pn} clear — remove saved credentials\n\n"
        + "⚠️ Send this command in a PRIVATE conversation with the bot only!"
    }
  },

  onStart: async function ({ api, event, args, message }) {
    const { senderID, messageID, threadID } = event;

    if (!isBotAdmin(senderID)) return;

    const action = args[0]?.toLowerCase();

    if (action === "status") {
      const { email, password } = global.GoatBot.config.facebookAccount || {};
      const hasEmail = !!(email && email.trim());
      const hasPass  = !!(password && password.trim());

      return message.reply(
        "🔐 Account Credentials Status\n"
        + "━━━━━━━━━━━━━━━\n"
        + `📧 Email: ${hasEmail ? "✅ Saved (hidden)" : "❌ Not set"}\n`
        + `🔑 Password: ${hasPass ? "✅ Saved (hidden)" : "❌ Not set"}\n`
        + "━━━━━━━━━━━━━━━\n"
        + (hasEmail && hasPass
          ? "✅ Bot will auto re-login when session expires."
          : "⚠️ Set credentials so bot can recover from login_blocked errors.\nUse: /setaccount [email] [password]")
      );
    }

    if (action === "clear") {
      global.GoatBot.config.facebookAccount.email    = "";
      global.GoatBot.config.facebookAccount.password = "";
      const configPath = path.join(process.cwd(), "config.json");
      fs.writeFileSync(configPath, JSON.stringify(global.GoatBot.config, null, 2));

      try { api.unsendMessage(messageID); } catch (e) {}
      return message.reply("✅ Credentials cleared.");
    }

    const email    = args[0];
    const password = args.slice(1).join(" ");

    if (!email || !password) {
      try { api.unsendMessage(messageID); } catch (e) {}
      return message.reply(
        "❌ Usage: /setaccount [email] [password]\n\n"
        + "Example:\n/setaccount example@gmail.com mypassword123\n\n"
        + "⚠️ Use this command in a PRIVATE chat with the bot only!"
      );
    }

    try { api.unsendMessage(messageID); } catch (e) {}

    if (!global.GoatBot.config.facebookAccount) {
      global.GoatBot.config.facebookAccount = {};
    }

    global.GoatBot.config.facebookAccount.email    = email.trim();
    global.GoatBot.config.facebookAccount.password = password.trim();

    const configPath = global.client?.dirConfig || path.join(process.cwd(), "config.json");
    fs.writeFileSync(configPath, JSON.stringify(global.GoatBot.config, null, 2));

    return message.reply(
      "✅ Credentials saved successfully!\n"
      + "━━━━━━━━━━━━━━━\n"
      + "📧 Email: saved ✅\n"
      + "🔑 Password: saved ✅\n"
      + "━━━━━━━━━━━━━━━\n"
      + "🔄 The bot will now automatically attempt re-login\n"
      + "   when a login_blocked error is detected.\n\n"
      + "⚠️ Your original message was deleted for security."
    );
  }
};
