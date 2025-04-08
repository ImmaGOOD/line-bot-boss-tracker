const express = require('express');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const line = require('@line/bot-sdk');
const schedule = require('node-schedule');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Line Bot configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const lineClient = new line.Client(lineConfig);

// Google Sheets configuration
const getGoogleSheetsClient = () => {
  try {
    // Get credentials from environment variable
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');

    // Create JWT client
    const client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Create and return Google Sheets client
    return google.sheets({ version: 'v4', auth: client });
  } catch (error) {
    console.error('Error initializing Google Sheets client:', error);
    throw new Error('Failed to initialize Google Sheets client');
  }
};

// Map to store scheduled jobs
const scheduledJobs = new Map();

// Function to get boss data from Google Sheets
const getBossData = async () => {
  try {
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const range = 'BossData!A2:D'; // Assuming headers are in row 1

    // Get data from Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const rows = response.data.values || [];

    // Transform data into a more usable format
    return rows.map(row => ({
      name: row[0] || 'Unknown Boss',
      location: row[1] || 'Unknown Location',
      nextSpawn: row[2] || new Date().toISOString(),
      status: row[3] || 'upcoming'
    }));
  } catch (error) {
    console.error('Error fetching boss data:', error);
    return []; // Return empty array on error
  }
};

// Function to update boss data in Google Sheets
const updateBossData = async (bossName, nextSpawnTime) => {
  try {
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Find the row with the boss name
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'BossData!A:A'
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === bossName);

    if (rowIndex === -1) {
      throw new Error(`Boss "${bossName}" not found in the spreadsheet`);
    }

    // Update the next spawn time
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `BossData!C${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[nextSpawnTime]]
      }
    });

    // Update the status to upcoming
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `BossData!D${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['upcoming']]
      }
    });

    return true;
  } catch (error) {
    console.error('Error updating boss data:', error);
    return false;
  }
};

// Function to send a notification about a boss spawn
const sendBossNotification = async (bossName, location, spawnTime) => {
  try {
    const targetGroupId = process.env.LINE_GROUP_ID;

    if (!targetGroupId) {
      throw new Error('LINE_GROUP_ID is not set in environment variables');
    }

    // Format the message
    const message = {
      type: 'flex',
      altText: `${bossName} is about to spawn!`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'Boss Spawn Alert',
              weight: 'bold',
              color: '#ffffff',
              size: 'xl'
            }
          ],
          backgroundColor: '#7D3C98'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: bossName,
              weight: 'bold',
              size: 'xxl',
              margin: 'md'
            },
            {
              type: 'text',
              text: 'Location:',
              size: 'xs',
              color: '#aaaaaa',
              wrap: true,
              margin: 'md'
            },
            {
              type: 'text',
              text: location,
              size: 'md',
              wrap: true
            },
            {
              type: 'text',
              text: 'Spawn Time:',
              size: 'xs',
              color: '#aaaaaa',
              wrap: true,
              margin: 'md'
            },
            {
              type: 'text',
              text: new Date(spawnTime).toLocaleString(),
              size: 'md',
              wrap: true
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              height: 'sm',
              action: {
                type: 'message',
                label: "I'm Ready",
                text: `Ready for ${bossName}`
              }
            }
          ],
          flex: 0
        }
      }
    };

    // Send the message
    await lineClient.pushMessage(targetGroupId, message);
    console.log(`Notification sent for ${bossName}`);
    return true;
  } catch (error) {
    console.error('Error sending Line notification:', error);
    return false;
  }
};

// Function to schedule notifications for all bosses
const scheduleAllNotifications = async () => {
  try {
    // Cancel all existing jobs
    cancelAllJobs();

    // Get boss data from Google Sheets
    const bossData = await getBossData();

    // Get notification time (minutes before spawn)
    const notifyBeforeMinutes = parseInt(process.env.NOTIFY_BEFORE_MINUTES || '30');

    // Schedule notifications for each boss
    bossData.forEach(boss => {
      const spawnTime = new Date(boss.nextSpawn);

      // Calculate notification time
      const notificationTime = new Date(spawnTime.getTime() - notifyBeforeMinutes * 60 * 1000);

      // Skip if notification time is in the past
      if (notificationTime <= new Date()) {
        console.log(`Skipping notification for ${boss.name} as notification time is in the past`);
        return;
      }

      // Schedule the notification
      const job = schedule.scheduleJob(notificationTime, async () => {
        await sendBossNotification(boss.name, boss.location, boss.nextSpawn);
        console.log(`Notification sent for ${boss.name}`);
      });

      // Store the job
      scheduledJobs.set(boss.name, job);
      console.log(`Scheduled notification for ${boss.name} at ${notificationTime.toLocaleString()}`);
    });

    return true;
  } catch (error) {
    console.error('Error scheduling notifications:', error);
    return false;
  }
};

