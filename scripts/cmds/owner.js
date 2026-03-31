module.exports = {
  config: {
    name: "owner",
    version: "1.3.0",
    author: "Mᴏʜᴀᴍᴍᴀᴅ Aᴋᴀsʜ",
    role: 0,
    shortDescription: "Owner information",
    category: "Information",
    guide: {
      en: "owner"
    }
  },

  onStart: async function ({ api, event }) {
    const ownerText =
`╭─ 👑 Oᴡɴᴇʀ Iɴғᴏ 👑 ─╮
│ 👤 Nᴀᴍᴇ       : DJAMEL
│ 🧸 Nɪᴄᴋ       : L7WAK
│ 🎂 Aɢᴇ        : 16
│ 💘 Rᴇʟᴀᴛɪᴏɴ : MARRIED
│ 🎓 Pʀᴏғᴇssɪᴏɴ : Sᴛᴜᴅᴇɴᴛ
│ 📚 Eᴅᴜᴄᴀᴛɪᴏɴ : 2S HIGH SCHOOL
│ 🏡 Lᴏᴄᴀᴛɪᴏɴ : L7WAWK FIHA
╰────────────────╯`;

    api.sendMessage(ownerText, event.threadID, event.messageID);
  }
};
