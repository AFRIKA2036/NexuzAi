const fs = require('fs');
const path = require('path');

/**
 * This script runs during deployment (e.g., on Vercel) to inject 
 * environment variables into the frontend configuration file.
 */

const configPath = path.join(__dirname, 'js', 'supabase-config.js');

try {
  let content = fs.readFileSync(configPath, 'utf8');

  const replacements = {
    '{{SUPABASE_URL}}': process.env.SUPABASE_URL || '',
    '{{SUPABASE_ANON_KEY}}': process.env.SUPABASE_ANON_KEY || '',
    '{{AI_FUNCTION_URL}}': process.env.AI_FUNCTION_URL || '',
    '{{PAYSTACK_PUBLIC_KEY}}': process.env.PAYSTACK_PUBLIC_KEY || ''
  };

  Object.keys(replacements).forEach(placeholder => {
    const value = replacements[placeholder];
    content = content.replace(placeholder, value);
  });

  fs.writeFileSync(configPath, content);
  console.log('✅ Successfully injected environment variables into js/supabase-config.js');
} catch (error) {
  console.error('❌ Failed to inject environment variables:', error.message);
  process.exit(1);
}
