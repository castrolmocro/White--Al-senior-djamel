const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
const WebSocket = require("ws");

// ─── Language codes (40+ languages) ───────────────────────────────────────
const LANG_CODES = {
  ar: "Arabic",      en: "English",     bn: "Bengali",     fr: "French",
  es: "Spanish",     tr: "Turkish",     ur: "Urdu",        hi: "Hindi",
  de: "German",      it: "Italian",     ru: "Russian",     zh: "Chinese",
  ja: "Japanese",    ko: "Korean",      pt: "Portuguese",  nl: "Dutch",
  fa: "Persian",     id: "Indonesian",  ms: "Malay",       th: "Thai",
  vi: "Vietnamese",  pl: "Polish",      sv: "Swedish",     ro: "Romanian",
  el: "Greek",       cs: "Czech",       hu: "Hungarian",   uk: "Ukrainian",
  he: "Hebrew",      fil: "Filipino",   ta: "Tamil",       te: "Telugu",
  gu: "Gujarati",    mr: "Marathi",     pa: "Punjabi",     sk: "Slovak",
  hr: "Croatian",    bg: "Bulgarian",   da: "Danish",      fi: "Finnish",
  no: "Norwegian",   ca: "Catalan"
};

// ─── Edge TTS voice map: langCode → { f: female, m: male } ────────────────
const EDGE_VOICES = {
  ar:  { f: "ar-EG-SalmaNeural",        m: "ar-SA-HamedNeural"       },
  en:  { f: "en-US-AriaNeural",          m: "en-US-GuyNeural"         },
  fr:  { f: "fr-FR-DeniseNeural",        m: "fr-FR-HenriNeural"       },
  es:  { f: "es-ES-ElviraNeural",        m: "es-ES-AlvaroNeural"      },
  de:  { f: "de-DE-KatjaNeural",         m: "de-DE-ConradNeural"      },
  it:  { f: "it-IT-ElsaNeural",          m: "it-IT-DiegoNeural"       },
  ja:  { f: "ja-JP-NanamiNeural",        m: "ja-JP-KeitaNeural"       },
  ko:  { f: "ko-KR-SunHiNeural",         m: "ko-KR-InJoonNeural"      },
  zh:  { f: "zh-CN-XiaoxiaoNeural",      m: "zh-CN-YunxiNeural"       },
  hi:  { f: "hi-IN-SwaraNeural",         m: "hi-IN-MadhurNeural"      },
  tr:  { f: "tr-TR-EmelNeural",          m: "tr-TR-AhmetNeural"       },
  ru:  { f: "ru-RU-SvetlanaNeural",      m: "ru-RU-DmitryNeural"      },
  pt:  { f: "pt-BR-FranciscaNeural",     m: "pt-BR-AntonioNeural"     },
  bn:  { f: "bn-IN-TanishaaNeural",      m: "bn-IN-BashkarNeural"     },
  ur:  { f: "ur-PK-UzmaNeural",          m: "ur-PK-AsadNeural"        },
  fa:  { f: "fa-IR-DilaraNeural",        m: "fa-IR-FaridNeural"       },
  id:  { f: "id-ID-GadisNeural",         m: "id-ID-ArdiNeural"        },
  ms:  { f: "ms-MY-YasminNeural",        m: "ms-MY-OsmanNeural"       },
  th:  { f: "th-TH-PremwadeeNeural",     m: "th-TH-NiwatNeural"       },
  vi:  { f: "vi-VN-HoaiMyNeural",        m: "vi-VN-NamMinhNeural"     },
  pl:  { f: "pl-PL-ZofiaNeural",         m: "pl-PL-MarekNeural"       },
  sv:  { f: "sv-SE-SofieNeural",         m: "sv-SE-MattiasNeural"     },
  ro:  { f: "ro-RO-AlinaNeural",         m: "ro-RO-EmilNeural"        },
  nl:  { f: "nl-NL-ColetteNeural",       m: "nl-NL-MaartenNeural"     },
  el:  { f: "el-GR-AthinaNeural",        m: "el-GR-NestorasNeural"    },
  cs:  { f: "cs-CZ-VlastaNeural",        m: "cs-CZ-AntoninNeural"     },
  hu:  { f: "hu-HU-NoemiNeural",         m: "hu-HU-TamasNeural"       },
  uk:  { f: "uk-UA-PolinaNeural",        m: "uk-UA-OstapNeural"       },
  he:  { f: "he-IL-HilaNeural",          m: "he-IL-AvriNeural"        },
  fil: { f: "fil-PH-BlessicaNeural",     m: "fil-PH-AngeloNeural"     },
  ta:  { f: "ta-IN-PallaviNeural",       m: "ta-IN-ValluvarNeural"    },
  te:  { f: "te-IN-ShrutiNeural",        m: "te-IN-MohanNeural"       },
  gu:  { f: "gu-IN-DhwaniNeural",        m: "gu-IN-NiranjanNeural"    },
  mr:  { f: "mr-IN-AarohiNeural",        m: "mr-IN-ManoharNeural"     },
  sk:  { f: "sk-SK-ViktoriaNeural",      m: "sk-SK-LukasNeural"       },
  hr:  { f: "hr-HR-GabrijelaNeural",     m: "hr-HR-SreckoNeural"      },
  bg:  { f: "bg-BG-KalinaNeural",        m: "bg-BG-BorislavNeural"    },
  da:  { f: "da-DK-ChristelNeural",      m: "da-DK-JeppeNeural"       },
  fi:  { f: "fi-FI-NooraNeural",         m: "fi-FI-HarriNeural"       },
  no:  { f: "nb-NO-PernilleNeural",      m: "nb-NO-FinnNeural"        },
  ca:  { f: "ca-ES-JoanaNeural",         m: "ca-ES-EnricNeural"       },
  pa:  { f: "pa-IN-OjasweeNeural",       m: "pa-IN-SurbirNeural"      }
};

