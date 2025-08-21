const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("📲 Scan this QR to log in:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log("✅ Bot is ready!");

  // change this to your group name
  const targetGroupName = "UNVEIL - News App";

  const chats = await client.getChats();
  const groups = chats.filter((chat) => chat.isGroup);

  console.log(`👥 Found ${groups.length} groups:`);

  groups.forEach((g) => {
    console.log(`- ${g.name} → ${g.id._serialized}`);
  });

  // Find specific group
  const targetGroup = groups.find((g) => g.name === targetGroupName);
  if (targetGroup) {
    console.log(`✅ Group "${targetGroupName}" ID is: ${targetGroup.id._serialized}`);
  } else {
    console.log(`❌ Group "${targetGroupName}" not found`);
  }

  process.exit(0); // exit after printing
});

client.initialize();
