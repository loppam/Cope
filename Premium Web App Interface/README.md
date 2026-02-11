
  # Claude Trench Scanner - Solana Token Analyzer

  AI-powered Solana token analysis tool with real-time on-chain data and market cap predictions.

  ## Features

  - Real-time Solana blockchain data via Helius RPC
  - AI-powered analysis using Claude AI
  - Progressive UI with 5-second interval reveals
  - Market cap predictions with probability assessments
  - Risk analysis (bundle detection, holder concentration, dev activity)

  ## Setup

  ### 1. Install Dependencies

  ```bash
  npm install
  ```

  ### 2. Environment Variables

  Create a `.env.local` file in the root directory:

  ```env
  HELIUS_API_KEY=your_helius_key_here
  ANTHROPIC_API_KEY=your_anthropic_key_here
  BIRDEYE_API_KEY=your_birdeye_key_here
  ```

  Get your API keys:
  - **Helius**: Sign up at https://www.helius.dev/
  - **Anthropic**: Get your API key from https://console.anthropic.com/
  - **Birdeye**: Get your API key from https://birdeye.so/ (optional - falls back to estimates if not provided)

  ### 3. Development

  ```bash
  npm run dev
  ```

  The app will run on `http://localhost:5173` (or the port Vite assigns).

  ### 4. Testing the API Locally

  For local development, you can use Vercel CLI:

  ```bash
  npm i -g vercel
  vercel dev
  ```

  This will run the serverless functions locally at `http://localhost:3000/api/analyze-token`.

  ## Project Structure

  ```
  /api
    /helpers
      solana.js       # Helius RPC integration (on-chain data + social links)
      birdeye.js      # Birdeye API integration (market data: price, volume, liquidity)
      calculations.js  # Metrics calculations
      claude.js        # Claude AI integration
    analyze-token.js   # Main API endpoint
  /src
    /hooks
      useTokenAnalysis.js  # React hook for analysis flow
    /utils
      formatters.js        # Data formatting utilities
    /components
      AnalysisInterface.tsx # Main UI component
      ...
  ```

  ## Deployment

  ### Vercel (Recommended)

  1. Push your code to GitHub
  2. Import project in Vercel dashboard
  3. Add environment variables:
     - `HELIUS_API_KEY`
     - `ANTHROPIC_API_KEY`
  4. Deploy

  The API routes will automatically be available as serverless functions.

  ## API Endpoint

  **POST** `/api/analyze-token`

  Request body:
  ```json
  {
    "tokenAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  }
  ```

  Response:
  ```json
  {
    "metadata": { ... },
    "metrics": { ... },
    "analysis": { ... }
  }
  ```

  ## Tech Stack

  - **Frontend**: React + Vite + Tailwind CSS
  - **Backend**: Vercel Serverless Functions (Node.js)
  - **Blockchain**: Helius RPC for Solana on-chain data
  - **Market Data**: Birdeye API for price, volume, liquidity, market cap
  - **AI**: Anthropic Claude API
  