// Arabic-like languages that use Arabic EDGE voices
const ARABIC_FAMILY = new Set(["ar"]);
// Languages that use Google TTS as fallback (no Edge TTS voice available)
const GOOGLE_FALLBACK = new Set(["sw", "am", "so", "ha"]);

// ─── Voice presets ─────────────────────────────────────────────────────────
// gender: "f" = female voices, "m" = male voices
// enStyle: SSML style applied ONLY for English (other languages use neutral tone)
const VOICES = {
  normal: { label: "🌐 Normal",     desc: "Classic voice — 40+ languages (Google TTS)",  engine: "google" },
  girl:   { label: "👧 Cute Girl",  desc: "Cute cheerful girl — all 40+ languages",       engine: "edge", gender: "f", enStyle: "cheerful" },
  woman:  { label: "👩 Woman",      desc: "Natural woman voice — all 40+ languages",      engine: "edge", gender: "f", enStyle: "friendly" },
  male:   { label: "🧔 Male",       desc: "Confident male voice — all 40+ languages",     engine: "edge", gender: "m", enStyle: "newscast" },
  deep:   { label: "💪 Deep Male",  desc: "Strong deep male — all 40+ languages",         engine: "edge", gender: "m", enStyle: "angry" },
  anime:  { label: "🎌 Anime",      desc: "Excited anime-style — all 40+ languages",      engine: "edge", gender: "f", enStyle: "excited" },
  news:   { label: "📰 News",       desc: "Professional news anchor — all 40+ languages", engine: "edge", gender: "f", enStyle: "newscast-formal" },
  soft:   { label: "🌸 Soft",       desc: "Soft whispering voice — all 40+ languages",    engine: "edge", gender: "f", enStyle: "whispering" },
  sad:    { label: "😢 Sad",        desc: "Sad emotional voice — all 40+ languages",      engine: "edge", gender: "f", enStyle: "sad" }
};

// ─── Language auto-detect ──────────────────────────────────────────────────
async function detectLang(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text.slice(0, 100))}`;
    const res = await axios.get(url, { timeout: 5000 });
    return res.data?.[2] || "en";
  } catch {
    return "en";
  }
}

// ─── Pick Edge TTS voice based on language and style gender ───────────────
function pickEdgeVoice(voiceConfig, lang) {
  const langVoices = EDGE_VOICES[lang] || EDGE_VOICES["en"];
  const voice = langVoices[voiceConfig.gender] || langVoices.f;
  // SSML styles are only reliably supported for English voices
  const style = (lang === "en" && voiceConfig.enStyle) ? voiceConfig.enStyle : null;
  return { voice, style };
}

// ─── Edge TTS via WebSocket (Microsoft AI) ────────────────────────────────
function buildSSML(text, voice, style) {
  const langTag = voice.slice(0, 5);
  if (style) {
    return (
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' ` +
      `xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='${langTag}'>` +
      `<voice name='${voice}'><mstts:express-as style='${style}'>` +
      escapeXML(text) +
      `</mstts:express-as></voice></speak>`
    );
  }
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langTag}'>` +
    `<voice name='${voice}'>${escapeXML(text)}</voice></speak>`
  );
}

