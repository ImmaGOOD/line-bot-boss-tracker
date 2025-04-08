// Main application entry point
const express = require("express")
const { google } = require("googleapis")
const { JWT } = require("google-auth-library")
const line = require("@line/bot-sdk")
const schedule = require("node-schedule")
const dotenv = require("dotenv")

// Load environment variables
dotenv.config()

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Line Bot configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
}

const lineClient = new line.Client(lineConfig)

// Google Sheets configuration
const getGoogleSheetsClient = () => {
  try {
    // Get credentials from environment variable
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || "{}")

    // Create JWT client
    const client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    })

    // Create and return Google Sheets client
    return google.sheets({ version: "v4", auth: client })
  } catch (error) {
    console.error("Error initializing Google Sheets client:", error)
    throw new Error("Failed to initialize Google Sheets client")
  }
}

// Map to store scheduled jobs
const scheduledJobs = new Map()

// Function to get boss data from Google Sheets
async function getBossData() {
  try {
    const sheets = getGoogleSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEET_ID
    const range = "BossData!A2:D" // Assuming headers are in row 1

    // Get data from Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    })

    const rows = response.data.values || []

    // Transform data into a more usable format
    return rows.map((row) => ({
      name: row[0] || "Unknown Boss",
      location: row[1] || "Unknown Location",
      nextSpawn: row[2] || new Date().toISOString(),
      status: row[3] || "upcoming",
    }))
  } catch (error) {
    console.error("Error fetching boss data:", error)
    return [] // Return empty array on error
  }
}

// Function to update boss data in Google Sheets
async function updateBossData(bossName, nextSpawnTime) {
  try {
    const sheets = getGoogleSheetsClient()
    const spreadsheetId = process.env.GOOGLE_SHEET_ID

    // Find the row with the boss name
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "BossData!A:A",
    })

    const rows = response.data.values || []
    const rowIndex = rows.findIndex((row) => row[0] === bossName)

    if (rowIndex === -1) {
      throw new Error(`Boss "${bossName}" not found in the spreadsheet`)
    }

    // Update the next spawn time
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `BossData!C${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[nextSpawnTime]],
      },
    })

    // Update the status
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `BossData!D${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["upcoming"]],
      },
    })

    return true
  } catch (error) {
    console.error("Error updating boss data:", error)
    return false
  }
}

// Function to send a notification about a boss spawn
async function sendBossNotification(bossName, location, spawnTime) {
  try {
    // Format the message
    const message = {
      type: "flex",
      altText: `${bossName} is about to spawn!`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: "Boss Spawn Alert",
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
              text: bossName,
              weight: "bold",
              size: "xxl",
              margin: "md",
            },
            {
              type: "text",
              text: "Location:",
              size: "xs",
              color: "#aaaaaa",
              wrap: true,
              margin: "md",
            },
            {
              type: "text",
              text: location,
              size: "md",
              wrap: true,
            },
            {
              type: "text",
              text: "Spawn Time:",
              size: "xs",
              color: "#aaaaaa",
              wrap: true,
              margin: "md",
            },
            {
              type: "text",
              text: new Date(spawnTime).toLocaleString(),
              size: "md",
              wrap: true,
            },
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
              action: {
                type: "message",
                label: "I'm Ready",
                text: `Ready for ${bossName}`,
              },
            },
          ],
          flex: 0,
        },
      },
    }

    // Send the message to the user instead of a group
    await lineClient.pushMessage(process.env.LINE_USER_ID, message)
    console.log(`Notification sent for ${bossName}`)
    return true
  } catch (error) {
    console.error("Error sending Line notification:", error)
    return false
  }
}

// Function to schedule notifications for all bosses
async function scheduleAllNotifications() {
  try {
    // Cancel all existing jobs
    cancelAllJobs()

    // Get boss data from Google Sheets
    const bossData = await getBossData()

    // Get notification time (minutes before spawn)
    const notifyBeforeMinutes = Number.parseInt(process.env.NOTIFY_BEFORE_MINUTES || "30")

    // Schedule notifications for each boss
    bossData.forEach((boss) => {
      const spawnTime = new Date(boss.nextSpawn)

      // Calculate notification time
      const notificationTime = new Date(spawnTime.getTime() - notifyBeforeMinutes * 60 * 1000)

      // Skip if notification time is in the past
      if (notificationTime <= new Date()) {
        console.log(`Skipping notification for ${boss.name} as notification time is in the past`)
        return
      }

      // Schedule the notification
      const job = schedule.scheduleJob(notificationTime, async () => {
        await sendBossNotification(boss.name, boss.location, boss.nextSpawn)
        console.log(`Notification sent for ${boss.name}`)
      })

      // Store the job
      scheduledJobs.set(boss.name, job)
      console.log(`Scheduled notification for ${boss.name} at ${notificationTime.toLocaleString()}`)
    })

    return true
  } catch (error) {
    console.error("Error scheduling notifications:", error)
    return false
  }
}

// Function to cancel all scheduled jobs
function cancelAllJobs() {
  scheduledJobs.forEach((job, bossName) => {
    job.cancel()
    console.log(`Cancelled scheduled notification for ${bossName}`)
  })

  scheduledJobs.clear()
}

