import { fetchTokenData, getTokenMetadata } from './helpers/solana.js';
import { analyzeWithClaude } from './helpers/claude.js';
import { calculateMetrics } from './helpers/calculations.js';
import { getTokenOverview } from './helpers/birdeye.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tokenAddress } = req.body;
    
    if (!tokenAddress || tokenAddress.length < 32) {
      return res.status(400).json({ error: 'Invalid token address' });
    }

    // Step 1: Fetch token metadata (quick response for UI)
    const metadata = await getTokenMetadata(tokenAddress);
    
    // Step 2: Fetch comprehensive on-chain data and market data in parallel
    const [onChainData, marketData] = await Promise.all([
      fetchTokenData(tokenAddress),
      getTokenOverview(tokenAddress) // Birdeye market data
    ]);
    
    // Step 3: Calculate all metrics (using real market data if available)
    const metrics = calculateMetrics(onChainData, marketData);
    
    // Step 4: Send to Claude for AI analysis
    const analysis = await analyzeWithClaude({
      tokenAddress,
      metadata,
      metrics,
      onChainData
    });

    // Return complete analysis
    return res.status(200).json({
      metadata,
      metrics,
      analysis
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message 
    });
  }
}