function escapeXML(str) {
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function edgeTTS(text, voice, style) {
  return new Promise((resolve, reject) => {
    const connId = crypto.randomBytes(16).toString("hex").toUpperCase();
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=${connId}`;
    const ws = new WebSocket(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const chunks = [];
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { done = true; ws.terminate(); reject(new Error("Edge TTS timeout")); }
    }, 20000);
    ws.on("open", () => {
      const ts = new Date().toISOString();
      ws.send(
        `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
      );
      ws.send(
        `X-RequestId:${connId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n` +
        buildSSML(text, voice, style)
      );
    });
    ws.on("message", (data) => {
      if (Buffer.isBuffer(data)) {
        const headerLen = data.readUInt16BE(0);
        const audio = data.slice(2 + headerLen);
        if (audio.length > 0) chunks.push(audio);
      } else if (typeof data === "string" && data.includes("Path:turn.end")) {
        done = true; clearTimeout(timeout); ws.close(); resolve(Buffer.concat(chunks));
      }
    });
    ws.on("error", (err) => { if (!done) { done = true; clearTimeout(timeout); reject(err); } });
    ws.on("close", () => { if (!done && chunks.length > 0) { done = true; clearTimeout(timeout); resolve(Buffer.concat(chunks)); } });
  });
}

