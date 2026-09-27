import test from 'node:test';
import assert from 'node:assert/strict';
import { faviconURL, createSiteIcon } from '../icons.js';

const runtime = { id: 'test-extension', getURL: path => `chrome-extension://test-extension${path}` };

test('favicon requests stay inside the extension and encode the exact saved destination', () => {
  const page = 'https://example.com/docs?q=a&other=日本語#section';
  const icon = new URL(faviconURL(page, runtime));
  assert.equal(icon.protocol, 'chrome-extension:');
  assert.equal(icon.hostname, runtime.id);
  assert.equal(icon.pathname, '/_favicon/');
  assert.deepEqual([...icon.searchParams.keys()], ['pageUrl', 'size']);
  assert.equal(icon.searchParams.get('pageUrl'), new URL(page).href);
  assert.equal(icon.searchParams.get('size'), '32');
});

test('preview and invalid destinations never request an external fallback image', () => {
  assert.equal(faviconURL('https://example.com', {}), null);
  for (const page of ['javascript:alert(1)', 'file:///private', 'data:image/png,x', 'https://user:secret@example.com', 'invalid'])
    assert.equal(faviconURL(page, runtime), null);
});

test('icons show initials while loading, replace them on load and retain them on error', t => {
  const created = [];
  class Element extends EventTarget {
    children = [];
    attributes = {};
    setAttribute(name, value) { this.attributes[name] = value; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  globalThis.chrome = { runtime };
  globalThis.document = { createElement: tag => {
    const element = new Element(); element.tag = tag; created.push(element); return element;
  } };
  t.after(() => { delete globalThis.chrome; delete globalThis.document; });
  const icon = createSiteIcon('https://example.com', 'Example', 'site-icon');
  assert.equal(icon.children[0].textContent, 'E');
  assert.equal(icon.attributes['aria-hidden'], 'true');
  const image = created.find(element => element.tag === 'img');
  assert.equal(image.alt, '');
  assert.equal(image.referrerPolicy, 'no-referrer');
  image.dispatchEvent(new Event('load'));
  assert.deepEqual(icon.children, [image]);
  const failed = createSiteIcon('https://unavailable.test', 'Unavailable', 'shortcut-icon');
  created.at(-1).dispatchEvent(new Event('error'));
  assert.equal(failed.children[0].textContent, 'U');
  assert.equal(failed.children.length, 1);
});
