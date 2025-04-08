const express = require("express");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const line = require("@line/bot-sdk");
const schedule = require("node-schedule");
const dotenv = require("dotenv");

// โหลด environment variables
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// กำหนดค่าของ LINE bot
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new line.Client(lineConfig);

// กำหนดการเชื่อมต่อ Google Sheets
const getGoogleSheetsClient = () => {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || "{}");
    const client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    return google.sheets({ version: "v4", auth: client });
  } catch (error) {
    console.error("Error initializing Google Sheets client:", error);
    throw new Error("Failed to initialize Google Sheets client");
  }
};

// ฟังก์ชั่นการส่ง Flex Message
async function sendFlexMessage(userId) {
  const message = {
    type: "flex",
    altText: "จดเวลาบอสแล้ว! คุณจะได้รับการแจ้งเตือนภายใน 1 ชั่วโมง 58 นาที",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "จดเวลาบอส",
            weight: "bold",
            color: "#ffffff",
            size: "xl",
          },
        ],
        backgroundColor: "#7D3C98",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "คุณจะได้รับการแจ้งเตือนหลังจากนี้ภายใน 1 ชั่วโมง 58 นาที",
            size: "md",
            wrap: true,
          },
        ],
      },
    },
  };

  await lineClient.pushMessage(userId, message);
}

// ฟังก์ชั่นการตั้งเวลาแจ้งเตือน
async function scheduleNotification(userId) {
  const now = new Date();
  const notifyTime = new Date(now.getTime() + (1 * 60 + 58) * 60 * 1000); // 1 ชั่วโมง 58 นาที

  schedule.scheduleJob(notifyTime, async () => {
    await sendFlexMessage(userId);
    console.log(`แจ้งเตือนให้ผู้ใช้ที่ ID ${userId} เวลา ${notifyTime.toLocaleString()}`);
  });

  console.log(`ตั้งเวลาแจ้งเตือนให้ผู้ใช้ที่ ID ${userId} เวลา ${notifyTime.toLocaleString()}`);
}

// webhook endpoint ของ LINE
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;

    await Promise.all(
      events.map(async (event) => {
        if (event.type !== "message" || event.message.type !== "text") {
          return;
        }

        const { text } = event.message;
        const userId = event.source.userId;

        // หากพิมพ์คำว่า "จดเวลาบอส"
        if (text.toLowerCase() === "จดเวลาบอส") {
          await sendFlexMessage(userId);
          await scheduleNotification(userId);
          await lineClient.replyMessage(event.replyToken, {
            type: "text",
            text: "จดเวลาบอสแล้ว! คุณจะได้รับการแจ้งเตือนในอีก 1 ชั่วโมง 58 นาที",
          });
        }
      })
    );

    res.status(200).end();
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).end();
  }
});

// เริ่มเซิร์ฟเวอร์
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
