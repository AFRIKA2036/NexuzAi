const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFileHelpers() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const context = vm.createContext({
    console,
    ArrayBuffer,
    TextDecoder,
    Uint8Array,
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
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {}
    },
    setInterval() {},
    setTimeout() {},
    Blob,
    URL
  });

  vm.runInContext(
    `${source}\nglobalThis.__fileHelpers = { getFileKind, getFileReadMode, extractFileText, getParsedFileLabel, isLocalProxyUrl };`,
    context
  );
  return context.__fileHelpers;
}

test('classifies supported file types and read modes', () => {
  const helpers = loadFileHelpers();

  assert.equal(helpers.getFileKind({ name: 'notes.txt', type: 'text/plain' }), 'text');
  assert.equal(helpers.getFileReadMode({ name: 'notes.txt', type: 'text/plain' }), 'text');
  assert.equal(helpers.getFileKind({ name: 'resume.docx', type: '' }), 'docx');
  assert.equal(helpers.getFileReadMode({ name: 'resume.docx', type: '' }), 'arrayBuffer');
  assert.equal(helpers.getFileKind({ name: 'contract.pdf', type: 'application/pdf' }), 'pdf');
  assert.equal(helpers.getFileKind({ name: 'unknown.bin', type: 'application/octet-stream' }), 'binary');
});

test('extracts text payloads directly', async () => {
  const helpers = loadFileHelpers();

  const text = await helpers.extractFileText({ name: 'notes.txt', type: 'text/plain' }, 'plain notes');
  assert.equal(text, 'plain notes');
});

test('extracts docx text through injected parser', async () => {
  const helpers = loadFileHelpers();
  const parser = {
    extractRawText({ arrayBuffer }) {
      assert.ok(arrayBuffer instanceof ArrayBuffer);
      return Promise.resolve({ value: 'word text' });
    }
  };

  const text = await helpers.extractFileText(
    { name: 'resume.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    new ArrayBuffer(4),
    { mammoth: parser }
  );

  assert.equal(text, 'word text');
});

test('extracts pdf text through injected parser', async () => {
  const helpers = loadFileHelpers();
  const parser = {
    GlobalWorkerOptions: {},
    getDocument({ data }) {
      assert.ok(data instanceof Uint8Array);
      return {
        promise: Promise.resolve({
          numPages: 2,
          async getPage(pageNumber) {
            return {
              async getTextContent() {
                return { items: [{ str: `page ${pageNumber}` }, { str: 'text' }] };
              }
            };
          }
        })
      };
    }
  };

  const text = await helpers.extractFileText(
    { name: 'contract.pdf', type: 'application/pdf' },
    new ArrayBuffer(4),
    { pdfjsLib: parser }
  );

  assert.equal(text, 'page 1 text\npage 2 text\n');
});
