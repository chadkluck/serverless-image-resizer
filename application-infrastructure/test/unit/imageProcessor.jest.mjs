/**
 * Unit tests for utils/imageProcessor.js
 *
 * Since Sharp is a native module provided via Lambda Layer and may not be
 * installed in the test environment, we mock it using jest.unstable_mockModule.
 * The mock simulates Sharp's fluent API and calculates expected resized
 * dimensions to verify aspect ratio preservation and tier selection logic.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 4.1
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/** Mutable state that controls the mock's behaviour per test. */
let mockOrigWidth = 4000;
let mockOrigHeight = 2667;
let mockOrigFormat = 'jpeg';

/**
 * Calculate output dimensions given resize options and the current mock originals.
 */
function calcDimensions(resizeOpts) {
  if (!resizeOpts) return { width: mockOrigWidth, height: mockOrigHeight };

  const ratio = mockOrigWidth / mockOrigHeight;

  if (resizeOpts.width && !resizeOpts.height) {
    return {
      width: resizeOpts.width,
      height: Math.round(resizeOpts.width / ratio)
    };
  }
  if (resizeOpts.height && !resizeOpts.width) {
    return {
      width: Math.round(resizeOpts.height * ratio),
      height: resizeOpts.height
    };
  }
  return { width: mockOrigWidth, height: mockOrigHeight };
}

/**
 * Create a fluent Sharp instance mock. Each call to sharp(buffer) returns a
 * fresh chainable object that tracks resize/format state.
 */
function createSharpInstance() {
  let resizeOpts = null;
  let isWebp = false;

  const instance = {
    metadata: jest.fn(async () => {
      const dims = calcDimensions(resizeOpts);
      return { width: dims.width, height: dims.height, format: mockOrigFormat };
    }),
    resize: jest.fn((opts) => {
      resizeOpts = opts;
      return instance;
    }),
    toFormat: jest.fn(() => instance),
    webp: jest.fn(() => {
      isWebp = true;
      return instance;
    }),
    toBuffer: jest.fn(async () => {
      const dims = calcDimensions(resizeOpts);
      return Buffer.from(JSON.stringify({ w: dims.width, h: dims.height, webp: isWebp }));
    })
  };

  return instance;
}

// Register the sharp mock before importing imageProcessor
jest.unstable_mockModule('sharp', () => ({
  __esModule: true,
  default: jest.fn(() => createSharpInstance())
}));

// Dynamic import AFTER mock registration
const { resizeImage } = await import(
  '../../src/lambda/functions/processor/utils/imageProcessor.js'
);

/** Default size tiers matching settings.js */
const DEFAULT_SIZES = {
  xxLarge: 3000,
  xLarge: 1920,
  large: 1000,
  medium: 800,
  small: 500,
  thumb: 250
};

