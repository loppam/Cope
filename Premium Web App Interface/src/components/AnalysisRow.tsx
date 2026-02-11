import React from 'react';
import { motion } from 'motion/react';
import { 
  Target, 
  UserCircle, 
  Users, 
  TrendingUp, 
  Sparkles, 
  Activity, 
  BookOpen, 
  Globe,
  Check,
  AlertTriangle,
  X,
  Loader2,
  LucideIcon
} from 'lucide-react';

interface AnalysisRowProps {
  data: {
    id: string;
    icon: string;
    label: string;
    reason: string;
    status: 'safe' | 'warning' | 'danger' | 'info';
    statusText: string | null;
    concentration?: string;
    percentage?: string;
    details?: string;
    links?: Array<{ platform: string; url: string; followers?: string; members?: string }>;
  };
  isAnalyzing: boolean;
  delay: number;
}

const iconMap: Record<string, LucideIcon> = {
  Target,
  UserCircle,
  Users,
  TrendingUp,
  Sparkles,
  Activity,
  BookOpen,
  Globe
};

const statusConfig = {
  safe: {
    bg: 'bg-[#10B98120]',
    border: 'border-[#10B98140]',
    text: 'text-[#10B981]',
    icon: Check,
    glow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]'
  },
  warning: {
    bg: 'bg-[#F59E0B20]',
    border: 'border-[#F59E0B40]',
    text: 'text-[#F59E0B]',
    icon: AlertTriangle,
    glow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]'
  },
  danger: {
    bg: 'bg-[#EF444420]',
    border: 'border-[#EF444440]',
    text: 'text-[#EF4444]',
    icon: X,
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.3)]'
  },
  info: {
    bg: 'bg-transparent',
    border: 'border-transparent',
    text: 'text-[#A0A0A0]',
    icon: null,
    glow: ''
  }
};

export function AnalysisRow({ data, isAnalyzing, delay }: AnalysisRowProps) {
  // Safety checks
  if (!data) return null;
  
  const Icon = iconMap[data.icon] || Target; // Fallback to Target if icon not found
  const config = statusConfig[data.status] || statusConfig.info;
  const StatusIcon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ 
        delay,
        duration: 0.5, 
        ease: [0.4, 0, 0.2, 1] 
      }}
      className={`bg-[#2D2D2D] border rounded-xl p-4 sm:p-6 shadow-[0_4px_12px_rgba(0,0,0,0.3)] ${
        isAnalyzing ? 'border-[#CC785C] animate-pulse' : 'border-[#404040]'
      }`}
    >
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4 sm:gap-6">
        {/* Left Side */}
        <div className="flex items-start gap-3 sm:gap-4 flex-1 w-full">
          {isAnalyzing ? (
            <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 text-[#CC785C] animate-spin flex-shrink-0 mt-1" />
          ) : (
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-[#CC785C] flex-shrink-0 mt-1" />
          )}
          
          <div className="flex-1 min-w-0">
            <div className="text-[14px] sm:text-[15px] font-medium text-[#A0A0A0] mb-2 flex items-center gap-2 flex-wrap">
              {data.label}
              {isAnalyzing && (
                <span className="text-[12px] sm:text-[13px] text-[#737373] italic">Analyzing...</span>
              )}
            </div>
            
            {!isAnalyzing && (
              <>
                <p className="text-[12px] sm:text-[13px] text-[#737373] leading-[1.5] italic break-words overflow-wrap-anywhere max-w-full">
                  {data.reason}
                </p>
                
                {/* Links for social presence */}
                {data.links && data.links.length > 0 && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {data.links.map((link) => (
                      <a
                        key={link.platform}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-[#3A3A3A] hover:bg-[#404040] border border-[#4A4A4A] hover:border-[#CC785C] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-[12px] text-[#A0A0A0] hover:text-[#EBEBEB] transition-all"
                      >
                        {link.platform} {link.followers && `• ${link.followers}`} {link.members && `• ${link.members}`}
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Side - Status Badge */}
        {!isAnalyzing && data.statusText && (
          <div className={`${config.bg} ${config.border} ${config.text} border rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-center sm:justify-start ${config.glow}`}>
            {StatusIcon && <StatusIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            <span className="text-[12px] sm:text-[14px] font-semibold whitespace-nowrap">
              {data.statusText}
              {data.concentration && ` • ${data.concentration}`}
              {data.percentage && ` • ${data.percentage}`}
            </span>
          </div>
        )}
      </div>
      
      {!isAnalyzing && data.details && (
        <div className="mt-3 text-[11px] sm:text-[12px] text-[#737373] pl-8 sm:pl-10">
          {data.details}
        </div>
      )}
    </motion.div>
  );
}
