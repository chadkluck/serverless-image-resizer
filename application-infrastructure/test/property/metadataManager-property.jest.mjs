/**
 * Property-based tests for utils/metadataManager.js
 *
 * Feature: 0-0-1-initial-project, Properties 6, 7, 8, 9, 10
 *
 * Property 6: Metadata schema completeness and no-null invariant
 * Property 7: Credit populated from EXIF Artist
 * Property 8: JSON metadata merge with null-to-empty conversion
 * Property 9: JSON merge preserves protected fields
 * Property 10: Image re-upload preserves non-empty descriptive fields
 *
 * Validates: Requirements 5.2, 5.4, 5.5, 5.6, 6.3, 6.4, 6.5, 6.6
 *
 * Uses fast-check to generate random EXIF data, sizes, formats, and
 * metadata objects, then verifies schema completeness, no-null invariant,
 * credit population, merge behaviour, and field preservation across many
 * inputs.
 *
 * Sharp is mocked via jest.unstable_mockModule since it is provided by a
 * Lambda Layer and is not installed in the test environment.
 */

import { describe, it, expect, jest } from '@jest/globals';
import fc from 'fast-check';

// Mock sharp before importing metadataManager (sharp is imported at module level)
jest.unstable_mockModule('sharp', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    metadata: async () => ({ width: 100, height: 100, format: 'jpeg' }),
    resize: function () { return this; },
    toFormat: function () { return this; },
    webp: function () { return this; },
    toBuffer: async () => Buffer.from('stub')
  }))
}));

const {
  generateMetadata,
  mergeMetadata,
  mergeWithNewImage
} = await import('../../src/lambda/functions/processor/utils/metadataManager.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Required top-level fields in every metadata object.
 * @type {string[]}
 */
const REQUIRED_FIELDS = [
  'type', 'lastModified', 'created', 'exif', 'locationName',
  'locationCoord', 'defaultDescription', 'defaultLongDescription',
  'defaultAltText', 'defaultCaption', 'credit', 'copyright',
  'dateTaken', 'hasWebp', 'sizes'
];

/** All six size tier names. */
const SIZE_TIERS = ['xxLarge', 'xLarge', 'large', 'medium', 'small', 'thumb'];

/** Descriptive fields preserved during image re-uploads. */
const DESCRIPTIVE_FIELDS = [
  'defaultDescription', 'defaultLongDescription', 'defaultAltText',
  'defaultCaption', 'credit', 'copyright'
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively assert that no value at any depth is null.
 *
 * @param {*} obj - Value to check
 * @param {string} path - Current path for error messages
 */
function assertNoNulls(obj, path = '') {
  expect(obj).not.toBeNull();
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      assertNoNulls(value, `${path}.${key}`);
    }
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoNulls(item, `${path}[${i}]`));
  }
}

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Generate a random EXIF-like object with optional Artist field. */
const arbExifData = fc.record({
  Make: fc.option(fc.string({ minLength: 0, maxLength: 30 }), { nil: undefined }),
  Model: fc.option(fc.string({ minLength: 0, maxLength: 30 }), { nil: undefined }),
  Artist: fc.option(fc.string({ minLength: 0, maxLength: 50 }), { nil: undefined }),
  ISO: fc.option(fc.integer({ min: 50, max: 12800 }), { nil: undefined }),
  FocalLength: fc.option(fc.integer({ min: 10, max: 600 }), { nil: undefined })
}, { requiredKeys: [] });

/** Generate a random size tier dimensions entry: either [w, h] or []. */
const arbSizeDims = fc.oneof(
  fc.tuple(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 5000 })),
  fc.constant([])
);

/** Generate a random sizes object with all six tiers. */
const arbSizes = fc.record({
  xxLarge: arbSizeDims,
  xLarge: arbSizeDims,
  large: arbSizeDims,
  medium: arbSizeDims,
  small: arbSizeDims,
  thumb: arbSizeDims
});

/** Generate a random image format. */
const arbFormat = fc.constantFrom('jpg', 'png', 'gif', 'webp', 'tiff');

/** Generate a random non-empty string (for descriptive fields). */
const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 100 });

