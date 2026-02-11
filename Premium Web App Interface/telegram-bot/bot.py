import asyncio
import re
import requests
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from telegram.error import TelegramError

# ============================================================================
# CONFIGURATION - Edit these values as needed
# ============================================================================

# Telegram Bot Token - Get from @BotFather on Telegram
BOT_TOKEN = "8594106657:AAH4uWzpxs8ORiynEtcIrZ2W-6o4elPfTlw"

# API URL - Change to your production URL if needed
API_URL = "https://claudets.com/api"

# Timing configuration
STEP_DELAY = 3  # seconds between analysis steps
PREDICTION_DELAY = 2  # seconds before showing predictions

# Analysis steps (matching web app)
ANALYSIS_STEPS = [
    {'key': 'bundles', 'label': 'Bundle Detection', 'icon': '🎯'},
    {'key': 'devHistory', 'label': 'Developer History', 'icon': '👤'},
    {'key': 'topHolders', 'label': 'Top Holders Analysis', 'icon': '👥'},
    {'key': 'chart', 'label': 'Chart Pattern Analysis', 'icon': '📈'},
    {'key': 'freshWallets', 'label': 'Fresh Wallet Activity', 'icon': '✨'},
    {'key': 'devSold', 'label': 'Developer Activity', 'icon': '⚡'},
    {'key': 'lore', 'label': 'Lore & Narrative', 'icon': '📖'},
    {'key': 'socials', 'label': 'Social Media Presence', 'icon': '🌐'}
]

# ============================================================================
# FORMATTING FUNCTIONS
# ============================================================================

def format_market_cap(value):
    """Format market cap value"""
    if not value or value == 0:
        return "$0"
    
    if value >= 1000000:
        return f"${(value / 1000000):.2f}M"
    if value >= 1000:
        return f"${(value / 1000):.1f}K"
    return f"${value:.0f}"

def format_token_overview(metadata, metrics):
    """Format token overview section"""
    name = metadata.get('name', 'Unknown')
    symbol = metadata.get('symbol', 'N/A')
    market_cap = format_market_cap(metrics.get('marketCap', 0))
    volume = format_market_cap(metrics.get('volume24h', 0))
    liquidity = format_market_cap(metrics.get('liquidityUSD', 0))
    
    # Truncate long names/symbols
    name = name[:25] if len(name) > 25 else name
    symbol = symbol[:23] if len(symbol) > 23 else symbol
    
    return f"""📊 Token Overview
┌─────────────────────────────┐
│ Name: {name:<25} │
│ Symbol: {symbol:<23} │
│ Market Cap: {market_cap:<18} │
│ Volume 24h: {volume:<19} │
│ Liquidity: {liquidity:<20} │
└─────────────────────────────┘"""

def format_analysis_step(step_key, step_data, step_index, total_steps):
    """Format individual analysis step"""
    step_info = next((s for s in ANALYSIS_STEPS if s['key'] == step_key), None)
    if not step_info:
        return ""
    
    icon = step_info['icon']
    label = step_info['label']
    value = step_data.get('value', 'N/A')
    status = step_data.get('status', 'info')
    reason = step_data.get('reason', '')
    
    # Status emoji
    status_emoji = {
        'safe': '✅',
        'warning': '⚠️',
        'danger': '❌',
        'info': 'ℹ️',
        'neutral': 'ℹ️'
    }.get(status, 'ℹ️')
    
    # Format reason (truncate if too long, wrap if needed)
    if len(reason) > 70:
        reason = reason[:67] + "..."
    
    # Wrap long reasons
    wrapped_reason = ""
    words = reason.split()
    current_line = ""
    for word in words:
        if len(current_line + word) <= 27:
            current_line += word + " "
        else:
            if current_line:
                wrapped_reason += current_line.strip() + "\n   "
            current_line = word + " "
    if current_line:
        wrapped_reason += current_line.strip()
    
    return f"""
{icon} {label}
   {status_emoji} {value}
   {wrapped_reason}"""

def format_predictions(predictions, current_mcap):
    """Format market cap predictions"""
    if not predictions:
        return ""
    
    conservative = predictions.get('conservative', {})
    moderate = predictions.get('moderate', {})
    aggressive = predictions.get('aggressive', {})
    
    return f"""
📈 Market Cap Predictions
┌─────────────────────────────┐
│ 🟢 Conservative             │
│    Target: {format_market_cap(conservative.get('mcap', 0)):<18} │
│    Multiplier: {conservative.get('multiplier', 'N/A'):<15} │
│    Probability: {conservative.get('probability', 0)}%            │
│    Timeframe: {conservative.get('timeframe', 'N/A'):<16} │
├─────────────────────────────┤
│ 🟡 Moderate                 │
│    Target: {format_market_cap(moderate.get('mcap', 0)):<18} │
│    Multiplier: {moderate.get('multiplier', 'N/A'):<15} │
│    Probability: {moderate.get('probability', 0)}%            │
│    Timeframe: {moderate.get('timeframe', 'N/A'):<16} │
├─────────────────────────────┤
│ 🔴 Aggressive               │
│    Target: {format_market_cap(aggressive.get('mcap', 0)):<18} │
│    Multiplier: {aggressive.get('multiplier', 'N/A'):<15} │
│    Probability: {aggressive.get('probability', 0)}%            │
│    Timeframe: {aggressive.get('timeframe', 'N/A'):<16} │
└─────────────────────────────┘"""

