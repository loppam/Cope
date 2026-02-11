const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;

export async function getTokenMetadata(tokenAddress) {
  try {
    // Fetch basic token info
    const response = await fetch(HELIUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'token-metadata',
        method: 'getAsset',
        params: { id: tokenAddress }
      })
    });

    const data = await response.json();
    const asset = data.result;

    // Also get token supply
    const supplyRes = await fetch(HELIUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'supply',
        method: 'getTokenSupply',
        params: [tokenAddress]
      })
    });

    const supplyData = await supplyRes.json();

    // Extract metadata - check multiple possible locations
    const metadata = asset?.content?.metadata || asset?.mint_extensions?.metadata || {};
    const tokenInfo = asset?.token_info || {};
    
    // Social links might be in extensions, mint_extensions, or need to fetch from JSON URI
    // For now, check common locations
    const extensions = asset?.content?.metadata?.extensions || 
                      asset?.mint_extensions?.metadata?.extensions || 
                      {};
    
    return {
      name: metadata.name || tokenInfo.symbol || 'Unknown',
      symbol: metadata.symbol || tokenInfo.symbol || 'N/A',
      supply: supplyData?.result?.value?.uiAmount || tokenInfo.supply || 0,
      decimals: supplyData?.result?.value?.decimals || tokenInfo.decimals || 9,
      mintAuthority: asset?.authorities?.find(a => a.scopes?.includes('full'))?.address || 
                     asset?.mint_extensions?.metadata?.update_authority || null,
      freezeAuthority: asset?.compression?.compressed ? 'Compressed' : 'None',
      createdAt: asset?.created_at || Date.now(),
      // Social links from metadata extensions (may not be present for all tokens)
      website: extensions.website || null,
      twitter: extensions.twitter || null,
      telegram: extensions.telegram || null
    };
  } catch (error) {
    console.error('Metadata fetch error:', error);
    throw new Error('Failed to fetch token metadata');
  }
}

export async function getHolderDistribution(tokenAddress) {
  try {
    const response = await fetch(HELIUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'holders',
        method: 'getTokenLargestAccounts',
        params: [tokenAddress]
      })
    });

    const data = await response.json();
    const holders = data?.result?.value || [];

    return holders.map(h => ({
      address: h.address,
      amount: h.uiAmount,
      percentage: 0 // Calculate below
    }));
  } catch (error) {
    console.error('Holder fetch error:', error);
    return [];
  }
}

export async function getRecentTransactions(tokenAddress, limit = 100) {
  try {
    const response = await fetch(HELIUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'transactions',
        method: 'getSignaturesForAddress',
        params: [tokenAddress, { limit }]
      })
    });

    const data = await response.json();
    return data?.result || [];
  } catch (error) {
    console.error('Transaction fetch error:', error);
    return [];
  }
}

export async function fetchTokenData(tokenAddress) {
  const [metadata, holders, transactions] = await Promise.all([
    getTokenMetadata(tokenAddress),
    getHolderDistribution(tokenAddress),
    getRecentTransactions(tokenAddress)
  ]);

  return {
    metadata,
    holders,
    transactions
  };
}

