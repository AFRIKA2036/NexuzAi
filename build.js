const fs = require('fs');
const path = require('path');

/**
 * This script runs during deployment (e.g., on Vercel) to inject 
 * environment variables into the frontend configuration file.
 */

const configPath = path.join(__dirname, 'js', 'supabase-config.js');

try {
  console.log('🚀 Starting environment variable injection...');
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  let content = fs.readFileSync(configPath, 'utf8');

  // Define required variables for the app to function
  const required = ['SUPABASE_ANON_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('Please add these to your Vercel Project Settings > Environment Variables.');
    process.exit(1);
  }

  const replacements = {
    '{{SUPABASE_URL}}': process.env.SUPABASE_URL,
    '{{SUPABASE_ANON_KEY}}': process.env.SUPABASE_ANON_KEY,
    '{{AI_FUNCTION_URL}}': process.env.AI_FUNCTION_URL || '',
    '{{PAYSTACK_PUBLIC_KEY}}': process.env.PAYSTACK_PUBLIC_KEY || ''
  };

  let replacedCount = 0;
  Object.keys(replacements).forEach(placeholder => {
    const value = replacements[placeholder];
    // Use a regex with the 'g' flag to replace all occurrences
    const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    
    if (content.includes(placeholder)) {
      content = content.replace(regex, value);
      console.log(`✅ Injected: ${placeholder.replace('{{', '').replace('}}', '')}`);
      replacedCount++;
    }
  });

  fs.writeFileSync(configPath, content);
  console.log(`✅ Config injection complete! Injected ${replacedCount} variables.`);

  // --- MINIFICATION PHASE ---
  console.log('📦 Starting asset optimization...');
  const jsDir = path.join(__dirname, 'js');
  const filesToMinify = ['app.js', 'agents.js', 'supabase-service.js'];

  filesToMinify.forEach(file => {
    const filePath = path.join(jsDir, file);
    if (fs.existsSync(filePath)) {
      const original = fs.readFileSync(filePath, 'utf8');
      
      // Basic regex minification (Remove comments and extra whitespace)
      const minified = original
        .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1') 
        .replace(/\s+/g, ' ')
        .trim();

      fs.writeFileSync(filePath, minified);
      const ratio = ((1 - minified.length / original.length) * 100).toFixed(1);
      console.log(`✨ Optimized ${file}: Reduced by ${ratio}%`);
    }
  });

  console.log(`🎊 Build complete! Optimized ${filesToMinify.length} assets.`);
  
} catch (error) {
  console.error('💥 Build Failed:', error.message);
  process.exit(1);
}
