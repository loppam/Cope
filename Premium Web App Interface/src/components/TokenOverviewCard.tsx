import React, { useState } from 'react';
import { Copy, Check, Twitter, MessageCircle } from 'lucide-react';
import { motion } from 'motion/react';

interface TokenOverviewProps {
  data: {
    name: string;
    symbol: string;
    marketCap: string;
    trend: string;
    trendPositive: boolean;
    volume24h: string;
    liquidity: string;
    contractAddress: string;
    hasVerifiedSocials: boolean;
    twitter?: string;
    telegram?: string;
  };
}

export function TokenOverviewCard({ data }: TokenOverviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(data.contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const EXCEPTION_ADDRESS = "73iDnLaQDL84PDDubzTFSa2awyHFQYHbBRU9tfTopump";
  const isExceptionToken = data.contractAddress === EXCEPTION_ADDRESS;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      className="bg-[#2D2D2D] border border-[#404040] rounded-2xl p-6 sm:p-8 shadow-[0_8px_16px_rgba(0,0,0,0.4)]"
    >
      {/* Special Message Banner for Exception Token */}
      {isExceptionToken && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mb-6 bg-gradient-to-r from-[#10B981] to-[#059669] border-2 border-[#10B981] rounded-xl p-4 sm:p-5 text-center relative overflow-hidden"
          style={{
            boxShadow: '0 4px 20px rgba(16, 185, 129, 0.3)'
          }}
        >
          <motion.div
            className="absolute inset-0 opacity-20"
            style={{
              background: 'radial-gradient(circle at 50% 50%, #10B981 0%, transparent 70%)'
            }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.2, 0.3, 0.2]
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
          />
          <div className="relative z-10">
            <p className="text-[16px] sm:text-[18px] font-bold text-white">
              You are scanning me, I am a win token
            </p>
          </div>
        </motion.div>
      )}

      {/* 3 Column Layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Column 1: Token Name */}
        <div>
          <div 
            className="text-[11px] sm:text-[12px] text-[#737373] uppercase mb-2"
            style={{ letterSpacing: '1px' }}
          >
            Token Name
          </div>
          <div className="text-[20px] sm:text-[24px] font-bold text-[#EBEBEB]">
            {data.name}
          </div>
          <div className="text-[13px] sm:text-[14px] text-[#A0A0A0] mt-1">
            {data.symbol}
          </div>
        </div>

        {/* Column 2: Market Cap */}
        <div>
          <div 
            className="text-[11px] sm:text-[12px] text-[#737373] uppercase mb-2"
            style={{ letterSpacing: '1px' }}
          >
            Current Market Cap
          </div>
          <div className="text-[20px] sm:text-[24px] font-bold text-[#10B981]">
            {data.marketCap}
          </div>
          <div className={`text-[12px] sm:text-[13px] mt-1 ${data.trendPositive ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
            {data.trend}
          </div>
        </div>

        {/* Column 3: 24h Volume */}
        <div className="sm:col-span-2 lg:col-span-1">
          <div 
            className="text-[11px] sm:text-[12px] text-[#737373] uppercase mb-2"
            style={{ letterSpacing: '1px' }}
          >
            24h Volume
          </div>
          <div className="text-[20px] sm:text-[24px] font-bold text-[#CC785C]">
            {data.volume24h}
          </div>
          <div className="text-[11px] sm:text-[12px] text-[#737373] mt-1">
            Liquidity: {data.liquidity}
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-[#404040] space-y-3 sm:space-y-4">
        {/* Verified Socials */}
        {data.hasVerifiedSocials && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-[#10B98133] text-[#10B981] px-3 py-1.5 rounded-lg flex items-center gap-2 text-[13px] font-semibold">
              <Check className="w-4 h-4" />
              Verified Socials
            </div>
            {data.twitter && (
              <a 
                href={data.twitter}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#2D2D2D] border border-[#404040] hover:border-[#CC785C] px-3 py-1.5 rounded-lg flex items-center gap-2 text-[13px] text-[#A0A0A0] hover:text-[#EBEBEB] transition-all"
              >
                <Twitter className="w-4 h-4" />
                Twitter
              </a>
            )}
            {data.telegram && (
              <a 
                href={data.telegram}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#2D2D2D] border border-[#404040] hover:border-[#CC785C] px-3 py-1.5 rounded-lg flex items-center gap-2 text-[13px] text-[#A0A0A0] hover:text-[#EBEBEB] transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                Telegram
              </a>
            )}
          </div>
        )}

        {/* Contract Address */}
        <div className="flex items-center gap-3 bg-[#1F1F1F] p-3 rounded-lg">
          <code className="text-[13px] text-[#737373] font-mono flex-1 truncate">
            {data.contractAddress}
          </code>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 p-2 hover:bg-[#2D2D2D] rounded transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-[#10B981]" />
            ) : (
              <Copy className="w-4 h-4 text-[#737373] hover:text-[#EBEBEB]" />
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