// Function to cancel all scheduled jobs
const cancelAllJobs = () => {
  scheduledJobs.forEach((job, bossName) => {
    job.cancel();
    console.log(`Cancelled scheduled notification for ${bossName}`);
  });

  scheduledJobs.clear();
};

// Function to send a test notification with a specific time (1 hour 58 minutes from now)
const sendTestNotificationWithTime = async () => {
  try {
    const targetGroupId = process.env.LINE_GROUP_ID;

    if (!targetGroupId) {
      throw new Error('LINE_GROUP_ID is not set in environment variables');
    }

    // Calculate spawn time (1 hour 58 minutes from now)
    const now = new Date();
    const spawnTime = new Date(now.getTime() + (1 * 60 + 58) * 60 * 1000);
    
    // Format the spawn time
    const formattedSpawnTime = spawnTime.toLocaleString();

    // Create a test boss
    const testBoss = {
      name: 'Test Boss',
      location: 'Test Location',
      nextSpawn: spawnTime.toISOString()
    };

    // Send notification
    await sendBossNotification(testBoss.name, testBoss.location, testBoss.nextSpawn);
    
    // Update the Google Sheet with this test boss
    await updateBossData('Test Boss', spawnTime.toISOString());
    
    return {
      success: true,
      message: `Test notification sent for a boss spawning at ${formattedSpawnTime}`
    };
  } catch (error) {
    console.error('Error sending test notification:', error);
    return {
      success: false,
      message: `Error: ${error.message}`
    };
  }
};

// Express routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Home route
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Boss Spawn Tracker</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #1a1a1a;
            color: #ffffff;
          }
          h1 {
            color: #7D3C98;
          }
          .card {
            background-color: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          }
          button {
            background-color: #7D3C98;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
          }
          button:hover {
            background-color: #6A2C86;
          }
          .status {
            margin-top: 20px;
            padding: 10px;
            border-radius: 4px;
          }
          .success {
            background-color: #4CAF50;
          }
          .error {
            background-color: #f44336;
          }
        </style>
      </head>
      <body>
        <h1>Boss Spawn Tracker</h1>
        <div class="card">
          <h2>Send Test Notification</h2>
          <p>This will send a test notification for a boss that will spawn in 1 hour and 58 minutes from now.</p>
          <form action="/send-test-notification" method="post">
            <button type="submit">Send Test Notification</button>
          </form>
        </div>
        
        <div class="card">
          <h2>Refresh Notifications</h2>
          <p>This will refresh all scheduled notifications based on the current data in Google Sheets.</p>
          <form action="/refresh-notifications" method="post">
            <button type="submit">Refresh Notifications</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