def format_verdict(analysis):
    """Format final verdict"""
    probability = analysis.get('overallProbability', 0)
    risk_level = analysis.get('riskLevel', 'Medium')
    recommendation = analysis.get('recommendation', '')
    
    # Risk emoji
    risk_emoji = {
        'Low': '🟢',
        'Medium': '🟡',
        'High': '🔴'
    }.get(risk_level, '🟡')
    
    # Truncate recommendation if too long
    if len(recommendation) > 150:
        recommendation = recommendation[:147] + "..."
    
    return f"""
🎯 Overall Verdict
┌─────────────────────────────┐
│ Win Probability: {probability}%        │
│ Risk Level: {risk_emoji} {risk_level:<18} │
├─────────────────────────────┤
│ {recommendation:<27} │
└─────────────────────────────┘"""

def format_progress_bar(current, total):
    """Format progress bar"""
    percentage = int((current / total) * 100)
    filled = int((current / total) * 20)
    bar = "█" * filled + "░" * (20 - filled)
    return f"[{bar}] {percentage}%"

def format_analysis_message(token_address, metadata, metrics, analysis, current_step=0, total_steps=8, show_complete=False):
    """Format complete analysis message with current progress"""
    # Truncate address for display
    display_address = token_address[:20] + "..." if len(token_address) > 20 else token_address
    
    lines = [
        f"🔍 Analyzing Token",
        f"`{display_address}`",
        "",
        format_token_overview(metadata, metrics)
    ]
    
    # Add completed analysis steps
    if analysis:
        steps_completed = []
        for i, step_info in enumerate(ANALYSIS_STEPS):
            step_key = step_info['key']
            step_data = analysis.get(step_key)
            
            if step_data and i < current_step:
                steps_completed.append(format_analysis_step(step_key, step_data, i, total_steps))
        
        if steps_completed:
            lines.append("\n📋 Analysis Results:")
            lines.extend(steps_completed)
        
        # Show progress if still analyzing
        if current_step < total_steps and not show_complete:
            lines.append(f"\n⏳ Analyzing... ({current_step}/{total_steps})")
            lines.append(format_progress_bar(current_step, total_steps))
        
        # Show predictions if all steps complete or show_complete is True
        if (current_step >= total_steps or show_complete) and analysis.get('marketCapPredictions'):
            lines.append(format_predictions(analysis.get('marketCapPredictions'), analysis.get('currentMarketCap', 0)))
        
        # Show verdict if available and complete
        if show_complete and analysis.get('overallProbability') is not None:
            lines.append(format_verdict(analysis))
    
    return "\n".join(lines)

# ============================================================================
# BOT CLASS
# ============================================================================

class TokenAnalysisBot:
    def __init__(self):
        self.api_url = f"{API_URL}/analyze-token"
    
    def is_valid_solana_address(self, address: str) -> bool:
        """Validate Solana address format (base58, 32-44 chars)"""
        # Basic validation: base58 characters, 32-44 chars
        if not address or len(address) < 32 or len(address) > 44:
            return False
        
        # Check for base58 characters (no 0, O, I, l)
        base58_pattern = re.compile(r'^[1-9A-HJ-NP-Za-km-z]+$')
        return bool(base58_pattern.match(address))
    
    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle the /start command"""
        welcome_message = """🤖 <b>Claude Trench Scanner Bot</b>

🔍 <b>AI-Powered Solana Token Analysis</b>

I analyze Solana tokens and provide comprehensive risk assessments with market cap predictions.

<b>How to use:</b>
1. Send me a Solana token contract address
2. I'll analyze it step-by-step
3. Get detailed insights and predictions

<b>Example:</b>
<code>6V8q5kQkzokNwSxJv8W81zcKRUWsUW4c5Bf8suqipump</code>

<b>Features:</b>
• Real-time on-chain data analysis
• AI-driven market cap predictions
• Risk assessment (bundles, holders, dev activity)
• Progressive step-by-step results

