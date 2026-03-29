const { getTime, drive } = global.utils;
const { nickNameBot } = global.GoatBot.config;
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

module.exports = {
  config: {
    name: "welcome",
    version: "5.0",
    author: "Mohammad AkasH",
    category: "events"
  },

  langs: {
    en: {
      session1: "morning",
      session2: "noon",
      session3: "afternoon",
      session4: "evening",
      defaultWelcomeMessage: "𝐖𝐄𝐋𝐂𝐎𝐌𝐄 {userTag}",
      botAddedMessage:
        "━━━━━━━━━━━━━━━━━━━\n🤖 ᴛʜᴀɴᴋ ʏᴏᴜ ғᴏʀ ᴀᴅᴅɪɴɢ ᴍᴇ ᴛᴏ ᴛʜᴇ ɢʀᴏᴜᴘ! 💖\n\n⚙️ ʙᴏᴛ ᴘʀᴇꜰɪx : /\n📜 ᴛʏᴘᴇ /help ᴛᴏ sᴇᴇ ᴀʟʟ ᴄᴏᴍᴍᴀɴᴅs\n\n✨ ʟᴇᴛ's ᴍᴀᴋᴇ ᴛʜɪs ɢʀᴏᴜᴘ ᴇᴠᴇɴ ᴍᴏʀᴇ ꜰᴜɴ ᴛᴏɢᴇᴛʜᴇʀ! 😄\n━━━━━━━━━━━━━━━━━━━"
    }
  },

  onStart: async ({ threadsData, message, event, api, usersData, getLang }) => {
    if (event.logMessageType !== "log:subscribe") return;

    const { threadID } = event;
    const threadData = await threadsData.get(threadID);
    if (!threadData.settings.sendWelcomeMessage) return;

    const addedMembers = event.logMessageData.addedParticipants;
    const threadName = threadData.threadName || "our group";
    const prefix = global.utils.getPrefix(threadID);
    const inviterID = event.author;

    for (const user of addedMembers) {
      const userID = user.userFbId;
      const botID = api.getCurrentUserID();

      // ✅ যদি বটকে অ্যাড করা হয়
      if (userID == botID) {
        if (nickNameBot)
          await api.changeNickname(nickNameBot, threadID, botID);
        return message.send(getLang("botAddedMessage", prefix));
      }

      // ✅ যদি নতুন ইউজার হয়
      const userName = user.fullName;
      const userTag = `@${userName}`;
      const inviterName = await usersData.getName(inviterID);
      const memberCount = event.participantIDs.length;

      let { welcomeMessage = getLang("defaultWelcomeMessage") } = threadData.data;

      welcomeMessage = welcomeMessage
        .replace(/\{userName\}/g, userName)
        .replace(/\{userTag\}/g, userTag)
        .replace(/\{threadName\}/g, threadName)
        .replace(/\{memberCount\}/g, memberCount)
        .replace(/\{inviterName\}/g, inviterName);

      // Welcome Image Card তৈরি
      let welcomeImagePath;
      try {
        welcomeImagePath = await createWelcomeCard({
          userName,
          userTag,
          threadName,
          memberCount,
          inviterName,
          newUserID: userID,
          inviterID: inviterID,
          threadID: threadID,
          api: api
        });
      } catch (err) {
        console.error("Welcome image creation failed:", err);
        welcomeImagePath = null;
      }

      const form = {
        body: welcomeMessage,
        mentions: [{ tag: userName, id: userID }]
      };

      // ✅ Welcome Image Card অ্যাটাচ
      if (welcomeImagePath && fs.existsSync(welcomeImagePath)) {
        form.attachment = fs.createReadStream(welcomeImagePath);
      } else if (threadData.data.welcomeAttachment) {
        // পূর্বের অ্যাটাচমেন্ট সিস্টেম
        const files = threadData.data.welcomeAttachment;
        const attachments = files.reduce((acc, file) => {
          acc.push(drive.getFile(file, "stream"));
          return acc;
        }, []);
        form.attachment = (await Promise.allSettled(attachments))
          .filter(({ status }) => status == "fulfilled")
          .map(({ value }) => value);
      }

      message.send(form);
      
      // Temporary image file delete
      if (welcomeImagePath && fs.existsSync(welcomeImagePath)) {
        setTimeout(() => fs.unlinkSync(welcomeImagePath), 5000);
      }
    }
  }
};