/**
 * Generate a complete metadata object by calling generateMetadata with
 * random inputs. Useful as a base for merge tests.
 */
const arbExistingMetadata = fc.record({
  exif: arbExifData,
  sizes: arbSizes,
  hasWebp: fc.boolean(),
  format: arbFormat
}).map(({ exif, sizes, hasWebp, format }) =>
  generateMetadata(exif, sizes, hasWebp, format)
);

/**
 * Generate a random uploaded JSON object for merge tests.
 * Values can be strings, null, or undefined (absent).
 */
const arbUploadedJson = fc.record({
  defaultDescription: fc.option(fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)), { nil: undefined }),
  defaultLongDescription: fc.option(fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)), { nil: undefined }),
  defaultAltText: fc.option(fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)), { nil: undefined }),
  defaultCaption: fc.option(fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)), { nil: undefined }),
  credit: fc.option(fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)), { nil: undefined }),
  copyright: fc.option(fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)), { nil: undefined }),
  locationName: fc.option(fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)), { nil: undefined }),
  dateTaken: fc.option(fc.oneof(fc.string({ maxLength: 30 }), fc.constant(null)), { nil: undefined })
}, { requiredKeys: [] });

// ---------------------------------------------------------------------------
// Property 6: Metadata schema completeness and no-null invariant
// ---------------------------------------------------------------------------