// Function to send a test notification with a specific time (1 hour and 58 minutes in the future)
async function sendTestNotification() {
  try {
    // Calculate spawn time (1 hour and 58 minutes from now)
    const now = new Date()
    const spawnTime = new Date(now.getTime() + (1 * 60 + 58) * 60 * 1000)

    // Format the spawn time as ISO string
    const spawnTimeISO = spawnTime.toISOString()

    // Update a test boss in the spreadsheet
    const testBossName = "TestBoss"
    await updateBossData(testBossName, spawnTimeISO)

    // Send immediate notification
    await sendBossNotification(testBossName, "Test Location", spawnTimeISO)

    return true
  } catch (error) {
    console.error("Error sending test notification:", error)
    return false
  }
}

// Line webhook endpoint
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events

    // Process each event
    await Promise.all(
      events.map(async (event) => {
        if (event.type !== "message" || event.message.type !== "text") {
          return
        }

        const { text } = event.message
        const userId = event.source.userId

        // Send user ID when user sends "myid"
        if (text.toLowerCase() === "myid") {
          await lineClient.replyMessage(event.replyToken, {
            type: "text",
            text: `Your User ID is: ${userId}`,
          })
          return
        }

        // Check if the message is a command to update boss spawn time
        // Format: !update BossName YYYY-MM-DD HH:MM:SS
        if (text.startsWith("!update")) {
          const parts = text.split(" ")
          if (parts.length >= 3) {
            const bossName = parts[1]
            const dateTimeStr = parts.slice(2).join(" ")

            try {
              // Update boss data in Google Sheets
              const success = await updateBossData(bossName, new Date(dateTimeStr).toISOString())

              if (success) {
                // Reschedule notifications
                await scheduleAllNotifications()

                // Send confirmation message
                await lineClient.replyMessage(event.replyToken, {
                  type: "text",
                  text: `Updated spawn time for ${bossName} to ${dateTimeStr}`,
                })
              } else {
                await lineClient.replyMessage(event.replyToken, {
                  type: "text",
                  text: `Failed to update spawn time for ${bossName}`,
                })
              }
            } catch (error) {
              console.error("Error handling update command:", error)
              await lineClient.replyMessage(event.replyToken, {
                type: "text",
                text: "Error updating boss spawn time. Please check the format: !update BossName YYYY-MM-DD HH:MM:SS",
              })
            }
          }
        }
      }),
    )

    res.status(200).end()
  } catch (error) {
    console.error("Error processing webhook:", error)
    res.status(500).end()
  }
})

// API endpoint to send a test notification
app.post("/api/test-notification", async (req, res) => {
  try {
    const success = await sendTestNotification()

    if (success) {
      res.status(200).json({ status: "ok", message: "Test notification sent successfully" })
    } else {
      res.status(500).json({ status: "error", message: "Failed to send test notification" })
    }
  } catch (error) {
    console.error("Error sending test notification:", error)
    res.status(500).json({ status: "error", message: "Internal server error" })
  }
})

// API endpoint to refresh scheduled notifications
app.get("/api/refresh-notifications", async (req, res) => {
  try {
    const success = await scheduleAllNotifications()

    if (success) {
      res.status(200).json({ status: "ok", message: "Notifications rescheduled successfully" })
    } else {
      res.status(500).json({ status: "error", message: "Failed to reschedule notifications" })
    }
  } catch (error) {
    console.error("Error in refresh notifications:", error)
    res.status(500).json({ status: "error", message: "Internal server error" })
  }
})

// Simple status endpoint
app.get("/", (req, res) => {
  res.send("Boss Tracker API is running")
})

// Create a simple HTML page for testing
app.get("/test", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Boss Tracker</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
            }
            button {
                background-color: #7D3C98;
                color: white;
                border: none;
                padding: 10px 20px;
                margin: 10px 0;
                cursor: pointer;
                border-radius: 4px;
            }
            button:hover {
                background-color: #6A2C86;
            }
        </style>
    </head>
    <body>
        <h1>Boss Tracker Control Panel</h1>
        <p>Use the buttons below to test and manage your boss notifications.</p>
        
        <button id="testBtn">Send Test Notification (1 hour 58 minutes)</button>
        <button id="refreshBtn">Refresh All Notifications</button>
        
        <div id="result" style="margin-top: 20px;"></div>
        
        <script>
            document.getElementById('testBtn').addEventListener('click', async () => {
                const result = document.getElementById('result');
                result.textContent = 'Sending test notification...';
                
                try {
                    const response = await fetch('/api/test-notification', {
                        method: 'POST'
                    });
                    const data = await response.json();
                    result.textContent = \`Result: \${data.message}\`;
                } catch (error) {
                    result.textContent = \`Error: \${error.message}\`;
                }
            });
            
            document.getElementById('refreshBtn').addEventListener('click', async () => {
                const result = document.getElementById('result');
                result.textContent = 'Refreshing notifications...';
                
                try {
                    const response = await fetch('/api/refresh-notifications');
                    const data = await response.json();
                    result.textContent = \`Result: \${data.message}\`;
                } catch (error) {
                    result.textContent = \`Error: \${error.message}\`;
                }
            });
        </script>
    </body>
    </html>
  `)
})

// Start the server
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)

  // Schedule notifications on startup
  scheduleAllNotifications()
    .then(() => {
      console.log("Initial notifications scheduled")
    })
    .catch((error) => {
      console.error("Error scheduling initial notifications:", error)
    })
})
