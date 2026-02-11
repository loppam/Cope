import React, { useState, useEffect } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { TokenOverviewCard } from './TokenOverviewCard';
import { AnalysisRow } from './AnalysisRow';
import { PredictionCard } from './PredictionCard';
import { OverallVerdict } from './OverallVerdict';
import { useTokenAnalysis } from '../hooks/useTokenAnalysis';
import { formatMarketCap } from '../utils/formatters';

type AnalysisState = 'idle' | 'loading' | 'analyzing' | 'complete';

// Map analysis data to UI format
const analysisSteps = [
  { key: 'bundles', icon: 'Target', label: 'Bundle Detection' },
  { key: 'devHistory', icon: 'UserCircle', label: 'Developer History' },
  { key: 'topHolders', icon: 'Users', label: 'Top Holders Analysis' },
  { key: 'chart', icon: 'TrendingUp', label: 'Chart Pattern Analysis' },
  { key: 'freshWallets', icon: 'Sparkles', label: 'Fresh Wallet Activity' },
  { key: 'devSold', icon: 'Activity', label: 'Developer Activity' },
  { key: 'lore', icon: 'BookOpen', label: 'Lore & Narrative' },
  { key: 'socials', icon: 'Globe', label: 'Social Media Presence' }
];

export function AnalysisInterface() {
  const [tokenAddress, setTokenAddress] = useState('');
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [showPredictions, setShowPredictions] = useState(false);
  const [showVerdict, setShowVerdict] = useState(false);

  const { loading, currentStep, tokenData, analysis, error, analyzeToken } = useTokenAnalysis();
    
  useEffect(() => {
    if (loading) {
    setAnalysisState('loading');
    } else if (currentStep > 0 && currentStep < analysisSteps.length) {
      setAnalysisState('analyzing');
    } else if (currentStep >= analysisSteps.length && analysis?.marketCapPredictions) {
          setShowPredictions(true);
      setTimeout(() => {
        setShowVerdict(true);
        setAnalysisState('complete');
      }, 2000);
    } else if (!loading && currentStep === 0 && tokenData) {
      setAnalysisState('analyzing');
    }
  }, [loading, currentStep, analysis, tokenData]);

  const handleAnalyze = () => {
    if (!tokenAddress.trim()) return;
    analyzeToken(tokenAddress.trim());
    setShowPredictions(false);
    setShowVerdict(false);
  };

  const isAnalyzing = analysisState === 'analyzing' || analysisState === 'loading';

  // Map analysis data to AnalysisRow format
  const getAnalysisItem = (stepKey: string, stepIndex: number) => {
    const step = analysisSteps[stepIndex];
    const analysisData = analysis?.[stepKey as keyof typeof analysis];
    
    // Check if step exists and analysis data exists
    if (!step || !analysisData) return null;

    const item: any = {
      id: stepKey,
      icon: step.icon,
      label: step.label,
      reason: analysisData.reason || '',
      status: analysisData.status || 'info',
      statusText: analysisData.value || null
    };

    // Add specific fields based on step type
    if (stepKey === 'topHolders' && analysis?.topHolders) {
      item.concentration = `${analysis.topHolders.reason.match(/\d+%/)?.[0] || ''}`;
    }
    if (stepKey === 'freshWallets' && analysis?.freshWallets) {
      item.percentage = `${analysis.freshWallets.reason.match(/\d+%/)?.[0] || ''}`;
    }
    if (stepKey === 'devSold' && analysis?.devSold) {
      item.details = analysis.devSold.reason;
    }
    if (stepKey === 'socials' && analysis?.socials) {
      // Extract links if available (would need to be in response)
      item.links = [];
    }

    return item;
  };

  // Map predictions to PredictionCard format
  const getPredictions = () => {
    if (!analysis?.marketCapPredictions) return [];
    
    const predictions = analysis.marketCapPredictions;
    // Use real market cap from tokenData if available, otherwise from analysis
    const currentMcap = tokenData?.marketCap || analysis.currentMarketCap || 0;
    
    return [
      {
        id: 'conservative',
        type: 'CONSERVATIVE',
        badge: 'SAFE BET',
        themeColor: '#10B981',
        targetMarketCap: formatMarketCap(predictions.conservative.mcap),
        targetMarketCapRaw: predictions.conservative.mcap,
        currentMarketCap: formatMarketCap(currentMcap),
        multiplier: predictions.conservative.multiplier,
        winProbability: predictions.conservative.probability,
        timeframe: predictions.conservative.timeframe,
        confidence: 'High'
      },
      {
        id: 'moderate',
        type: 'MODERATE',
        badge: 'BALANCED',
        themeColor: '#F59E0B',
        targetMarketCap: formatMarketCap(predictions.moderate.mcap),
        targetMarketCapRaw: predictions.moderate.mcap,
        currentMarketCap: formatMarketCap(currentMcap),
        multiplier: predictions.moderate.multiplier,
        winProbability: predictions.moderate.probability,
        timeframe: predictions.moderate.timeframe,
        confidence: 'Medium'
      },
      {
        id: 'aggressive',
        type: 'AGGRESSIVE',
        badge: 'HIGH RISK',
        themeColor: '#EF4444',
        targetMarketCap: formatMarketCap(predictions.aggressive.mcap),
        targetMarketCapRaw: predictions.aggressive.mcap,
        currentMarketCap: formatMarketCap(currentMcap),
        multiplier: predictions.aggressive.multiplier,
        winProbability: predictions.aggressive.probability,
        timeframe: predictions.aggressive.timeframe,
        confidence: 'Low'
      }
    ];
  };

  // Map verdict data
  const getVerdictData = () => {
    if (!analysis) return null;
    
    const riskLevel = analysis.riskLevel?.toLowerCase() || 'medium';
    const riskLevelText = analysis.riskLevel || 'Medium Risk';
    
    return {
      winProbability: analysis.overallProbability || 0,
      riskLevel: (riskLevel === 'low' ? 'low' : riskLevel === 'high' ? 'high' : 'medium') as 'low' | 'medium' | 'high',
      riskLevelText,
      riskIcon: 'Shield',
      recommendation: analysis.recommendation || '',
      ctaText: riskLevel === 'low' ? 'Proceed with Trade →' : 'Proceed with Caution →',
      ctaType: (riskLevel === 'low' ? 'positive' : 'negative') as 'positive' | 'negative'
    };
  };

  return (
    <div className="bg-[#1F1F1F] px-6 sm:px-8 md:px-12 py-12 sm:py-16 min-h-screen">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <h2 className="text-[20px] sm:text-[24px] font-semibold text-[#EBEBEB]">
          Token Scanner
        </h2>
      </div>

      {/* Input Section */}
      <div 
        className="bg-[#2D2D2D] border border-[#404040] rounded-xl p-1.5 transition-all duration-300 hover:border-[#CC785C]"
        style={{
          boxShadow: '0 4px 6px rgba(0,0,0,0.4), 0 0 0 1px rgba(204,120,92,0.1)'
        }}
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAnalyze()}
            placeholder="Enter Solana token address (e.g., 7xKXtg...)"
            className="flex-1 bg-[#3A3A3A] rounded-lg px-4 sm:px-5 py-3 sm:py-4 text-[14px] sm:text-[15px] text-[#EBEBEB] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#CC785C]"
          />
          <button
            onClick={handleAnalyze}
            disabled={!tokenAddress.trim() || isAnalyzing}
            className="bg-gradient-to-br from-[#CC785C] to-[#B86A4F] text-white px-6 sm:px-8 py-3 sm:py-4 rounded-lg text-[14px] sm:text-[15px] font-semibold hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 shadow-lg w-full sm:w-auto"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                <span className="hidden sm:inline">Analyzing...</span>
                <span className="sm:hidden">Analyzing</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4 sm:w-5 sm:h-5" />
                Analyze
              </>
            )}
          </button>
        </div>
      </div>

      {/* Loading State */}
      {analysisState === 'loading' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-12 text-center"
        >
          <div className="inline-flex items-center gap-3 text-[#CC785C]">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-[16px] font-medium">Connecting to Solana...</span>
          </div>
          <div className="mt-4 max-w-md mx-auto bg-[#2D2D2D] rounded-full h-2 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-[#CC785C] to-[#B86A4F]"
              initial={{ width: '0%' }}
              animate={{ width: '30%' }}
              transition={{ duration: 1.5 }}
            />
          </div>
        </motion.div>
      )}

      {/* Error State */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 bg-[#EF444420] border border-[#EF4444] rounded-xl p-4 text-[#EF4444]"
        >
          <p className="text-[14px] font-medium">Error: {error}</p>
        </motion.div>
      )}

      {/* Token Overview Card */}
      {tokenData && analysisState !== 'idle' && analysisState !== 'loading' && (
        <div className="mt-8">
          <TokenOverviewCard data={{
            name: tokenData.name,
            symbol: tokenData.symbol,
            marketCap: formatMarketCap(tokenData.marketCap || 0),
            trend: tokenData.priceChange24h ? `${tokenData.priceChange24h >= 0 ? '↑' : '↓'} ${Math.abs(tokenData.priceChange24h).toFixed(2)}%` : '↑ 0%',
            trendPositive: tokenData.priceChange24h ? tokenData.priceChange24h >= 0 : true,
            volume24h: formatMarketCap(tokenData.volume24h || 0),
            liquidity: formatMarketCap(tokenData.liquidityUSD || 0),
            contractAddress: tokenData.contractAddress,
            hasVerifiedSocials: tokenData.hasVerifiedSocials || false,
            twitter: tokenData.twitter,
            telegram: tokenData.telegram
          }} />
        </div>
      )}

      {/* Analysis Section */}
      {(analysisState === 'analyzing' || analysisState === 'complete') && currentStep > 0 ? (
        <div className="mt-12">
          {/* Section Title */}
          <div className="mb-8">
            <h3 className="text-[20px] font-semibold text-[#EBEBEB] relative inline-block">
              {analysisState === 'complete' ? 'Analysis Complete' : 'AI Analysis in Progress...'}
              {analysisState === 'analyzing' && (
                <motion.div
                  className="absolute -bottom-2 left-0 right-0 h-0.5 bg-gradient-to-r from-[#CC785C] to-[#B86A4F]"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.5 }}
                />
              )}
            </h3>
          </div>

          {/* Progress Bar */}
          <div className="mb-8 bg-[#2D2D2D] rounded-full h-2 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-[#CC785C] to-[#10B981]"
              initial={{ width: '0%' }}
              animate={{ 
                width: `${Math.min((currentStep / analysisSteps.length) * 100, 100)}%` 
              }}
              transition={{ duration: 0.5 }}
            />
          </div>

          {/* Analysis Rows */}
          <div className="space-y-4">
            {analysisSteps.map((step, index) => {
              // Only show items that have been completed (index < currentStep)
              if (index >= currentStep || !step) return null;
              
              const item = getAnalysisItem(step.key, index);
              // Ensure item has all required properties
              if (!item || !item.icon || !item.label) return null;
              
              return (
                <AnalysisRow
                  key={step.key}
                  data={item}
                  isAnalyzing={index === currentStep - 1 && analysisState === 'analyzing'}
                  delay={0}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Market Cap Predictions */}
      {showPredictions && (
        <div className="mt-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h3 
              className="text-[22px] font-bold mb-2"
              style={{
                background: 'linear-gradient(135deg, #CC785C 0%, #B86A4F 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}
            >
              Market Cap Predictions
            </h3>
            <p className="text-[14px] text-[#737373] mb-8">
              AI-generated scenarios based on token fundamentals
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {getPredictions().map((prediction, index) => (
                <PredictionCard
                  key={prediction.id}
                  data={prediction}
                  index={index}
                />
              ))}
            </div>
          </motion.div>
        </div>
      )}

      {/* Overall Verdict */}
      {showVerdict && getVerdictData() && (
        <div className="mt-12">
          <OverallVerdict data={getVerdictData()!} />
        </div>
      )}
    </div>
  );
}