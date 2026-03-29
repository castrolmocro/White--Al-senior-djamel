const fs = require("fs-extra");
const path = require("path");

const angelDataPath = path.join(process.cwd(), "database/data/angelData.json");

function isBotAdmin(senderID) {
  const admins = global.GoatBot.config.adminBot || [];
  return admins.includes(String(senderID)) || admins.includes(senderID);
}

function loadAngelData() {
  try {
    if (fs.existsSync(angelDataPath)) return JSON.parse(fs.readFileSync(angelDataPath, "utf8"));
  } catch (e) {}
  return {};
}

function saveAngelData(data) {
  fs.ensureDirSync(path.dirname(angelDataPath));
  fs.writeFileSync(angelDataPath, JSON.stringify(data, null, 2));
}

function startAngelInterval(api, threadID, threadData) {
  if (global.GoatBot.angelIntervals?.[threadID]) {
    clearInterval(global.GoatBot.angelIntervals[threadID]);
  }
  if (!global.GoatBot.angelIntervals) global.GoatBot.angelIntervals = {};
  const ms = (threadData.intervalMinutes || 10) * 60 * 1000;
  global.GoatBot.angelIntervals[threadID] = setInterval(() => {
    api.sendMessage(threadData.message, threadID).catch(() => {});
  }, ms);
}

function stopAngelInterval(threadID) {
  if (global.GoatBot.angelIntervals?.[threadID]) {
    clearInterval(global.GoatBot.angelIntervals[threadID]);
    delete global.GoatBot.angelIntervals[threadID];
  }
}

function setReply(api, event, commandName, messageID, replyData) {
  global.GoatBot.onReply.set(messageID, {
    commandName,
    messageID,
    author: event.senderID,
    ...replyData
  });
}

