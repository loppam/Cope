export const mockData = {
  tokenOverview: {
    name: "DogWifHat",
    symbol: "$WIF",
    marketCap: "$2,400,000",
    marketCapRaw: 2400000,
    trend: "↑ 23.4%",
    trendPositive: true,
    volume24h: "$847,000",
    liquidity: "$156,000",
    contractAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    hasVerifiedSocials: true,
    twitter: "https://twitter.com/dogwifhat",
    telegram: "https://t.me/dogwifhat"
  },
  analysisItems: [
    {
      id: "bundles",
      icon: "Target",
      label: "Bundle Detection",
      reason: "No coordinated wallet patterns detected. Distribution appears organic with natural holder growth.",
      status: "safe" as const,
      statusText: "Safe"
    },
    {
      id: "devHistory",
      icon: "UserCircle",
      label: "Developer History",
      reason: "Dev wallet has 3 previous successful launches with no rug pulls. Established credibility in the ecosystem.",
      status: "safe" as const,
      statusText: "Decent"
    },
    {
      id: "topHolders",
      icon: "Users",
      label: "Top Holders Analysis",
      reason: "Top 10 holders control 34% of supply. Relatively decentralized with no single whale dominance.",
      status: "safe" as const,
      statusText: "Safe",
      concentration: "34%"
    },
    {
      id: "chartAnalysis",
      icon: "TrendingUp",
      label: "Chart Pattern Analysis",
      reason: "Clear floor formation at $0.0024 with higher lows. Bullish accumulation pattern confirmed.",
      status: "safe" as const,
      statusText: "Floor Confirmed"
    },
    {
      id: "freshWallets",
      icon: "Sparkles",
      label: "Fresh Wallet Activity",
      reason: "23% of recent buyers are fresh wallets. Indicates genuine new interest rather than wash trading.",
      status: "safe" as const,
      statusText: "Safe",
      percentage: "23%"
    },
    {
      id: "devActivity",
      icon: "Activity",
      label: "Developer Activity",
      reason: "Dev wallet shows no sells in past 30 days. Last transaction was adding liquidity 2 days ago.",
      status: "safe" as const,
      statusText: "No Sells",
      details: "Last LP add: 2 days ago"
    },
    {
      id: "lore",
      icon: "BookOpen",
      label: "Lore & Narrative",
      reason: "Strong community-driven meme narrative around 'dog with hat' theme. Viral potential with over 15K organic mentions on Twitter in past week. Similar successful precedents in the space.",
      status: "info" as const,
      statusText: null
    },
    {
      id: "socialPresence",
      icon: "Globe",
      label: "Social Media Presence",
      reason: "Active Twitter with 47K followers and daily engagement. Telegram group has 12K members with healthy activity.",
      status: "safe" as const,
      statusText: "Strong",
      links: [
        { platform: "Twitter", url: "https://twitter.com/dogwifhat", followers: "47K" },
        { platform: "Telegram", url: "https://t.me/dogwifhat", members: "12K" }
      ]
    }
  ],
  predictions: [
    {
      id: "conservative",
      type: "CONSERVATIVE",
      badge: "SAFE BET",
      themeColor: "#10B981",
      targetMarketCap: "$150K",
      targetMarketCapRaw: 150000,
      currentMarketCap: "$25K",
      multiplier: "6x",
      winProbability: 73,
      timeframe: "1-2 weeks",
      confidence: "High",
      details: [
        { icon: "Clock", text: "Timeframe: 1-2 weeks" },
        { icon: "Gauge", text: "Confidence: High" }
      ]
    },
    {
      id: "moderate",
      type: "MODERATE",
      badge: "BALANCED",
      themeColor: "#F59E0B",
      targetMarketCap: "$500K",
      targetMarketCapRaw: 500000,
      currentMarketCap: "$25K",
      multiplier: "20x",
      winProbability: 45,
      timeframe: "2-4 weeks",
      confidence: "Medium",
      details: [
        { icon: "Clock", text: "Timeframe: 2-4 weeks" },
        { icon: "Gauge", text: "Confidence: Medium" }
      ]
    },
    {
      id: "aggressive",
      type: "AGGRESSIVE",
      badge: "HIGH RISK",
      themeColor: "#EF4444",
      targetMarketCap: "$2.5M",
      targetMarketCapRaw: 2500000,
      currentMarketCap: "$25K",
      multiplier: "100x",
      winProbability: 12,
      timeframe: "1-3 months",
      confidence: "Low",
      details: [
        { icon: "Clock", text: "Timeframe: 1-3 months" },
        { icon: "Gauge", text: "Confidence: Low" }
      ]
    }
  ],
  overallVerdict: {
    winProbability: 73,
    riskLevel: "low" as const,
    riskLevelText: "Low Risk",
    riskIcon: "Shield",
    recommendation: "Strong fundamentals with organic growth patterns. This token shows promising metrics for short-term gains. Consider position sizing appropriate for your risk tolerance.",
    ctaText: "Proceed with Trade →",
    ctaType: "positive" as const
  }
};
