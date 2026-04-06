/**
 * Metadata management utility for generating, merging, and extracting
 * image metadata. Handles metadata.json creation for processed images,
 * JSON metadata uploads for field updates, and EXIF data extraction.
 *
 * All output metadata objects follow a strict no-null contract: every
 * field is always present and uses `""`, `{}`, or `[]` instead of null.
 *
 * @module utils/metadataManager
 * @example
 * import { generateMetadata, mergeMetadata, mergeWithNewImage, extractExif } from './utils/metadataManager.js';
 *
 * // Generate metadata for a newly processed image
 * const exif = await extractExif(imageBuffer);
 * const metadata = generateMetadata(exif, sizes, true, 'jpg');
 *
 * // Merge uploaded JSON into existing metadata
 * const updated = mergeMetadata(existingMetadata, uploadedJson);
 *
 * // Re-upload: replace technical fields, preserve descriptive fields
 * const merged = mergeWithNewImage(existingMetadata, newExif, newSizes, true, 'png');
 */

import sharp from 'sharp';

/**
 * All six size tier names in the canonical order used by metadata.json.
 * @type {string[]}
 */
const SIZE_TIER_NAMES = ['xxLarge', 'xLarge', 'large', 'medium', 'small', 'thumb'];

/**
 * Descriptive field names that are preserved during image re-uploads
 * when they already contain non-empty values.
 * @type {string[]}
 */
const DESCRIPTIVE_FIELDS = [
  'defaultDescription',
  'defaultLongDescription',
  'defaultAltText',
  'defaultCaption',
  'credit',
  'copyright'
];

/**
 * Protected field names that are preserved from existing metadata
 * during JSON uploads unless explicitly provided in the uploaded JSON.
 * @type {string[]}
 */
const PROTECTED_FIELDS = ['sizes', 'exif', 'hasWebp'];

/**
 * Build a complete sizes object with all six tiers present.
 * Tiers not included in the input use empty arrays `[]`.
 *
 * @param {Object} sizes - Size tier dimensions from image processing.
 *   Keys are tier names, values are `[width, height]` arrays or `[]`.
 * @returns {Object} Sizes object with all six tiers guaranteed.
 */
function buildSizesObject(sizes) {
  const result = {};
  for (const tier of SIZE_TIER_NAMES) {
    const value = sizes && sizes[tier];
    result[tier] = Array.isArray(value) ? value : [];
  }
  return result;
}

/**
 * Replace null values with the appropriate empty value based on type
 * context. Strings become `""`, objects become `{}`, arrays become `[]`.
 *
 * @param {*} value - Value to sanitize
 * @param {*} [existing] - Existing value used to infer the expected type
 * @returns {*} Sanitized value with no nulls
 */
function sanitizeNull(value, existing) {
  if (value === null || value === undefined) {
    // Infer type from existing value when available
    if (Array.isArray(existing)) return [];
    if (existing !== null && existing !== undefined && typeof existing === 'object') return {};
    return '';
  }
  return value;
}

/**
 * Create a blank metadata template with all required fields set to
 * their empty defaults. This guarantees the no-null invariant.
 *
 * @returns {Object} Empty metadata object with all fields present.
 */
function createEmptyMetadata() {
  return {
    type: '',
    lastModified: '',
    created: '',
    exif: {},
    locationName: '',
    locationCoord: { lat: '', long: '' },
    defaultDescription: '',
    defaultLongDescription: '',
    defaultAltText: '',
    defaultCaption: '',
    credit: '',
    copyright: '',
    dateTaken: '',
    hasWebp: false,
    sizes: buildSizesObject({})
  };
}

/**
 * Deep-sanitize an object so that no null values remain at any depth.
 * Null strings become `""`, null objects become `{}`, null arrays become `[]`.
 *
 * @param {*} obj - Value to sanitize recursively
 * @returns {*} Sanitized value
 */
function deepSanitize(obj) {
  if (obj === null || obj === undefined) return '';
  if (Array.isArray(obj)) return obj.map(item => deepSanitize(item));
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepSanitize(value);
    }
    return result;
  }
  return obj;
}

