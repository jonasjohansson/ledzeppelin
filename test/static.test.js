import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentType } from '../server/static.js';
test('contentType maps common extensions', () => {
  assert.equal(contentType('a.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('a.glsl'), 'text/plain; charset=utf-8');
  assert.equal(contentType('a.json'), 'application/json; charset=utf-8');
  assert.equal(contentType('a.unknown'), 'application/octet-stream');
});
