const fs = require("fs");

const balanceFile = __dirname + "/game.json";

function getBalance(uid) {
  const data = JSON.parse(fs.readFileSync(balanceFile));
  return data[uid]?.balance ?? 100;
}

function setBalance(uid, balance) {
  const data = JSON.parse(fs.readFileSync(balanceFile));
  data[uid] = { balance };
  fs.writeFileSync(balanceFile, JSON.stringify(data, null, 2));
}

module.exports.config = {
  name: "slot",
  version: "1.0",
  author: "MOHAMMAD AKASH",
  role: 0,
  category: "economy",
  shortDescription: "Slot Machine Game"
};

module.exports.onStart = async function ({ api, event, args }) {

  const { senderID, threadID, messageID } = event;

  const bet = parseInt(args[0]);
  if (!bet || bet <= 0)
    return api.sendMessage("Enter valid bet amount.", threadID, messageID);

  let balance = getBalance(senderID);

  if (balance < bet)
    return api.sendMessage("❌ Not enough balance!", threadID, messageID);

  const symbols = ["🍎", "🍌", "🍒", "⭐", "7️⃣"];

  let winChance = Math.random() * 100;
  let win = winChance < 60;

  let slot1, slot2, slot3;
  let winAmount = bet;

  if (win) {
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    slot1 = slot2 = slot3 = symbol;

    balance += winAmount;
  } else {
    do {
      slot1 = symbols[Math.floor(Math.random() * symbols.length)];
      slot2 = symbols[Math.floor(Math.random() * symbols.length)];
      slot3 = symbols[Math.floor(Math.random() * symbols.length)];
    } while (slot1 === slot2 && slot2 === slot3);

    balance -= bet;
  }

  setBalance(senderID, balance);

  let resultText = "";

  if (win) {
    resultText =
`🎰 SLOT GAME 🎰
──────────────

🎲 Result →
${slot1} | ${slot2} | ${slot3}

🏆 Jackpot Winner!
💵 Earned +${winAmount}$

💰 Balance → ${balance}$`;
  } else {
    resultText =
`🎰 SLOT GAME 🎰
──────────────

🎲 Result →
${slot1} | ${slot2} | ${slot3}

💸 You Lose!
💵 Lost -${bet}$

💰 Balance → ${balance}$`;
  }

  api.sendMessage(resultText, threadID, messageID);
};