// ─── Google TTS (normal voice / fallback) ─────────────────────────────────
async function googleTTS(text, lang) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
  const res = await axios.get(url, {
    responseType: "arraybuffer", timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  return Buffer.from(res.data);
}

// ─── Main command ──────────────────────────────────────────────────────────
module.exports = {
  config: {
    name: "say",
    version: "6.0",
    author: "Custom",
    countDown: 5,
    role: 0,
    shortDescription: "AI Text-to-Voice — 40+ languages, 9 voice styles",
    longDescription: "Converts text to voice using Microsoft AI (Edge TTS). Supports 40+ languages with 9 voice styles. Voice preference saved permanently per group.",
    category: "media",
    guide: {
      en:
        "  {pn} [text]           — Speak (auto-detect language)\n" +
        "  {pn} ar [نص]          — Force Arabic\n" +
        "  {pn} voice [name]     — Change voice style\n" +
        "  {pn} voices           — List all voices\n" +
        "  {pn} langs            — List all 40+ languages\n" +
        "  {pn} commands         — Show this help\n\n" +
        "Voices: normal girl woman male deep anime news soft sad"
    }
  },

  onStart: async function ({ api, event, args, threadsData }) {
    const { threadID, messageID, senderID } = event;

    // ── Get saved voice from threadsData (persists across restarts) ──────────
    const savedVoice = await threadsData.get(threadID, "data.sayVoice").catch(() => null);
    const currentVoice = (savedVoice && VOICES[savedVoice]) ? savedVoice : "normal";

    // ── /say commands ────────────────────────────────────────────────────────
    if (args[0]?.toLowerCase() === "commands") {
      return api.sendMessage(
        `📖 /say — كيفية الاستخدام\n\n` +
        `🔹 /say [نص]          — يتكلم بالصوت الحالي\n` +
        `🔹 /say ar [نص]       — إجبار العربية\n` +
        `🔹 /say en [نص]       — إجبار الإنجليزية\n` +
        `🔹 /say voice [اسم]   — تغيير الصوت\n` +
        `🔹 /say voices        — عرض كل الأصوات\n` +
        `🔹 /say langs         — عرض كل اللغات (40+)\n` +
        `🔹 /say commands      — عرض هذه القائمة\n\n` +
        `🎙 الأصوات: normal, girl, woman, male, deep, anime, news, soft, sad\n\n` +
        `✅ الصوت الحالي: ${VOICES[currentVoice]?.label || currentVoice}\n\n` +
        `مثال:\n• /say مرحبا بالجميع\n• /say voice anime\n• /say ar أهلاً وسهلاً`,
        threadID, messageID
      );
    }

    // ── /say voices ──────────────────────────────────────────────────────────
    if (args[0]?.toLowerCase() === "voices") {
      const list = Object.entries(VOICES)
        .map(([key, v]) => `${v.label} — /say voice ${key}\n   ${v.desc}`)
        .join("\n\n");
      return api.sendMessage(
        `🎙 Available Voices:\n\n${list}\n\n` +
        `✅ Current: ${VOICES[currentVoice]?.label || currentVoice}\n\n` +
        `To change: /say voice [name]`,
        threadID, messageID
      );
    }

    // ── /say langs ───────────────────────────────────────────────────────────
    if (args[0]?.toLowerCase() === "langs") {
      const list = Object.entries(LANG_CODES).map(([c, n]) => `• ${c} — ${n}`).join("\n");
      return api.sendMessage(
        `🌍 Supported Languages (40+):\n\n${list}\n\nExample: /say ar مرحبا`,
        threadID, messageID
      );
    }

    // ── /say voice [name] ────────────────────────────────────────────────────
    if (args[0]?.toLowerCase() === "voice") {
      const vName = args[1]?.toLowerCase();
      if (!vName || !VOICES[vName]) {
        const list = Object.keys(VOICES).join(", ");
        return api.sendMessage(
          `❌ Unknown voice.\n\nAvailable: ${list}\n\nExample: /say voice girl`,
          threadID, messageID
        );
      }
      // Save to threadsData — persists across bot restarts
      await threadsData.set(threadID, vName, "data.sayVoice");
      const v = VOICES[vName];
      return api.sendMessage(
        `✅ Voice changed!\n\n${v.label}\n${v.desc}\n\n` +
        `${v.engine === "edge" ? "🤖 Microsoft AI — supports all 40+ languages!" : "✅ Supports all 40+ languages."}`,
        threadID, messageID
      );
    }

    // ── /say [text] ──────────────────────────────────────────────────────────
    let text = "";
    let forceLang = null;

    if (!args[0]) {
      const replyText = event.messageReply?.body;
      if (!replyText) {
        return api.sendMessage(
          `🎙 Current voice: ${VOICES[currentVoice]?.label || currentVoice}\n\n` +
          `Usage:\n• /say [text]\n• /say ar [text]\n• /say voice [name]\n• /say voices`,
          threadID, messageID
        );
      }
      text = replyText;
    } else {
      const firstWord = args[0].toLowerCase();
      if (LANG_CODES[firstWord]) {
        forceLang = firstWord;
        text = args.slice(1).join(" ").trim();
        if (!text) return api.sendMessage(`❌ Add text after language code.\nExample: /say ${forceLang} hello`, threadID, messageID);
      } else {
        text = args.join(" ").trim();
      }
    }

    const voiceConfig = VOICES[currentVoice] || VOICES.normal;
    const cacheDir = path.join(__dirname, "cache");
    await fs.ensureDir(cacheDir);
    const filePath = path.join(cacheDir, `say_${senderID}_${Date.now()}.mp3`);

    try {
      let audioBuffer;
      let infoLine = "";

      const detectedLang = forceLang || (await detectLang(text));
      const lang = LANG_CODES[detectedLang] ? detectedLang : "en";
      const langName = LANG_CODES[lang] || lang;

      if (voiceConfig.engine === "google" || GOOGLE_FALLBACK.has(lang)) {
        audioBuffer = await googleTTS(text, lang);
        infoLine = `🌐 Normal | 🌍 ${langName}`;
      } else {
        const { voice, style } = pickEdgeVoice(voiceConfig, lang);
        audioBuffer = await edgeTTS(text, voice, style);
        infoLine = `${voiceConfig.label} | 🌍 ${langName} | 🤖 AI`;
      }

      await fs.writeFile(filePath, audioBuffer);
      await api.sendMessage(
        { body: `🔊 ${infoLine}`, attachment: fs.createReadStream(filePath) },
        threadID,
        () => fs.remove(filePath).catch(() => {})
      );

    } catch (err) {
      await fs.remove(filePath).catch(() => {});
      console.error("Say command error:", err.message);

      // Fallback: try Google TTS if Edge fails
      if (voiceConfig.engine === "edge") {
        try {
          const lang = forceLang || (await detectLang(text));
          const validLang = LANG_CODES[lang] ? lang : "en";
          const audio = await googleTTS(text, validLang);
          const fallbackPath = path.join(cacheDir, `say_fb_${senderID}_${Date.now()}.mp3`);
          await fs.writeFile(fallbackPath, audio);
          return await api.sendMessage(
            { body: `🔊 Fallback | 🌍 ${LANG_CODES[validLang] || validLang}`, attachment: fs.createReadStream(fallbackPath) },
            threadID,
            () => fs.remove(fallbackPath).catch(() => {})
          );
        } catch {}
      }

      return api.sendMessage(
        "❌ Failed to generate voice. Try again or use /say voice normal",
        threadID, messageID
      );
    }
  }
};

