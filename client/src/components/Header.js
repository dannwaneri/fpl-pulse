import React, { useState } from 'react';

const Header = () => {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <header className="bg-gradient-to-r from-white to-green-50 shadow-lg py-4 px-4 sm:py-6 sm:px-6 mb-8 border-b border-green-100" role="banner">
      <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between">
        <div 
          className="flex items-center mb-4 sm:mb-0 group transition-all duration-300 hover:scale-105"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          role="presentation"
        >
          <div className="mr-4 relative" aria-hidden="true">
            <svg width="52" height="52" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="FPL Pulse logo">
              {/* Circle background with animated pulse on hover */}
              <circle 
                cx="25" 
                cy="25" 
                r="23" 
                fill="#f0f9ff" 
                stroke="#10b981" 
                strokeWidth="2.5" 
                className={`transition-all duration-500 ${isHovered ? 'animate-pulse' : ''}`}
              />
              
              {/* Pulse line with animated effect */}
              <path 
                d="M7 25 L15 25 L18 15 L23 35 L27 20 L32 28 L36 25 L43 25" 
                stroke="#10b981" 
                strokeWidth="3" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                fill="none" 
                className={`${isHovered ? 'animate-pulse' : ''}`}
              />
              
              {/* Soccer ball icon */}
              <circle cx="25" cy="25" r="5" fill="#f0f9ff" stroke="#10b981" strokeWidth="1.5" />
              <path 
                d="M25 22 L27 24.5 L25 27 L23 24.5 Z" 
                fill="#10b981" 
                stroke="#10b981" 
                strokeWidth="0.5" 
              />
              <path 
                d="M22 23 L23 25.5 L22 28" 
                fill="none" 
                stroke="#10b981" 
                strokeWidth="0.5" 
                strokeLinecap="round" 
              />
              <path 
                d="M28 23 L27 25.5 L28 28" 
                fill="none" 
                stroke="#10b981" 
                strokeWidth="0.5" 
                strokeLinecap="round" 
              />
            </svg>
            {/* Add a subtle glow effect on hover */}
            {isHovered && (
              <div className="absolute inset-0 rounded-full bg-green-400 opacity-20 blur-md"></div>
            )}
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
              <span className="text-green-600 font-extrabold">FPL</span> 
              <span className="relative">
                Pulse
                {isHovered && (
                  <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-green-500 transform origin-left"></span>
                )}
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-green-600 font-medium tracking-wide" role="doc-subtitle">Live Fantasy Premier League Tracker</p>
          </div>
        </div>
        
        {/* Mobile menu button */}
        <div className="sm:hidden flex items-center">
          <button 
            onClick={toggleMenu}
            className="text-gray-700 hover:text-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 p-2"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
            aria-label="Main menu"
          >
            <svg 
              className="h-6 w-6" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor" 
              aria-hidden="true"
            >
              {isMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
        
        {/* Desktop Navigation */}
        <nav className="hidden sm:flex bg-white rounded-full shadow-md px-3 py-2 border border-gray-100" role="navigation" aria-label="Main navigation">
          <NavLink href="#" icon={DashboardIcon} text="My Team" />
          <NavLink href="#" icon={LeagueIcon} text="Leagues" />
          <NavLink href="#" icon={TransferIcon} text="Transfers" />
          <NavLink href="#" icon={StatsIcon} text="Stats" />
        </nav>
        
        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div 
            id="mobile-menu"
            className="w-full mt-4 sm:hidden"
          >
            <div className="flex flex-col space-y-1 bg-white rounded-lg shadow-md px-4 py-3 border border-gray-100">
              <MobileNavLink href="#" icon={DashboardIcon} text="My Team" />
              <MobileNavLink href="#" icon={LeagueIcon} text="Leagues" />
              <MobileNavLink href="#" icon={TransferIcon} text="Transfers" />
              <MobileNavLink href="#" icon={StatsIcon} text="Stats" />
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

// Desktop navigation link component
const NavLink = ({ href, icon: Icon, text }) => (
  <a 
    href={href} 
    className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-green-600 hover:bg-green-50 rounded-full transition-all duration-200 flex items-center mx-1"
    role="menuitem"
    tabIndex="0"
  >
    <Icon className="w-4 h-4 mr-2" aria-hidden="true" />
    {text}
  </a>
);

// Mobile navigation link component
const MobileNavLink = ({ href, icon: Icon, text }) => (
  <a 
    href={href} 
    className="px-3 py-2 text-base font-medium text-gray-700 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all duration-200 flex items-center"
    role="menuitem"
    tabIndex="0"
  >
    <Icon className="w-5 h-5 mr-3" aria-hidden="true" />
    {text}
  </a>
);

// Icon components aligned with app features
const DashboardIcon = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const LeagueIcon = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const TransferIcon = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
  </svg>
);

const StatsIcon = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

export default Header;