const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApp(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const context = vm.createContext({
    console,
    ArrayBuffer,
    Blob,
    fetch: fetchImpl,
    getSupabaseAccessToken: async () => null,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {}
    },
    ReadableStream,
    Response,
    setInterval() {},
    setTimeout,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    window: {
      CONFIG: null,
      addEventListener() {}
    },
    document: {
      addEventListener() {},
      querySelectorAll() {
        return [];
      }
    },
    AGENTS: {
      email: { fallbacks: ['test/model'] }
    }
  });

  vm.runInContext(
    `${source}\nglobalThis.__api = { callAIAPI, state, CONFIG };`,
    context
  );
  return context.__api;
}

test('callAIAPI propagates streamed provider errors', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"provider exploded"}}\n\n'));
      controller.close();
    }
  });

  const api = loadApp(async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  }));

  api.state.currentAgent = 'email';
  api.state.user = { email: 'test@example.com' };
  api.CONFIG.useLocal = true;

  await assert.rejects(
    () => api.callAIAPI('system', 'user'),
    /provider exploded/
  );
});
