const fs = require("fs-extra");
const axios = require("axios");
const path = require("path");

let pingTimer = null;
let saveTimer = null;
let isSaving = false;

function getRandomMs(minMinutes, maxMinutes) {
  const minMs = minMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function doPing() {
  try {
    const api = global.GoatBot.fcaApi;
    if (!api) return;

    const appState = api.getAppState();
    if (!appState || !appState.length) return;

    const cookieStr = appState.map(c => `${c.key}=${c.value}`).join("; ");
    const userAgent =
      global.GoatBot.config?.facebookAccount?.userAgent ||
      "Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Mobile Safari/537.36";

    await axios.get("https://mbasic.facebook.com/", {
      headers: {
        cookie: cookieStr,
        "user-agent": userAgent,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      timeout: 15000,
    });

    global.utils.log.info("KEEP_ALIVE", "✅ Ping sent — account stays active");
  } catch (e) {
    global.utils.log.warn("KEEP_ALIVE", "⚠️ Ping failed: " + (e.message || e));
  }
}

async function doSaveCookies(source) {
  if (isSaving) return;
  if (global.isRelogining) return;

  isSaving = true;
  try {
    const api = global.GoatBot?.fcaApi;
    if (!api) return;

    const appState = api.getAppState();
    if (!appState || !appState.length) return;

    const accountPath = path.join(process.cwd(), "account.txt");
    const current = await fs.readFile(accountPath, "utf-8").catch(() => "");
    const newData = JSON.stringify(appState, null, 2);

    if (current.trim() === newData.trim()) return;

    await fs.writeFile(accountPath, newData, "utf-8");
    global.utils.log.info("KEEP_ALIVE", `💾 Cookies saved to account.txt${source ? ` (${source})` : ""}`);
  } catch (e) {
    global.utils.log.warn("KEEP_ALIVE", "⚠️ Failed to save cookies: " + (e.message || e));
  } finally {
    isSaving = false;
  }
}

function schedulePing() {
  if (pingTimer) clearTimeout(pingTimer);
  const delay = getRandomMs(8, 18);
  const minutes = Math.round(delay / 60000);
  pingTimer = setTimeout(async () => {
    await doPing();
    schedulePing();
  }, delay);
  global.utils.log.info("KEEP_ALIVE", `🔔 Next ping in ${minutes} min`);
}

function scheduleSave() {
  if (saveTimer) clearInterval(saveTimer);
  const interval = 2 * 60 * 60 * 1000;
  saveTimer = setInterval(async () => {
    await doSaveCookies("scheduled");
  }, interval);
}

module.exports = function startKeepAlive() {
  if (pingTimer) clearTimeout(pingTimer);
  if (saveTimer) clearInterval(saveTimer);

  global.utils.log.info(
    "KEEP_ALIVE",
    "🚀 Keep-alive started | Ping every 8–18 min | Cookies saved every 2h"
  );

  schedulePing();
  scheduleSave();
};

module.exports.stop = function () {
  if (pingTimer) clearTimeout(pingTimer);
  if (saveTimer) clearInterval(saveTimer);
  pingTimer = null;
  saveTimer = null;
};

module.exports.saveCookiesNow = function (source) {
  return doSaveCookies(source || "manual");
};
