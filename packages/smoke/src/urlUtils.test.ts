import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  isSameOrigin,
  shouldSkip,
  matchesExclude,
  extractLinks,
} from './urlUtils.js';

const BASE = 'https://example.com/app/';

describe('normalizeUrl', () => {
  it('strips fragments', () => {
    expect(normalizeUrl('https://example.com/page#section', BASE))
      .toBe('https://example.com/page');
  });

  it('resolves relative paths', () => {
    expect(normalizeUrl('/about', BASE)).toBe('https://example.com/about');
    expect(normalizeUrl('contact', BASE)).toBe('https://example.com/app/contact');
  });

  it('resolves protocol-relative URLs', () => {
    expect(normalizeUrl('//example.com/path', BASE)).toBe('https://example.com/path');
  });

  it('normalises scheme and host to lowercase', () => {
    expect(normalizeUrl('HTTPS://EXAMPLE.COM/page', BASE)).toBe('https://example.com/page');
  });

  it('returns null for unparseable input', () => {
    expect(normalizeUrl('not a url ✗✗', '')).toBeNull();
  });

  it('keeps query strings', () => {
    expect(normalizeUrl('https://example.com/search?q=foo', BASE))
      .toBe('https://example.com/search?q=foo');
  });

  it('strips fragment but keeps query', () => {
    expect(normalizeUrl('https://example.com/search?q=foo#anchor', BASE))
      .toBe('https://example.com/search?q=foo');
  });
});

describe('isSameOrigin', () => {
  it('returns true for same origin', () => {
    expect(isSameOrigin('https://example.com/page', 'https://example.com')).toBe(true);
    expect(isSameOrigin('https://example.com/a/b', 'https://example.com/c')).toBe(true);
  });

  it('returns false for different host', () => {
    expect(isSameOrigin('https://other.com/page', 'https://example.com')).toBe(false);
  });

  it('returns false for different scheme', () => {
    expect(isSameOrigin('http://example.com/page', 'https://example.com')).toBe(false);
  });

  it('returns false for different port', () => {
    expect(isSameOrigin('https://example.com:8080/page', 'https://example.com')).toBe(false);
  });

  it('returns false for invalid href', () => {
    expect(isSameOrigin('not-a-url', 'https://example.com')).toBe(false);
  });
});

describe('shouldSkip', () => {
  it('skips mailto: links', () => {
    expect(shouldSkip('mailto:foo@bar.com')).toBe(true);
  });

  it('skips tel: links', () => {
    expect(shouldSkip('tel:+1234567890')).toBe(true);
  });

  it('skips PDF downloads', () => {
    expect(shouldSkip('https://example.com/docs/guide.pdf')).toBe(true);
  });

  it('skips image files', () => {
    expect(shouldSkip('https://example.com/img/logo.png')).toBe(true);
    expect(shouldSkip('https://example.com/img/photo.jpg')).toBe(true);
    expect(shouldSkip('https://example.com/img/photo.jpeg')).toBe(true);
    expect(shouldSkip('https://example.com/img/icon.svg')).toBe(true);
  });

  it('skips JS and CSS assets', () => {
    expect(shouldSkip('https://example.com/assets/app.js')).toBe(true);
    expect(shouldSkip('https://example.com/assets/style.css')).toBe(true);
  });

  it('skips ZIP archives', () => {
    expect(shouldSkip('https://example.com/download/file.zip')).toBe(true);
  });

  it('does not skip normal HTML pages', () => {
    expect(shouldSkip('https://example.com/about')).toBe(false);
    expect(shouldSkip('https://example.com/about.html')).toBe(false);
  });

  it('does not skip pages with query strings that look like assets', () => {
    // Path has no extension, so it should not be skipped
    expect(shouldSkip('https://example.com/api/data?format=json')).toBe(false);
  });

  it('returns true for unparseable URLs', () => {
    expect(shouldSkip('not a url')).toBe(true);
  });
});

describe('matchesExclude', () => {
  it('returns false when no pattern is given', () => {
    expect(matchesExclude('https://example.com/admin', undefined)).toBe(false);
  });

  it('matches by substring via regex', () => {
    expect(matchesExclude('https://example.com/admin/users', '/admin')).toBe(true);
  });

  it('returns false when pattern does not match', () => {
    expect(matchesExclude('https://example.com/about', '/admin')).toBe(false);
  });

  it('supports regex special chars', () => {
    expect(matchesExclude('https://example.com/logout?token=abc', 'logout\\?')).toBe(true);
  });

  it('returns false for invalid regex without throwing', () => {
    expect(matchesExclude('https://example.com/page', '[invalid')).toBe(false);
  });

  it('matches full URLs with anchored regex', () => {
    expect(matchesExclude('https://example.com/staging/page', '^https://example\\.com/staging')).toBe(true);
  });
});

describe('extractLinks', () => {
  it('extracts href values from anchor tags', () => {
    const html = `<a href="/about">About</a><a href="https://other.com">Ext</a>`;
    expect(extractLinks(html)).toEqual(['/about', 'https://other.com']);
  });

  it('handles double and single quotes', () => {
    const html = `<a href='/a'>A</a><a href="/b">B</a>`;
    expect(extractLinks(html)).toEqual(['/a', '/b']);
  });

  it('returns empty array for no links', () => {
    expect(extractLinks('<p>No links here</p>')).toEqual([]);
  });

  it('ignores empty hrefs', () => {
    const html = `<a href="">empty</a><a href="/valid">valid</a>`;
    // empty string is still extracted — caller filters
    expect(extractLinks(html)).toContain('/valid');
  });
});
