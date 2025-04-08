// index.js

const express = require("express")
const { google } = require("googleapis")
const { JWT } = require("google-auth-library")
const line = require("@line/bot-sdk")
const schedule = require("node-schedule")
const dotenv = require("dotenv")

dotenv.config()

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
}
const lineClient = new line.Client(lineConfig)

const getGoogleSheetsClient = () => {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || "{}")
  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  return google.sheets({ version: "v4", auth: client })
}

const scheduledJobs = new Map()

async function getBossData() {
  const sheets = getGoogleSheetsClient()
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  const range = "BossData!A2:D"
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range })
  const rows = response.data.values || []
  return rows.map((row) => ({
    name: row[0] || "Unknown Boss",
    location: row[1] || "Unknown Location",
    nextSpawn: row[2] || new Date().toISOString(),
    status: row[3] || "upcoming",
  }))
}

async function updateBossData(bossName, nextSpawnTime) {
  const sheets = getGoogleSheetsClient()
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "BossData!A:A",
  })
  const rows = response.data.values || []
  const rowIndex = rows.findIndex((row) => row[0] === bossName)
  if (rowIndex === -1) throw new Error(`Boss "${bossName}" not found`)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `BossData!C${rowIndex + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[nextSpawnTime]] },
  })
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `BossData!D${rowIndex + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["upcoming"]] },
  })
  return true
}

async function sendBossNotification(bossName, location, spawnTime) {
  const message = {
    type: "flex",
    altText: `${bossName} is about to spawn!`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: "Boss Spawn Alert", weight: "bold", size: "xl", color: "#ffffff" }],
        backgroundColor: "#7D3C98",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: bossName, weight: "bold", size: "xxl" },
          { type: "text", text: "Location:", size: "xs", color: "#aaaaaa", margin: "md" },
          { type: "text", text: location, size: "md" },
          { type: "text", text: "Spawn Time:", size: "xs", color: "#aaaaaa", margin: "md" },
          { type: "text", text: new Date(spawnTime).toLocaleString(), size: "md" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            action: { type: "message", label: "I'm Ready", text: `Ready for ${bossName}` },
          },
        ],
        flex: 0,
      },
    },
  }

  return await lineClient.pushMessage(process.env.LINE_USER_ID, message)
}

function cancelAllJobs() {
  scheduledJobs.forEach((job, name) => job.cancel())
  scheduledJobs.clear()
}

async function scheduleAllNotifications() {
  cancelAllJobs()
  const bossData = await getBossData()
  const notifyBefore = parseInt(process.env.NOTIFY_BEFORE_MINUTES || "30")

  bossData.forEach((boss) => {
    const spawnTime = new Date(boss.nextSpawn)
    const notifyTime = new Date(spawnTime.getTime() - notifyBefore * 60000)
    if (notifyTime <= new Date()) return
    const job = schedule.scheduleJob(notifyTime, () =>
      sendBossNotification(boss.name, boss.location, boss.nextSpawn)
    )
    scheduledJobs.set(boss.name, job)
  })
}

app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events
    await Promise.all(
      events.map(async (event) => {
        if (event.type !== "message" || event.message.type !== "text") return
        const text = event.message.text.toLowerCase()

        if (text === "myid") {
          await lineClient.replyMessage(event.replyToken, {
            type: "text",
            text: `Your User ID is: ${event.source.userId}`,
          })
        } else if (text.startsWith("!update")) {
          const parts = text.split(" ")
          if (parts.length >= 3) {
            const bossName = parts[1]
            const dateTimeStr = parts.slice(2).join(" ")
            const isoTime = new Date(dateTimeStr).toISOString()
            await updateBossData(bossName, isoTime)
            await scheduleAllNotifications()
            await lineClient.replyMessage(event.replyToken, {
              type: "text",
              text: `Updated spawn time for ${bossName} to ${dateTimeStr}`,
            })
          }
        }
      })
    )
    res.status(200).end()
  } catch (error) {
    console.error("Webhook error:", error)
    res.status(500).end()
  }
})

app.get("/", (req, res) => res.send("Boss Tracker API is running"))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  scheduleAllNotifications()
})
