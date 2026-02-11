import { useState, useCallback } from 'react';

export function useTokenAnalysis() {
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [tokenData, setTokenData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);

  const analyzeToken = useCallback(async (tokenAddress) => {
    setLoading(true);
    setError(null);
    setCurrentStep(0);
    setAnalysis(null);
    setTokenData(null);

    try {
      // Call API
      const response = await fetch('/api/analyze-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Analysis failed');
      }

      const result = await response.json();
      
      // Extract social links from Birdeye extensions if available, fallback to Helius metadata
      const birdeyeExtensions = result.metrics?.extensions || {};
      const socialTwitter = birdeyeExtensions.twitter || result.metadata.twitter || null;
      const socialTelegram = birdeyeExtensions.telegram || result.metadata.telegram || null;
      
      // Set token metadata immediately (use real market cap, volume, liquidity from metrics)
      setTokenData({
        name: result.metadata.name,
        symbol: result.metadata.symbol,
        marketCap: result.metrics.marketCap || result.analysis.currentMarketCap,
        volume24h: result.metrics.volume24h || 0,
        liquidityUSD: result.metrics.liquidityUSD || 0,
        priceChange24h: result.metrics.priceChange24h || 0,
        contractAddress: tokenAddress,
        hasVerifiedSocials: !!(socialTwitter || socialTelegram),
        twitter: socialTwitter,
        telegram: socialTelegram
      });

      // API call complete, set loading to false
      setLoading(false);

      // Simulate 5-second intervals for each analysis step
      const steps = [
        'bundles',
        'devHistory',
        'topHolders',
        'chart',
        'freshWallets',
        'devSold',
        'lore',
        'socials'
      ];

      const analysisResults = result.analysis;
      const steppedAnalysis = {};

      for (let i = 0; i < steps.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
        
        const stepKey = steps[i];
        steppedAnalysis[stepKey] = analysisResults[stepKey];
        
        setAnalysis({ ...steppedAnalysis });
        setCurrentStep(i + 1);
      }

      // After all steps, add predictions
      await new Promise(resolve => setTimeout(resolve, 2000));
      setAnalysis({
        ...steppedAnalysis,
        currentMarketCap: analysisResults.currentMarketCap,
        marketCapPredictions: analysisResults.marketCapPredictions,
        overallProbability: analysisResults.overallProbability,
        riskLevel: analysisResults.riskLevel,
        recommendation: analysisResults.recommendation
      });

    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  return {
    loading,
    currentStep,
    tokenData,
    analysis,
    error,
    analyzeToken
  };
}

