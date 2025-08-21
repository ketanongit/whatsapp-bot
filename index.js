const { Client, RemoteAuth, Poll } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const cron = require("node-cron");
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

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
  lastActivity: null,
  error: null
};

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API endpoints
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot Dashboard</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                max-width: 1200px;
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
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
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
            
            .status-card.connected {
                border-left-color: #28a745;
            }
            
            .status-card.authenticated {
                border-left-color: #007bff;
            }
            
            .status-card.ready {
                border-left-color: #25D366;
            }
            
            .status-card.error {
                border-left-color: #dc3545;
                background: #fff5f5;
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
            
            .logs {
                background: #1e1e1e;
                color: #00ff00;
                padding: 20px;
                border-radius: 10px;
                max-height: 400px;
                overflow-y: auto;
                font-family: 'Courier New', monospace;
                font-size: 14px;
                line-height: 1.4;
            }
            
            .log-entry {
                margin-bottom: 5px;
            }
            
            .log-timestamp {
                color: #888;
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
            
            .btn-primary {
                background: #007bff;
                color: white;
            }
            
            .btn-primary:hover {
                background: #0056b3;
            }
            
            .btn-success {
                background: #28a745;
                color: white;
            }
            
            .btn-success:hover {
                background: #1e7e34;
            }
            
            .btn-danger {
                background: #dc3545;
                color: white;
            }
            
            .btn-danger:hover {
                background: #c82333;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 WhatsApp Bot Dashboard</h1>
                <p>Real-time monitoring and control</p>
            </div>
            
            <div class="status-grid">
                <div class="status-card" id="connection-status">
                    <h3><span class="status-indicator" id="conn-indicator"></span>Connection</h3>
                    <p id="conn-text">Disconnected</p>
                </div>
                
                <div class="status-card" id="auth-status">
                    <h3><span class="status-indicator" id="auth-indicator"></span>Authentication</h3>
                    <p id="auth-text">Not Authenticated</p>
                </div>
                
                <div class="status-card" id="ready-status">
                    <h3><span class="status-indicator" id="ready-indicator"></span>Bot Status</h3>
                    <p id="ready-text">Not Ready</p>
                </div>
                
                <div class="status-card" id="activity-status">
                    <h3><span class="status-indicator" id="activity-indicator"></span>Last Activity</h3>
                    <p id="activity-text">Never</p>
                </div>
            </div>
            
            <div class="qr-section" id="qr-section" style="display: none;">
                <h3>📱 Scan QR Code with WhatsApp</h3>
                <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                <div class="qr-code" id="qr-container"></div>
                <p><small>QR Code will refresh automatically if needed</small></p>
            </div>
            
            <div class="actions">
                <button class="btn btn-success" onclick="sendTestPoll()">📊 Send Test Poll</button>
                <button class="btn btn-primary" onclick="refreshStatus()">🔄 Refresh Status</button>
                <button class="btn btn-danger" onclick="restartBot()">🔄 Restart Bot</button>
            </div>
            
            <h3>📋 Live Logs</h3>
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
                // Connection status
                const connIndicator = document.getElementById('conn-indicator');
                const connText = document.getElementById('conn-text');
                if (status.connected) {
                    connIndicator.classList.add('active');
                    connText.textContent = 'Connected';
                    document.getElementById('connection-status').classList.add('connected');
                } else {
                    connIndicator.classList.remove('active');
                    connText.textContent = 'Disconnected';
                    document.getElementById('connection-status').classList.remove('connected');
                }
                
                // Auth status
                const authIndicator = document.getElementById('auth-indicator');
                const authText = document.getElementById('auth-text');
                if (status.authenticated) {
                    authIndicator.classList.add('active');
                    authText.textContent = 'Authenticated';
                    document.getElementById('auth-status').classList.add('authenticated');
                } else {
                    authIndicator.classList.remove('active');
                    authText.textContent = 'Not Authenticated';
                    document.getElementById('auth-status').classList.remove('authenticated');
                }
                
                // Ready status
                const readyIndicator = document.getElementById('ready-indicator');
                const readyText = document.getElementById('ready-text');
                if (status.ready) {
                    readyIndicator.classList.add('active');
                    readyText.textContent = 'Ready & Online';
                    document.getElementById('ready-status').classList.add('ready');
                } else {
                    readyIndicator.classList.remove('active');
                    readyText.textContent = 'Not Ready';
                    document.getElementById('ready-status').classList.remove('ready');
                }
                
                // Last activity
                const activityText = document.getElementById('activity-text');
                if (status.lastActivity) {
                    activityText.textContent = new Date(status.lastActivity).toLocaleString();
                    document.getElementById('activity-indicator').classList.add('active');
                } else {
                    activityText.textContent = 'Never';
                    document.getElementById('activity-indicator').classList.remove('active');
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
                entry.className = 'log-entry';
                entry.innerHTML = '<span class="log-timestamp">[' + new Date().toLocaleTimeString() + ']</span> ' + log;
                logs.appendChild(entry);
                logs.scrollTop = logs.scrollHeight;
                
                // Keep only last 100 logs
                while (logs.children.length > 100) {
                    logs.removeChild(logs.firstChild);
                }
            }
            
            function sendTestPoll() {
                socket.emit('sendTestPoll');
                addLog('🔄 Test poll requested...');
            }
            
            function refreshStatus() {
                socket.emit('getStatus');
                addLog('🔄 Status refresh requested...');
            }
            
            function restartBot() {
                if (confirm('Are you sure you want to restart the bot?')) {
                    socket.emit('restart');
                    addLog('🔄 Bot restart requested...');
                }
            }
            
            // Auto-refresh status every 30 seconds
            setInterval(() => {
                socket.emit('getStatus');
            }, 30000);
            
            // Initial status load
            socket.emit('getStatus');
        </script>
    </body>
    </html>
  `);
});

app.get('/api/status', (req, res) => {
  res.json(botStatus);
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
      try {
        const poll = new Poll("Test Poll", ["Yes", "No"], { allowMultipleAnswers: false });
        await client.sendMessage(groupId, poll);
        socket.emit('log', '✅ Test poll sent successfully!');
        botStatus.lastActivity = new Date();
      } catch (error) {
        socket.emit('log', '❌ Error sending test poll: ' + error.message);
      }
    } else {
      socket.emit('log', '⚠️ Bot not ready yet!');
    }
  });
  
  socket.on('restart', () => {
    socket.emit('log', '🔄 Restarting bot...');
    process.exit(1); // Let Render restart the service
  });
});

// MongoDB and WhatsApp Client setup
let client;

mongoose.connect(mongoUri).then(() => {
  console.log("Connected to MongoDB");
  io.emit('log', '✅ Connected to MongoDB');
  
  const store = new MongoStore({ mongoose: mongoose });
  
  client = new Client({
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

  client.on("qr", async (qr) => {
    console.log("📲 QR Code received");
    botStatus.qrCode = qr;
    
    try {
      const qrImage = await qrcode.toDataURL(qr);
      io.emit('qr', qrImage);
      io.emit('log', '📲 New QR code generated - scan with your phone');
    } catch (err) {
      console.error('Error generating QR code:', err);
    }
  });

  client.on("authenticated", () => {
    console.log("🔑 Authenticated successfully!");
    botStatus.authenticated = true;
    botStatus.qrCode = null;
    io.emit('status', botStatus);
    io.emit('log', '🔑 WhatsApp authenticated successfully!');
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
    botStatus.lastActivity = new Date();
    io.emit('status', botStatus);
    io.emit('log', '✅ WhatsApp Bot is ready and online!');

    // Schedule poll every hour
    cron.schedule("0 * * * *", async () => {
      try {
        console.log("⏰ Sending scheduled poll...");
        io.emit('log', '⏰ Sending scheduled poll...');
        
        const poll = new Poll("Meet availability", ["Yes", "No"], { allowMultipleAnswers: false });
        await client.sendMessage(groupId, poll);
        
        console.log("📊 Poll sent successfully");
        botStatus.lastActivity = new Date();
        io.emit('status', botStatus);
        io.emit('log', '📊 Scheduled poll sent successfully!');
      } catch (err) {
        console.error("Error sending poll:", err);
        io.emit('log', '❌ Error sending scheduled poll: ' + err.message);
      }
    });
  });

  client.on("disconnected", (reason) => {
    console.log("⚠️ Client disconnected:", reason);
    botStatus.connected = false;
    botStatus.ready = false;
    io.emit('status', botStatus);
    io.emit('log', '⚠️ WhatsApp disconnected: ' + reason);
  });

  client.initialize();

}).catch(err => {
  console.error("MongoDB connection failed:", err);
  botStatus.error = err.message;
  io.emit('log', '❌ MongoDB connection failed: ' + err.message);
});

server.listen(PORT, () => {
  console.log(`🌐 Dashboard running on port ${PORT}`);
});