describe('imageProcessor – resizeImage', () => {
  beforeEach(() => {
    // Reset to defaults; individual tests override as needed
    mockOrigWidth = 4000;
    mockOrigHeight = 2667;
    mockOrigFormat = 'jpeg';
  });

  // ---------------------------------------------------------------
  // Test 1: Image larger than all tiers → generates all 6 sizes
  // ---------------------------------------------------------------
  describe('image larger than all tiers', () => {
    it('should generate all 6 resized images when original exceeds every threshold', async () => {
      mockOrigWidth = 4000;
      mockOrigHeight = 2667;

      const result = await resizeImage(Buffer.from('fake'), 'jpg', DEFAULT_SIZES, false);

      expect(result.resizedImages).toHaveLength(6);

      const names = result.resizedImages.map((r) => r.sizeName);
      expect(names).toEqual(['thumb', 'small', 'medium', 'large', 'xLarge', 'xxLarge']);
    });
  });

  // ---------------------------------------------------------------
  // Test 2: Image smaller than some tiers → skip larger tiers
  // ---------------------------------------------------------------
  describe('image smaller than some tiers', () => {
    it('should generate sizes up to the first too-small tier and skip larger', async () => {
      // Long side 900 → thumb ✓, small ✓, medium ✓, large → original dims, skip xLarge & xxLarge
      mockOrigWidth = 900;
      mockOrigHeight = 600;

      const result = await resizeImage(Buffer.from('fake'), 'jpg', DEFAULT_SIZES, false);

      expect(result.resizedImages).toHaveLength(4);

      const names = result.resizedImages.map((r) => r.sizeName);
      expect(names).toEqual(['thumb', 'small', 'medium', 'large']);
    });
  });

  // ---------------------------------------------------------------
  // Test 3: Image smaller than smallest tier (thumb=250)
  // ---------------------------------------------------------------
  describe('image smaller than smallest tier', () => {
    it('should generate only thumb at original dimensions', async () => {
      mockOrigWidth = 200;
      mockOrigHeight = 150;

      const result = await resizeImage(Buffer.from('tiny'), 'png', DEFAULT_SIZES, false);

      expect(result.resizedImages).toHaveLength(1);
      expect(result.resizedImages[0].sizeName).toBe('thumb');
    });
  });

  // ---------------------------------------------------------------
  // Test 4: Format retention – jpg stays jpg, png stays png
  // ---------------------------------------------------------------
  describe('format retention', () => {
    it('should retain jpg format for a jpg input', async () => {
      mockOrigWidth = 4000;
      mockOrigHeight = 3000;
      mockOrigFormat = 'jpeg';

      const result = await resizeImage(Buffer.from('jpg'), 'jpg', DEFAULT_SIZES, false);

      for (const img of result.resizedImages) {
        expect(img.format).toBe('jpg');
      }
    });

    it('should retain png format for a png input', async () => {
      mockOrigWidth = 4000;
      mockOrigHeight = 3000;
      mockOrigFormat = 'png';

      const result = await resizeImage(Buffer.from('png'), 'png', DEFAULT_SIZES, false);

      for (const img of result.resizedImages) {
        expect(img.format).toBe('png');
      }
    });
  });

  // ---------------------------------------------------------------
  // Test 5: WebP toggle
  // ---------------------------------------------------------------
  describe('WebP toggle', () => {
    it('should populate webpImages when createWebp is true', async () => {
      mockOrigWidth = 4000;
      mockOrigHeight = 2667;

      const result = await resizeImage(Buffer.from('webp-test'), 'jpg', DEFAULT_SIZES, true);

      expect(result.webpImages.length).toBe(result.resizedImages.length);
      expect(result.webpImages.length).toBeGreaterThan(0);
    });

    it('should return empty webpImages when createWebp is false', async () => {
      mockOrigWidth = 4000;
      mockOrigHeight = 2667;

      const result = await resizeImage(Buffer.from('no-webp'), 'jpg', DEFAULT_SIZES, false);

      expect(result.webpImages).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // Test 6: Aspect ratio maintained
  // ---------------------------------------------------------------
  describe('aspect ratio preservation', () => {
    it('should maintain aspect ratio for landscape images (width > height)', async () => {
      mockOrigWidth = 4000;
      mockOrigHeight = 2500;

      const result = await resizeImage(Buffer.from('landscape'), 'jpg', DEFAULT_SIZES, false);
      const originalRatio = mockOrigWidth / mockOrigHeight;

      for (const img of result.resizedImages) {
        const imgRatio = img.width / img.height;
        expect(Math.abs(imgRatio - originalRatio)).toBeLessThanOrEqual(0.01);
      }
    });

    it('should maintain aspect ratio for portrait images (height > width)', async () => {
      mockOrigWidth = 2000;
      mockOrigHeight = 3500;

      const result = await resizeImage(Buffer.from('portrait'), 'jpg', DEFAULT_SIZES, false);
      const originalRatio = mockOrigWidth / mockOrigHeight;

      for (const img of result.resizedImages) {
        const imgRatio = img.width / img.height;
        expect(Math.abs(imgRatio - originalRatio)).toBeLessThanOrEqual(0.01);
      }
    });
  });
});
