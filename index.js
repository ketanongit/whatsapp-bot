const { Client, RemoteAuth, Poll } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const cron = require("node-cron");
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// Express app setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const groupId = process.env.GROUP_ID || "120363420330015494@g.us";
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp-bot";

// Bot status tracking
let botStatus = {
  connected: false,
  authenticated: false,
  ready: false,
  qrCode: null,
  lastPollSent: null,
  nextPollTime: null,
  error: null
};

// Calculate next 10 AM
function getNext10AM() {
  const now = new Date();
  const next10AM = new Date();
  next10AM.setHours(10, 0, 0, 0);
  
  // If it's already past 10 AM today, schedule for tomorrow
  if (now > next10AM) {
    next10AM.setDate(next10AM.getDate() + 1);
  }
  
  return next10AM;
}

// Update next poll time
function updateNextPollTime() {
  botStatus.nextPollTime = getNext10AM();
}

// Serve dashboard
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Daily Poll Bot</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                max-width: 1000px;
                margin: 0 auto;
                padding: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                color: #333;
            }
            
            .container {
                background: white;
                border-radius: 15px;
                padding: 30px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            
            .header h1 {
                color: #25D366;
                margin-bottom: 5px;
            }
            
            .status-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            
            .status-card {
                background: #f8f9fa;
                border-radius: 10px;
                padding: 20px;
                text-align: center;
                border-left: 4px solid #ddd;
            }
            
            .status-card.ready {
                border-left-color: #25D366;
            }
            
            .status-card.schedule {
                border-left-color: #ffc107;
            }
            
            .status-indicator {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                display: inline-block;
                margin-right: 8px;
                background: #dc3545;
            }
            
            .status-indicator.active {
                background: #28a745;
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }
            
            .qr-section {
                text-align: center;
                margin: 30px 0;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 10px;
            }
            
            .qr-code {
                max-width: 300px;
                margin: 20px auto;
                padding: 20px;
                background: white;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            }
            
            .schedule-info {
                background: #fff3cd;
                border: 1px solid #ffeaa7;
                border-radius: 10px;
                padding: 20px;
                margin: 20px 0;
                text-align: center;
            }
            
            .actions {
                display: flex;
                justify-content: center;
                gap: 15px;
                margin-top: 20px;
            }
            
            .btn {
                padding: 10px 20px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.3s;
            }
            
            .btn-success {
                background: #28a745;
                color: white;
            }
            
            .btn-success:hover {
                background: #1e7e34;
            }
            
            .logs {
                background: #1e1e1e;
                color: #00ff00;
                padding: 20px;
                border-radius: 10px;
                max-height: 300px;
                overflow-y: auto;
                font-family: 'Courier New', monospace;
                font-size: 14px;
                line-height: 1.4;
            }
            
            .privacy-notice {
                background: #d4edda;
                border: 1px solid #c3e6cb;
                border-radius: 10px;
                padding: 15px;
                margin: 20px 0;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📅 Daily Poll Bot</h1>
                <p>Sends polls every day at 10:00 AM</p>
            </div>
            
            <div class="privacy-notice">
                <strong>🔒 Privacy-First Bot</strong><br>
                This bot only sends messages - it does NOT read your conversations
            </div>
            
            <div class="status-grid">
                <div class="status-card ready" id="bot-status">
                    <h3><span class="status-indicator" id="bot-indicator"></span>Bot Status</h3>
                    <p id="bot-text">Not Ready</p>
                </div>
                
                <div class="status-card schedule" id="schedule-status">
                    <h3><span class="status-indicator active"></span>Next Poll</h3>
                    <p id="next-poll-text">Calculating...</p>
                </div>
                
                <div class="status-card" id="last-sent-status">
                    <h3><span class="status-indicator" id="last-indicator"></span>Last Sent</h3>
                    <p id="last-sent-text">Never</p>
                </div>
            </div>
            
            <div class="schedule-info">
                <h3>⏰ Schedule</h3>
                <p><strong>Daily at 10:00 AM</strong> - "Meet availability" poll will be sent automatically</p>
                <p><small>Bot timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}</small></p>
            </div>
            
            <div class="qr-section" id="qr-section" style="display: none;">
                <h3>📱 Scan QR Code with WhatsApp</h3>
                <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                <div class="qr-code" id="qr-container"></div>
            </div>
            
            <div class="actions">
                <button class="btn btn-success" onclick="sendTestPoll()">📊 Send Test Poll Now</button>
            </div>
            
            <h3>📋 Activity Log</h3>
            <div class="logs" id="logs"></div>
        </div>

        <script>
            const socket = io();
            
            socket.on('status', (status) => {
                updateStatus(status);
            });
            
            socket.on('qr', (qr) => {
                showQRCode(qr);
            });
            
            socket.on('log', (log) => {
                addLog(log);
            });
            
            function updateStatus(status) {
                // Bot status
                const botIndicator = document.getElementById('bot-indicator');
                const botText = document.getElementById('bot-text');
                if (status.ready) {
                    botIndicator.classList.add('active');
                    botText.textContent = 'Ready & Online';
                    document.getElementById('bot-status').classList.add('ready');
                } else {
                    botIndicator.classList.remove('active');
                    botText.textContent = 'Not Ready';
                    document.getElementById('bot-status').classList.remove('ready');
                }
                
                // Next poll time
                const nextPollText = document.getElementById('next-poll-text');
                if (status.nextPollTime) {
                    const nextTime = new Date(status.nextPollTime);
                    nextPollText.textContent = nextTime.toLocaleString();
                }
                
                // Last sent
                const lastSentText = document.getElementById('last-sent-text');
                const lastIndicator = document.getElementById('last-indicator');
                if (status.lastPollSent) {
                    const lastTime = new Date(status.lastPollSent);
                    lastSentText.textContent = lastTime.toLocaleString();
                    lastIndicator.classList.add('active');
                } else {
                    lastSentText.textContent = 'Never';
                    lastIndicator.classList.remove('active');
                }
                
                // Hide QR if authenticated
                if (status.authenticated) {
                    document.getElementById('qr-section').style.display = 'none';
                }
            }
            
            function showQRCode(qr) {
                const qrSection = document.getElementById('qr-section');
                const qrContainer = document.getElementById('qr-container');
                
                qrContainer.innerHTML = '<img src="' + qr + '" alt="QR Code" style="width: 100%; max-width: 250px;">';
                qrSection.style.display = 'block';
            }
            
            function addLog(log) {
                const logs = document.getElementById('logs');
                const entry = document.createElement('div');
                entry.innerHTML = '<span style="color: #888;">[' + new Date().toLocaleTimeString() + ']</span> ' + log;
                logs.appendChild(entry);
                logs.scrollTop = logs.scrollHeight;
                
                // Keep only last 50 logs
                while (logs.children.length > 50) {
                    logs.removeChild(logs.firstChild);
                }
            }
            
            function sendTestPoll() {
                socket.emit('sendTestPoll');
                addLog('📊 Test poll requested...');
            }
            
            // Auto-refresh status every 60 seconds
            setInterval(() => {
                socket.emit('getStatus');
            }, 60000);
            
            // Initial status load
            socket.emit('getStatus');
        </script>
    </body>
    </html>
  `);
});

// Socket.IO connections
io.on('connection', (socket) => {
  console.log('Dashboard connected');
  
  socket.emit('status', botStatus);
  
  socket.on('getStatus', () => {
    socket.emit('status', botStatus);
  });
  
  socket.on('sendTestPoll', async () => {
    if (client && botStatus.ready) {
      await sendDailyPoll(true);
    } else {
      socket.emit('log', '⚠️ Bot not ready yet!');
    }
  });
});

// Optimized poll sending function
async function sendDailyPoll(isTest = false) {
  if (!client || !botStatus.ready) {
    console.log('⚠️ Bot not ready to send poll');
    return false;
  }

  try {
    const startTime = Date.now();
    const pollType = isTest ? "Test Poll" : "Ready for a meet today?";
    
    console.log(`📊 Sending ${pollType}...`);
    io.emit('log', `📊 Sending ${pollType}...`);
    
    const poll = new Poll(pollType, ["Yes", "No"], { 
      allowMultipleAnswers: false 
    });
    
    await client.sendMessage(groupId, poll);
    
    const duration = Date.now() - startTime;
    console.log(`✅ ${pollType} sent successfully in ${duration}ms`);
    io.emit('log', `✅ ${pollType} sent in ${duration}ms`);
    
    if (!isTest) {
      botStatus.lastPollSent = new Date();
      updateNextPollTime();
    }
    
    io.emit('status', botStatus);
    return true;
    
  } catch (error) {
    console.error('❌ Error sending poll:', error);
    io.emit('log', '❌ Error sending poll: ' + error.message);
    return false;
  }
}

// MongoDB and WhatsApp Client setup
let client;

mongoose.connect(mongoUri).then(() => {
  console.log("✅ Connected to MongoDB");
  io.emit('log', '✅ Connected to MongoDB');
  
  const store = new MongoStore({ mongoose: mongoose });
  
  client = new Client({
    authStrategy: new RemoteAuth({
      clientId: 'daily-poll-bot',
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

  // IMPORTANT: No message event listeners for privacy and performance
  // This bot will NEVER read incoming messages

  client.on("qr", async (qr) => {
    console.log("📲 QR Code generated");
    botStatus.qrCode = qr;
    
    try {
      const qrImage = await qrcode.toDataURL(qr);
      io.emit('qr', qrImage);
      io.emit('log', '📲 Scan QR code with your phone');
    } catch (err) {
      console.error('Error generating QR code:', err);
    }
  });

  client.on("authenticated", () => {
    console.log("🔑 Authenticated successfully!");
    botStatus.authenticated = true;
    botStatus.qrCode = null;
    io.emit('status', botStatus);
    io.emit('log', '🔑 WhatsApp authenticated!');
  });

  client.on("auth_failure", (msg) => {
    console.error("❌ Authentication failed:", msg);
    botStatus.authenticated = false;
    botStatus.error = msg;
    io.emit('status', botStatus);
    io.emit('log', '❌ Authentication failed: ' + msg);
  });

  client.on("ready", () => {
    console.log("✅ WhatsApp Bot is ready!");
    botStatus.ready = true;
    botStatus.connected = true;
    updateNextPollTime();
    io.emit('status', botStatus);
    io.emit('log', '✅ Daily Poll Bot is ready!');

    // Schedule daily poll at 10:00 AM
    cron.schedule("0 10 * * *", async () => {
      console.log("⏰ Daily poll time - 10:00 AM");
      io.emit('log', '⏰ Daily poll time - 10:00 AM');
      await sendDailyPoll(false);
    }, {
      timezone: "Asia/Kolkata" // Change to your timezone
    });

    io.emit('log', '📅 Daily poll scheduled for 10:00 AM');
  });

  client.on("disconnected", (reason) => {
    console.log("⚠️ Disconnected:", reason);
    botStatus.connected = false;
    botStatus.ready = false;
    io.emit('status', botStatus);
    io.emit('log', '⚠️ WhatsApp disconnected: ' + reason);
  });

  client.initialize();

}).catch(err => {
  console.error("❌ MongoDB connection failed:", err);
  botStatus.error = err.message;
  io.emit('log', '❌ MongoDB connection failed: ' + err.message);
});

server.listen(PORT, () => {
  console.log(`🌐 Daily Poll Bot running on port ${PORT}`);
});
