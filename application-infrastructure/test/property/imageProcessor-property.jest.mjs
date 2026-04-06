/**
 * Property-based tests for utils/imageProcessor.js
 *
 * Feature: 0-0-1-initial-project, Properties 2, 3, 4
 *
 * Property 2: Image resize tier selection and skip logic
 * Property 3: Aspect ratio preservation
 * Property 4: Output format retention
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * Uses fast-check to generate random image dimensions and formats, then
 * verifies tier selection, aspect ratio preservation, and format retention
 * across many inputs.
 *
 * Sharp is mocked via jest.unstable_mockModule since it is provided by a
 * Lambda Layer and is not installed in the test environment.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mutable state controlling the Sharp mock per test run
// ---------------------------------------------------------------------------

let mockOrigWidth = 4000;
let mockOrigHeight = 2667;
let mockOrigFormat = 'jpeg';

/**
 * Calculate output dimensions given resize options and the current mock
 * originals, replicating Sharp's default behaviour (resize by one axis,
 * derive the other proportionally).
 *
 * @param {Object|null} resizeOpts - Sharp resize options
 * @returns {{width: number, height: number}} Calculated dimensions
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
 * Try to parse encoded dimensions from a buffer produced by a previous
 * toBuffer() call. Returns null if the buffer is not an encoded mock buffer.
 *
 * @param {Buffer} buf - Buffer to inspect
 * @returns {{w: number, h: number}|null} Parsed dimensions or null
 */
function tryParseEncodedDims(buf) {
  try {
    const str = buf.toString('utf8');
    const obj = JSON.parse(str);
    if (typeof obj.w === 'number' && typeof obj.h === 'number') {
      return obj;
    }
  } catch {
    // Not an encoded buffer — treat as raw image data
  }
  return null;
}

/**
 * Create a fluent Sharp instance mock that tracks resize/format state.
 * When the input buffer contains encoded dimensions (from a prior toBuffer),
 * metadata() returns those dimensions instead of the global originals.
 *
 * @param {Buffer|null} inputBuffer - Buffer passed to sharp()
 * @returns {Object} Chainable Sharp-like instance
 */
function createSharpInstance(inputBuffer) {
  let resizeOpts = null;

  // If the buffer was produced by a previous toBuffer(), extract the
  // encoded dimensions so metadata() returns the correct values.
  const encoded = inputBuffer ? tryParseEncodedDims(inputBuffer) : null;
  const baseWidth = encoded ? encoded.w : mockOrigWidth;
  const baseHeight = encoded ? encoded.h : mockOrigHeight;

  /**
   * Calculate dimensions using the instance's base (which may come from
   * an encoded buffer) and any resize options applied to this instance.
   */
  function instanceDims() {
    if (!resizeOpts) return { width: baseWidth, height: baseHeight };

    const ratio = baseWidth / baseHeight;

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
    return { width: baseWidth, height: baseHeight };
  }

  const instance = {
    metadata: jest.fn(async () => {
      const dims = instanceDims();
      return { width: dims.width, height: dims.height, format: mockOrigFormat };
    }),
    resize: jest.fn((opts) => {
      resizeOpts = opts;
      return instance;
    }),
    toFormat: jest.fn(() => instance),
    webp: jest.fn(() => instance),
    toBuffer: jest.fn(async () => {
      const dims = instanceDims();
      return Buffer.from(JSON.stringify({ w: dims.width, h: dims.height }));
    })
  };

  return instance;
}

// Register the sharp mock before importing imageProcessor.
// The mock's default export receives the buffer argument so it can detect
// encoded dimensions from a prior toBuffer() call.
jest.unstable_mockModule('sharp', () => ({
  __esModule: true,
  default: jest.fn((buf) => createSharpInstance(buf))
}));

// Dynamic import AFTER mock registration
const { resizeImage } = await import(
  '../../src/lambda/functions/processor/utils/imageProcessor.js'
);

/** Default size tiers matching settings.js (ascending order). */
const DEFAULT_SIZES = {
  xxLarge: 3000,
  xLarge: 1920,
  large: 1000,
  medium: 800,
  small: 500,
  thumb: 250
};

