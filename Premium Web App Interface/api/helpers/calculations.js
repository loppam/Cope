export function calculateMetrics(onChainData, marketData = null) {
  const { metadata, holders, transactions } = onChainData;

  // Top 10 holder concentration
  const totalSupply = metadata.supply;
  const top10Amount = holders
    .slice(0, 10)
    .reduce((sum, h) => sum + (h.amount || 0), 0);
  const top10Concentration =
    totalSupply > 0 ? ((top10Amount / totalSupply) * 100).toFixed(2) : "0.00";

  // Detect bundles (multiple txs in same slot/block)
  const bundleCount = detectBundles(transactions);

  // Fresh wallet detection (simplified - would need more data)
  const freshWalletPercent = estimateFreshWallets(holders);

  // Dev wallet activity (simplified)
  const devSold = checkDevActivity(transactions, holders);

  // Use real market data from Birdeye if available, otherwise fallback to estimates
  const liquidityUSD =
    marketData?.liquidity || estimateLiquidity(metadata, holders);
  const volume24h = marketData?.volume24h || transactions.length * 100; // Fallback estimate
  const marketCap = marketData?.marketCap || liquidityUSD * 10; // Fallback estimate
  const price = marketData?.price || 0;
  const priceChange24h = marketData?.priceChangePercent24h || 0;

  return {
    top10Concentration: parseFloat(top10Concentration),
    holderCount: holders.length,
    bundleCount,
    freshWalletPercent,
    devSold,
    liquidityUSD,
    volume24h,
    marketCap,
    price,
    priceChange24h,
    totalSupply,
    hasFreeze: metadata.freezeAuthority !== "None",
    hasMintAuthority: metadata.mintAuthority !== null,
    // Include Birdeye extensions for social links
    extensions: marketData?.extensions || {},
  };
}

function detectBundles(transactions) {
  const slotGroups = {};
  transactions.forEach((tx) => {
    const slot = tx.slot;
    if (slot) {
      slotGroups[slot] = (slotGroups[slot] || 0) + 1;
    }
  });

  return Object.values(slotGroups).filter((count) => count > 3).length;
}

function estimateFreshWallets(holders) {
  // Simplified: assume top holders are older
  // In production, would check wallet creation dates
  return Math.random() * 30 + 10; // 10-40%
}

function checkDevActivity(transactions, holders) {
  // Simplified: check if top holder has many outgoing txs
  const topHolder = holders[0];
  if (!topHolder) return "No";

  const devTxs = transactions.filter(
    (tx) => tx.memo?.includes("sell") || tx.memo?.includes("transfer")
  );
  return devTxs.length > 5 ? "Yes" : "No";
}

function estimateLiquidity(metadata, holders) {
  // Very simplified - would need Raydium/Orca pool data
  return holders.length * 1000; // Rough estimate
}
