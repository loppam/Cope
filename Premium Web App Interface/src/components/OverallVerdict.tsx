import React from 'react';
import { motion } from 'motion/react';
import { Shield, AlertTriangle, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';

interface OverallVerdictProps {
  data: {
    winProbability: number;
    riskLevel: 'low' | 'medium' | 'high';
    riskLevelText: string;
    riskIcon: string;
    recommendation: string;
    ctaText: string;
    ctaType: 'positive' | 'negative';
  };
}

const riskConfig = {
  low: {
    color: '#10B981',
    icon: Shield,
    bg: 'bg-[#10B98120]',
    border: 'border-[#10B981]'
  },
  medium: {
    color: '#F59E0B',
    icon: AlertTriangle,
    bg: 'bg-[#F59E0B20]',
    border: 'border-[#F59E0B]'
  },
  high: {
    color: '#EF4444',
    icon: AlertCircle,
    bg: 'bg-[#EF444420]',
    border: 'border-[#EF4444]'
  }
};

export function OverallVerdict({ data }: OverallVerdictProps) {
  const config = riskConfig[data.riskLevel];
  const RiskIcon = config.icon;
  const isPositive = data.ctaType === 'positive';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ 
        duration: 0.8,
        ease: [0.4, 0, 0.2, 1],
        type: 'spring',
        bounce: 0.4
      }}
      className="bg-gradient-to-br from-[#2D2D2D] via-[#1F1F1F] to-[#2D2D2D] border-2 border-[#CC785C] rounded-[20px] p-6 sm:p-8 md:p-12 text-center relative overflow-hidden"
      style={{
        boxShadow: '0 16px 48px rgba(204, 120, 92, 0.2)'
      }}
    >
      {/* Animated background glow */}
      <motion.div
        className="absolute inset-0 opacity-10"
        style={{
          background: 'radial-gradient(circle at 50% 50%, #CC785C 0%, transparent 70%)'
        }}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.1, 0.15, 0.1]
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
      />

      <div className="relative z-10">
        {/* Label */}
        <div 
          className="text-[12px] sm:text-[14px] text-[#737373] uppercase mb-3 sm:mb-4"
          style={{ letterSpacing: '2px' }}
        >
          Overall Assessment
        </div>

        {/* Giant Probability */}
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6, type: 'spring', bounce: 0.5 }}
          className="mb-2"
        >
          <div 
            className="text-[48px] sm:text-[60px] md:text-[72px] font-extrabold leading-none"
            style={{
              background: 'linear-gradient(135deg, #10B981 0%, #CC785C 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              textShadow: '0 4px 20px rgba(16, 185, 129, 0.3)'
            }}
          >
            {data.winProbability}%
          </div>
        </motion.div>

        <div className="text-[14px] sm:text-[16px] md:text-[18px] text-[#A0A0A0] mb-4 sm:mb-6">
          Win Probability
        </div>

        {/* Risk Level Badge */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="inline-flex items-center gap-2 sm:gap-3 px-5 sm:px-8 py-2 sm:py-3 rounded-full border-2 mb-4 sm:mb-6"
          style={{
            backgroundColor: config.bg.replace('bg-', ''),
            borderColor: config.color
          }}
        >
          <RiskIcon className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: config.color }} />
          <span 
            className="text-[14px] sm:text-[16px] font-bold"
            style={{ color: config.color }}
          >
            {data.riskLevelText}
          </span>
        </motion.div>

        {/* AI Recommendation */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="max-w-2xl mx-auto mb-6 sm:mb-8 relative"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#CC785C] rounded-full" />
          <p className="text-[14px] sm:text-[15px] md:text-[16px] text-[#A0A0A0] italic leading-[1.7] pl-4 sm:pl-6">
            {data.recommendation}
          </p>
        </motion.div>

        {/* CTA Button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={`w-full h-14 sm:h-16 rounded-xl text-[16px] sm:text-[18px] font-bold text-white flex items-center justify-center gap-2 sm:gap-3 relative overflow-hidden group ${
            isPositive 
              ? 'bg-gradient-to-r from-[#10B981] to-[#059669]' 
              : 'bg-gradient-to-r from-[#EF4444] to-[#DC2626]'
          }`}
          style={{
            boxShadow: isPositive 
              ? '0 8px 24px rgba(16, 185, 129, 0.3)' 
              : '0 8px 24px rgba(239, 68, 68, 0.3)'
          }}
        >
          {/* Shimmer effect on hover */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-0 group-hover:opacity-20"
            initial={{ x: '-100%' }}
            whileHover={{ x: '100%' }}
            transition={{ duration: 0.6 }}
          />
          
          <span className="relative z-10 flex items-center gap-2 sm:gap-3">
            {!isPositive && <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />}
            {data.ctaText}
            {isPositive && <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />}
          </span>
        </motion.button>

        {/* Sparkles decoration for positive verdict */}
        {isPositive && (
          <>
            <motion.div
              className="absolute top-10 left-10"
              animate={{
                rotate: [0, 360],
                scale: [1, 1.2, 1]
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: 'linear'
              }}
            >
              <Sparkles className="w-6 h-6 text-[#CC785C] opacity-50" />
            </motion.div>
            <motion.div
              className="absolute bottom-10 right-10"
              animate={{
                rotate: [360, 0],
                scale: [1, 1.2, 1]
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: 'linear'
              }}
            >
              <Sparkles className="w-6 h-6 text-[#10B981] opacity-50" />
            </motion.div>
          </>
        )}
      </div>
    </motion.div>
  );
}
