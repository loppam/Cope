import React from 'react';
import { motion } from 'motion/react';
import { Clock, Gauge } from 'lucide-react';

interface PredictionCardProps {
  data: {
    id: string;
    type: string;
    badge: string;
    themeColor: string;
    targetMarketCap: string;
    currentMarketCap: string;
    multiplier: string;
    winProbability: number;
    timeframe: string;
    confidence: string;
  };
  index: number;
}

export function PredictionCard({ data, index }: PredictionCardProps) {
  const rotation = index === 0 ? -2 : index === 1 ? 0 : 2;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ 
        delay: index * 0.15,
        duration: 0.6, 
        ease: [0.4, 0, 0.2, 1] 
      }}
      whileHover={{ 
        y: -4,
        transition: { duration: 0.3 }
      }}
      className="bg-gradient-to-br from-[#2D2D2D] to-[#262626] border-2 border-[#404040] rounded-2xl p-5 sm:p-7 shadow-[0_8px_24px_rgba(0,0,0,0.4)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.5)] transition-all duration-300 group"
      style={{
        '--theme-color': data.themeColor
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = data.themeColor;
        e.currentTarget.style.boxShadow = `0 12px 32px ${data.themeColor}33`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#404040';
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
      }}
    >
      {/* Badge */}
      <div 
        className="inline-block px-3.5 py-2 rounded-md text-[12px] font-extrabold uppercase text-white"
        style={{ 
          backgroundColor: data.themeColor,
          letterSpacing: '1.5px',
          transform: `rotate(${rotation}deg)`
        }}
      >
        {data.badge}
      </div>

      {/* Target Market Cap */}
      <div className="mt-4 sm:mt-5">
        <div className="text-[28px] sm:text-[36px] font-extrabold text-[#EBEBEB] leading-none">
          {data.targetMarketCap}
        </div>
        <div className="text-[12px] sm:text-[14px] text-[#737373] mt-2">
          from <span className="line-through">{data.currentMarketCap}</span>
        </div>
      </div>

      {/* Multiplier */}
      <div 
        className="mt-3 text-[22px] sm:text-[28px] font-bold leading-none"
        style={{
          background: `linear-gradient(135deg, ${data.themeColor} 0%, ${data.themeColor}CC 100%)`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text'
        }}
      >
        {data.multiplier}
      </div>

      {/* Probability Section */}
      <div className="mt-6 relative">
        <div 
          className="text-[12px] text-[#737373] uppercase mb-2"
          style={{ letterSpacing: '1px' }}
        >
          Win Probability
        </div>
        
        <div className="flex items-center gap-4">
          {/* Circular Progress */}
          <div className="relative w-16 h-16 sm:w-20 sm:h-20">
            <svg className="w-16 h-16 sm:w-20 sm:h-20 -rotate-90">
              {/* Track */}
              <circle
                cx="32"
                cy="32"
                r="26"
                stroke="#3A3A3A"
                strokeWidth="5"
                fill="none"
                className="sm:hidden"
              />
              <circle
                cx="40"
                cy="40"
                r="32"
                stroke="#3A3A3A"
                strokeWidth="6"
                fill="none"
                className="hidden sm:block"
              />
              {/* Progress */}
              <motion.circle
                cx="32"
                cy="32"
                r="26"
                stroke={data.themeColor}
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
                initial={{ strokeDasharray: '0 999' }}
                animate={{ 
                  strokeDasharray: `${(data.winProbability / 100) * 163} 999` 
                }}
                transition={{ 
                  delay: index * 0.15 + 0.3,
                  duration: 1,
                  ease: 'easeOut'
                }}
                className="sm:hidden"
              />
              <motion.circle
                cx="40"
                cy="40"
                r="32"
                stroke={data.themeColor}
                strokeWidth="6"
                fill="none"
                strokeLinecap="round"
                initial={{ strokeDasharray: '0 999' }}
                animate={{ 
                  strokeDasharray: `${(data.winProbability / 100) * 201} 999` 
                }}
                transition={{ 
                  delay: index * 0.15 + 0.3,
                  duration: 1,
                  ease: 'easeOut'
                }}
                className="hidden sm:block"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span 
                className="text-[14px] sm:text-[18px] font-bold"
                style={{ color: data.themeColor }}
              >
                {data.winProbability}%
              </span>
            </div>
          </div>

          {/* Large Percentage */}
          <div 
            className="text-[24px] sm:text-[32px] font-bold"
            style={{ color: data.themeColor }}
          >
            {data.winProbability}%
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="mt-6 space-y-2 border-t border-[#404040] pt-4">
        <div className="flex items-center gap-2 text-[13px] text-[#A0A0A0]">
          <Clock className="w-4 h-4" style={{ color: data.themeColor }} />
          <span>Timeframe: {data.timeframe}</span>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-[#A0A0A0]">
          <Gauge className="w-4 h-4" style={{ color: data.themeColor }} />
          <span>Confidence: {data.confidence}</span>
        </div>
      </div>
    </motion.div>
  );
}
