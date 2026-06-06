const fs = require('node:fs');
const path = require('node:path');

const rootDir = __dirname;
const outputDir = path.join(rootDir, 'dist');
const configPath = path.join(outputDir, 'js', 'supabase-config.js');
const envPath = path.join(rootDir, '.env');

const staticEntries = [
  'index.html',
  'css',
  'js',
  'admin',
  'docs'
];

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }

  return '';
}

function loadLocalEnv() {
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[match[1]] = value;
  }
}

function assertInsideRoot(targetPath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project root: ${resolvedTarget}`);
  }
}

function copyEntry(entry) {
  const source = path.join(rootDir, entry);
  const destination = path.join(outputDir, entry);

  if (!fs.existsSync(source)) {
    throw new Error(`Build source not found: ${source}`);
  }

  fs.cpSync(source, destination, { recursive: true });
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function supabaseProjectRef(url) {
  const match = String(url || '').match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
  return match?.[1] || '';
}

function validatePublicConfig(replacements) {
  const supabaseUrl = replacements['{{SUPABASE_URL}}'];
  const supabaseAnonKey = replacements['{{SUPABASE_ANON_KEY}}'];
  const missing = [];
  const errors = [];
  const warnings = [];

  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');

  const isProductionBuild = process.env.VERCEL || process.env.CI;
  if (missing.length > 0) {
    const message = `Missing public environment variables: ${missing.join(', ')}.`;
    if (isProductionBuild) {
      errors.push(`${message} Add them in Vercel Project Settings > Environment Variables.`);
    } else {
      warnings.push(message);
      warnings.push('Continuing local build with demo-mode placeholders blank.');
    }
  }

  const projectRef = supabaseProjectRef(supabaseUrl);
  if (supabaseUrl && !projectRef) {
    errors.push('SUPABASE_URL must look like https://YOUR_PROJECT_REF.supabase.co.');
  }

  if (supabaseAnonKey) {
    if (/service[_-]?role/i.test(supabaseAnonKey) || /^sb_secret_/i.test(supabaseAnonKey)) {
      errors.push('SUPABASE_ANON_KEY must be a browser-safe anon/publishable key, not a service-role or secret key.');
    } else if (/^sb_publishable_/i.test(supabaseAnonKey)) {
      warnings.push('Using a Supabase publishable key for browser auth.');
    } else {
      const payload = decodeJwtPayload(supabaseAnonKey);
      if (!payload) {
        errors.push('SUPABASE_ANON_KEY must be a valid Supabase anon JWT or publishable key.');
      } else {
        if (payload.role !== 'anon') {
          errors.push(`SUPABASE_ANON_KEY JWT role must be "anon"; received "${payload.role || 'unknown'}".`);
        }
        if (projectRef && payload.ref && payload.ref !== projectRef) {
          errors.push(`SUPABASE_ANON_KEY belongs to project "${payload.ref}", but SUPABASE_URL points to "${projectRef}".`);
        }
      }
    }
  }

  return { errors, warnings };
}

function injectPublicConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  const replacements = {
    '{{SUPABASE_URL}}': firstEnv('SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    '{{SUPABASE_ANON_KEY}}': firstEnv(
      'SUPABASE_ANON_KEY',
      'SUPABASE_PUBLIC_ANON_KEY',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY'
    ),
    '{{AI_FUNCTION_URL}}': firstEnv('AI_FUNCTION_URL', 'VITE_AI_FUNCTION_URL', 'NEXT_PUBLIC_AI_FUNCTION_URL'),
    '{{PAYSTACK_PUBLIC_KEY}}': firstEnv('PAYSTACK_PUBLIC_KEY', 'VITE_PAYSTACK_PUBLIC_KEY', 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY')
  };

  const validation = validatePublicConfig(replacements);
  for (const warning of validation.warnings) console.warn(warning);
  if (validation.errors.length > 0) {
    console.error('Invalid public Supabase configuration:');
    for (const error of validation.errors) console.error(`- ${error}`);
    console.error('Accepted Supabase names: SUPABASE_URL + SUPABASE_ANON_KEY, SUPABASE_PUBLIC_ANON_KEY, VITE_SUPABASE_*, or NEXT_PUBLIC_SUPABASE_*.');
    throw new Error('Invalid public Supabase configuration.');
  }

  let content = fs.readFileSync(configPath, 'utf8');
  let replacedCount = 0;

  for (const [placeholder, value] of Object.entries(replacements)) {
    if (content.includes(placeholder)) {
      content = content.split(placeholder).join(value);
      replacedCount += 1;
    }
  }

  fs.writeFileSync(configPath, content);
  console.log(`Injected ${replacedCount} public config values into ${path.relative(rootDir, configPath)}.`);
}

function build() {
  loadLocalEnv();
  assertInsideRoot(outputDir);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const entry of staticEntries) {
    copyEntry(entry);
  }

  injectPublicConfig();
  console.log(`Static build complete: ${path.relative(rootDir, outputDir)}`);
}

try {
  build();
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exit(1);
}
