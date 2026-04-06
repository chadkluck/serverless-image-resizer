/**
 * Centralized configuration module for the Processor Lambda.
 * Reads settings from environment variables with fallback defaults.
 * The exported object is deeply frozen to prevent runtime mutation.
 *
 * @module config/settings
 * @example
 * import settings from './config/settings.js';
 *
 * // Access image size thresholds
 * const { sizes } = settings;
 * console.log(sizes.xxLarge); // 3000
 *
 * // Check WebP conversion flag
 * if (settings.createWebpVersion) {
 *   // create WebP variants
 * }
 */

/**
 * Parse a string environment variable as a boolean.
 * Only the exact string 'true' (case-sensitive) resolves to true.
 *
 * @param {string|undefined} value - Raw environment variable value
 * @param {boolean} defaultValue - Fallback when the variable is not set
 * @returns {boolean} Parsed boolean value
 */
function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return value === 'true';
}

/**
 * @typedef {Object} SizeThresholds
 * @property {number} xxLarge - 3000px long-side threshold
 * @property {number} xLarge  - 1920px long-side threshold
 * @property {number} large   - 1000px long-side threshold
 * @property {number} medium  - 800px long-side threshold
 * @property {number} small   - 500px long-side threshold
 * @property {number} thumb   - 250px long-side threshold
 */

/**
 * @typedef {Object} Settings
 * @property {SizeThresholds} sizes            - Predefined image resize thresholds
 * @property {boolean}        createWebpVersion - Whether to generate WebP variants
 * @property {string}         imageOutputBasePrefix - Base S3 prefix for output objects
 * @property {number}         maxImageFileSize  - Maximum allowed image file size in bytes
 * @property {number}         logLevel          - Logging verbosity (0 = minimal)
 * @property {string}         stageId           - Deployment stage identifier
 * @property {string}         sourceBucket      - Name of the source S3 bucket
 */

/** @type {Settings} */
const settings = Object.freeze({
  sizes: Object.freeze({
    xxLarge: 3000,
    xLarge: 1920,
    large: 1000,
    medium: 800,
    small: 500,
    thumb: 250
  }),
  createWebpVersion: parseBoolean(process.env.CREATE_WEBP_VERSION, true),
  imageOutputBasePrefix: process.env.IMAGE_OUTPUT_BASE_PREFIX || '/{stageId}/public/images',
  maxImageFileSize: parseInt(process.env.MAX_IMAGE_FILE_SIZE, 10) || 26214400,
  logLevel: parseInt(process.env.LOG_LEVEL, 10) || 0,
  stageId: process.env.STAGE_ID || '',
  sourceBucket: process.env.SOURCE_BUCKET || ''
});

export default settings;
