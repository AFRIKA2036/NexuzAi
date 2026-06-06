// ══════════════════════════════════════════════
//  Vercel Speed Insights Initialization
// ══════════════════════════════════════════════

/**
 * Initialize Vercel Speed Insights for performance monitoring
 * This script loads the Speed Insights library and initializes it
 * to track Core Web Vitals and other performance metrics.
 */

(function initSpeedInsights() {
  'use strict';

  // Only run in production (when deployed to Vercel)
  const isDevelopment = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1';
  
  if (isDevelopment) {
    console.log('[Speed Insights] Development mode - tracking disabled');
    return;
  }

  // Initialize the Speed Insights queue
  window.si = window.si || function() {
    (window.siq = window.siq || []).push(arguments);
  };

  // Load the Speed Insights script
  const script = document.createElement('script');
  script.src = 'https://va.vercel-scripts.com/v1/speed-insights/script.js';
  script.defer = true;
  script.setAttribute('data-sdkn', '@vercel/speed-insights');
  script.setAttribute('data-sdkv', '2.0.0');
  
  // Add error handling
  script.onerror = function() {
    console.warn('[Speed Insights] Failed to load script');
  };

  script.onload = function() {
    console.log('[Speed Insights] Initialized successfully');
  };

  // Append to head
  document.head.appendChild(script);
})();
