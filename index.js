const { Client, RemoteAuth, Poll } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const mongoose = require("mongoose");
const { MongoStore } = require("wwebjs-mongo");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cron = require("node-cron");

// Set timezone to IST
process.env.TZ = 'Asia/Kolkata';

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
  loading: false,
  dbSessionExists: false
};

// Logs array to store recent logs
let logs = [];
function addLog(message) {
  const now = new Date();
  const timestamp = now.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  const logEntry = `[${timestamp} IST] ${message}`;
  logs.push(logEntry);
  
  if (logs.length > 100) logs.shift();
  io.emit("newLog", logEntry);
  console.log(logEntry);
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
                padding: 15px;
            }
            
            .container {
                max-width: 1100px;
                margin: 0 auto;
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.15);
                overflow: hidden;
            }
            
            .header {
                background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
                color: white;
                padding: 25px 30px;
                text-align: center;
                position: relative;
            }
            
            .header::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: linear-gradient(90deg, #25D366, #128C7E, #25D366);
            }
            
            .header h1 {
                margin-bottom: 8px;
                font-size: 28px;
            }
            
            .header p {
                opacity: 0.9;
                font-size: 16px;
            }
            
            .privacy-badge {
                background: rgba(255,255,255,0.2);
                color: white;
                padding: 8px 16px;
                border-radius: 25px;
                font-size: 14px;
                font-weight: bold;
                display: inline-block;
                margin-top: 10px;
                border: 1px solid rgba(255,255,255,0.3);
            }
            
            .status-section {
                padding: 25px 30px;
                border-bottom: 1px solid #eee;
            }
            
            .status-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 20px;
                margin-bottom: 25px;
            }
            
            .status-card {
                background: #f8f9fa;
                border-radius: 12px;
                padding: 20px;
                text-align: center;
                border-left: 4px solid #ddd;
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }
            
            .status-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: linear-gradient(90deg, transparent, #ddd, transparent);
                transition: all 0.3s ease;
            }
            
            .status-card.connected {
                border-left-color: #28a745;
                background: #d4edda;
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(40, 167, 69, 0.15);
            }
            
            .status-card.connected::before {
                background: linear-gradient(90deg, transparent, #28a745, transparent);
            }
            
            .status-card.disconnected {
                border-left-color: #dc3545;
                background: #f8d7da;
            }
            
            .status-card.loading {
                border-left-color: #ffc107;
                background: #fff3cd;
            }
            
            .status-card h3 {
                margin-bottom: 10px;
                font-size: 16px;
                color: #333;
            }
            
            .status-indicator {
                display: inline-block;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                margin-right: 8px;
                background: #dc3545;
                transition: all 0.3s ease;
            }
            
            .status-indicator.active {
                background: #28a745;
                animation: pulse 2s infinite;
                box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.7);
            }
            
            .status-indicator.loading {
                background: #ffc107;
                animation: spin 1s linear infinite;
            }
            
            @keyframes pulse {
                0% {
                    transform: scale(0.95);
                    box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.7);
                }
                70% {
                    transform: scale(1);
                    box-shadow: 0 0 0 5px rgba(40, 167, 69, 0);
                }
                100% {
                    transform: scale(0.95);
                    box-shadow: 0 0 0 0 rgba(40, 167, 69, 0);
                }
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .info-section {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                margin: 25px 0;
            }
            
            .schedule-info, .session-info {
                background: #e7f3ff;
                border: 1px solid #b3d7ff;
                border-radius: 12px;
                padding: 20px;
                text-align: center;
            }
            
            .session-info.has-session {
                background: #d4edda;
                border-color: #c3e6cb;
            }
            
            .session-info.no-session {
                background: #fff3cd;
                border-color: #ffeaa7;
            }
            
            .actions {
                text-align: center;
                margin: 25px 0;
            }
            
            .btn {
                background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
                color: white;
                border: none;
                padding: 14px 28px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                transition: all 0.3s ease;
                margin: 0 10px;
                box-shadow: 0 4px 15px rgba(0, 123, 255, 0.3);
            }
            
            .btn:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(0, 123, 255, 0.4);
            }
            
            .btn:disabled {
                background: linear-gradient(135deg, #6c757d 0%, #545b62 100%);
                cursor: not-allowed;
                transform: none;
                box-shadow: none;
            }
            
            .qr-section {
                text-align: center;
                padding: 30px;
                background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
                border: 2px solid #ffc107;
                border-radius: 15px;
                margin: 25px 0;
                animation: slideIn 0.5s ease;
            }
            
            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            .qr-code {
                display: inline-block;
                padding: 25px;
                background: white;
                border-radius: 15px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.15);
                margin: 20px 0;
                border: 3px solid #25D366;
            }
            
            .qr-code img {
                max-width: 280px;
                width: 100%;
                border-radius: 8px;
            }
            
            .logs-section {
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                color: #00ff00;
                padding: 25px 30px;
            }
            
            .logs-header {
                color: #00ff00;
                margin-bottom: 20px;
                font-weight: bold;
                font-size: 18px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .logs-container {
                max-height: 450px;
                overflow-y: auto;
                background: #000;
                border-radius: 10px;
                padding: 20px;
                font-family: 'Courier New', monospace;
                font-size: 14px;
                line-height: 1.6;
                border: 1px solid #333;
                box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
            }
            
            .log-entry {
                margin-bottom: 8px;
                word-wrap: break-word;
                padding: 2px 0;
                border-left: 2px solid transparent;
                padding-left: 8px;
                transition: all 0.3s ease;
            }
            
            .log-entry:hover {
                background: rgba(0, 255, 0, 0.1);
                border-left-color: #00ff00;
            }
            
            .log-entry.error {
                color: #ff6b6b;
            }
            
            .log-entry.success {
                color: #51cf66;
            }
            
            .log-entry.warning {
                color: #ffc107;
            }
            
            @media (max-width: 768px) {
                .info-section {
                    grid-template-columns: 1fr;
                }
                
                .status-grid {
                    grid-template-columns: 1fr;
                }
                
                .container {
                    margin: 10px;
                    border-radius: 15px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 WhatsApp Daily Poll Bot</h1>
                <p>Automated polling system for daily meetings</p>
                <div class="privacy-badge">🔒 Privacy-First: No message reading</div>
            </div>
            
            <div class="status-section">
                <div class="status-grid">
                    <div class="status-card loading" id="connection-card">
                        <h3><span class="status-indicator loading" id="conn-indicator"></span>Connection</h3>
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
                
                <div class="info-section">
                    <div class="schedule-info">
                        <h3>📅 Schedule</h3>
                        <p><strong>Daily at 10:00 AM IST</strong></p>
                        <p>Next: <span id="next-poll">Calculating...</span></p>
                        <p><small>Last sent: <span id="last-sent">Never</span></small></p>
                    </div>
                    
                    <div class="session-info no-session" id="session-info">
                        <h3>🗄️ Session Status</h3>
                        <p id="session-status">Checking database...</p>
                        <p><small id="session-details">Validating stored session</small></p>
                    </div>
                </div>
                
                <div class="actions">
                    <button class="btn" id="test-btn" onclick="sendTestPoll()" disabled>
                        📊 Send Test Poll
                    </button>
                </div>
            </div>
            
            <div id="qr-section" class="qr-section" style="display: none;">
                <h3>📱 Scan QR Code with WhatsApp</h3>
                <p><strong>Open WhatsApp → Settings → Linked Devices → Link a Device</strong></p>
                <div class="qr-code" id="qr-container">
                    <div style="padding: 40px; color: #666;">Generating QR Code...</div>
                </div>
                <p><small>⚠️ This will replace any existing session for this bot</small></p>
            </div>
            
            <div class="logs-section">
                <h3 class="logs-header">
                    <span>📋</span>
                    <span>Live Activity Logs</span>
                    <span style="margin-left: auto; font-size: 14px; opacity: 0.7;">IST Timezone</span>
                </h3>
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
            socket.on('hideQR', hideQRCode);
            
            function updateStatus(status) {
                console.log('Status update:', status);
                
                // Connection status
                const connCard = document.getElementById('connection-card');
                const connIndicator = document.getElementById('conn-indicator');
                const connStatus = document.getElementById('conn-status');
                
                if (status.loading) {
                    connCard.className = 'status-card loading';
                    connIndicator.className = 'status-indicator loading';
                    connStatus.textContent = 'Connecting...';
                } else if (status.connected) {
                    connCard.className = 'status-card connected';
                    connIndicator.className = 'status-indicator active';
                    connStatus.textContent = 'Connected to WhatsApp';
                } else {
                    connCard.className = 'status-card disconnected';
                    connIndicator.className = 'status-indicator';
                    connStatus.textContent = 'Disconnected';
                }
                
                // Authentication status
                const authCard = document.getElementById('auth-card');
                const authIndicator = document.getElementById('auth-indicator');
                const authStatus = document.getElementById('auth-status');
                
                if (status.authenticated) {
                    authCard.className = 'status-card connected';
                    authIndicator.className = 'status-indicator active';
                    authStatus.textContent = 'Authenticated';
                } else {
                    authCard.className = 'status-card disconnected';
                    authIndicator.className = 'status-indicator';
                    authStatus.textContent = 'Not Authenticated';
                }
                
                // Ready status
                const readyCard = document.getElementById('ready-card');
                const readyIndicator = document.getElementById('ready-indicator');
                const readyStatus = document.getElementById('ready-status');
                const testBtn = document.getElementById('test-btn');
                
                if (status.ready) {
                    readyCard.className = 'status-card connected';
                    readyIndicator.className = 'status-indicator active';
                    readyStatus.textContent = 'Ready & Online';
                    testBtn.disabled = false;
                } else {
                    readyCard.className = 'status-card disconnected';
                    readyIndicator.className = 'status-indicator';
                    readyStatus.textContent = 'Not Ready';
                    testBtn.disabled = true;
                }
                
                // Session info
                const sessionInfo = document.getElementById('session-info');
                const sessionStatus = document.getElementById('session-status');
                const sessionDetails = document.getElementById('session-details');
                
                if (status.dbSessionExists) {
                    sessionInfo.className = 'session-info has-session';
                    sessionStatus.textContent = 'Session Found';
                    sessionDetails.textContent = 'Valid session data in database';
                } else {
                    sessionInfo.className = 'session-info no-session';
                    sessionStatus.textContent = 'No Session';
                    sessionDetails.textContent = 'QR code required for authentication';
                }
                
                // Schedule info
                if (status.nextPollTime) {
                    document.getElementById('next-poll').textContent = 
                        new Date(status.nextPollTime).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                }
                
                if (status.lastPollSent) {
                    document.getElementById('last-sent').textContent = 
                        new Date(status.lastPollSent).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                }
                
                // Hide QR if session exists or authenticated
                if (status.dbSessionExists || status.authenticated) {
                    hideQRCode();
                }
            }
            
            function showQRCode(qrImage) {
                console.log('Showing QR code');
                const qrSection = document.getElementById('qr-section');
                const qrContainer = document.getElementById('qr-container');
                
                qrContainer.innerHTML = '<img src="' + qrImage + '" alt="QR Code">';
                qrSection.style.display = 'block';
            }
            
            function hideQRCode() {
                console.log('Hiding QR code');
                const qrSection = document.getElementById('qr-section');
                qrSection.style.display = 'none';
            }
            
            function addLogEntry(log) {
                const logsContainer = document.getElementById('logs');
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                
                // Add styling based on log content
                if (log.includes('❌') || log.includes('Error')) {
                    logEntry.classList.add('error');
                } else if (log.includes('✅') || log.includes('successfully')) {
                    logEntry.classList.add('success');
                } else if (log.includes('⚠️') || log.includes('Warning')) {
                    logEntry.classList.add('warning');
                }
                
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
                    
                    if (log.includes('❌') || log.includes('Error')) {
                        logEntry.classList.add('error');
                    } else if (log.includes('✅') || log.includes('successfully')) {
                        logEntry.classList.add('success');
                    } else if (log.includes('⚠️') || log.includes('Warning')) {
                        logEntry.classList.add('warning');
                    }
                    
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
  addLog("📱 Dashboard connected");
  
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
      addLog("🧪 Test poll requested via dashboard");
      await sendTestPoll();
    } else {
      addLog("⚠️ Bot not ready - cannot send test poll");
    }
  });
});

server.listen(PORT, () => {
  addLog(`🌐 Dashboard running on port ${PORT}`);
});

// Enhanced session checking function
async function checkDatabaseSession() {
  try {
    addLog("🔍 Checking for existing session in database...");
    
    // Wait for mongoose to be fully connected
    if (mongoose.connection.readyState !== 1) {
      addLog("⚠️ MongoDB not ready, waiting...");
      return false;
    }
    
    // Check for session collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    addLog(`📊 Found ${collections.length} collections in database`);
    
    // Look for session-related collections
    const sessionCollections = collections.filter(c => 
      c.name.includes('session') || 
      c.name.includes('auth') || 
      c.name.includes('whatsapp')
    );
    
    if (sessionCollections.length === 0) {
      addLog("📦 No session collections found in database");
      return false;
    }
    
    addLog(`📦 Found ${sessionCollections.length} session-related collections`);
    
    // Check each collection for our clientId
    for (const collection of sessionCollections) {
      try {
        const count = await mongoose.connection.db
          .collection(collection.name)
          .countDocuments({ id: clientId });
        
        if (count > 0) {
          addLog(`✅ Found ${count} session record(s) for clientId: ${clientId}`);
          return true;
        }
      } catch (err) {
        addLog(`⚠️ Error checking collection ${collection.name}: ${err.message}`);
      }
    }
    
    addLog("📦 No session found for current clientId");
    return false;
    
  } catch (error) {
    addLog(`❌ Error checking database session: ${error.message}`);
    return false;
  }
}

