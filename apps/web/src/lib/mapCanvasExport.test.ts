import { describe, expect, it } from 'vitest';
import { MAP_EXPORT_FILENAME } from './mapCanvasExport';

describe('map PNG export', () => {
  it('names the download for the live map share card', () => {
    expect(MAP_EXPORT_FILENAME).toBe('lss-map.png');
  });
});