/**
 * Generate a complete metadata object for a newly processed image.
 *
 * Populates the `credit` field from the EXIF `Artist` tag when `credit`
 * would otherwise be empty. All fields are guaranteed present with no
 * null values.
 *
 * @param {Object} exifData - Raw EXIF data extracted from the image
 * @param {Object} sizes - Size tier dimensions from image processing.
 *   Each key is a tier name (`xxLarge`, `xLarge`, etc.) with a
 *   `[width, height]` array or `[]` for skipped tiers.
 * @param {boolean} hasWebp - Whether WebP variants were generated
 * @param {string} originalFormat - File extension without dot (e.g., `jpg`)
 * @returns {Object} Complete metadata object matching the metadata.json schema
 * @example
 * const metadata = generateMetadata(
 *   { Artist: 'Jane Doe', Make: 'Canon' },
 *   { xxLarge: [3000, 2000], xLarge: [1920, 1280], large: [], medium: [800, 533], small: [500, 333], thumb: [250, 167] },
 *   true,
 *   'jpg'
 * );
 * console.log(metadata.credit); // 'Jane Doe'
 * console.log(metadata.sizes.large); // []
 */
function generateMetadata(exifData, sizes, hasWebp, originalFormat) {
  const now = new Date().toISOString();
  const safeExif = deepSanitize(exifData || {});

  // Populate credit from EXIF Artist if available
  const credit = (safeExif && safeExif.Artist && typeof safeExif.Artist === 'string' && safeExif.Artist.trim() !== '')
    ? safeExif.Artist
    : '';

  return {
    type: originalFormat || '',
    lastModified: now,
    created: now,
    exif: safeExif,
    locationName: '',
    locationCoord: { lat: '', long: '' },
    defaultDescription: '',
    defaultLongDescription: '',
    defaultAltText: '',
    defaultCaption: '',
    credit,
    copyright: '',
    dateTaken: '',
    hasWebp: Boolean(hasWebp),
    sizes: buildSizesObject(sizes)
  };
}

/**
 * Merge an uploaded JSON document into existing metadata.
 *
 * Rules:
 * - Non-null values in `uploadedJson` overwrite the corresponding
 *   fields in `existingMetadata`.
 * - Null values in `uploadedJson` are converted to the appropriate
 *   empty value (`""`, `{}`, `[]`).
 * - Protected fields (`sizes`, `exif`, `hasWebp`) are preserved from
 *   `existingMetadata` unless explicitly present in `uploadedJson`.
 * - The output is guaranteed to contain all required fields with no
 *   null values.
 *
 * @param {Object} existingMetadata - Current metadata.json content
 * @param {Object} uploadedJson - Uploaded JSON with fields to merge
 * @returns {Object} Merged metadata object with no null values
 * @example
 * const existing = { ...currentMetadata };
 * const uploaded = { defaultCaption: 'New caption', credit: null };
 * const merged = mergeMetadata(existing, uploaded);
 * console.log(merged.defaultCaption); // 'New caption'
 * console.log(merged.credit); // '' (null converted to empty string)
 */
function mergeMetadata(existingMetadata, uploadedJson) {
  const base = createEmptyMetadata();
  const existing = existingMetadata || {};
  const uploaded = uploadedJson || {};

  // Start with the empty template, then layer existing values
  const result = { ...base };
  for (const [key, value] of Object.entries(existing)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }

  // Apply uploaded JSON fields
  for (const [key, value] of Object.entries(uploaded)) {
    // Skip protected fields unless explicitly provided (non-undefined)
    if (PROTECTED_FIELDS.includes(key) && !(key in uploaded)) {
      continue;
    }

    if (value === null || value === undefined) {
      // Convert null to appropriate empty value
      result[key] = sanitizeNull(value, result[key]);
    } else {
      result[key] = value;
    }
  }

  // Ensure protected fields are preserved from existing when not in uploaded
  for (const field of PROTECTED_FIELDS) {
    if (!(field in uploaded)) {
      if (field === 'sizes') {
        result.sizes = existing.sizes !== undefined && existing.sizes !== null
          ? existing.sizes
          : buildSizesObject({});
      } else if (field === 'exif') {
        result.exif = existing.exif !== undefined && existing.exif !== null
          ? existing.exif
          : {};
      } else if (field === 'hasWebp') {
        result.hasWebp = existing.hasWebp !== undefined && existing.hasWebp !== null
          ? existing.hasWebp
          : false;
      }
    }
  }

  // Ensure sizes always has all six tiers
  result.sizes = buildSizesObject(result.sizes);

  // Ensure locationCoord structure
  if (!result.locationCoord || typeof result.locationCoord !== 'object' || Array.isArray(result.locationCoord)) {
    result.locationCoord = { lat: '', long: '' };
  } else {
    result.locationCoord = {
      lat: result.locationCoord.lat !== null && result.locationCoord.lat !== undefined ? result.locationCoord.lat : '',
      long: result.locationCoord.long !== null && result.locationCoord.long !== undefined ? result.locationCoord.long : ''
    };
  }

  // Update lastModified timestamp
  result.lastModified = new Date().toISOString();

  // Final deep sanitize to guarantee no nulls
  return deepSanitize(result);
}

