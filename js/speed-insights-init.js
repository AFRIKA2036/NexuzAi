/**
 * Vercel Speed Insights Initialization
 * This script initializes Vercel Speed Insights for performance monitoring
 */

(function() {
  'use strict';

  // Initialize the Speed Insights queue
  function initQueue() {
    if (window.si) return;
    window.si = function() {
      (window.siq = window.siq || []).push(arguments);
    };
  }

  // Inject the Speed Insights script
  function injectSpeedInsights() {
    // Don't run in development
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.log('[Speed Insights] Skipping in development mode');
      return;
    }

    initQueue();

    // Check if script is already loaded
    const scriptSrc = '/_vercel/speed-insights/script.js';
    if (document.head.querySelector(`script[src*="${scriptSrc}"]`)) {
      return;
    }

    // Create and inject the script
    const script = document.createElement('script');
    script.src = scriptSrc;
    script.defer = true;
    script.dataset.sdkn = '@vercel/speed-insights';
    script.dataset.sdkv = '2.0.0';

    script.onerror = function() {
      console.log('[Vercel Speed Insights] Failed to load script. Please check if any content blockers are enabled.');
    };

    document.head.appendChild(script);
    console.log('[Speed Insights] Initialized successfully');
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSpeedInsights);
  } else {
    injectSpeedInsights();
  }
})();
