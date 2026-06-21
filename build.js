const fs = require('node:fs');
const path = require('node:path');

const rootDir = __dirname;
const outputDir = path.join(rootDir, 'dist');
const configPath = path.join(outputDir, 'js', 'supabase-config.js');

const staticEntries = [
  'index.html',
  'admin',
  'css',
  'js',
  'docs',
  'sitemap.xml',
  'robots.txt',
  'images',
  'favicon.png'
];

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

function injectPublicConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  const replacements = {
    '{{SUPABASE_URL}}': process.env.SUPABASE_URL || '',
    '{{SUPABASE_ANON_KEY}}': process.env.SUPABASE_ANON_KEY || '',
    '{{AI_FUNCTION_URL}}': process.env.AI_FUNCTION_URL || '',
    '{{PAYSTACK_PUBLIC_KEY}}': process.env.PAYSTACK_PUBLIC_KEY || ''
  };

  const recommended = ['{{SUPABASE_URL}}', '{{SUPABASE_ANON_KEY}}'];
  const missing = recommended
    .filter((placeholder) => replacements[placeholder] === '')
    .map((placeholder) => placeholder.slice(2, -2));

  if (missing.length > 0) {
    console.warn(`Missing public environment variables: ${missing.join(', ')}.`);
    console.warn('Continuing build with demo-mode placeholders blank.');
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
