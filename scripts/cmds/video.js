const A = require("axios");
const B = require("fs");
const C = require("path");
const D = require("yt-search");
const E = require("node-fetch");

const F = "https://raw.githubusercontent.com/aryannix/stuffs/master/raw/apis.json";

module.exports = {
  config: {
    name: "video",
    aliases: ["v"],
    version: "0.0.1",
    author: "ArYAN",
    countDown: 5,
    role: 0,
    shortDescription: "Download YouTube video interactively.",
    longDescription: "Search YouTube, display a list of 6 videos, and download the selected one.",
    category: "MUSIC",
    guide: "/video [video name]"
  },

  onStart: async function ({ api, event, args }) {
    if (!args.length)
      return api.sendMessage("❌ Missing video name.", event.threadID, event.messageID);

    const G = args.join(" ");
    
    try {
      const H = await D(G);
      if (!H || !H.videos.length) throw new Error("No video.");

      const I = H.videos.slice(0, 6); 
      
      let J = "🔎 Found 6 videos. Reply with the number to download:\n\n";
      const K = [];
      const L = []; 

      for (let i = 0; i < I.length; i++) {
        const M = I[i];
        
        const N = await A.get(M.thumbnail, { responseType: 'stream' });
        L.push(N.data);
        
        const O = M.views.toLocaleString();
        
        J += `${i + 1}. ${M.title}\nTime: ${M.timestamp}\nChannel: ${M.author.name}\nViews: ${O}\n\n`;
        
        K.push({ 
            title: M.title,
            url: M.url,
            channel: M.author.name,
            views: O
        });
      }

      const P = await api.sendMessage(
        { body: J, attachment: L },
        event.threadID
      );
      
      global.GoatBot.onReply.set(P.messageID, {
        commandName: this.config.name,
        author: event.senderID,
        videos: K,
        listMessageID: P.messageID 
      });

    } catch (err) {
      let Q = err.message.includes("No video") ? "No video found." : "Search error.";
      api.sendMessage(`❌ Error: ${Q}`, event.threadID, event.messageID);
    }
  },
  
  onReply: async function({ api, event, Reply }) {
    if (event.senderID !== Reply.author) return;

    if (Reply.listMessageID) {
        api.unsendMessage(Reply.listMessageID);
    }
    
    global.GoatBot.onReply.delete(event.messageReply.messageID);


    const R = parseInt(event.body.trim());
    if (isNaN(R) || R < 1 || R > Reply.videos.length) {
      return api.sendMessage("❌ Invalid selection. Choose 1-6.", event.threadID, event.messageID);
    }
    
    const S = Reply.videos[R - 1];
    const T = S.url;
    
    let U;
    try {
      const V = await A.get(F);
      U = V.data && V.data.nixtube; 
      if (!U) throw new Error("Config error.");
    } catch (error) {
      return api.sendMessage("❌ Config fetch error.", event.threadID, event.messageID);
    }
    
    try {
      const W = `${U}?url=${encodeURIComponent(T)}&type=video`;
      
      const X = await A.get(W);

      if (!X.data.status || !X.data.downloadUrl) {
          throw new Error("Link fetch error.");
      }
      
      const Y = X.data.downloadUrl;

      const Z = await E(Y);
      if (!Z.ok) throw new Error("Download failed.");

      const a = await Z.buffer();
      const b = `${S.title}.mp4`.replace(/[\/\\:*?"<>|]/g, "").substring(0, 100); 
      const c = C.join(__dirname, b);

      B.writeFileSync(c, a);
      
      const d = `• Title: ${S.title}\n• Channel Name: ${S.channel}\n• Quality: ${X.data.quality || 'N/A'}\n• Views: ${S.views || 'N/A'}`;


      await api.sendMessage(
        { 
          body: d,
          attachment: B.createReadStream(c) 
        },
        event.threadID,
        () => {
          B.unlinkSync(c);
        },
        event.messageID
      );

    } catch (err) {
      let e = err.message.includes("Link fetch error") || err.message.includes("Download failed") ? err.message : "Download error.";
      api.sendMessage(`❌ Error: ${e}`, event.threadID, event.messageID);
    }
  }
};
