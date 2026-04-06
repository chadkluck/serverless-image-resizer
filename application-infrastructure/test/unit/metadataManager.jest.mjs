/**
 * Unit tests for utils/metadataManager.js
 *
 * Tests metadata generation, JSON merge, image re-upload merge,
 * and EXIF-to-credit population. Validates the no-null invariant,
 * schema completeness, and field preservation rules.
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.3, 6.4, 6.5, 6.6
 */

import { describe, it, expect, jest } from '@jest/globals';

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

const SIZE_TIERS = ['xxLarge', 'xLarge', 'large', 'medium', 'small', 'thumb'];

/**
 * Recursively check that no value at any depth is null.
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

/** Sample EXIF data with Artist tag. */
const exifWithArtist = { Artist: 'Jane Doe', Make: 'Canon', Model: 'EOS R5' };

/** Sample sizes with all tiers generated. */
const fullSizes = {
  xxLarge: [3000, 2000],
  xLarge: [1920, 1280],
  large: [1000, 667],
  medium: [800, 533],
  small: [500, 333],
  thumb: [250, 167]
};

/** Sample sizes with some tiers skipped. */
const partialSizes = {
  medium: [800, 600],
  small: [500, 375],
  thumb: [250, 188]
};

describe('metadataManager', () => {

  // ---------------------------------------------------------------
  // generateMetadata
  // ---------------------------------------------------------------
  describe('generateMetadata', () => {

    it('should include all required top-level fields', () => {
      const result = generateMetadata(exifWithArtist, fullSizes, true, 'jpg');
      for (const field of REQUIRED_FIELDS) {
        expect(result).toHaveProperty(field);
      }
    });

    it('should contain no null values at any depth', () => {
      const result = generateMetadata(exifWithArtist, fullSizes, true, 'jpg');
      assertNoNulls(result);
    });

    it('should include all six size tiers including skipped as empty arrays', () => {
      const result = generateMetadata({}, partialSizes, false, 'png');
      for (const tier of SIZE_TIERS) {
        expect(result.sizes).toHaveProperty(tier);
        expect(Array.isArray(result.sizes[tier])).toBe(true);
      }
      // Skipped tiers should be empty arrays
      expect(result.sizes.xxLarge).toEqual([]);
      expect(result.sizes.xLarge).toEqual([]);
      expect(result.sizes.large).toEqual([]);
      // Present tiers should have dimensions
      expect(result.sizes.medium).toEqual([800, 600]);
      expect(result.sizes.small).toEqual([500, 375]);
      expect(result.sizes.thumb).toEqual([250, 188]);
    });

    it('should populate credit from EXIF Artist when credit is empty', () => {
      const result = generateMetadata(exifWithArtist, fullSizes, true, 'jpg');
      expect(result.credit).toBe('Jane Doe');
    });

    it('should leave credit empty when no EXIF Artist is present', () => {
      const result = generateMetadata({ Make: 'Nikon' }, fullSizes, true, 'jpg');
      expect(result.credit).toBe('');
    });

    it('should set type to the original format', () => {
      const result = generateMetadata({}, fullSizes, false, 'gif');
      expect(result.type).toBe('gif');
    });

    it('should set hasWebp based on the boolean parameter', () => {
      expect(generateMetadata({}, fullSizes, true, 'jpg').hasWebp).toBe(true);
      expect(generateMetadata({}, fullSizes, false, 'jpg').hasWebp).toBe(false);
    });

    it('should handle null exifData gracefully', () => {
      const result = generateMetadata(null, fullSizes, true, 'jpg');
      assertNoNulls(result);
      expect(result.exif).toEqual({});
      expect(result.credit).toBe('');
    });
  });

  // ---------------------------------------------------------------
  // mergeMetadata
  // ---------------------------------------------------------------
  describe('mergeMetadata', () => {

    it('should overwrite existing fields with non-null uploaded values', () => {
      const existing = generateMetadata({}, fullSizes, true, 'jpg');
      existing.defaultCaption = 'Old caption';

      const uploaded = { defaultCaption: 'New caption', defaultAltText: 'Alt text' };
      const result = mergeMetadata(existing, uploaded);

      expect(result.defaultCaption).toBe('New caption');
      expect(result.defaultAltText).toBe('Alt text');
    });

    it('should convert null values to empty strings', () => {
      const existing = generateMetadata({}, fullSizes, true, 'jpg');
      existing.defaultDescription = 'A description';

      const uploaded = { defaultDescription: null, credit: null };
      const result = mergeMetadata(existing, uploaded);

      expect(result.defaultDescription).toBe('');
      expect(result.credit).toBe('');
      assertNoNulls(result);
    });

    it('should preserve sizes, exif, and hasWebp when not in uploaded JSON', () => {
      const existing = generateMetadata(exifWithArtist, fullSizes, true, 'jpg');
      const uploaded = { defaultCaption: 'Updated caption' };
      const result = mergeMetadata(existing, uploaded);

      expect(result.sizes).toEqual(existing.sizes);
      expect(result.exif).toEqual(existing.exif);
      expect(result.hasWebp).toBe(existing.hasWebp);
    });

    it('should overwrite sizes, exif, and hasWebp when explicitly in uploaded JSON', () => {
      const existing = generateMetadata(exifWithArtist, fullSizes, true, 'jpg');
      const newSizes = {
        xxLarge: [], xLarge: [], large: [],
        medium: [640, 480], small: [320, 240], thumb: [160, 120]
      };
      const uploaded = {
        sizes: newSizes,
        exif: { Make: 'Sony' },
        hasWebp: false
      };
      const result = mergeMetadata(existing, uploaded);

      expect(result.sizes.medium).toEqual([640, 480]);
      expect(result.exif).toEqual({ Make: 'Sony' });
      expect(result.hasWebp).toBe(false);
    });

    it('should produce output with no null values', () => {
      const existing = generateMetadata({}, fullSizes, true, 'jpg');
      const uploaded = { locationName: null, copyright: null, dateTaken: null };
      const result = mergeMetadata(existing, uploaded);
      assertNoNulls(result);
    });
  });

  // ---------------------------------------------------------------
  // mergeWithNewImage
  // ---------------------------------------------------------------
  describe('mergeWithNewImage', () => {

    it('should replace exif, sizes, hasWebp, and type from new image', () => {
      const existing = generateMetadata(exifWithArtist, fullSizes, true, 'jpg');
      const newExif = { Make: 'Sony', Model: 'A7IV' };
      const newSizes = {
        xxLarge: [2500, 1667], xLarge: [1920, 1280],
        large: [1000, 667], medium: [800, 533],
        small: [500, 333], thumb: [250, 167]
      };

      const result = mergeWithNewImage(existing, newExif, newSizes, false, 'png');

      expect(result.exif).toEqual({ Make: 'Sony', Model: 'A7IV' });
      expect(result.sizes.xxLarge).toEqual([2500, 1667]);
      expect(result.hasWebp).toBe(false);
      expect(result.type).toBe('png');
    });

    it('should preserve non-empty descriptive fields from existing metadata', () => {
      const existing = generateMetadata({}, fullSizes, true, 'jpg');
      existing.defaultDescription = 'A sunset photo';
      existing.defaultLongDescription = 'A beautiful sunset over the ocean';
      existing.defaultAltText = 'Sunset over ocean';
      existing.defaultCaption = 'Photo by John';
      existing.credit = 'John Smith';
      existing.copyright = '2026 John Smith';

      const result = mergeWithNewImage(existing, {}, fullSizes, true, 'jpg');

      expect(result.defaultDescription).toBe('A sunset photo');
      expect(result.defaultLongDescription).toBe('A beautiful sunset over the ocean');
      expect(result.defaultAltText).toBe('Sunset over ocean');
      expect(result.defaultCaption).toBe('Photo by John');
      expect(result.credit).toBe('John Smith');
      expect(result.copyright).toBe('2026 John Smith');
    });

    it('should populate credit from new EXIF Artist when existing credit is empty', () => {
      const existing = generateMetadata({}, fullSizes, true, 'jpg');
      // credit is empty in existing
      expect(existing.credit).toBe('');

      const newExif = { Artist: 'New Photographer' };
      const result = mergeWithNewImage(existing, newExif, fullSizes, true, 'jpg');

      expect(result.credit).toBe('New Photographer');
    });

    it('should not overwrite existing credit with EXIF Artist', () => {
      const existing = generateMetadata({}, fullSizes, true, 'jpg');
      existing.credit = 'Existing Photographer';

      const newExif = { Artist: 'New Photographer' };
      const result = mergeWithNewImage(existing, newExif, fullSizes, true, 'jpg');

      expect(result.credit).toBe('Existing Photographer');
    });

    it('should produce output with no null values', () => {
      const existing = generateMetadata(null, fullSizes, true, 'jpg');
      const result = mergeWithNewImage(existing, null, partialSizes, false, 'png');
      assertNoNulls(result);
    });
  });
});