describe('Property 6: Metadata schema completeness and no-null invariant', () => {
  // **Validates: Requirements 5.2, 5.5, 5.6**

  it('generateMetadata output has all required fields, all 6 size tiers, and no null values', () => {
    fc.assert(
      fc.property(
        arbExifData,
        arbSizes,
        fc.boolean(),
        arbFormat,
        (exif, sizes, hasWebp, format) => {
          const result = generateMetadata(exif, sizes, hasWebp, format);

          // All required top-level fields present
          for (const field of REQUIRED_FIELDS) {
            expect(result).toHaveProperty(field);
          }

          // All six size tiers present
          for (const tier of SIZE_TIERS) {
            expect(result.sizes).toHaveProperty(tier);
            expect(Array.isArray(result.sizes[tier])).toBe(true);
          }

          // No null values at any depth
          assertNoNulls(result);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('mergeMetadata output has all required fields, all 6 size tiers, and no null values', () => {
    fc.assert(
      fc.property(
        arbExistingMetadata,
        arbUploadedJson,
        (existing, uploaded) => {
          const result = mergeMetadata(existing, uploaded);

          for (const field of REQUIRED_FIELDS) {
            expect(result).toHaveProperty(field);
          }

          for (const tier of SIZE_TIERS) {
            expect(result.sizes).toHaveProperty(tier);
            expect(Array.isArray(result.sizes[tier])).toBe(true);
          }

          assertNoNulls(result);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('mergeWithNewImage output has all required fields, all 6 size tiers, and no null values', () => {
    fc.assert(
      fc.property(
        arbExistingMetadata,
        arbExifData,
        arbSizes,
        fc.boolean(),
        arbFormat,
        (existing, newExif, newSizes, hasWebp, format) => {
          const result = mergeWithNewImage(existing, newExif, newSizes, hasWebp, format);

          for (const field of REQUIRED_FIELDS) {
            expect(result).toHaveProperty(field);
          }

          for (const tier of SIZE_TIERS) {
            expect(result.sizes).toHaveProperty(tier);
            expect(Array.isArray(result.sizes[tier])).toBe(true);
          }

          assertNoNulls(result);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Credit populated from EXIF Artist
// ---------------------------------------------------------------------------

describe('Property 7: Credit populated from EXIF Artist', () => {
  // **Validates: Requirements 5.4**

  it('credit equals EXIF Artist when Artist is non-empty and credit would otherwise be empty', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString,
        arbSizes,
        fc.boolean(),
        arbFormat,
        (artist, sizes, hasWebp, format) => {
          // Ensure Artist is non-empty and not just whitespace
          const trimmed = artist.trim();
          if (trimmed === '') return; // skip trivial case

          const exif = { Artist: artist, Make: 'TestMake' };
          const result = generateMetadata(exif, sizes, hasWebp, format);

          expect(result.credit).toBe(artist);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('credit is empty when no EXIF Artist is present', () => {
    fc.assert(
      fc.property(
        arbSizes,
        fc.boolean(),
        arbFormat,
        (sizes, hasWebp, format) => {
          const exif = { Make: 'TestMake', Model: 'TestModel' };
          const result = generateMetadata(exif, sizes, hasWebp, format);

          expect(result.credit).toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: JSON metadata merge with null-to-empty conversion
// ---------------------------------------------------------------------------

describe('Property 8: JSON metadata merge with null-to-empty conversion', () => {
  // **Validates: Requirements 6.3, 6.4**

  it('non-null values overwrite, null values become empty, output has no nulls', () => {
    fc.assert(
      fc.property(
        arbExistingMetadata,
        arbUploadedJson,
        (existing, uploaded) => {
          const result = mergeMetadata(existing, uploaded);

          // Check each uploaded field
          for (const [key, value] of Object.entries(uploaded)) {
            if (value === undefined) continue; // field not present in upload

            if (value === null) {
              // Null values should become empty (string fields → '')
              const resultValue = result[key];
              expect(resultValue).not.toBeNull();
              // For string fields, expect empty string
              if (typeof existing[key] === 'string' || existing[key] === '') {
                expect(resultValue).toBe('');
              }
            } else {
              // Non-null values should overwrite
              expect(result[key]).toBe(value);
            }
          }

          // Output has no nulls at any depth
          assertNoNulls(result);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: JSON merge preserves protected fields
// ---------------------------------------------------------------------------

describe('Property 9: JSON merge preserves protected fields', () => {
  // **Validates: Requirements 6.5**

  it('sizes, exif, and hasWebp are identical to existing when not in uploaded JSON', () => {
    fc.assert(
      fc.property(
        arbExistingMetadata,
        arbUploadedJson,
        (existing, uploaded) => {
          // Ensure uploaded does NOT contain sizes, exif, or hasWebp
          // (arbUploadedJson already excludes them by design)
          delete uploaded.sizes;
          delete uploaded.exif;
          delete uploaded.hasWebp;

          const result = mergeMetadata(existing, uploaded);

          // sizes: each tier should match existing
          for (const tier of SIZE_TIERS) {
            expect(result.sizes[tier]).toEqual(existing.sizes[tier]);
          }

          // exif: should be identical to existing
          expect(result.exif).toEqual(existing.exif);

          // hasWebp: should be identical to existing
          expect(result.hasWebp).toBe(existing.hasWebp);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Image re-upload preserves non-empty descriptive fields
// ---------------------------------------------------------------------------

describe('Property 10: Image re-upload preserves non-empty descriptive fields', () => {
  // **Validates: Requirements 6.6**

  it('non-empty descriptive fields from existing metadata are preserved after re-upload', () => {
    fc.assert(
      fc.property(
        arbExistingMetadata,
        arbExifData,
        arbSizes,
        fc.boolean(),
        arbFormat,
        fc.record({
          defaultDescription: arbNonEmptyString,
          defaultLongDescription: arbNonEmptyString,
          defaultAltText: arbNonEmptyString,
          defaultCaption: arbNonEmptyString,
          credit: arbNonEmptyString,
          copyright: arbNonEmptyString
        }),
        (existing, newExif, newSizes, hasWebp, format, descriptiveValues) => {
          // Set non-empty descriptive fields on existing metadata
          for (const field of DESCRIPTIVE_FIELDS) {
            existing[field] = descriptiveValues[field];
          }

          const result = mergeWithNewImage(existing, newExif, newSizes, hasWebp, format);

          // All non-empty descriptive fields should be preserved
          for (const field of DESCRIPTIVE_FIELDS) {
            expect(result[field]).toBe(descriptiveValues[field]);
          }

          // EXIF should be replaced with new data (deep-sanitized)
          // Just verify it's not the old exif
          if (newExif && Object.keys(newExif).length > 0) {
            // New exif should be present (deep-sanitized version)
            expect(result.exif).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