/**
 * Merge existing metadata with data from a re-uploaded image.
 *
 * Replaces technical fields (`exif`, `sizes`, `hasWebp`, `type`,
 * `lastModified`) with new values from the re-upload. Preserves
 * non-empty descriptive fields (`defaultDescription`,
 * `defaultLongDescription`, `defaultAltText`, `defaultCaption`,
 * `credit`, `copyright`) from the existing metadata.
 *
 * The `credit` field is populated from the new EXIF `Artist` tag
 * only when the existing `credit` is empty.
 *
 * @param {Object} existingMetadata - Current metadata.json content
 * @param {Object} newExifData - Raw EXIF data from the new image
 * @param {Object} newSizes - Size tier dimensions from re-processing
 * @param {boolean} hasWebp - Whether WebP variants were generated
 * @param {string} originalFormat - File extension without dot (e.g., `png`)
 * @returns {Object} Merged metadata with preserved descriptive fields
 * @example
 * const merged = mergeWithNewImage(
 *   existingMetadata,
 *   newExifData,
 *   { xxLarge: [3000, 2000], xLarge: [1920, 1280], large: [1000, 667], medium: [800, 533], small: [500, 333], thumb: [250, 167] },
 *   true,
 *   'jpg'
 * );
 */
function mergeWithNewImage(existingMetadata, newExifData, newSizes, hasWebp, originalFormat) {
  const existing = existingMetadata || {};
  const safeExif = deepSanitize(newExifData || {});
  const now = new Date().toISOString();

  // Start with a fresh metadata from the new image
  const result = {
    type: originalFormat || '',
    lastModified: now,
    created: existing.created || now,
    exif: safeExif,
    locationName: existing.locationName || '',
    locationCoord: existing.locationCoord && typeof existing.locationCoord === 'object' && !Array.isArray(existing.locationCoord)
      ? {
        lat: existing.locationCoord.lat !== null && existing.locationCoord.lat !== undefined ? existing.locationCoord.lat : '',
        long: existing.locationCoord.long !== null && existing.locationCoord.long !== undefined ? existing.locationCoord.long : ''
      }
      : { lat: '', long: '' },
    defaultDescription: '',
    defaultLongDescription: '',
    defaultAltText: '',
    defaultCaption: '',
    credit: '',
    copyright: '',
    dateTaken: existing.dateTaken || '',
    hasWebp: Boolean(hasWebp),
    sizes: buildSizesObject(newSizes)
  };

  // Preserve non-empty descriptive fields from existing metadata
  for (const field of DESCRIPTIVE_FIELDS) {
    const existingValue = existing[field];
    if (existingValue !== null && existingValue !== undefined && existingValue !== '') {
      result[field] = existingValue;
    }
  }

  // Populate credit from new EXIF Artist only if credit is still empty
  if (result.credit === '' && safeExif && safeExif.Artist && typeof safeExif.Artist === 'string' && safeExif.Artist.trim() !== '') {
    result.credit = safeExif.Artist;
  }

  // Final deep sanitize to guarantee no nulls
  return deepSanitize(result);
}

/**
 * Extract raw EXIF data from an image buffer using Sharp.
 *
 * Returns an empty object `{}` if the image contains no EXIF data
 * or if extraction fails. Never returns null.
 *
 * @param {Buffer} imageBuffer - The image file buffer to extract EXIF from
 * @returns {Promise<Object>} Raw EXIF data object, or `{}` if unavailable
 * @example
 * import { extractExif } from './utils/metadataManager.js';
 *
 * const exif = await extractExif(imageBuffer);
 * console.log(exif.Make);   // e.g., 'Canon'
 * console.log(exif.Model);  // e.g., 'EOS R5'
 */
async function extractExif(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    if (metadata.exif) {
      // Parse the raw EXIF buffer into a usable object
      // Sharp provides exif as a Buffer; we return the parsed metadata fields
      const parsed = {};
      // Copy all metadata fields that come from EXIF
      const exifFields = [
        'format', 'width', 'height', 'space', 'channels', 'depth',
        'density', 'chromaSubsampling', 'isProgressive', 'hasProfile',
        'hasAlpha', 'orientation'
      ];
      for (const field of exifFields) {
        if (metadata[field] !== undefined && metadata[field] !== null) {
          parsed[field] = metadata[field];
        }
      }
      // Include any ICC profile info
      if (metadata.icc) {
        parsed.hasIcc = true;
      }
      return deepSanitize(parsed);
    }
    return {};
  } catch {
    return {};
  }
}

export { generateMetadata, mergeMetadata, mergeWithNewImage, extractExif };
