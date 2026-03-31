const moment = require("moment-timezone");

module.exports = {
  config: {
    name: "accept",
    aliases: ["acp"],
    version: "2.0",
    author: "Djamel",
    countDown: 8,
    role: 2,
    shortDescription: "إدارة طلبات الصداقة",
    longDescription: "قبول أو رفض طلبات الصداقة بشكل فردي أو جماعي",
    category: "owner",
  },

  onStart: async function ({ event, api, commandName }) {
    const form = {
      av: api.getCurrentUserID(),
      fb_api_req_friendly_name: "FriendingCometFriendRequestsRootQueryRelayPreloader",
      fb_api_caller_class: "RelayModern",
      doc_id: "4499164963466303",
      variables: JSON.stringify({ input: { scale: 3 } })
    };

    try {
      const response = await api.httpPost("https://www.facebook.com/api/graphql/", form);
      const listRequest = JSON.parse(response)?.data?.viewer?.friending_possibilities?.edges || [];

      if (listRequest.length === 0) {
        return api.sendMessage("📭 لا توجد طلبات صداقة معلّقة حالياً.", event.threadID);
      }

      let msg = `╔══════════════════╗\n`;
      msg    += `  👥 طلبات الصداقة (${listRequest.length})\n`;
      msg    += `╚══════════════════╝\n\n`;

      listRequest.forEach((user, i) => {
        msg += `${i + 1}. 👤 ${user.node.name}\n`;
        msg += `   🆔 ${user.node.id}\n`;
        msg += `   🔗 ${user.node.url.replace("www.facebook", "fb")}\n\n`;
      });

      msg += "━━━━━━━━━━━━━━━\n";
      msg += "↩️ رد بأحد الأوامر:\n";
      msg += "• add <رقم | all>  — قبول\n";
      msg += "• del <رقم | all>  — رفض\n";
      msg += "مثال: add 1 3   أو   del all";

      api.sendMessage(msg, event.threadID, (e, info) => {
        if (e || !info) return;
        global.GoatBot.onReply.set(info.messageID, {
          commandName,
          messageID: info.messageID,
          listRequest,
          author: event.senderID
          // لا يوجد unsendTimeout — القائمة تبقى ظاهرة
        });
      }, event.messageID);

    } catch (error) {
      console.error(error);
      api.sendMessage("❌ حدث خطأ أثناء جلب قائمة الطلبات.", event.threadID);
    }
  },

  onReply: async function ({ message, Reply, event, api }) {
    const { author, listRequest } = Reply;
    if (author !== event.senderID) return;

    const args = event.body.trim().toLowerCase().split(/\s+/);
    const action = args[0];

    if (action !== "add" && action !== "del") {
      return api.sendMessage(
        "⚠️ أمر غير صحيح.\nاستخدم: add <رقم | all>  أو  del <رقم | all>",
        event.threadID
      );
    }

    const form = {
      av: api.getCurrentUserID(),
      fb_api_caller_class: "RelayModern",
      variables: {
        input: {
          source: "friends_tab",
          actor_id: api.getCurrentUserID(),
          client_mutation_id: Math.random().toString(36).substring(2, 15)
        },
        scale: 3,
        refresh_num: 0
      }
    };

    if (action === "add") {
      form.fb_api_req_friendly_name = "FriendingCometFriendRequestConfirmMutation";
      form.doc_id = "3147613905362928";
    } else {
      form.fb_api_req_friendly_name = "FriendingCometFriendRequestDeleteMutation";
      form.doc_id = "4108254489275063";
    }

    // تحديد الأهداف
    const targets = args[1] === "all"
      ? listRequest.map((_, idx) => idx + 1)
      : args.slice(1).map(Number).filter(n => !isNaN(n) && n > 0);

    if (!targets.length) {
      return api.sendMessage("⚠️ حدد رقم الطلب أو اكتب all.", event.threadID);
    }

    const success = [];
    const failed  = [];

    for (const num of targets) {
      const user = listRequest[num - 1];
      if (!user) { failed.push(`#${num} (غير موجود)`); continue; }

      try {
        const res = await api.httpPost("https://www.facebook.com/api/graphql/", {
          ...form,
          variables: JSON.stringify({ ...form.variables, input: { ...form.variables.input, friend_requester_id: user.node.id } })
        });
        const data = JSON.parse(res);
        if (data.errors) failed.push(user.node.name);
        else success.push(user.node.name);
      } catch {
        failed.push(user.node.name);
      }
    }

    let result = action === "add" ? "✅ تم القبول:\n" : "🗑️ تم الرفض:\n";
    if (success.length) result += success.map(n => `• ${n}`).join("\n");
    if (failed.length)  result += `\n\n❌ فشل:\n` + failed.map(n => `• ${n}`).join("\n");
    if (!success.length && !failed.length) result = "لم يتم معالجة أي طلب.";

    // حذف رسالة القائمة بعد تنفيذ الأمر
    api.unsendMessage(Reply.messageID).catch(() => {});

    return api.sendMessage(result, event.threadID);
  }
};
