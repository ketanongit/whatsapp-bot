const { Client, RemoteAuth, Poll } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const express = require('express');

// Express app for health checks
const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const groupId = process.env.GROUP_ID || "120363420330015494@g.us";
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp-bot";

// Connect to MongoDB first, then initialize client
mongoose.connect(mongoUri).then(() => {
  console.log("Connected to MongoDB");
  
  // Create store after MongoDB connection
  const store = new MongoStore({ mongoose: mongoose });

  const client = new Client({
    authStrategy: new RemoteAuth({
      clientId: 'whatsapp-bot',
      store: store,
      backupSyncIntervalMs: 300000
    }),
    puppeteer: {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run"
      ],
    },
  });

  // Health check endpoints
  app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running! 🤖');
  });

  app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
  });

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

    // Schedule poll every hour
    cron.schedule("0 * * * *", async () => {
      try {
        console.log("⏰ Cron job triggered — sending poll...");
        
        const pollName = "Meet availability";
        const options = ["Yes", "No"];
        const poll = new Poll(pollName, options, { allowMultipleAnswers: false });
        
        await client.sendMessage(groupId, poll);
        console.log(`📊 Poll "${pollName}" sent to group: ${groupId}`);
      } catch (err) {
        console.error("⚠️ Error while sending poll:", err);
      }
    });
  });

  client.on("disconnected", (reason) => {
    console.log("⚠️ Client was logged out:", reason);
  });

  client.initialize();

}).catch(err => {
  console.error("MongoDB connection failed:", err);
});
