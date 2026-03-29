const fs = require("fs-extra");
const path = require("path");
const { writeFileSync } = require("fs-extra");

const levelsPath = path.join(process.cwd(), "database/data/adminLevels.json");

function loadLevels() {
  try {
    if (fs.existsSync(levelsPath)) return JSON.parse(fs.readFileSync(levelsPath, "utf8"));
  } catch (e) {}
  return {};
}

function saveLevels(data) {
  fs.ensureDirSync(path.dirname(levelsPath));
  fs.writeFileSync(levelsPath, JSON.stringify(data, null, 2));
}

function isTopAdmin(senderID) {
  const levels = loadLevels();
  const id = String(senderID);
  if (levels[id] !== undefined) return levels[id] === 3;
  const adminBot = global.GoatBot.config.adminBot || [];
  return adminBot.includes(id);
}

function extractIDFromURL(text) {
  const match1 = text.match(/(?:facebook\.com|fb\.com)\/profile\.php\?id=(\d+)/i);
  if (match1) return match1[1];
  const match2 = text.match(/(?:facebook\.com|fb\.com)\/(\d+)/i);
  if (match2) return match2[1];
  if (/^\d{5,20}$/.test(text.trim())) return text.trim();
  return null;
}

module.exports = {
  config: {
    name: "admindelete",
    version: "1.0",
    author: "Custom",
    countDown: 5,
    role: 2,
    description: "Remove a bot admin. Only top-level bot admins can use this.",
    category: "admin",
    guide: {
      en: "  {pn} — reply to the admin's message\n  {pn} [ID]\n  {pn} [Facebook URL]\n\nExamples:\n  /admindelete (reply to someone)\n  /admindelete 123456789\n  /admindelete https://facebook.com/profile.php?id=123"
    }
  },

  onStart: async function ({ api, event, args, message, usersData }) {
    const { senderID, threadID } = event;
    const config = global.GoatBot.config;

    if (!isTopAdmin(senderID)) {
      return message.reply("🚫 This command is restricted to Level 3 (Senior) admins only.");
    }

    let targetID = null;

    // Method 1: Reply to a message
    if (event.messageReply && !args[0]) {
      targetID = event.messageReply.senderID;
    }
    // Method 2: ID or URL in args[0]
    else if (args[0]) {
      targetID = extractIDFromURL(args[0]);
      if (!targetID) {
        return message.reply("❌ Could not extract a valid Facebook ID from the provided input.\n\nPlease use:\n• A numeric ID\n• A Facebook URL with a numeric ID");
      }
    }
    // Method 3: Mentions
    else if (Object.keys(event.mentions).length > 0) {
      targetID = Object.keys(event.mentions)[0];
    }

    if (!targetID) {
      return message.reply(
        "❌ Please specify who to remove:\n" +
        "• Reply to their message\n" +
        "• Provide their ID or Facebook URL\n\n" +
        "Example: /admindelete 123456789"
      );
    }

    targetID = String(targetID);

    // Prevent removing yourself
    if (targetID === String(senderID)) {
      return message.reply("❌ You cannot remove yourself.");
    }

    const levels = loadLevels();

    const inLevels = levels[targetID] !== undefined;
    const inConfig = config.adminBot.includes(targetID);

    if (!inLevels && !inConfig) {
      return message.reply(`❌ This user (ID: ${targetID}) is not a registered bot admin.`);
    }

    const oldLevel = levels[targetID];

    // Remove from levels file
    if (inLevels) {
      delete levels[targetID];
      saveLevels(levels);
    }

    // Remove from config.adminBot
    if (inConfig) {
      const index = config.adminBot.indexOf(targetID);
      if (index !== -1) config.adminBot.splice(index, 1);
      writeFileSync(global.client.dirConfig, JSON.stringify(config, null, 2));
    }

    let userName = targetID;
    try {
      userName = (await usersData.getName(targetID)) || targetID;
    } catch (e) {}

    const levelEmoji = oldLevel === 3 ? "🥇" : oldLevel === 2 ? "🥈" : oldLevel === 1 ? "🥉" : "—";
    const levelName = oldLevel === 3 ? "Senior Admin" : oldLevel === 2 ? "Mid Admin" : oldLevel === 1 ? "Junior Admin" : "Admin";

    return message.reply(
      `✅ Admin removed successfully!\n\n` +
      `👤 Name: ${userName}\n` +
      `🆔 ID: ${targetID}\n` +
      `📊 Was: ${levelEmoji} Level ${oldLevel || "?"} — ${levelName}\n\n` +
      `Removed by: ${senderID}`
    );
  }
};