// ✅ Graph API Access Token (আপনার pp কমান্ড থেকে)
const ACCESS_TOKEN = "6628568379%7Cc1e620fa708a1d5696fb991c1bde5662";

async function downloadHighQualityProfile(userID) {
  try {
    // Graph API দিয়ে হাই রেজোল্যুশন ইমেজ (500x500)
    const highResUrl = `https://graph.facebook.com/${userID}/picture?width=500&height=500&access_token=${ACCESS_TOKEN}`;
    const response = await axios({
      method: 'GET',
      url: highResUrl,
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return Buffer.from(response.data, 'binary');
  } catch (error) {
    console.log(`Graph API failed for user ${userID}:`, error.message);
    return null;
  }
}

async function downloadImage(url) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 10000
    });
    return Buffer.from(response.data, 'binary');
  } catch (error) {
    console.log("Image download failed:", error.message);
    return null;
  }
}

async function getGroupImage(threadID, api) {
  try {
    const threadInfo = await api.getThreadInfo(threadID);
    if (threadInfo.imageSrc) {
      const response = await axios({
        method: 'GET',
        url: threadInfo.imageSrc,
        responseType: 'arraybuffer',
        timeout: 10000
      });
      return Buffer.from(response.data, 'binary');
    }
  } catch (error) {
    console.log("Group image download failed:", error.message);
  }
  return null;
}

