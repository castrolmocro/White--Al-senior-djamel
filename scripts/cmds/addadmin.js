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
  // If registered in our levels system → must be level 3
  if (levels[id] !== undefined) return levels[id] === 3;
  // If not in our levels system but in config.adminBot → original top-level admin
  const adminBot = global.GoatBot.config.adminBot || [];
  return adminBot.includes(id);
}

function extractIDFromURL(text) {
  // facebook.com/profile.php?id=123456
  const match1 = text.match(/(?:facebook\.com|fb\.com)\/profile\.php\?id=(\d+)/i);
  if (match1) return match1[1];
  // facebook.com/123456789 (pure numeric)
  const match2 = text.match(/(?:facebook\.com|fb\.com)\/(\d+)/i);
  if (match2) return match2[1];
  // pure numeric ID
  if (/^\d{5,20}$/.test(text.trim())) return text.trim();
  return null;
}

module.exports = {
  config: {
    name: "addadmin",
    version: "1.0",
    author: "Custom",
    countDown: 5,
    role: 2,
    description: "Add a bot admin with a level (1, 2, or 3). Only top-level bot admins can use this.",
    category: "admin",
    guide: {
      en: "  {pn} [level 1-3] — reply to a message\n  {pn} [level 1-3] [ID]\n  {pn} [level 1-3] [Facebook URL]\n\nExamples:\n  /addadmin 2 (reply to someone)\n  /addadmin 1 123456789\n  /addadmin 3 https://facebook.com/profile.php?id=123"
    }
  },

  onStart: async function ({ api, event, args, message, usersData }) {
    const { senderID, threadID } = event;
    const config = global.GoatBot.config;

    if (!isTopAdmin(senderID)) {
      return message.reply("🚫 This command is restricted to Level 3 (Senior) admins only.");
    }

    const level = parseInt(args[0]);
    if (isNaN(level) || level < 1 || level > 3) {
      return message.reply(
        "❌ Please specify a valid level (1, 2, or 3).\n\n" +
        "Usage:\n" +
        "• Reply to someone: /addadmin [level]\n" +
        "• By ID: /addadmin [level] [ID]\n" +
        "• By URL: /addadmin [level] [Facebook URL]\n\n" +
        "Levels:\n" +
        "🥉 Level 1 — Junior admin\n" +
        "🥈 Level 2 — Mid admin\n" +
        "🥇 Level 3 — Senior admin"
      );
    }

    let targetID = null;

    // Method 1: Reply to a message
    if (event.messageReply && !args[1]) {
      targetID = event.messageReply.senderID;
    }
    // Method 2: ID or URL in args[1]
    else if (args[1]) {
      targetID = extractIDFromURL(args[1]);
      if (!targetID) {
        return message.reply("❌ Could not extract a valid Facebook ID from the provided input.\n\nPlease use:\n• A numeric ID (e.g. 123456789)\n• A Facebook URL with a numeric ID");
      }
    }
    // Method 3: Mentions
    else if (Object.keys(event.mentions).length > 0) {
      targetID = Object.keys(event.mentions)[0];
    }

    if (!targetID) {
      return message.reply(
        "❌ Please specify who to add as admin:\n" +
        "• Reply to their message\n" +
        "• Provide their ID or Facebook URL\n\n" +
        "Example: /addadmin 2 123456789"
      );
    }

    targetID = String(targetID);

    // Prevent adding yourself
    if (targetID === String(senderID)) {
      return message.reply("❌ You cannot add yourself.");
    }

    // Prevent adding the bot itself
    const botID = String(global.GoatBot.botID || global.botID);
    if (targetID === botID) {
      return message.reply("❌ Cannot add the bot as an admin.");
    }

    const levels = loadLevels();
    const alreadyExists = levels[targetID] !== undefined;
    const oldLevel = levels[targetID];

    // Update levels file
    levels[targetID] = level;
    saveLevels(levels);

    // Add to config.adminBot if not already there
    if (!config.adminBot.includes(targetID)) {
      config.adminBot.push(targetID);
      writeFileSync(global.client.dirConfig, JSON.stringify(config, null, 2));
    }

    let userName = targetID;
    try {
      userName = (await usersData.getName(targetID)) || targetID;
    } catch (e) {}

    const levelEmoji = level === 3 ? "🥇" : level === 2 ? "🥈" : "🥉";
    const levelName = level === 3 ? "Senior Admin" : level === 2 ? "Mid Admin" : "Junior Admin";

    if (alreadyExists) {
      return message.reply(
        `✅ Admin level updated!\n\n` +
        `👤 Name: ${userName}\n` +
        `🆔 ID: ${targetID}\n` +
        `📊 Level: ${levelEmoji} Level ${oldLevel} → Level ${level} (${levelName})\n\n` +
        `Added by: ${senderID}`
      );
    }

    return message.reply(
      `✅ New admin added successfully!\n\n` +
      `👤 Name: ${userName}\n` +
      `🆔 ID: ${targetID}\n` +
      `📊 Level: ${levelEmoji} Level ${level} — ${levelName}\n\n` +
      `Added by: ${senderID}`
    );
  }
};
