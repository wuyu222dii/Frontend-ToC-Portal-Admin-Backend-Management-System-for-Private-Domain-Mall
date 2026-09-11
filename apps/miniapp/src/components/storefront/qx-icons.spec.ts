import { describe, expect, it } from 'vitest';

import { qxIconImageSrc } from './qx-icons';

describe('qxIconImageSrc', () => {
  it('tints the SVG stroke for WeChat image rendering', () => {
    const src = qxIconImageSrc('warning', '#b84848');

    expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(src)).toContain('stroke="#b84848"');
    expect(decodeURIComponent(src)).not.toContain('stroke="#000"');
  });

  it('rejects non-hex colors so the SVG stays valid', () => {
    const src = qxIconImageSrc('home', 'url(javascript:alert(1))');

    expect(decodeURIComponent(src)).toContain('stroke="#6B6458"');
  });
});