module.exports = {
  config: {
    name: "chats",
    aliases: ["groups"],
    version: "2.0",
    author: "Custom",
    countDown: 5,
    role: 2,
    description: "Manage message requests and group chats. Bot admins only.",
    category: "admin",
    guide: { en: "  {pn}" }
  },

  onStart: async function ({ api, event, commandName }) {
    if (!isBotAdmin(event.senderID)) return;

    const menu =
      "💬 إدارة المحادثات\n"
      + "━━━━━━━━━━━━━━━\n"
      + "1️⃣  طلبات المراسلة\n"
      + "2️⃣  المحادثات والغروبات الحالية\n"
      + "━━━━━━━━━━━━━━━\n"
      + "↩️ رد بالرقم لاختيار ما تريد";

    api.sendMessage(menu, event.threadID, (err, info) => {
      if (err || !info) return;
      setReply(api, event, commandName, info.messageID, { step: "MAIN_MENU" });
    }, event.messageID);
  },

  onReply: async function ({ api, event, Reply, commandName }) {
    if (!isBotAdmin(event.senderID)) return;
    if (event.senderID !== Reply.author) return;

    const input = event.body?.trim();
    const { step } = Reply;

    // ─── STEP 1: Main menu ───────────────────────────────────────────────────
    if (step === "MAIN_MENU") {

      if (input === "1") {
        // Message requests
        api.sendMessage("⏳ جاري جلب طلبات المراسلة...", event.threadID);
        try {
          const pending = await api.getThreadList(30, null, ["PENDING"]);
          const other   = await api.getThreadList(30, null, ["OTHER"]).catch(() => []);
          const requests = [...(pending || []), ...(other || [])];

          if (!requests.length) {
            return api.sendMessage("📭 لا توجد طلبات مراسلة حالياً.", event.threadID);
          }

          let msg = "📬 طلبات المراسلة\n━━━━━━━━━━━━━━━\n";
          const list = [];

          requests.slice(0, 20).forEach((r, i) => {
            const name = r.name || r.threadID;
            const type = r.isGroup ? "غروب 👥" : "شخص 👤";
            const count = r.messageCount || 0;
            msg += `${i + 1}. ${name}\n   النوع: ${type} | رسائل: ${count}\n   ID: ${r.threadID}\n\n`;
            list.push({ threadID: r.threadID, name, isGroup: r.isGroup });
          });

          msg += "━━━━━━━━━━━━━━━\n↩️ رد برقم الطلب لاختيار الإجراء";

          api.sendMessage(msg, event.threadID, (err, info) => {
            if (err || !info) return;
            setReply(api, event, commandName, info.messageID, { step: "REQUEST_LIST", list });
          });

        } catch (e) {
          api.sendMessage("❌ فشل جلب الطلبات.\n" + e.message, event.threadID);
        }

      } else if (input === "2") {
        // Current groups
        api.sendMessage("⏳ جاري جلب المحادثات...", event.threadID);
        try {
          const threads = await api.getThreadList(50, null, ["INBOX"]);
          const groups  = threads.filter(t => t.isGroup);

          if (!groups.length) {
            return api.sendMessage("📭 البوت ليس في أي غروب حالياً.", event.threadID);
          }

          groups.sort((a, b) => b.messageCount - a.messageCount);

          let msg = "👥 الغروبات الحالية\n━━━━━━━━━━━━━━━\n";
          const list = [];

          groups.slice(0, 20).forEach((g, i) => {
            const angelData = loadAngelData();
            const angelStatus = angelData[g.threadID]?.active ? "🟢" : "⚫";
            msg += `${i + 1}. ${g.name || "بدون اسم"}\n   رسائل: ${g.messageCount} | Angel: ${angelStatus}\n   ID: ${g.threadID}\n\n`;
            list.push({ threadID: g.threadID, name: g.name || "بدون اسم" });
          });

          msg += "━━━━━━━━━━━━━━━\n↩️ رد برقم الغروب لاختيار الإجراء";

          api.sendMessage(msg, event.threadID, (err, info) => {
            if (err || !info) return;
            setReply(api, event, commandName, info.messageID, { step: "GROUP_LIST", list });
          });

        } catch (e) {
          api.sendMessage("❌ فشل جلب المحادثات.\n" + e.message, event.threadID);
        }

      } else {
        api.sendMessage("⚠️ اختار 1 أو 2 فقط.", event.threadID);
      }
    }

    // ─── STEP 2A: Request list ────────────────────────────────────────────────
    else if (step === "REQUEST_LIST") {
      const idx = parseInt(input) - 1;
      const { list } = Reply;

      if (isNaN(idx) || idx < 0 || idx >= list.length) {
        return api.sendMessage("❌ رقم غير صحيح.", event.threadID);
      }

      const selected = list[idx];
      const msg =
        `📨 ${selected.name}\n`
        + `ID: ${selected.threadID}\n`
        + "━━━━━━━━━━━━━━━\n"
        + "1️⃣  قبول الطلب (البوت يبدأ العمل فيه)\n"
        + "2️⃣  حذف الطلب ورفضه\n"
        + "━━━━━━━━━━━━━━━\n"
        + "↩️ رد بالرقم";

      api.sendMessage(msg, event.threadID, (err, info) => {
        if (err || !info) return;
        setReply(api, event, commandName, info.messageID, { step: "REQUEST_ACTION", selected });
      });
    }

    // ─── STEP 2B: Request action ──────────────────────────────────────────────
    else if (step === "REQUEST_ACTION") {
      const { selected } = Reply;

      if (input === "1") {
        try {
          await api.changeArchivedStatus(selected.threadID, false).catch(() => {});
          await api.markAsRead(selected.threadID).catch(() => {});
          api.sendMessage(`✅ تم قبول طلب "${selected.name}"\nالبوت بدأ يعمل في المحادثة.`, event.threadID);
        } catch (e) {
          api.sendMessage("❌ فشل القبول.\n" + e.message, event.threadID);
        }

      } else if (input === "2") {
        try {
          await api.deleteThread(selected.threadID).catch(() => {});
          api.sendMessage(`🗑️ تم حذف طلب "${selected.name}"`, event.threadID);
        } catch (e) {
          api.sendMessage("❌ فشل الحذف.\n" + e.message, event.threadID);
        }

      } else {
        api.sendMessage("⚠️ اختار 1 أو 2 فقط.", event.threadID);
      }
    }

    // ─── STEP 3A: Group list ──────────────────────────────────────────────────
    else if (step === "GROUP_LIST") {
      const idx = parseInt(input) - 1;
      const { list } = Reply;

      if (isNaN(idx) || idx < 0 || idx >= list.length) {
        return api.sendMessage("❌ رقم غير صحيح.", event.threadID);
      }

      const selected = list[idx];
      const angelData = loadAngelData();
      const angelActive = angelData[selected.threadID]?.active || false;
      const angelMsg    = angelData[selected.threadID]?.message || "لم تُضبط";
      const angelMins   = angelData[selected.threadID]?.intervalMinutes || 10;

      const msg =
        `👥 ${selected.name}\n`
        + `ID: ${selected.threadID}\n`
        + `Angel: ${angelActive ? "🟢 شغّال" : "⚫ متوقف"} | رسالة: "${angelMsg}" | كل ${angelMins} دقيقة\n`
        + "━━━━━━━━━━━━━━━\n"
        + "1️⃣  تفعيل Angel (الإرسال التكراري)\n"
        + "2️⃣  إيقاف Angel\n"
        + "3️⃣  ضبط رسالة Angel\n"
        + "4️⃣  ضبط وقت Angel (بالدقائق)\n"
        + "5️⃣  إخراج البوت من الغروب\n"
        + "6️⃣  إرسال رسالة لهذا الغروب\n"
        + "━━━━━━━━━━━━━━━\n"
        + "↩️ رد بالرقم";

      api.sendMessage(msg, event.threadID, (err, info) => {
        if (err || !info) return;
        setReply(api, event, commandName, info.messageID, { step: "GROUP_ACTION", selected });
      });
    }

    // ─── STEP 3B: Group action ────────────────────────────────────────────────
    else if (step === "GROUP_ACTION") {
      const { selected } = Reply;
      const tid = selected.threadID;

      // 1 — Enable angel
      if (input === "1") {
        const angelData = loadAngelData();
        if (!angelData[tid]?.message) {
          return api.sendMessage(`❌ لم تُضبط رسالة Angel لهذا الغروب بعد.\nاختار 3 أولاً لضبط الرسالة.`, event.threadID);
        }
        angelData[tid].active = true;
        saveAngelData(angelData);
        startAngelInterval(api, tid, angelData[tid]);
        api.sendMessage(`✅ تم تفعيل Angel في "${selected.name}"\n📝 رسالة: "${angelData[tid].message}"\n⏱️ كل ${angelData[tid].intervalMinutes} دقيقة`, event.threadID);

      // 2 — Disable angel
      } else if (input === "2") {
        const angelData = loadAngelData();
        if (!angelData[tid]?.active) {
          return api.sendMessage(`⚠️ Angel ليس شغّالاً في هذا الغروب أصلاً.`, event.threadID);
        }
        angelData[tid].active = false;
        saveAngelData(angelData);
        stopAngelInterval(tid);
        api.sendMessage(`✅ تم إيقاف Angel في "${selected.name}"`, event.threadID);

      // 3 — Set angel message
      } else if (input === "3") {
        api.sendMessage(`✏️ أرسل الرسالة التي تريد أن يُرسلها Angel في "${selected.name}"`, event.threadID, (err, info) => {
          if (err || !info) return;
          setReply(api, event, commandName, info.messageID, { step: "ANGEL_SET_MSG", selected });
        });

      // 4 — Set angel interval
      } else if (input === "4") {
        api.sendMessage(`⏱️ أرسل عدد الدقائق بين كل إرسال في "${selected.name}"`, event.threadID, (err, info) => {
          if (err || !info) return;
          setReply(api, event, commandName, info.messageID, { step: "ANGEL_SET_TIME", selected });
        });

      // 5 — Leave group
      } else if (input === "5") {
        api.sendMessage(`⚠️ هل تريد فعلاً إخراج البوت من "${selected.name}"؟\nأرسل: نعم للتأكيد أو أي شيء آخر للإلغاء`, event.threadID, (err, info) => {
          if (err || !info) return;
          setReply(api, event, commandName, info.messageID, { step: "GROUP_LEAVE_CONFIRM", selected });
        });

      // 6 — Send message
      } else if (input === "6") {
        api.sendMessage(`💬 أرسل الرسالة التي تريد إرسالها إلى "${selected.name}"`, event.threadID, (err, info) => {
          if (err || !info) return;
          setReply(api, event, commandName, info.messageID, { step: "GROUP_SEND_MSG", selected });
        });

      } else {
        api.sendMessage("⚠️ رقم غير صحيح. اختار من 1 إلى 6.", event.threadID);
      }
    }

    // ─── STEP: Set angel message ──────────────────────────────────────────────
    else if (step === "ANGEL_SET_MSG") {
      const { selected } = Reply;
      const newMsg = input;
      if (!newMsg) return api.sendMessage("❌ الرسالة فارغة.", event.threadID);

      const angelData = loadAngelData();
      if (!angelData[selected.threadID]) angelData[selected.threadID] = { intervalMinutes: 10, active: false };
      angelData[selected.threadID].message = newMsg;
      saveAngelData(angelData);

      api.sendMessage(`✅ تم ضبط رسالة Angel في "${selected.name}":\n"${newMsg}"`, event.threadID);
    }

    // ─── STEP: Set angel interval ─────────────────────────────────────────────
    else if (step === "ANGEL_SET_TIME") {
      const { selected } = Reply;
      const mins = parseFloat(input);

      if (isNaN(mins) || mins <= 0) return api.sendMessage("❌ أرسل رقماً صحيحاً (دقائق).", event.threadID);

      const angelData = loadAngelData();
      if (!angelData[selected.threadID]) angelData[selected.threadID] = { message: null, active: false };
      angelData[selected.threadID].intervalMinutes = mins;
      saveAngelData(angelData);

      if (angelData[selected.threadID].active && angelData[selected.threadID].message) {
        startAngelInterval(api, selected.threadID, angelData[selected.threadID]);
      }

      api.sendMessage(`✅ تم ضبط وقت Angel في "${selected.name}": كل ${mins} دقيقة`, event.threadID);
    }

    // ─── STEP: Confirm leave ──────────────────────────────────────────────────
    else if (step === "GROUP_LEAVE_CONFIRM") {
      const { selected } = Reply;

      if (input === "نعم") {
        try {
          await api.removeUserFromGroup(api.getCurrentUserID(), selected.threadID);
          api.sendMessage(`✅ خرج البوت من "${selected.name}"`, event.threadID);
        } catch (e) {
          api.sendMessage("❌ فشل الخروج من الغروب.\n" + e.message, event.threadID);
        }
      } else {
        api.sendMessage("❎ تم الإلغاء.", event.threadID);
      }
    }

    // ─── STEP: Send message to group ─────────────────────────────────────────
    else if (step === "GROUP_SEND_MSG") {
      const { selected } = Reply;
      const msgToSend = input;
      if (!msgToSend) return api.sendMessage("❌ الرسالة فارغة.", event.threadID);

      try {
        await api.sendMessage(msgToSend, selected.threadID);
        api.sendMessage(`✅ تم إرسال الرسالة إلى "${selected.name}"`, event.threadID);
      } catch (e) {
        api.sendMessage("❌ فشل الإرسال.\n" + e.message, event.threadID);
      }
    }
  }
};
