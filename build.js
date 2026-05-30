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
  console.log(`🎊 Build complete! Injected ${replacedCount} variables.`);
  
} catch (error) {
  console.error('💥 Build Failed:', error.message);
  process.exit(1);
}