/** Tier names in ascending order (matches SIZE_TIERS_ASC in imageProcessor). */
const TIER_NAMES_ASC = ['thumb', 'small', 'medium', 'large', 'xLarge', 'xxLarge'];

// ---------------------------------------------------------------------------
// Property 2: Image resize tier selection and skip logic
// ---------------------------------------------------------------------------

describe('Property 2: Image resize tier selection and skip logic', () => {
  // **Validates: Requirements 3.1, 3.3**

  beforeEach(() => {
    mockOrigFormat = 'jpeg';
  });

  it('should select correct tiers and skip larger tiers when original is smaller', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        async (width, height) => {
          mockOrigWidth = width;
          mockOrigHeight = height;

          const result = await resizeImage(
            Buffer.from('prop2'),
            'jpg',
            DEFAULT_SIZES,
            false
          );

          const longSide = Math.max(width, height);
          const thresholds = TIER_NAMES_ASC.map(n => DEFAULT_SIZES[n]);

          // Determine expected tier count: iterate ascending, include each
          // tier where longSide >= threshold. For the first tier where
          // longSide < threshold, include that tier (at original dims) then stop.
          let expectedCount = 0;
          let hitBreak = false;
          for (let i = 0; i < thresholds.length; i++) {
            expectedCount++;
            if (longSide < thresholds[i]) {
              hitBreak = true;
              break;
            }
          }

          expect(result.resizedImages).toHaveLength(expectedCount);

          // Verify each generated image
          for (let i = 0; i < result.resizedImages.length; i++) {
            const img = result.resizedImages[i];
            const threshold = thresholds[i];

            if (longSide >= threshold) {
              // Resized: long side should equal the threshold
              const imgLongSide = Math.max(img.width, img.height);
              expect(imgLongSide).toBe(threshold);
            } else {
              // Saved at original dimensions
              expect(img.width).toBe(width);
              expect(img.height).toBe(height);
            }
          }

          // Verify all larger tiers are skipped (not present)
          if (hitBreak) {
            const generatedNames = result.resizedImages.map(r => r.sizeName);
            const lastGenerated = generatedNames[generatedNames.length - 1];
            const lastIdx = TIER_NAMES_ASC.indexOf(lastGenerated);
            for (let j = lastIdx + 1; j < TIER_NAMES_ASC.length; j++) {
              expect(generatedNames).not.toContain(TIER_NAMES_ASC[j]);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Aspect ratio preservation
// ---------------------------------------------------------------------------

describe('Property 3: Aspect ratio preservation', () => {
  // **Validates: Requirements 3.2**

  beforeEach(() => {
    mockOrigFormat = 'jpeg';
  });

  it('should preserve aspect ratio within ±1 pixel tolerance for all resized images', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        async (width, height) => {
          mockOrigWidth = width;
          mockOrigHeight = height;

          const result = await resizeImage(
            Buffer.from('prop3'),
            'jpg',
            DEFAULT_SIZES,
            false
          );

          const originalRatio = width / height;

          for (const img of result.resizedImages) {
            // Skip images saved at original dimensions (ratio is exact)
            if (img.width === width && img.height === height) {
              continue;
            }

            const imgRatio = img.width / img.height;

            // ±1 pixel tolerance: compute what the ratio range would be
            // if width or height were off by 1 pixel
            const toleranceW = 1 / img.height;
            const toleranceH = (img.width / (img.height * img.height));
            const tolerance = Math.max(toleranceW, toleranceH, 0.01);

            expect(Math.abs(imgRatio - originalRatio)).toBeLessThanOrEqual(tolerance);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Output format retention
// ---------------------------------------------------------------------------

describe('Property 4: Output format retention', () => {
  // **Validates: Requirements 3.4**

  it('should retain the original format for every resized image', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.constantFrom('jpg', 'png', 'gif'),
        async (width, height, format) => {
          mockOrigWidth = width;
          mockOrigHeight = height;
          mockOrigFormat = format === 'jpg' ? 'jpeg' : format;

          const result = await resizeImage(
            Buffer.from('prop4'),
            format,
            DEFAULT_SIZES,
            false
          );

          for (const img of result.resizedImages) {
            expect(img.format).toBe(format);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
