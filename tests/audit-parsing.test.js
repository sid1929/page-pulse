'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _internal } = require('../src/services/audit');
const { extractTitle, extractMetaDescription, extractHeadingCounts } = _internal;

test('extracts title', () => {
  const html = '<html><head><title>  My Page  </title></head></html>';
  assert.equal(extractTitle(html), 'My Page');
});

test('returns null when no title present', () => {
  assert.equal(extractTitle('<html></html>'), null);
});

test('extracts meta description', () => {
  const html = '<meta name="description" content="A great page about testing">';
  assert.equal(extractMetaDescription(html), 'A great page about testing');
});

test('returns null when no meta description present', () => {
  assert.equal(extractMetaDescription('<html></html>'), null);
});

test('counts headings by level', () => {
  const html = '<h1>A</h1><h2>B</h2><h2>C</h2><h3>D</h3>';
  const counts = extractHeadingCounts(html);
  assert.equal(counts.h1, 1);
  assert.equal(counts.h2, 2);
  assert.equal(counts.h3, 1);
  assert.equal(counts.h4, 0);
});
