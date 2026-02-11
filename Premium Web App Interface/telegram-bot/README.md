# Claude Trench Scanner Telegram Bot

Telegram bot that provides AI-powered Solana token analysis with progressive step-by-step results.

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Get Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow instructions to create your bot
4. Copy the bot token

### 3. Configure Bot

Edit `bot.py` and set your configuration at the top of the file:
```python
BOT_TOKEN = "your_telegram_bot_token_here"  # Get from @BotFather
API_URL = "http://localhost:3000/api"  # Change to production URL if needed
```

### 4. Run the Bot

**Local Development:**
```bash
# Make sure your API is running locally first
# Terminal 1: Start API (if using Vercel CLI)
vercel dev

# Terminal 2: Start bot
python telegram-bot/bot.py
```

## Usage

1. Start a chat with your bot on Telegram
2. Send `/start` to see welcome message
3. Send a Solana token contract address
4. Watch the analysis progress step-by-step with 5-second delays

## Features

- ✅ Progressive message updates (edits same message)
- ✅ Step-by-step analysis with delays matching web app
- ✅ Monospace formatting for clean display
- ✅ Real-time data from Helius, Birdeye, and Claude AI
- ✅ Market cap predictions
- ✅ Risk assessment and recommendations

## File Structure

```
telegram-bot/
├── bot.py          # Main bot logic
├── formatters.py  # Message formatting functions
├── config.py      # Configuration and constants
├── requirements.txt # Python dependencies
└── README.md      # This file
```

## Testing

Test with a real Solana token address:
```
6V8q5kQkzokNwSxJv8W81zcKRUWsUW4c5Bf8suqipump
```

The bot will:
1. Validate the address
2. Call your API endpoint
3. Show token overview immediately
4. Progressively add each analysis step (5s delays)
5. Show predictions
6. Show final verdict
