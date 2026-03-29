const { createCanvas, registerFont } = require("canvas");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/* ===== HACKER FONTS ===== */
const fontDir = path.join(__dirname, "fonts");

registerFont(path.join(fontDir, "CourierPrime-Regular.ttf"), {
  family: "Hacker"
});

registerFont(path.join(fontDir, "CourierPrime-Bold.ttf"), {
  family: "Hacker",
  weight: "bold"
});

try {
  registerFont(path.join(fontDir, "NotoColorEmoji.ttf"), {
    family: "Emoji"
  });
} catch {
  console.log("Emoji font not found, using default");
}

/* ===== SYSTEM HELPERS ===== */
let prev = null;
const getCPU = () => {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const t in c.times) total += c.times[t];
    idle += c.times.idle;
  }
  const cur = { idle, total };
  if (!prev) { prev = cur; return 0; }
  const di = cur.idle - prev.idle;
  const dt = cur.total - prev.total;
  prev = cur;
  return dt ? Math.round(100 - (100 * di / dt)) : 0;
};

const getDisk = () => {
  try {
    const d = execSync("df -k /").toString().split("\n")[1].split(/\s+/);
    return Math.round((parseInt(d[2]) / parseInt(d[1])) * 100);
  } catch {
    return Math.floor(Math.random() * 30) + 40;
  }
};

const getNetwork = () => {
  try {
    const interfaces = os.networkInterfaces();
    let total = 0;
    for (const iface in interfaces) {
      interfaces[iface].forEach(addr => {
        if (addr.internal === false && addr.family === 'IPv4') {
          total++;
        }
      });
    }
  return total;
  } catch {
    return 3;
  }
};

const getTemperature = () => {
  try {
    if (os.platform() === 'linux') {
      const temp = execSync("cat /sys/class/thermal/thermal_zone0/temp").toString();
      return Math.round(parseInt(temp) / 1000);
    } else if (os.platform() === 'darwin') {
      const temp = execSync("sudo powermetrics --samplers smc -i1 -n1 | grep -i 'CPU die temperature'").toString();
      const match = temp.match(/(\d+\.?\d*)/);
      return match ? Math.round(parseFloat(match[0])) : 45;
    }
  } catch {
    return Math.floor(Math.random() * 20) + 40;
  }
  return 45;
};

module.exports = {
  config: {
    name: "up",
    aliases: ["uptime", "status", "sysinfo"],
    version: "2.8",
    author: "MOHAMMAD AKASH",
    role: 0,
    category: "system",
    shortDescription: "Display system status in hacker terminal style"
  },

  onStart: async function ({ message, api, event }) {
    try {
      const start = Date.now();

      // System metrics
      const cpu = Math.min(getCPU(), 99);
      const total = os.totalmem();
      const used = total - os.freemem();
      const ram = Math.min(Math.round((used / total) * 100), 99);
      const disk = Math.min(getDisk(), 99);
      const network = Math.min(getNetwork(), 9);
      const temp = getTemperature();
      const threads = os.cpus().length;
      const platform = os.platform().toUpperCase();
      const arch = os.arch();
      const hostname = os.hostname();
      const load = Math.min(parseFloat(os.loadavg()[0].toFixed(2)), 9.99);

      // Bot Uptime calculation
      const sec = process.uptime();
      const d = Math.floor(sec / 86400);
      const h = Math.floor((sec % 86400) / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const uptime = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;

      const ping = Math.min(Date.now() - start, 9999);

      /* ===== TERMINAL STYLE CANVAS ===== */
      const W = 1800, H = 1100;
      const cv = createCanvas(W, H);
      const c = cv.getContext("2d");

      // Dark terminal background with gradient
      const gradient = c.createLinearGradient(0, 0, W, H);
      gradient.addColorStop(0, "#0a0a12");
      gradient.addColorStop(1, "#0c0c18");
      c.fillStyle = gradient;
      c.fillRect(0, 0, W, H);

      // Terminal scanlines effect
      for (let i = 0; i < H; i += 4) {
        c.fillStyle = i % 8 === 0 ? "rgba(0, 255, 100, 0.05)" : "rgba(0, 200, 80, 0.02)";
        c.fillRect(0, i, W, 1);
      }

      // ========== HEADER SECTION ==========
      c.font = "bold 85px 'Hacker'";
      c.fillStyle = "#00ff41";
      c.textAlign = "center";
      
      // Glitch effect
      c.fillStyle = "#ff0041";
      c.fillText("█▓▒░ SYSTEM TERMINAL ░▒▓█", W/2 + 3, 125);
      c.fillStyle = "#0041ff";
      c.fillText("█▓▒░ SYSTEM TERMINAL ░▒▓█", W/2 - 3, 120);
      c.fillStyle = "#00ff41";
      c.fillText("█▓▒░ SYSTEM TERMINAL ░▒▓█", W/2, 123);

      // Subtitle
      c.font = "38px 'Hacker'";
      c.fillStyle = "#00cc33";
      c.fillText(">>> REAL-TIME SYSTEM MONITOR v2.8 <<<", W/2, 185);

      // Connection info
      c.font = "28px 'Hacker'";
      c.fillStyle = "#008833";
      
      // Left aligned - CONNECTED TO
      c.textAlign = "left";
      c.fillText(`CONNECTED TO: ${hostname.substring(0, 20)}`, 100, 240);
      
      // Right aligned - SESSION ID
      c.textAlign = "right";
      c.fillText(`SESSION: ${Date.now().toString(16).toUpperCase().substring(0, 12)}`, W - 100, 240);

      // Main border
      c.strokeStyle = "#00ff41";
      c.lineWidth = 3;
      c.strokeRect(80, 280, W - 160, H - 400);

      // Vertical separator line
      c.strokeStyle = "#00ff41";
      c.lineWidth = 1;
      c.setLineDash([5, 3]);
      c.beginPath();
      c.moveTo(W/2, 300);
      c.lineTo(W/2, H - 380);
      c.stroke();
      c.setLineDash([]);

      // ========== LEFT PANEL - SYSTEM SPECS ==========
      const leftPanelX = 120;
      const leftPanelStartY = 340;
      
      c.font = "bold 48px 'Hacker'";
      c.fillStyle = "#00ff88";
      c.textAlign = "left";
      c.fillText("> SYSTEM SPECIFICATIONS", leftPanelX, leftPanelStartY);

      const sysInfo = [
        `OS: ${platform} ${arch}`,
        `CPU CORES: ${threads}`,
        `CPU: ${os.cpus()[0].model.split('@')[0].substring(0, 30)}`,
        `NETWORK: ${network} ACTIVE INTERFACES`,
        `NODE: ${process.version.substring(0, 12)}`,
        `LOAD: ${load}`,
        `TEMP: ${temp}°C`
      ];

      c.font = "34px 'Hacker'";
      c.fillStyle = "#00ee77";
      const leftLineHeight = 55;
      const leftContentStartY = leftPanelStartY + 70;
      
      sysInfo.forEach((info, i) => {
        c.fillText(`◉ ${info}`, leftPanelX + 20, leftContentStartY + (i * leftLineHeight));
      });

      // ========== RIGHT PANEL - LIVE METRICS ==========
      const rightPanelX = W/2 + 120;
      const rightPanelStartY = 340;
      
      c.font = "bold 48px 'Hacker'";
      c.fillStyle = "#00ff88";
      c.textAlign = "left";
      c.fillText("> LIVE METRICS", rightPanelX, rightPanelStartY);

      // Bars with PROPER spacing
      const drawTerminalBar = (x, y, value, label, color, symbol = "█") => {
        c.font = "32px 'Hacker'";
        c.fillStyle = "#00cc66";
        c.fillText(label, x, y);
        
        c.fillStyle = "#002200";
        c.fillRect(x, y + 25, 450, 40);
        
        const fillWidth = (value / 100) * 450;
        const barGradient = c.createLinearGradient(x, 0, x + fillWidth, 0);
        barGradient.addColorStop(0, color);
        barGradient.addColorStop(1, color + "cc");
        c.fillStyle = barGradient;
        c.fillRect(x, y + 25, fillWidth, 40);
        
        c.strokeStyle = "#00ff41";
        c.lineWidth = 2;
        c.strokeRect(x, y + 25, 450, 40);
        
        c.font = "bold 28px 'Hacker'";
        c.fillStyle = "#ffffff";
        c.textAlign = "right";
        const symbols = symbol.repeat(Math.floor(value/20));
        c.fillText(`${value}% ${symbols.substring(0, 5)}`, x + 445, y + 55);
        c.textAlign = "left";
      };

      // Position bars with EXACT spacing
      const rightContentStartY = rightPanelStartY + 70;
      drawTerminalBar(rightPanelX, rightContentStartY, cpu, "CPU LOAD", "#00ff41", "■");
      drawTerminalBar(rightPanelX, rightContentStartY + 90, ram, "MEMORY USAGE", "#00ccff", "▣");
      drawTerminalBar(rightPanelX, rightContentStartY + 180, disk, "STORAGE USAGE", "#ff00ff", "◼");

      // ========== HORIZONTAL SEPARATOR ==========
      c.strokeStyle = "#00ff41";
      c.lineWidth = 2;
      c.setLineDash([10, 5]);
      c.beginPath();
      c.moveTo(100, 750);
      c.lineTo(W - 100, 750);
      c.stroke();
      c.setLineDash([]);

      // ========== BOT UPTIME - FIXED TEXT ==========
      c.font = "bold 52px 'Hacker'";
      c.fillStyle = "#ffff00";
      c.textAlign = "left";
      
      // FIXED: বানান ঠিক করা
      const uptimeLabel = "⏱️ BOT UPTIME:";
      c.fillText(uptimeLabel, 120, 830);
      
      // Calculate uptime text position
      const uptimeLabelWidth = c.measureText(uptimeLabel).width;
      const uptimeX = 120 + uptimeLabelWidth + 30;
      const uptimeY = 830;
      
      // Background highlight box
      c.fillStyle = "rgba(0, 255, 255, 0.2)";
      const uptimeText = `[ ${uptime} ]`;
      const uptimeTextWidth = c.measureText(uptimeText).width;
      c.fillRect(uptimeX - 15, uptimeY - 45, uptimeTextWidth + 30, 80);
      
      // Border around uptime
      const blink = Math.floor(Date.now() / 500) % 2;
      c.strokeStyle = blink ? "#ff0000" : "#00ff00";
      c.lineWidth = 3;
      c.strokeRect(uptimeX - 20, uptimeY - 50, uptimeTextWidth + 40, 90);
      
      // Uptime text - FIXED
      c.font = "bold 60px 'Hacker'";
      c.fillStyle = "#00ffff";
      c.fillText(uptimeText, uptimeX, uptimeY);

      // ========== RESPONSE TIME - FIXED TEXT ==========
      c.font = "bold 52px 'Hacker'";
      c.fillStyle = "#ffff00";
      
      // FIXED: বানান ঠিক করা
      const responseLabel = "📡 RESPONSE TIME:";
      c.fillText(responseLabel, 120, 930);
      
      let pingColor = "#00ff00";
      let pingStatus = "EXCELLENT";
      if (ping > 200) {
        pingColor = "#ffff00";
        pingStatus = "GOOD";
      }
      if (ping > 500) {
        pingColor = "#ff5500";
        pingStatus = "SLOW";
      }
      if (ping > 1000) {
        pingColor = "#ff0000";
        pingStatus = "POOR";
      }
      
      // Calculate response time position
      const responseLabelWidth = c.measureText(responseLabel).width;
      const responseX = 120 + responseLabelWidth + 30;
      const responseY = 930;
      
      // Response time text
      const responseText = `[ ${ping}ms | ${pingStatus} ]`;
      c.font = "48px 'Hacker'";
      c.fillStyle = pingColor;
      c.fillText(responseText, responseX, responseY);

      // ========== STATUS FOOTER ==========
      // Horizontal line
      c.strokeStyle = "#00ff41";
      c.lineWidth = 1;
      c.setLineDash([5, 3]);
      c.beginPath();
      c.moveTo(100, 990);
      c.lineTo(W - 100, 990);
      c.stroke();
      c.setLineDash([]);

      // Status message - CENTERED
      const status = ping < 100 ? "OPTIMAL" : ping < 300 ? "STABLE" : "LAG DETECTED";
      const statusColor = ping < 100 ? "#00ff00" : ping < 300 ? "#ffff00" : "#ff0000";
      
      c.font = "bold 42px 'Hacker'";
      c.fillStyle = statusColor;
      c.textAlign = "center";
      c.fillText(`<<< SYSTEM STATUS: ${status} >>>`, W/2, 1050);

      // Cursor blink
      const cursorBlink = Math.floor(Date.now() / 500) % 2;
      c.fillText(cursorBlink ? "▋" : "_", W/2, 1090);

      // Bottom hex stream
      c.font = "26px 'Hacker'";
      c.fillStyle = "#008833";
      const hexCount = 8;
      const hexSpacing = (W - 200) / hexCount;
      for (let i = 0; i < hexCount; i++) {
        const hex = Math.random().toString(16).substr(2, 6).toUpperCase();
        c.fillText(`0x${hex}`, 100 + (i * hexSpacing), H - 30);
      }

      // Save image
      const timestamp = Date.now();
      const file = path.join(__dirname, "cache", `terminal_${timestamp}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      
      const buffer = cv.toBuffer('image/png');
      fs.writeFileSync(file, buffer);

      // Send image
      await message.reply({
        attachment: fs.createReadStream(file)
      });

      // Cleanup
      setTimeout(() => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }, 15000);

    } catch (error) {
      console.error("TERMINAL ERROR:", error);
      message.reply("❌ System terminal failed to generate.");
    }
  },

  onChat: async function({ event, api }) {
    if (event.body && event.body.toLowerCase() === "hack") {
      api.sendMessage("```ACCESS DENIED\nINSUFFICIENT PRIVILEGES\n>_```", event.threadID);
    }
  }
};
