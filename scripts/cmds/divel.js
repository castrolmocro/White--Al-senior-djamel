const fs = require("fs-extra");
const path = require("path");

const dataPath = path.join(process.cwd(), "database/data/divelData.json");

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadData() {
  try {
    if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch (_) {}
  return {};
}

function saveData(data) {
  fs.ensureDirSync(path.dirname(dataPath));
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

// ─── Global state ─────────────────────────────────────────────────────────────

if (!global.GoatBot.divelWatchers) {
  global.GoatBot.divelWatchers = {};
}

// استعادة الغروبات المفعّلة بعد إعادة تشغيل البوت
function restoreWatchers() {
  if (global.GoatBot.divelRestored) return;
  global.GoatBot.divelRestored = true;

  const data = loadData();
  let restored = 0;

  for (const [threadID, td] of Object.entries(data)) {
    if (td.active && td.message) {
      global.GoatBot.divelWatchers[threadID] = {
        active: true,
        message: td.message,
        waitMinutes: td.waitMinutes || 5,
        timer: null
      };
      restored++;
    }
  }

  if (restored > 0 && global.utils?.log?.info) {
    global.utils.log.info("DIVEL", `✅ Restored ${restored} watcher(s) after restart`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isBotAdmin(senderID) {
  const admins = global.GoatBot.config.adminBot || [];
  return admins.includes(String(senderID)) || admins.includes(senderID);
}

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = {
  config: {
    name: "divel",
    aliases: ["devil", "ديفل"],
    version: "1.0",
    author: "Saint",
    countDown: 3,
    role: 0,
    shortDescription: "يراقب الغروب ويرد بعد N دقيقة من آخر رسالة",
    longDescription: "عكس Angel — يراقب المحادثة بصمت، فإذا أرسل أحد رسالة ينتظر N دقيقة ثم يرد برسالته تلقائياً.",
    category: "admin",
    guide: {
      en: "  {pn} on — تفعيل المراقبة في هذا الغروب\n"
        + "  {pn} off — إيقاف المراقبة\n"
        + "  {pn} change [رسالة] — تحديد الرسالة\n"
        + "  {pn} time [دقائق] — تحديد وقت الانتظار\n"
        + "  {pn} status — عرض الحالة\n\n"
        + "مثال:\n"
        + "  /divel change هيا تكلموا! 👿\n"
        + "  /divel time 5\n"
        + "  /divel on"
    }
  },

  onStart: async function ({ api, event, args, message }) {
    const { senderID, threadID } = event;

    if (!isBotAdmin(senderID)) return;

    restoreWatchers();

    const action = args[0]?.toLowerCase();
    const data = loadData();

    if (!data[threadID]) {
      data[threadID] = { message: null, waitMinutes: 5, active: false };
    }
    const td = data[threadID];

    switch (action) {

      // ── تحديد الرسالة
      case "change": {
        const newMsg = args.slice(1).join(" ").trim();
        if (!newMsg) {
          return message.reply(
            "❌ اكتب الرسالة بعد الأمر.\n\nمثال:\n/divel change هيا تكلموا ما هذا الصمت! 👿"
          );
        }
        td.message = newMsg;
        saveData(data);
        if (global.GoatBot.divelWatchers[threadID]) {
          global.GoatBot.divelWatchers[threadID].message = newMsg;
        }
        return message.reply(`✅ تم تحديث الرسالة!\n\n📝 الرسالة الجديدة:\n"${newMsg}"`);
      }

      // ── تحديد وقت الانتظار
      case "time": {
        const mins = parseFloat(args[1]);
        if (isNaN(mins) || mins <= 0) {
          return message.reply(
            "❌ اكتب عدد الدقائق.\n\nمثال:\n/divel time 5"
          );
        }
        td.waitMinutes = mins;
        saveData(data);
        const watcher = global.GoatBot.divelWatchers[threadID];
        if (watcher) {
          watcher.waitMinutes = mins;
          // إيقاف المؤقت الحالي حتى يُحسب من أول رسالة جديدة
          if (watcher.timer) {
            clearTimeout(watcher.timer);
            watcher.timer = null;
          }
        }
        return message.reply(
          `✅ وقت الانتظار: ${mins} دقيقة\n`
          + `💡 بعد كل رسالة من أي شخص في الغروب يعدّ ${mins} دقيقة ثم يرسل.`
        );
      }

      // ── تفعيل
      case "on": {
        if (!td.message) {
          return message.reply(
            "❌ لم تحدد الرسالة بعد.\n\nضع رسالة أولاً:\n/divel change [رسالتك]"
          );
        }

        if (global.GoatBot.divelWatchers[threadID]?.active) {
          return message.reply("⚠️ Divel مفعّل بالفعل في هذا الغروب.");
        }

        td.active = true;
        saveData(data);

        global.GoatBot.divelWatchers[threadID] = {
          active: true,
          message: td.message,
          waitMinutes: td.waitMinutes || 5,
          timer: null
        };

        return message.reply(
          `✅ تم تفعيل Divel! 😈\n\n`
          + `📝 الرسالة: "${td.message}"\n`
          + `⏱️ الانتظار: ${td.waitMinutes} دقيقة بعد آخر رسالة\n\n`
          + `👁️ يراقب المحادثة الآن...`
        );
      }

      // ── إيقاف
      case "off": {
        const watcher = global.GoatBot.divelWatchers[threadID];
        if (!watcher?.active) {
          return message.reply("⚠️ Divel غير مفعّل في هذا الغروب.");
        }
        if (watcher.timer) {
          clearTimeout(watcher.timer);
        }
        delete global.GoatBot.divelWatchers[threadID];
        td.active = false;
        saveData(data);
        return message.reply("✅ تم إيقاف Divel في هذا الغروب.");
      }

      // ── الحالة
      case "status": {
        const watcher = global.GoatBot.divelWatchers[threadID];
        const isActive = watcher?.active || false;
        const hasTimer = !!watcher?.timer;
        return message.reply(
          `😈 حالة Divel\n`
          + `━━━━━━━━━━━━━━━━━━\n`
          + `▪️ الحالة: ${isActive ? "🟢 مفعّل" : "🔴 موقوف"}\n`
          + `▪️ الرسالة: ${td.message ? `"${td.message}"` : "غير محددة"}\n`
          + `▪️ وقت الانتظار: ${td.waitMinutes} دقيقة\n`
          + `▪️ المؤقت: ${hasTimer ? "⏳ يعدّ الآن" : "⏸️ في انتظار رسالة"}`
        );
      }

      // ── مساعدة
      default: {
        return message.reply(
          "😈 أوامر Divel:\n"
          + "━━━━━━━━━━━━━━━━━━\n"
          + "/divel change [رسالة] — تحديد الرسالة\n"
          + "/divel time [دقائق] — وقت الانتظار\n"
          + "/divel on — تفعيل\n"
          + "/divel off — إيقاف\n"
          + "/divel status — الحالة\n\n"
          + "💡 مثال:\n"
          + "/divel change \n"
          + "/divel time 5\n"
          + "/divel on\n\n"
          + "📌 ."
        );
      }
    }
  }
};
