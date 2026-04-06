/**
 * Image processing utility for resizing images and creating WebP variants.
 * Uses Sharp (provided via Lambda Layer) for image manipulation.
 *
 * @module utils/imageProcessor
 * @example
 * import { resizeImage } from './utils/imageProcessor.js';
 *
 * const { resizedImages, webpImages } = await resizeImage(
 *   imageBuffer,
 *   'jpg',
 *   { xxLarge: 3000, xLarge: 1920, large: 1000, medium: 800, small: 500, thumb: 250 },
 *   true
 * );
 */

import sharp from 'sharp';

/**
 * Ordered size tiers from smallest to largest for iteration.
 * @type {Array<{name: string, key: string}>}
 */
const SIZE_TIERS_ASC = [
  { name: 'thumb', key: 'thumb' },
  { name: 'small', key: 'small' },
  { name: 'medium', key: 'medium' },
  { name: 'large', key: 'large' },
  { name: 'xLarge', key: 'xLarge' },
  { name: 'xxLarge', key: 'xxLarge' }
];

/**
 * Resize an image buffer into multiple size tiers and optionally create WebP variants.
 *
 * Determines the long side of the original image and iterates size tiers from
 * smallest to largest. For each tier where the original long side >= threshold,
 * the image is resized proportionally. For the first tier where the original
 * long side < threshold, the image is saved at original dimensions and all
 * larger tiers are skipped.
 *
 * @param {Buffer} imageBuffer - The original image file buffer
 * @param {string} originalFormat - File extension without dot (e.g., 'jpg', 'png', 'gif')
 * @param {Object} sizes - Size tier thresholds
 * @param {number} sizes.xxLarge - 3000px long-side threshold
 * @param {number} sizes.xLarge - 1920px long-side threshold
 * @param {number} sizes.large - 1000px long-side threshold
 * @param {number} sizes.medium - 800px long-side threshold
 * @param {number} sizes.small - 500px long-side threshold
 * @param {number} sizes.thumb - 250px long-side threshold
 * @param {boolean} createWebp - Whether to create WebP variants for each resized image
 * @returns {Promise<{resizedImages: Array<{sizeName: string, buffer: Buffer, width: number, height: number, format: string}>, webpImages: Array<{sizeName: string, buffer: Buffer, width: number, height: number}>}>} Resized images and optional WebP variants
 * @example
 * // Resize a JPEG image with WebP variants
 * const result = await resizeImage(buffer, 'jpg', settings.sizes, true);
 * console.log(result.resizedImages.length); // Number of size tiers generated
 * console.log(result.webpImages.length);    // Same count if createWebp is true
 *
 * @example
 * // Resize without WebP
 * const { resizedImages, webpImages } = await resizeImage(buffer, 'png', settings.sizes, false);
 * console.log(webpImages.length); // 0
 */
async function resizeImage(imageBuffer, originalFormat, sizes, createWebp) {
  const metadata = await sharp(imageBuffer).metadata();
  const originalWidth = metadata.width;
  const originalHeight = metadata.height;
  const longSide = Math.max(originalWidth, originalHeight);

  const resizedImages = [];
  const webpImages = [];

  for (const tier of SIZE_TIERS_ASC) {
    const threshold = sizes[tier.key];

    if (longSide >= threshold) {
      // Resize proportionally so the long side equals the threshold
      const resizeOptions = originalWidth >= originalHeight
        ? { width: threshold }
        : { height: threshold };

      const resized = sharp(imageBuffer)
        .resize(resizeOptions)
        .toFormat(originalFormat === 'jpg' ? 'jpeg' : originalFormat);

      const resizedBuffer = await resized.toBuffer();
      const resizedMeta = await sharp(resizedBuffer).metadata();

      resizedImages.push({
        sizeName: tier.name,
        buffer: resizedBuffer,
        width: resizedMeta.width,
        height: resizedMeta.height,
        format: originalFormat
      });

      if (createWebp) {
        const webpBuffer = await sharp(imageBuffer)
          .resize(resizeOptions)
          .webp()
          .toBuffer();
        const webpMeta = await sharp(webpBuffer).metadata();

        webpImages.push({
          sizeName: tier.name,
          buffer: webpBuffer,
          width: webpMeta.width,
          height: webpMeta.height
        });
      }
    } else {
      // Original is smaller than this tier — save at original dimensions, then break
      const originalFormatted = sharp(imageBuffer)
        .toFormat(originalFormat === 'jpg' ? 'jpeg' : originalFormat);

      const originalBuffer = await originalFormatted.toBuffer();
      const originalMeta = await sharp(originalBuffer).metadata();

      resizedImages.push({
        sizeName: tier.name,
        buffer: originalBuffer,
        width: originalMeta.width,
        height: originalMeta.height,
        format: originalFormat
      });

      if (createWebp) {
        const webpBuffer = await sharp(imageBuffer)
          .webp()
          .toBuffer();
        const webpMeta = await sharp(webpBuffer).metadata();

        webpImages.push({
          sizeName: tier.name,
          buffer: webpBuffer,
          width: webpMeta.width,
          height: webpMeta.height
        });
      }

      // Skip all larger tiers
      break;
    }
  }

  return { resizedImages, webpImages };
}

export { resizeImage };