Send a token address to get started! 🚀"""
        
        await update.message.reply_text(welcome_message, parse_mode='HTML')
    
    async def handle_token_address(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle token address message"""
        token_address = update.message.text.strip()
        
        # Validate address
        if not self.is_valid_solana_address(token_address):
            await update.message.reply_text(
                "❌ Invalid Solana address format!\n\n"
                "Please send a valid Solana token address (32-44 characters, base58).\n\n"
                "Example: <code>6V8q5kQkzokNwSxJv8W81zcKRUWsUW4c5Bf8suqipump</code>",
                parse_mode='HTML'
            )
            return
        
        # Send initial analyzing message
        initial_message = await update.message.reply_text(
            f"🔍 Analyzing Token...\n"
            f"`{token_address}`\n\n"
            f"⏳ Connecting to Solana...",
            parse_mode='Markdown'
        )
        
        try:
            # Call API endpoint
            response = requests.post(
                self.api_url,
                json={'tokenAddress': token_address},
                headers={'Content-Type': 'application/json'},
                timeout=60
            )
            
            if not response.ok:
                error_data = response.json() if response.content else {}
                error_msg = error_data.get('message', 'Analysis failed')
                await initial_message.edit_text(
                    f"❌ Analysis Failed\n\n"
                    f"Error: {error_msg}\n\n"
                    f"Please try again later.",
                    parse_mode='Markdown'
                )
                return
            
            result = response.json()
            metadata = result.get('metadata', {})
            metrics = result.get('metrics', {})
            analysis = result.get('analysis', {})
            
            # Show token overview immediately
            try:
                await initial_message.edit_text(
                    format_analysis_message(token_address, metadata, metrics, analysis, 0, len(ANALYSIS_STEPS)),
                    parse_mode='Markdown'
                )
            except TelegramError as e:
                # Ignore "message is not modified" errors - content is identical
                if "message is not modified" not in str(e).lower():
                    raise
            
            # Progressive updates for each analysis step
            for i, step_info in enumerate(ANALYSIS_STEPS, 1):
                await asyncio.sleep(STEP_DELAY)
                
                step_key = step_info['key']
                step_data = analysis.get(step_key)
                
                if step_data:
                    try:
                        await initial_message.edit_text(
                            format_analysis_message(token_address, metadata, metrics, analysis, i, len(ANALYSIS_STEPS)),
                            parse_mode='Markdown'
                        )
                    except TelegramError as e:
                        # Ignore "message is not modified" errors - content is identical
                        if "message is not modified" not in str(e).lower():
                            raise
            
            # Show predictions after all steps
            if analysis.get('marketCapPredictions'):
                await asyncio.sleep(STEP_DELAY)
                try:
                    await initial_message.edit_text(
                        format_analysis_message(token_address, metadata, metrics, analysis, len(ANALYSIS_STEPS), len(ANALYSIS_STEPS)),
                        parse_mode='Markdown'
                    )
                except TelegramError as e:
                    # Ignore "message is not modified" errors - content is identical
                    if "message is not modified" not in str(e).lower():
                        raise
            
            # Show final verdict
            if analysis.get('overallProbability') is not None:
                await asyncio.sleep(PREDICTION_DELAY)
                try:
                    await initial_message.edit_text(
                        format_analysis_message(token_address, metadata, metrics, analysis, len(ANALYSIS_STEPS), len(ANALYSIS_STEPS), show_complete=True),
                        parse_mode='Markdown'
                    )
                except TelegramError as e:
                    # Ignore "message is not modified" errors - content is identical
                    if "message is not modified" not in str(e).lower():
                        raise
            
        except requests.exceptions.Timeout:
            await initial_message.edit_text(
                "⏱️ Request Timeout\n\n"
                "The analysis is taking longer than expected. Please try again.",
                parse_mode='Markdown'
            )
        except requests.exceptions.RequestException as e:
            await initial_message.edit_text(
                f"❌ Network Error\n\n"
                f"Failed to connect to analysis service.\n"
                f"Error: {str(e)}\n\n"
                f"Please try again later.",
                parse_mode='Markdown'
            )
        except Exception as e:
            await initial_message.edit_text(
                f"❌ Unexpected Error\n\n"
                f"Error: {str(e)}\n\n"
                f"Please try again later.",
                parse_mode='Markdown'
            )

# ============================================================================
# MAIN FUNCTION
# ============================================================================

def main():
    """Start the bot"""
    if not BOT_TOKEN or BOT_TOKEN == "your_telegram_bot_token_here":
        print("ERROR: BOT_TOKEN not configured!")
        print("Please edit bot.py and set BOT_TOKEN to your Telegram bot token")
        print("Get your token from @BotFather on Telegram")
        return
    
    bot = TokenAnalysisBot()
    
    # Create application
    application = Application.builder().token(BOT_TOKEN).build()
    
    # Add handlers
    application.add_handler(CommandHandler("start", bot.start_command))
    application.add_handler(MessageHandler(
        filters.TEXT & ~filters.COMMAND,
        bot.handle_token_address
    ))
    
    # Start the bot
    print("🤖 Claude Trench Scanner Bot is starting...")
    print(f"📡 API URL: {bot.api_url}")
    try:
        application.run_polling()
    except KeyboardInterrupt:
        print("\n🛑 Bot stopped by user")
    except Exception as e:
        print(f"❌ Bot error: {e}")

if __name__ == '__main__':
    main()