// Main bot initialization with robust session handling
let client;

(async function initializeBot() {
  try {
    botStatus.loading = true;
    io.emit("status", botStatus);
    
    addLog("🔄 Connecting to MongoDB...");
    await mongoose.connect(mongoUri, { 
      useNewUrlParser: true, 
      useUnifiedTopology: true 
    });
    addLog("✅ Connected to MongoDB");

    // Check for existing session in database
    botStatus.dbSessionExists = await checkDatabaseSession();
    botStatus.sessionRestored = botStatus.dbSessionExists;
    
    io.emit("status", botStatus);

    const store = new MongoStore({ mongoose });
    
    // Give MongoDB and store time to initialize
    addLog("⏳ Initializing session store...");
    await new Promise(resolve => setTimeout(resolve, 3000));

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

    // WhatsApp events with enhanced QR handling
    client.on("qr", async (qr) => {
      // Only show QR if no session exists in database
      if (!botStatus.dbSessionExists) {
        addLog("📲 QR Code generated - authentication required");
        botStatus.qrCode = qr;
        
        try {
          const qrImage = await qrcode.toDataURL(qr);
          io.emit("qr", qrImage);
        } catch (err) {
          addLog("❌ Error generating QR code display");
        }
      } else {
        addLog("🔄 QR generated but session exists - waiting for restoration");
      }
      
      io.emit("status", botStatus);
    });

    client.on("authenticated", () => {
      addLog("🔑 WhatsApp authenticated successfully!");
      botStatus.authenticated = true;
      botStatus.qrCode = null;
      botStatus.sessionRestored = true;
      botStatus.dbSessionExists = true;
      
      // Hide QR code
      io.emit("hideQR");
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
      botStatus.loading = false;
      updateNextPollTime();
      
      // Hide QR code when ready
      io.emit("hideQR");
      io.emit("status", botStatus);

      // Schedule daily poll at 10:00 AM IST
      cron.schedule("0 10 * * *", async () => {
        addLog("⏰ Daily poll time - 10:00 AM IST");
        await sendDailyPoll();
      }, { 
        timezone: "Asia/Kolkata"
      });
      
      addLog("📅 Daily poll scheduled for 10:00 AM IST");
    });

    client.on("disconnected", (reason) => {
      addLog(`⚠️ WhatsApp disconnected: ${reason}`);
      botStatus.connected = false;
      botStatus.ready = false;
      botStatus.loading = false;
      io.emit("status", botStatus);
    });

    client.on("loading_screen", (percent, message) => {
      if (percent) {
        addLog(`⏳ Loading WhatsApp Web: ${percent}% - ${message}`);
      }
    });

    // Initialize client
    addLog("🚀 Initializing WhatsApp client...");
    botStatus.loading = true;
    io.emit("status", botStatus);
    
    await client.initialize();

  } catch (error) {
    addLog(`❌ Bot initialization failed: ${error.message}`);
    botStatus.error = error.message;
    botStatus.loading = false;
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
