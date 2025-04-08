# Line Bot Boss Tracker

A Node.js application that connects Google Sheets API with a Line Bot to send notifications about boss respawns in games.

## Features

- Fetches boss data from Google Sheets
- Sends notifications via Line Bot before boss spawns
- Allows updating boss spawn times via Line commands
- Simple web interface for testing and refreshing notifications
- Automatically schedules notifications based on spawn times

## Setup

### Prerequisites

- Node.js 16 or higher
- A Google Cloud Platform account with Sheets API enabled
- A Line Developer account with a configured bot
- A Google Sheet with boss data

### Google Sheets Setup

1. Create a Google Sheet with a sheet named "BossData" with these columns:
   - Column A: Boss Name
   - Column B: Location
   - Column C: Next Spawn Time (in ISO format)
   - Column D: Status (spawned, upcoming, or delayed)

2. Create a Google Service Account and give it read/write access to your sheet.

### Line Bot Setup

1. Create a Line Bot through the Line Developer Console
2. Set up a webhook URL pointing to your deployment at `/webhook`
3. Enable webhook for your bot and get the channel access token and secret

### Installation

1. Clone this repository:
