const { Client, RemoteAuth, Poll } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const mongoose = require("mongoose");
const { MongoStore } = require("wwebjs-mongo");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cron = require("node-cron");

// Environment variables
const PORT = process.env.PORT || 3000;
const groupId = process.env.GROUP_ID || "120363420330015494@g.us";
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp-bot";
const clientId = process.env.CLIENT_ID || "daily-poll-bot-stable";

// Express + Socket.io setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let botStatus = {
  connected: false,
  authenticated: false,
  ready: false,
  qrCode: null,
  lastPollSent: null,
  nextPollTime: null,
  error: null,
  sessionRestored: false,
};

// Logs array to store recent logs
let logs = [];
function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logs.push(`[${timestamp}] ${message}`);
  if (logs.length > 100) logs.shift(); // Keep only last 100 logs
  io.emit("newLog", `[${timestamp}] ${message}`);
  console.log(message);
}

function getNext10AM() {
  const now = new Date();
  const next10AM = new Date();
  next10AM.setHours(10, 0, 0, 0);
  if (now > next10AM) next10AM.setDate(next10AM.getDate() + 1);
  return next10AM;
}

function updateNextPollTime() {
  botStatus.nextPollTime = getNext10AM();
}

// Enhanced web dashboard
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Daily Poll Bot</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            
            .container {
                max-width: 1000px;
                margin: 0 auto;
                background: white;
                border-radius: 15px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                overflow: hidden;
            }
            
            .header {
                background: #25D366;
                color: white;
                padding: 20px 30px;
                text-align: center;
            }
            
            .header h1 {
                margin-bottom: 5px;
            }
            
            .status-section {
                padding: 20px 30px;
                border-bottom: 1px solid #eee;
            }
            
            .status-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-bottom: 20px;
            }
            
            .status-card {
                background: #f8f9fa;
                border-radius: 8px;
                padding: 15px;
                text-align: center;
                border-left: 4px solid #ddd;
                transition: all 0.3s;
            }
            
            .status-card.connected {
                border-left-color: #28a745;
                background: #d4edda;
            }
            
            .status-card.disconnected {
                border-left-color: #dc3545;
                background: #f8d7da;
            }
            
            .status-indicator {
                display: inline-block;
                width: 10px;
                height: 10px;
                border-radius: 50%;
                margin-right: 8px;
                background: #dc3545;
            }
            
            .status-indicator.active {
                background: #28a745;
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            
            .qr-section {
                text-align: center;
                padding: 20px;
                background: #fff3cd;
                border: 1px solid #ffeaa7;
                border-radius: 10px;
                margin: 20px 0;
            }
            
            .qr-code {
                display: inline-block;
                padding: 20px;
                background: white;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.1);
                margin: 15px 0;
            }
            
            .qr-code img {
                max-width: 300px;
                width: 100%;
            }
            
            .actions {
                text-align: center;
                margin: 20px 0;
            }
            
            .btn {
                background: #007bff;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                transition: all 0.3s;
                margin: 0 10px;
            }
            
            .btn:hover {
                background: #0056b3;
                transform: translateY(-2px);
            }
            
            .btn:disabled {
                background: #6c757d;
                cursor: not-allowed;
                transform: none;
            }
            
            .logs-section {
                background: #1e1e1e;
                color: #00ff00;
                padding: 20px 30px;
            }
            
            .logs-header {
                color: #00ff00;
                margin-bottom: 15px;
                font-weight: bold;
            }
            
            .logs-container {
                max-height: 400px;
                overflow-y: auto;
                background: #000;
                border-radius: 8px;
                padding: 15px;
                font-family: 'Courier New', monospace;
                font-size: 14px;
                line-height: 1.4;
            }
            
            .log-entry {
                margin-bottom: 5px;
                word-wrap: break-word;
            }
            
            .schedule-info {
                background: #e7f3ff;
                border: 1px solid #b3d7ff;
                border-radius: 8px;
                padding: 15px;
                margin: 20px 0;
                text-align: center;
            }
            
            .privacy-badge {
                background: #d4edda;
                color: #155724;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: bold;
                display: inline-block;
                margin: 10px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 WhatsApp Daily Poll Bot</h1>
                <p>Sends "Meet availability" poll daily at 10:00 AM</p>
                <div class="privacy-badge">🔒 Privacy-First: No message reading</div>
            </div>
            
            <div class="status-section">
                <div class="status-grid">
                    <div class="status-card" id="connection-card">
                        <h3><span class="status-indicator" id="conn-indicator"></span>Connection</h3>
                        <p id="conn-status">Initializing...</p>
                    </div>
                    
                    <div class="status-card" id="auth-card">
                        <h3><span class="status-indicator" id="auth-indicator"></span>Authentication</h3>
                        <p id="auth-status">Waiting...</p>
                    </div>
                    
                    <div class="status-card" id="ready-card">
                        <h3><span class="status-indicator" id="ready-indicator"></span>Bot Status</h3>
                        <p id="ready-status">Not Ready</p>
                    </div>
                </div>
                
                <div class="schedule-info">
                    <h3>📅 Next Poll</h3>
                    <p id="next-poll">Calculating...</p>
                    <p><small>Last sent: <span id="last-sent">Never</span></small></p>
                </div>
                
                <div class="actions">
                    <button class="btn" id="test-btn" onclick="sendTestPoll()" disabled>
                        📊 Send Test Poll
                    </button>
                </div>
            </div>
            
            <div id="qr-section" class="qr-section" style="display: none;">
                <h3>📱 Scan QR Code with WhatsApp</h3>
                <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                <div class="qr-code" id="qr-container"></div>
                <p><small>This will replace your current session if you scan</small></p>
            </div>
            
            <div class="logs-section">
                <h3 class="logs-header">📋 Live Activity Logs</h3>
                <div class="logs-container" id="logs"></div>
            </div>
        </div>

        <script>
            const socket = io();
            
            // Connect to socket events
            socket.on('status', updateStatus);
            socket.on('qr', showQRCode);
            socket.on('newLog', addLogEntry);
            socket.on('allLogs', loadAllLogs);
            
            function updateStatus(status) {
                // Connection status
                const connCard = document.getElementById('connection-card');
                const connIndicator = document.getElementById('conn-indicator');
                const connStatus = document.getElementById('conn-status');
                
                if (status.connected) {
                    connCard.className = 'status-card connected';
                    connIndicator.classList.add('active');
                    connStatus.textContent = 'Connected to WhatsApp';
                } else {
                    connCard.className = 'status-card disconnected';
                    connIndicator.classList.remove('active');
                    connStatus.textContent = 'Disconnected';
                }
                
                // Authentication status
                const authCard = document.getElementById('auth-card');
                const authIndicator = document.getElementById('auth-indicator');
                const authStatus = document.getElementById('auth-status');
                
                if (status.authenticated) {
                    authCard.className = 'status-card connected';
                    authIndicator.classList.add('active');
                    authStatus.textContent = 'Authenticated';
                } else {
                    authCard.className = 'status-card disconnected';
                    authIndicator.classList.remove('active');
                    authStatus.textContent = 'Not Authenticated';
                }
                
                // Ready status
                const readyCard = document.getElementById('ready-card');
                const readyIndicator = document.getElementById('ready-indicator');
                const readyStatus = document.getElementById('ready-status');
                const testBtn = document.getElementById('test-btn');
                
                if (status.ready) {
                    readyCard.className = 'status-card connected';
                    readyIndicator.classList.add('active');
                    readyStatus.textContent = 'Ready & Online';
                    testBtn.disabled = false;
                } else {
                    readyCard.className = 'status-card disconnected';
                    readyIndicator.classList.remove('active');
                    readyStatus.textContent = 'Not Ready';
                    testBtn.disabled = true;
                }
                
                // Schedule info
                if (status.nextPollTime) {
                    document.getElementById('next-poll').textContent = 
                        new Date(status.nextPollTime).toLocaleString();
                }
                
                if (status.lastPollSent) {
                    document.getElementById('last-sent').textContent = 
                        new Date(status.lastPollSent).toLocaleString();
                }
                
                // Hide QR if authenticated
                if (status.authenticated) {
                    document.getElementById('qr-section').style.display = 'none';
                }
            }
            
            function showQRCode(qrImage) {
                const qrSection = document.getElementById('qr-section');
                const qrContainer = document.getElementById('qr-container');
                
                qrContainer.innerHTML = '<img src="' + qrImage + '" alt="QR Code">';
                qrSection.style.display = 'block';
            }
            
            function addLogEntry(log) {
                const logsContainer = document.getElementById('logs');
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.textContent = log;
                logsContainer.appendChild(logEntry);
                logsContainer.scrollTop = logsContainer.scrollHeight;
                
                // Keep only last 100 entries
                while (logsContainer.children.length > 100) {
                    logsContainer.removeChild(logsContainer.firstChild);
                }
            }
            
            function loadAllLogs(allLogs) {
                const logsContainer = document.getElementById('logs');
                logsContainer.innerHTML = '';
                allLogs.forEach(log => {
                    const logEntry = document.createElement('div');
                    logEntry.className = 'log-entry';
                    logEntry.textContent = log;
                    logsContainer.appendChild(logEntry);
                });
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }
            
            function sendTestPoll() {
                socket.emit('testPoll');
            }
            
            // Request initial status and logs
            socket.emit('getStatus');
            socket.emit('getLogs');
            
            // Auto-refresh status every 30 seconds
            setInterval(() => {
                socket.emit('getStatus');
            }, 30000);
        </script>
    </body>
    </html>
  `);
});

// Socket.io event handling
io.on("connection", (socket) => {
  addLog("Dashboard connected");
  
  socket.emit("status", botStatus);
  socket.emit("allLogs", logs);
  
  socket.on("getStatus", () => {
    socket.emit("status", botStatus);
  });
  
  socket.on("getLogs", () => {
    socket.emit("allLogs", logs);
  });
  
  socket.on("testPoll", async () => {
    if (client && botStatus.ready) {
      addLog("🧪 Test poll requested");
      await sendTestPoll();
    } else {
      addLog("⚠️ Bot not ready - cannot send test poll");
    }
  });
});

server.listen(PORT, () => {
  addLog(`🌐 Dashboard running on port ${PORT}`);
});

// Main bot initialization
let client;

(async function initializeBot() {
  try {
    addLog("🔄 Connecting to MongoDB...");
    await mongoose.connect(mongoUri, { 
      useNewUrlParser: true, 
      useUnifiedTopology: true 
    });
    addLog("✅ Connected to MongoDB");

    const store = new MongoStore({ mongoose });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check for existing session
    let sessionExists = false;
    try {
      const collections = await mongoose.connection.db.listCollections().toArray();
      const sessionCollection = collections.find(c => c.name.includes("session"));
      if (sessionCollection) {
        const count = await mongoose.connection.db.collection(sessionCollection.name)
          .countDocuments({ id: clientId });
        sessionExists = count > 0;
      }
    } catch (err) {
      // Ignore errors
    }
    
    botStatus.sessionRestored = sessionExists;
    addLog(`📦 Session exists in DB: ${sessionExists ? 'Yes' : 'No'}`);

    client = new Client({
      authStrategy: new RemoteAuth({
        clientId,
        store,
        backupSyncIntervalMs: 300000,
      }),
      puppeteer: {
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
        ],
      },
    });

    // WhatsApp events
    client.on("qr", async (qr) => {
      addLog("📲 QR Code generated - scan to authenticate");
      botStatus.qrCode = qr;
      try {
        const qrImage = await qrcode.toDataURL(qr);
        io.emit("qr", qrImage);
      } catch (err) {
        addLog("❌ Error generating QR code display");
      }
      io.emit("status", botStatus);
    });

    client.on("authenticated", () => {
      addLog("🔑 WhatsApp authenticated successfully!");
      botStatus.authenticated = true;
      botStatus.qrCode = null;
      botStatus.sessionRestored = true;
      io.emit("status", botStatus);
    });

    client.on("auth_failure", (msg) => {
      addLog(`❌ Authentication failed: ${msg}`);
      botStatus.authenticated = false;
      botStatus.error = msg;
      io.emit("status", botStatus);
    });

    client.on("ready", () => {
      addLog("✅ WhatsApp Bot is ready and online!");
      botStatus.ready = true;
      botStatus.connected = true;
      updateNextPollTime();
      io.emit("status", botStatus);

      // Schedule daily poll at 10:00 AM
      cron.schedule("0 10 * * *", async () => {
        addLog("⏰ Daily poll time - 10:00 AM");
        await sendDailyPoll();
      }, { timezone: "Asia/Kolkata" });
      
      addLog("📅 Daily poll scheduled for 10:00 AM IST");
    });

    client.on("disconnected", (reason) => {
      addLog(`⚠️ WhatsApp disconnected: ${reason}`);
      botStatus.connected = false;
      botStatus.ready = false;
      io.emit("status", botStatus);
    });

    // Initialize client
    addLog("🚀 Initializing WhatsApp client...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    await client.initialize();

  } catch (error) {
    addLog(`❌ Bot initialization failed: ${error.message}`);
    botStatus.error = error.message;
    io.emit("status", botStatus);
  }
})();

// Poll sending functions
async function sendDailyPoll() {
  return await sendPoll("Meet availability", false);
}

async function sendTestPoll() {
  return await sendPoll("Test Poll", true);
}

async function sendPoll(pollName, isTest) {
  try {
    if (!client || !botStatus.ready) {
      addLog("⚠️ Cannot send poll - bot not ready");
      return false;
    }

    addLog(`📊 Sending ${pollName}...`);
    const poll = new Poll(pollName, ["Yes", "No"], { allowMultipleAnswers: false });
    await client.sendMessage(groupId, poll);
    
    addLog(`✅ ${pollName} sent successfully!`);
    
    if (!isTest) {
      botStatus.lastPollSent = new Date();
      updateNextPollTime();
    }
    
    io.emit("status", botStatus);
    return true;
    
  } catch (error) {
    addLog(`❌ Error sending ${pollName}: ${error.message}`);
    return false;
  }
}
