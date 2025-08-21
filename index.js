const { Client, LocalAuth, Poll } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "my-bot-session" }),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

const groupId = "120363420330015494@g.us"; // Replace with your actual group ID

client.on("qr", (qr) => {
  console.log("📲 Scan this QR to log in:");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("🔑 Authenticated successfully!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Authentication failed:", msg);
});

client.on("ready", () => {
  console.log("✅ WhatsApp Bot is ready and connected!");

  cron.schedule("0 * * * * *", async () => {
    try {
      console.log("⏰ Cron job triggered — sending poll...");

      const pollName = "Meet availablity";
      const options = ["Yes", "No"];
      const poll = new Poll(pollName, options, { allowMultipleAnswers: false });

      await client.sendMessage(groupId, poll);
      console.log(`📊 Poll "${pollName}" sent to group: ${groupId}`);
    } catch (err) {
      console.error("⚠️ Error while sending poll:", err);
    }
  });
});

client.initialize();
