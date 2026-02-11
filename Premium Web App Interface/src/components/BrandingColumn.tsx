import React from "react";
import { Brain, Target, Shield, Zap, ArrowDown } from "lucide-react";
import { motion } from "motion/react";

const features = [
  {
    icon: Brain,
    title: "Real-Time On-Chain Data",
    description: "Live analysis from Solana blockchain via Helius RPC",
  },
  {
    icon: Target,
    title: "Market Cap Predictions",
    description: "AI-driven forecasts with probability assessments",
  },
  {
    icon: Shield,
    title: "Risk Assessment",
    description: "Bundle detection, holder analysis, and rug pull indicators",
  },
  {
    icon: Zap,
    title: "5-Second Analysis",
    description: "Get comprehensive insights in under 5 seconds",
  },
];

export function BrandingColumn() {
  const scrollToAnalysis = () => {
    const analysisSection = document.getElementById("analysis-section");
    if (analysisSection) {
      analysisSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="bg-gradient-to-b from-[#1A1A1A] to-[#1F1F1F] px-12 py-10 min-h-screen lg:h-[100vh] lg:sticky lg:top-0 flex flex-col overflow-hidden lg:px-12 md:px-8 sm:px-6">
      {/* Logo & Header */}
      <div className="flex flex-col gap-3 flex-shrink-0">
        <h1
          className="text-[24px] sm:text-[28px] lg:text-[32px] font-bold text-[#EBEBEB] tracking-tight"
          style={{
            letterSpacing: "-0.5px",
            textShadow: "0 0 20px rgba(204, 120, 92, 0.3)",
          }}
        >
          Claude Trench Scanner
        </h1>

        <motion.div
          className="inline-block"
          animate={{
            opacity: [1, 0.8, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <div className="bg-gradient-to-br from-[#CC785C] to-[#B86A4F] px-3.5 py-1.5 rounded-full w-fit">
            <span
              className="text-[11px] font-bold uppercase text-white"
              style={{ letterSpacing: "1px" }}
            >
              Claude AI-Powered Analysis
            </span>
          </div>
        </motion.div>
      </div>

      {/* Tagline */}
      <div className="flex flex-col gap-3 sm:gap-4 flex-shrink-0">
        <p className="text-[16px] sm:text-[18px] lg:text-[20px] text-[#A0A0A0] leading-[1.5]">
          Analyze tokens before you buy
        </p>
        <p className="text-[13px] sm:text-[14px] lg:text-[15px] text-[#737373] leading-[1.6]">
          Evaluate high-risk assets and estimate their probability of positive
          performance
        </p>
      </div>

      {/* Feature Highlights */}
      <div className="flex flex-col gap-4 sm:gap-6 flex-1 min-h-0 overflow-y-auto">
        {features.map((feature, index) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-[#2D2D2D] border border-[#404040] rounded-xl p-4 sm:p-5 flex gap-3 sm:gap-4 items-start hover:border-[#CC785C] transition-all duration-300 flex-shrink-0"
          >
            <div className="flex-shrink-0">
              <feature.icon className="w-5 h-5 sm:w-6 sm:h-6 text-[#CC785C]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] sm:text-[14px] font-semibold text-[#EBEBEB]">
                {feature.title}
              </h3>
              <p className="text-[12px] sm:text-[13px] text-[#737373] mt-1">
                {feature.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* CTA Button for Mobile/Tablet */}
      <div className="flex-shrink-0 lg:hidden">
        <motion.button
          onClick={scrollToAnalysis}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full bg-gradient-to-br from-[#CC785C] to-[#B86A4F] text-white px-6 py-4 mt-4 rounded-xl text-[16px] font-semibold hover:shadow-[0_8px_24px_rgba(204,120,92,0.4)] transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
        >
          <span>Analyze Token</span>
          <ArrowDown className="w-5 h-5" />
        </motion.button>
      </div>

      {/* Tech Stack Badge - More Prominent */}
      <div className="flex-shrink-0 pt-8 sm:pt-12 border-t border-[#333333]">
        <motion.div
          className="bg-gradient-to-br from-[#2D2D2D] to-[#1F1F1F] border border-[#CC785C] rounded-xl p-3 sm:p-4 shadow-[0_4px_12px_rgba(204,120,92,0.2)]"
          whileHover={{ scale: 1.02 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex flex-col gap-1">
            <p className="text-[12px] sm:text-[13px] text-[#A0A0A0] flex items-center justify-center">
              <span>Powered by</span>
            </p>
            <p className="text-[14px] sm:text-[16px] font-bold text-[#CC785C] flex items-center justify-center">
              <span className="tracking-wide">Claude AI</span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