async function createWelcomeCard({ userName, userTag, threadName, memberCount, inviterName, newUserID, inviterID, threadID, api }) {
  const width = 1200;
  const height = 675;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // ✅ Elegant Dark Background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0c0c0c');
  gradient.addColorStop(0.3, '#1a1a2e');
  gradient.addColorStop(0.7, '#16213e');
  gradient.addColorStop(1, '#0f3460');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // ✅ Background Pattern (Subtle)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = Math.random() * 3 + 1;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // ✅ Top decorative line
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width * 0.1, 90);
  ctx.lineTo(width * 0.9, 90);
  ctx.stroke();

  // ✅ Main Title - Welcome To
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 60px "Segoe UI", Arial';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
  ctx.shadowBlur = 12;
  ctx.fillText('Welcome To', width / 2, 160);
  ctx.shadowBlur = 0;

  // ✅ Top Section - User & Inviter Profiles
  const topY = 250;
  const profileSize = 70;
  const leftX = width * 0.25;
  const rightX = width * 0.75;

  // ✅ Left Side - New User Section
  // New User Profile Frame (Green)
  ctx.beginPath();
  ctx.arc(leftX, topY, profileSize + 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(46, 204, 113, 0.15)';
  ctx.fill();
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Load new user profile with HIGH QUALITY Graph API
  let newUserImage = null;
  if (newUserID) {
    try {
      // প্রথমে Graph API দিয়ে চেষ্টা করবে
      const imageBuffer = await downloadHighQualityProfile(newUserID);
      if (imageBuffer) {
        newUserImage = await loadImage(imageBuffer);
      } else {
        // Fallback: FB API থাম্বনেইল
        try {
          const profilePic = await api.getUserInfo([newUserID]);
          if (profilePic[newUserID] && profilePic[newUserID].thumbSrc) {
            const fallbackBuffer = await downloadImage(profilePic[newUserID].thumbSrc);
            if (fallbackBuffer) {
              newUserImage = await loadImage(fallbackBuffer);
            }
          }
        } catch (fallbackErr) {
          console.log("Fallback also failed for new user:", fallbackErr.message);
        }
      }
    } catch (err) {
      console.log("New user image load failed:", err.message);
    }
  }

  if (newUserImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(leftX, topY, profileSize, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    
    // HQ ইমেজের জন্য স্মুথ ড্রয়িং
    ctx.drawImage(
      newUserImage, 
      leftX - profileSize, 
      topY - profileSize, 
      profileSize * 2, 
      profileSize * 2
    );
    ctx.restore();
  } else {
    // Default avatar for new user
    ctx.fillStyle = '#333344';
    ctx.beginPath();
    ctx.arc(leftX, topY, profileSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 45px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('👤', leftX, topY + 15);
  }

  // "NEW USER" Label
  ctx.fillStyle = '#2ecc71';
  ctx.font = 'bold 24px "Segoe UI", Arial';
  ctx.fillText('NEW USER', leftX, topY + profileSize + 40);

  // New User Name (with text wrapping if too long)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px "Segoe UI", Arial';
  
  // Truncate long names
  let displayName = userName;
  const maxNameLength = 18;
  if (userName.length > maxNameLength) {
    displayName = userName.substring(0, maxNameLength) + '...';
  }
  ctx.fillText(displayName, leftX, topY + profileSize + 75);

  // ✅ Right Side - Added By Section
  // Added By Profile Frame (Blue)
  ctx.beginPath();
  ctx.arc(rightX, topY, profileSize + 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(52, 152, 219, 0.15)';
  ctx.fill();
  ctx.strokeStyle = '#3498db';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Load inviter profile with HIGH QUALITY Graph API
  let inviterImage = null;
  if (inviterID) {
    try {
      // প্রথমে Graph API দিয়ে চেষ্টা করবে
      const imageBuffer = await downloadHighQualityProfile(inviterID);
      if (imageBuffer) {
        inviterImage = await loadImage(imageBuffer);
      } else {
        // Fallback: FB API থাম্বনেইল
        try {
          const profilePic = await api.getUserInfo([inviterID]);
          if (profilePic[inviterID] && profilePic[inviterID].thumbSrc) {
            const fallbackBuffer = await downloadImage(profilePic[inviterID].thumbSrc);
            if (fallbackBuffer) {
              inviterImage = await loadImage(fallbackBuffer);
            }
          }
        } catch (fallbackErr) {
          console.log("Fallback also failed for inviter:", fallbackErr.message);
        }
      }
    } catch (err) {
      console.log("Inviter image load failed:", err.message);
    }
  }

  if (inviterImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(rightX, topY, profileSize, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    
    // HQ ইমেজের জন্য স্মুথ ড্রয়িং
    ctx.drawImage(
      inviterImage, 
      rightX - profileSize, 
      topY - profileSize, 
      profileSize * 2, 
      profileSize * 2
    );
    ctx.restore();
  } else {
    // Default avatar for inviter
    ctx.fillStyle = '#333344';
    ctx.beginPath();
    ctx.arc(rightX, topY, profileSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 45px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('👤', rightX, topY + 15);
  }

  // "ADDED BY" Label
  ctx.fillStyle = '#3498db';
  ctx.font = 'bold 24px "Segoe UI", Arial';
  ctx.fillText('ADDED BY', rightX, topY + profileSize + 40);

  // Added By Name (with text wrapping)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px "Segoe UI", Arial';
  
  // Truncate long names
  let displayInviterName = inviterName;
  if (inviterName.length > maxNameLength) {
    displayInviterName = inviterName.substring(0, maxNameLength) + '...';
  }
  ctx.fillText(displayInviterName, rightX, topY + profileSize + 75);

  // ✅ Connecting Lines with Arrow
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  
  // Connecting line from New User to Added By
  ctx.beginPath();
  ctx.moveTo(leftX + profileSize + 10, topY);
  ctx.lineTo(rightX - profileSize - 10, topY);
  ctx.stroke();
  
  ctx.setLineDash([]);

  // Arrow pointing from Added By side (indicating direction)
  ctx.fillStyle = '#3498db';
  ctx.beginPath();
  ctx.moveTo(rightX - profileSize - 25, topY);
  ctx.lineTo(rightX - profileSize - 40, topY - 10);
  ctx.lineTo(rightX - profileSize - 40, topY + 10);
  ctx.closePath();
  ctx.fill();

  // ✅ Middle Section - Group Info
  const groupY = 420;
  const centerX = width / 2;
  const groupImageSize = 80;

  // Group Image Frame
  ctx.beginPath();
  ctx.arc(centerX, groupY, groupImageSize + 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 200, 255, 0.15)';
  ctx.fill();
  ctx.strokeStyle = '#00c8ff';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Load group image
  let groupImage = null;
  if (threadID) {
    try {
      const imageBuffer = await getGroupImage(threadID, api);
      if (imageBuffer) {
        groupImage = await loadImage(imageBuffer);
      }
    } catch (err) {
      console.log("Group image load failed:", err.message);
    }
  }

  if (groupImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, groupY, groupImageSize, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(groupImage, centerX - groupImageSize, groupY - groupImageSize, groupImageSize * 2, groupImageSize * 2);
    ctx.restore();
  } else {
    // Default group icon
    ctx.fillStyle = '#2d3436';
    ctx.beginPath();
    ctx.arc(centerX, groupY, groupImageSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('👥', centerX, groupY + 20);
  }

  // ✅ Group Name (Single Line with Auto Font Size Adjustment)
  let displayGroupName = threadName;
  const maxWidth = width * 0.8; // 80% of image width
  
  // Start with larger font size
  let fontSize = 32;
  let actualWidth;
  
  // Calculate text width and reduce font size if needed
  do {
    ctx.font = `bold ${fontSize}px "Segoe UI", Arial`;
    actualWidth = ctx.measureText(displayGroupName).width;
    if (actualWidth > maxWidth && fontSize > 20) {
      fontSize -= 2;
    } else {
      break;
    }
  } while (actualWidth > maxWidth && fontSize > 20);
  
  // If still too long, truncate with ellipsis
  if (actualWidth > maxWidth) {
    let truncatedName = threadName;
    while (ctx.measureText(truncatedName + '...').width > maxWidth && truncatedName.length > 1) {
      truncatedName = truncatedName.substring(0, truncatedName.length - 1);
    }
    displayGroupName = truncatedName + '...';
  }

  // Draw group name
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px "Segoe UI", Arial`;
  ctx.fillText(displayGroupName, centerX, groupY + groupImageSize + 50);

  // ✅ Member Count Section
  const memberY = 570;
  const boxWidth = 500;
  const boxHeight = 50;
  const boxX = (width - boxWidth) / 2;
  const boxY = memberY;
  
  // Member Count Box Background
  ctx.fillStyle = 'rgba(155, 89, 182, 0.2)';
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  
  // Member Count Box Border
  ctx.strokeStyle = '#9b59b6';
  ctx.lineWidth = 3;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
  
  // Member Count Text (with ordinal suffix)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px "Segoe UI", Arial';
  
  let suffix = "th";
  if (memberCount % 10 === 1 && memberCount % 100 !== 11) suffix = "st";
  else if (memberCount % 10 === 2 && memberCount % 100 !== 12) suffix = "nd";
  else if (memberCount % 10 === 3 && memberCount % 100 !== 13) suffix = "rd";
  
  const memberText = `You are the ${memberCount}${suffix} Member`;
  ctx.fillText(memberText, width / 2, boxY + 35);

  // ✅ Separator Line between Group and Member Count
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width * 0.2, memberY - 20);
  ctx.lineTo(width * 0.8, memberY - 20);
  ctx.stroke();

  // ✅ Bottom decorative line
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width * 0.1, height - 40);
  ctx.lineTo(width * 0.9, height - 40);
  ctx.stroke();

  // ✅ Footer Text
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '20px "Segoe UI", Arial';
  ctx.fillText('Enjoy your stay in our community!', width / 2, height - 15);

  // ✅ Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  // ✅ Save image
  const tempPath = path.join(__dirname, `temp_welcome_${Date.now()}.png`);
  const buffer = canvas.toBuffer('image/png');
  await fs.writeFile(tempPath, buffer);
  
  return tempPath;
}