// Send test notification route
app.post('/send-test-notification', async (req, res) => {
  const result = await sendTestNotificationWithTime();
  
  if (result.success) {
    res.send(`
      <html>
        <head>
          <title>Test Notification Sent</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background-color: #1a1a1a;
              color: #ffffff;
            }
            h1 {
              color: #7D3C98;
            }
            .card {
              background-color: #2a2a2a;
              border-radius: 8px;
              padding: 20px;
              margin-bottom: 20px;
              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            }
            .status {
              margin-top: 20px;
              padding: 10px;
              border-radius: 4px;
            }
            .success {
              background-color: #4CAF50;
            }
            a {
              color: #7D3C98;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <h1>Test Notification Sent</h1>
          <div class="card">
            <div class="status success">
              <p>${result.message}</p>
            </div>
            <p><a href="/">← Back to Home</a></p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.status(500).send(`
      <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background-color: #1a1a1a;
              color: #ffffff;
            }
            h1 {
              color: #7D3C98;
            }
            .card {
              background-color: #2a2a2a;
              border-radius: 8px;
              padding: 20px;
              margin-bottom: 20px;
              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            }
            .status {
              margin-top: 20px;
              padding: 10px;
              border-radius: 4px;
            }
            .error {
              background-color: #f44336;
            }
            a {
              color: #7D3C98;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <h1>Error</h1>
          <div class="card">
            <div class="status error">
              <p>${result.message}</p>
            </div>
            <p><a href="/">← Back to Home</a></p>
          </div>
        </body>
      </html>
    `);
  }
});

// Refresh notifications route
app.post('/refresh-notifications', async (req, res) => {
  const success = await scheduleAllNotifications();
  
  if (success) {
    res.send(`
      <html>
        <head>
          <title>Notifications Refreshed</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background-color: #1a1a1a;
              color: #ffffff;
            }
            h1 {
              color: #7D3C98;
            }
            .card {
              background-color: #2a2a2a;
              border-radius: 8px;
              padding: 20px;
              margin-bottom: 20px;
              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            }
            .status {
              margin-top: 20px;
              padding: 10px;
              border-radius: 4px;
            }
            .success {
              background-color: #4CAF50;
            }
            a {
              color: #7D3C98;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <h1>Notifications Refreshed</h1>
          <div class="card">
            <div class="status success">
              <p>All notifications have been rescheduled successfully.</p>
            </div>
            <p><a href="/">← Back to Home</a></p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.status(500).send(`
      <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background-color: #1a1a1a;
              color: #ffffff;
            }
            h1 {
              color: #7D3C98;
            }
            .card {
              background-color: #2a2a2a;
              border-radius: 8px;
              padding: 20px;
              margin-bottom: 20px;
              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            }
            .status {
              margin-top: 20px;
              padding: 10px;
              border-radius: 4px;
            }
            .error {
              background-color: #f44336;
            }
            a {
              color: #7D3C98;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <h1>Error</h1>
          <div class="card">
            <div class="status error">
              <p>Failed to refresh notifications. Please check the logs for more information.</p>
            </div>
            <p><a href="/">← Back to Home</a></p>
          </div>
        </body>
      </html>
    `);
  }
});

// Line webhook endpoint
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    
    // Process each event
    await Promise.all(
      events.map(async (event) => {
        if (event.type !== 'message' || event.message.type !== 'text') {
          return;
        }

        const { text } = event.message;

        // Check if the message is a command to update boss spawn time
        // Format: !update BossName YYYY-MM-DD HH:MM:SS
        if (text.startsWith('!update')) {
          const parts = text.split(' ');
          if (parts.length >= 3) {
            const bossName = parts[1];
            const dateTimeStr = parts.slice(2).join(' ');

            try {
              // Update boss data in Google Sheets
              const success = await updateBossData(bossName, new Date(dateTimeStr).toISOString());

              if (success) {
                // Reschedule notifications
                await scheduleAllNotifications();

                // Send confirmation message
                await lineClient.replyMessage(event.replyToken, {
                  type: 'text',
                  text: `Updated spawn time for ${bossName} to ${dateTimeStr}`
                });
              } else {
                await lineClient.replyMessage(event.replyToken, {
                  type: 'text',
                  text: `Failed to update spawn time for ${bossName}`
                });
              }
            } catch (error) {
              console.error('Error handling update command:', error);
              await lineClient.replyMessage(event.replyToken, {
                type: 'text',
                text: 'Error updating boss spawn time. Please check the format: !update BossName YYYY-MM-DD HH:MM:SS'
              });
            }
          }
        }
      })
    );

    res.status(200).end();
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).end();
  }
});

// Cron endpoint to refresh scheduled notifications
app.get('/cron', async (req, res) => {
  try {
    // Reschedule all notifications
    const success = await scheduleAllNotifications();

    if (success) {
      res.json({ status: 'ok', message: 'Notifications rescheduled successfully' });
    } else {
      res.status(500).json({ status: 'error', message: 'Failed to reschedule notifications' });
    }
  } catch (error) {
    console.error('Error in cron job:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Schedule notifications on startup
  scheduleAllNotifications().then(() => {
    console.log('Initial notifications scheduled');
  }).catch(error => {
    console.error('Error scheduling initial notifications:', error);
  });
});
