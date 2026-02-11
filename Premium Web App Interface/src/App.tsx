import React from 'react';
import { BrandingColumn } from './components/BrandingColumn';
import { AnalysisInterface } from './components/AnalysisInterface';

export default function App() {
  return (
    <div className="min-h-screen bg-[#1F1F1F]">
      {/* Desktop: 2-column layout */}
      <div className="hidden lg:grid lg:grid-cols-[40%_60%]">
        {/* Left Column - Fixed */}
        <div className="h-screen overflow-hidden">
          <BrandingColumn />
        </div>
        
        {/* Right Column - Scrollable */}
        <div className="h-screen overflow-y-auto">
          <AnalysisInterface />
        </div>
      </div>

      {/* Mobile/Tablet: Continuous stacked layout */}
      <div className="lg:hidden">
        {/* Branding Column - Full section */}
        <BrandingColumn />
        
        {/* Analysis Interface */}
        <div id="analysis-section">
          <AnalysisInterface />
        </div>
      </div>

      {/* Custom Scrollbar Styles */}
      <style>{`
        /* Custom Scrollbar */
        ::-webkit-scrollbar {
          width: 12px;
        }
        
        ::-webkit-scrollbar-track {
          background: #2D2D2D;
        }
        
        ::-webkit-scrollbar-thumb {
          background: #4A4A4A;
          border-radius: 6px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
          background: #CC785C;
        }

        /* Smooth scrolling */
        html {
          scroll-behavior: smooth;
        }

        /* Prevent horizontal scroll */
        body {
          overflow-x: hidden;
        }
      `}</style>
    </div>
  );
}
