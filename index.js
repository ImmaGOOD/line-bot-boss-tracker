
const line = require('@line/bot-sdk');
const express = require('express');
const schedule = require('node-schedule');

// LINE bot configuration
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new line.Client(config);
const app = express();
app.use(express.json());

// Function to send a Flex Message with "I'm Ready" button
async function sendBossNotification() {
  try {
    const now = new Date();
    const notifyTime = new Date(now.getTime() + (1 * 60 + 58) * 60 * 1000); // 1 hour 58 minutes later
    const notificationTimeStr = notifyTime.toLocaleString();

    const message = {
      type: "flex",
      altText: "Boss Spawn Alert",
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [{ type: "text", text: "Boss Spawn Alert", weight: "bold", color: "#ffffff", size: "xl" }],
          backgroundColor: "#7D3C98",
        },
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "A boss will spawn soon!", weight: "bold", size: "xxl", margin: "md" },
            { type: "text", text: `Notification Time: ${notificationTimeStr}`, size: "md", wrap: true },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              height: "sm",
              action: { type: "message", label: "I'm Ready", text: "I'm Ready" },
            },
          ],
        },
      },
    };

    await lineClient.pushMessage(process.env.LINE_USER_ID, message);
    console.log("Flex message sent with button");

    // Schedule the notification after 1 hour 58 minutes
    schedule.scheduleJob(notifyTime, async () => {
      const alertMessage = { type: "text", text: "Reminder: The boss will spawn soon! Get ready!" };
      await lineClient.pushMessage(process.env.LINE_USER_ID, alertMessage);
      console.log(`Reminder sent at ${notifyTime.toLocaleString()}`);
    });

    return true;
  } catch (error) {
    console.error("Error sending notification:", error);
    return false;
  }
}

// Webhook to handle user message interaction
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;

    await Promise.all(events.map(async (event) => {
      if (event.type !== "message" || event.message.type !== "text") return;
      const { text } = event.message;
      const userId = event.source.userId;

      if (text === "I'm Ready") {
        await sendBossNotification();
        await lineClient.replyMessage(event.replyToken, { type: "text", text: "You will be notified in 1 hour and 58 minutes!" });
      }
    }));

    res.status(200).end();
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).end();
  }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
