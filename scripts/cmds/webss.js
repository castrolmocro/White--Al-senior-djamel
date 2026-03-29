const axios = require("axios");
const fs = require("fs");
const path = require("path");

module.exports = {
  config: {
    name: "webss",
    version: "1.1",
    author: "MOHAMMAD AKASH",
    countDown: 5,
    role: 2,
    shortDescription: {
      en: "Website screenshot"
    },
    description: {
      en: "Take a full page screenshot of any website"
    },
    category: "Ai",
    guide: {
      en: "{p}webss <url>\nExample: {p}webss https://google.com"
    }
  },

  langs: {
    en: {
      missing:
        "⚠️  Pʟᴇᴀsᴇ Pʀᴏᴠɪᴅᴇ A Vᴀʟɪᴅ Uʀʟ\n📌  Eɢ : webss https://example.com",
      loading:
        "📸  Wᴇʙ Sᴄʀᴇᴇɴsʜᴏᴛ Tᴀᴋɪɴɢ...\n🌐  %1",
      error:
        "❌  Sᴄʀᴇᴇɴsʜᴏᴛ Fᴀɪʟᴇᴅ\n🌐  Iɴᴠᴀʟɪᴅ Oʀ Bʟᴏᴄᴋᴇᴅ Uʀʟ"
    }
  },

  onStart: async function ({ message, args, getLang }) {
    if (!args[0]) return message.reply(getLang("missing"));

    const url = args[0].startsWith("http")
      ? args[0]
      : `https://${args[0]}`;

    await message.reply(getLang("loading", url));

    try {
      const res = await axios.get(
        `https://api.popcat.xyz/v2/screenshot?url=${encodeURIComponent(url)}`,
        { responseType: "arraybuffer" }
      );

      const cacheDir = path.join(__dirname, "cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

      const filePath = path.join(
        cacheDir,
        `webss_${Date.now()}.png`
      );

      fs.writeFileSync(filePath, res.data);

      await message.reply(
        {
          body:
            "📸  Wᴇʙsɪᴛᴇ Sᴄʀᴇᴇɴsʜᴏᴛ\n\n" +
            `🌐  Uʀʟ : ${url}\n` +
            "🖼️  Tʏᴘᴇ : Fᴜʟʟ Pᴀɢᴇ\n" +
            "⚡  Sᴛᴀᴛᴜs : Sᴜᴄᴄᴇss",
          attachment: fs.createReadStream(filePath)
        },
        () => fs.unlinkSync(filePath)
      );
    } catch (err) {
      console.error(err);
      message.reply(getLang("error"));
    }
  }
};
