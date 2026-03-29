const login = require("fca-eryxenx");
const fs = require("fs-extra");
const path = require("path");

const COOLDOWN_MS  = 3 * 60 * 1000;
const MAX_RETRIES  = 3;
const RESTART_DELAY_MS = 3000;

let lastAttempt  = 0;
let retryCount   = 0;
let isAttempting = false;

function log(level, msg) {
  try {
    const logger = global.utils?.log;
    if (level === "info")  return logger?.info ("AUTO_RELOGIN", msg);
    if (level === "warn")  return logger?.warn ("AUTO_RELOGIN", msg);
    if (level === "error") return logger?.err  ("AUTO_RELOGIN", msg);
  } catch (e) {}
  console[level === "error" ? "error" : "log"]("[AUTO_RELOGIN]", msg);
}

function notifyAdmins(api, message) {
  try {
    const admins = global.GoatBot?.config?.adminBot || [];
    for (const adminID of admins) {
      const id = String(adminID).trim();
      if (!id || id === " ") continue;
      api.sendMessage(message, id).catch(() => {});
    }
  } catch (e) {}
}

module.exports = async function autoRelogin(api) {
  const now = Date.now();

  if (isAttempting) {
    log("warn", "Already attempting re-login, skipping duplicate call.");
    return false;
  }

  if (now - lastAttempt < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - (now - lastAttempt)) / 1000);
    log("warn", `Cooldown active. Next attempt in ${waitSec}s.`);
    return false;
  }

  if (retryCount >= MAX_RETRIES) {
    log("error", `Max retries (${MAX_RETRIES}) reached. Manual intervention required.`);
    notifyAdmins(api,
      "⛔ AUTO RELOGIN FAILED\n\n"
      + `Tried ${MAX_RETRIES} times — all failed.\n`
      + "Please update account.txt manually with fresh cookies."
    );
    return false;
  }

  const { email, password } = global.GoatBot?.config?.facebookAccount || {};

  if (!email || !password) {
    log("error", "No email/password saved. Use /setaccount to store credentials.");
    notifyAdmins(api,
      "⚠️ SESSION EXPIRED — AUTO RELOGIN SKIPPED\n\n"
      + "No email/password saved in bot config.\n"
      + "Use /setaccount [email] [password] to save credentials."
    );
    return false;
  }

  isAttempting = true;
  lastAttempt  = now;
  retryCount++;

  log("info", `Attempting re-login (attempt ${retryCount}/${MAX_RETRIES}) with email: ${email}`);
  notifyAdmins(api,
    `🔄 SESSION EXPIRED — Attempting auto re-login...\n`
    + `Attempt ${retryCount}/${MAX_RETRIES}`
  );

  return new Promise((resolve) => {
    login({ email, password }, {}, async (err, newApi) => {
      isAttempting = false;

      if (err) {
        const errMsg = err?.error || err?.message || String(err);
        log("error", `Re-login failed: ${errMsg}`);
        notifyAdmins(api,
          `❌ AUTO RELOGIN FAILED (attempt ${retryCount}/${MAX_RETRIES})\n`
          + `Reason: ${errMsg}`
        );
        resolve(false);
        return;
      }

      try {
        const newAppState  = newApi.getAppState();
        const accountPath  = path.join(process.cwd(), "account.txt");
        fs.writeFileSync(accountPath, JSON.stringify(newAppState, null, 2));
        retryCount = 0;

        log("info", "✅ New appstate saved successfully. Restarting bot in 3s...");
        notifyAdmins(api,
          "✅ AUTO RELOGIN SUCCESS\n\n"
          + "New session saved. Bot is restarting now..."
        );

        resolve(true);
        setTimeout(() => process.exit(0), RESTART_DELAY_MS);

      } catch (saveErr) {
        log("error", `Failed to save new appstate: ${saveErr.message}`);
        notifyAdmins(api, `❌ Re-login succeeded but failed to save: ${saveErr.message}`);
        resolve(false);
      }
    });
  });
};
