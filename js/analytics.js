/**
 * Vercel Web Analytics Integration
 * Initializes Vercel Web Analytics for the application
 */

(function() {
  'use strict';

  // Initialize the analytics queue
  window.va = window.va || function () { 
    (window.vaq = window.vaq || []).push(arguments); 
  };

  // Load the Vercel Analytics script
  function loadAnalytics() {
    // Check if script is already loaded
    const existingScript = document.head.querySelector('script[src*="/_vercel/insights/"]');
    if (existingScript) {
      return;
    }

    const script = document.createElement('script');
    script.src = '/_vercel/insights/script.js';
    script.defer = true;
    
    // Set SDK information
    script.setAttribute('data-sdkn', '@vercel/analytics');
    script.setAttribute('data-sdkv', '2.0.1');
    
    script.onerror = function() {
      console.warn('[Vercel Web Analytics] Failed to load analytics script. Please ensure Web Analytics is enabled in your Vercel project settings.');
    };

    document.head.appendChild(script);
  }

  // Load analytics when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAnalytics);
  } else {
    loadAnalytics();
  }
})();
