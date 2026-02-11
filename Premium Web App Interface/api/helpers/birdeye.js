const BIRDEYE_API_URL = 'https://public-api.birdeye.so/defi';

export async function getTokenOverview(tokenAddress) {
  try {
    // Check if API key exists
    if (!process.env.BIRDEYE_API_KEY) {
      console.warn('Birdeye API key not found, using fallback estimates');
      return null;
    }

    const url = new URL(`${BIRDEYE_API_URL}/token_overview`);
    url.searchParams.append('address', tokenAddress);
    url.searchParams.append('ui_amount_mode', 'scaled');
    // Request 24h timeframe for volume data
    url.searchParams.append('frames', '24h');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-API-KEY': process.env.BIRDEYE_API_KEY,
        'x-chain': 'solana',
        'accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Birdeye API error:', response.status, errorText);
      // Return null if API fails - we'll use fallback estimates
      return null;
    }

    const result = await response.json();
    
    // Check if request was successful
    if (!result.success || !result.data) {
      console.warn('Birdeye API returned unsuccessful response');
      return null;
    }

    const data = result.data;
    
    // When frames=24h is specified, data is a single object with all 24h metrics
    // Extract data directly from the response
    return {
      price: data.price || 0,
      marketCap: data.marketCap || 0,
      fdv: data.fdv || 0, // Fully diluted valuation
      volume24h: data.v24hUSD || data.v24h || data.volume24h || data.volume || 0, // Use USD volume
      liquidity: data.liquidity || 0, // Liquidity is directly in the response
      priceChange24h: data.priceChange24h || 0,
      priceChangePercent24h: data.priceChange24hPercent || 0,
      // Social links from extensions (though we also get these from Helius)
      extensions: data.extensions || {}
    };
  } catch (error) {
    console.error('Birdeye fetch error:', error);
    // Return null on error - we'll use fallback estimates
    return null;
  }
}

