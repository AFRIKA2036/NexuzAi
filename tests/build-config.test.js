const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function testJwt(payload) {
  const encode = (value) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url');

  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode(payload),
    'test-signature'
  ].join('.');
}

test('build injects common Vercel public Supabase env names', () => {
  const rootDir = path.join(__dirname, '..');
  const anonKey = testJwt({ iss: 'supabase', ref: 'vite-test', role: 'anon' });
  const result = spawnSync(process.execPath, ['build.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      VITE_SUPABASE_URL: 'https://vite-test.supabase.co',
      VITE_SUPABASE_ANON_KEY: anonKey
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const config = fs.readFileSync(
    path.join(rootDir, 'dist', 'js', 'supabase-config.js'),
    'utf8'
  );

  assert.match(config, /https:\/\/vite-test\.supabase\.co/);
  assert.match(config, new RegExp(anonKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('vercel build fails when public Supabase config is missing', () => {
  const rootDir = path.join(__dirname, '..');
  const result = spawnSync(process.execPath, ['build.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      VERCEL: '1',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ''
    },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing public environment variables: SUPABASE_URL, SUPABASE_ANON_KEY/);
});

test('build rejects anon JWTs for a different Supabase project', () => {
  const rootDir = path.join(__dirname, '..');
  const result = spawnSync(process.execPath, ['build.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      SUPABASE_URL: 'https://correct-project.supabase.co',
      SUPABASE_ANON_KEY: testJwt({ iss: 'supabase', ref: 'wrong-project', role: 'anon' })
    },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /belongs to project "wrong-project"/);
});

test('build rejects service-role JWTs in browser config', () => {
  const rootDir = path.join(__dirname, '..');
  const result = spawnSync(process.execPath, ['build.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      SUPABASE_URL: 'https://vite-test.supabase.co',
      SUPABASE_ANON_KEY: testJwt({ iss: 'supabase', ref: 'vite-test', role: 'service_role' })
    },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /role must be "anon"/);
});
