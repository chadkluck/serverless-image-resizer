/**
 * SQS event handler for the Processor Lambda.
 * Processes images uploaded to the source S3 bucket by resizing them
 * into multiple size tiers, optionally creating WebP variants,
 * extracting EXIF metadata, and writing outputs to dynamically
 * determined destination buckets based on object and bucket tags.
 *
 * Also handles JSON metadata uploads that update existing metadata.json
 * files in the output bucket.
 *
 * Uses partial batch failure reporting (`ReportBatchItemFailures`) so
 * that only failed records are retried by SQS.
 *
 * @module handler
 * @example
 * // Deployed as a Lambda handler triggered by SQS
 * // Entry point: handler.handler
 * // The function receives SQS events where each record body contains
 * // an S3 event notification JSON string.
 */

import { getObject, getObjectTagging, getBucketTagging, putObject } from './utils/s3Client.js';
import { resizeImage } from './utils/imageProcessor.js';
import { generateMetadata, mergeMetadata, mergeWithNewImage, extractExif } from './utils/metadataManager.js';
import { getCachedTags, setCachedTags } from './utils/bucketTagCache.js';
import { resolveOutputPath } from './utils/pathResolver.js';
import logger from './utils/logger.js';
import settings from './config/settings.js';

/**
 * Supported image file extensions.
 * @type {Set<string>}
 */
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif']);

/**
 * Content type mapping for S3 PutObject operations.
 * @type {Object.<string, string>}
 */
const CONTENT_TYPE_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  json: 'application/json'
};

/**
 * Extract the file extension (lowercase, without dot) from an S3 object key.
 *
 * @param {string} key - S3 object key (e.g., `uploads/batch1/myImage.jpg`)
 * @returns {string} Lowercase file extension without dot, or empty string if none
 */
function getExtension(key) {
  const lastDot = key.lastIndexOf('.');
  if (lastDot === -1 || lastDot === key.length - 1) return '';
  return key.substring(lastDot + 1).toLowerCase();
}

/**
 * Extract the original file name (without extension) from an S3 object key.
 * For example, `uploads/batch1/myImage.jpg` returns `myImage`.
 *
 * @param {string} key - S3 object key
 * @returns {string} File name without extension
 */
function getOriginalFileName(key) {
  const parts = key.split('/');
  const fileName = parts[parts.length - 1];
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return fileName;
  return fileName.substring(0, lastDot);
}

/**
 * Convert an S3 TagSet array to a plain key-value object.
 *
 * @param {Array<{Key: string, Value: string}>} tagSet - S3 tag set array
 * @returns {Object.<string, string>} Key-value tag object
 */
function tagSetToObject(tagSet) {
  const tags = {};
  if (Array.isArray(tagSet)) {
    for (const tag of tagSet) {
      tags[tag.Key] = tag.Value;
    }
  }
  return tags;
}

/**
 * Retrieve and cache bucket tags for the given output bucket.
 * Returns cached tags if available, otherwise fetches from S3
 * and stores in the bucket tag cache.
 *
 * @param {string} bucketName - Output bucket name
 * @returns {Promise<Object.<string, string>>} Bucket tags as key-value object
 */
async function getOrCacheBucketTags(bucketName) {
  const cached = getCachedTags(bucketName);
  if (cached) {
    logger.debug('bucketTagCache', 'Using cached bucket tags', { bucket: bucketName });
    return cached;
  }

  const { TagSet } = await getBucketTagging(bucketName);
  const tags = tagSetToObject(TagSet);
  setCachedTags(bucketName, tags);
  logger.debug('bucketTagCache', 'Fetched and cached bucket tags', { bucket: bucketName });
  return tags;
}

/**
 * Convert a readable stream (S3 Body) to a Buffer.
 *
 * @param {ReadableStream} stream - S3 object body stream
 * @returns {Promise<Buffer>} Buffer containing the full stream content
 */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Process an image file: resize, create WebP variants, extract EXIF,
 * generate or merge metadata, and write all outputs to the output bucket.
 *
 * @param {string} sourceBucket - Source S3 bucket name
 * @param {string} sourceKey - Source S3 object key
 * @param {string} outputBucket - Destination S3 bucket name
 * @param {string} outputBasePath - Resolved output base path (ending with `/`)
 * @param {string} originalFileName - File name without extension
 * @param {string} extension - Lowercase file extension without dot
 * @returns {Promise<void>}
 */
async function processImage(sourceBucket, sourceKey, outputBucket, outputBasePath, originalFileName, extension) {
  // Get the image from the source bucket
  const { Body } = await getObject(sourceBucket, sourceKey);
  const imageBuffer = await streamToBuffer(Body);

  // Extract EXIF data
  const exifData = await extractExif(imageBuffer);
  logger.debug('exif', 'Extracted EXIF data', { hasExif: Object.keys(exifData).length > 0 });

  // Resize the image into multiple size tiers
  const format = extension === 'jpeg' ? 'jpg' : extension;
  const { resizedImages, webpImages } = await resizeImage(
    imageBuffer,
    format,
    settings.sizes,
    settings.createWebpVersion
  );

  logger.info('resize', 'Image resized', {
    generated: resizedImages.map(img => img.sizeName),
    webpCount: webpImages.length
  });

  // Build sizes object for metadata
  const sizesForMetadata = {};
  const allTiers = ['xxLarge', 'xLarge', 'large', 'medium', 'small', 'thumb'];
  for (const tier of allTiers) {
    const img = resizedImages.find(r => r.sizeName === tier);
    sizesForMetadata[tier] = img ? [img.width, img.height] : [];
  }

  // Try to get existing metadata from output bucket (for re-upload merge)
  let existingMetadata = null;
  try {
    const metadataKey = `${outputBasePath}metadata.json`;
    const { Body: metaBody } = await getObject(outputBucket, metadataKey);
    const metaBuffer = await streamToBuffer(metaBody);
    existingMetadata = JSON.parse(metaBuffer.toString('utf-8'));
    logger.debug('metadata', 'Found existing metadata for merge', { key: metadataKey });
  } catch {
    logger.debug('metadata', 'No existing metadata found, generating fresh');
  }

  // Generate or merge metadata
  let metadata;
  if (existingMetadata) {
    metadata = mergeWithNewImage(existingMetadata, exifData, sizesForMetadata, settings.createWebpVersion, format);
  } else {
    metadata = generateMetadata(exifData, sizesForMetadata, settings.createWebpVersion, format);
  }

  // Write all resized images to output bucket
  const contentType = CONTENT_TYPE_MAP[extension] || `image/${extension}`;
  for (const img of resizedImages) {
    const key = `${outputBasePath}${img.sizeName}.${extension}`;
    await putObject(outputBucket, key, img.buffer, contentType);
    logger.debug('putObject', 'Wrote resized image', { key, size: img.sizeName });
  }

  // Write all WebP images to output bucket
  for (const img of webpImages) {
    const key = `${outputBasePath}${img.sizeName}.webp`;
    await putObject(outputBucket, key, img.buffer, CONTENT_TYPE_MAP.webp);
    logger.debug('putObject', 'Wrote WebP image', { key, size: img.sizeName });
  }

  // Write metadata.json to output bucket
  const metadataKey = `${outputBasePath}metadata.json`;
  const metadataBody = JSON.stringify(metadata, null, 2);
  await putObject(outputBucket, metadataKey, metadataBody, CONTENT_TYPE_MAP.json);
  logger.info('metadata', 'Wrote metadata.json', { key: metadataKey });
}

/**
 * Process a JSON metadata upload: read the uploaded JSON, merge it
 * with existing metadata.json in the output bucket, and write the
 * updated metadata back.
 *
 * @param {string} sourceBucket - Source S3 bucket name
 * @param {string} sourceKey - Source S3 object key
 * @param {string} outputBucket - Destination S3 bucket name
 * @param {string} outputBasePath - Resolved output base path (ending with `/`)
 * @returns {Promise<void>}
 */
async function processJsonMetadata(sourceBucket, sourceKey, outputBucket, outputBasePath) {
  // Get the JSON file from the source bucket
  const { Body } = await getObject(sourceBucket, sourceKey);
  const jsonBuffer = await streamToBuffer(Body);
  const uploadedJson = JSON.parse(jsonBuffer.toString('utf-8'));

  logger.debug('jsonUpload', 'Parsed uploaded JSON', { fields: Object.keys(uploadedJson) });

  // Get existing metadata.json from output bucket
  let existingMetadata = {};
  try {
    const metadataKey = `${outputBasePath}metadata.json`;
    const { Body: metaBody } = await getObject(outputBucket, metadataKey);
    const metaBuffer = await streamToBuffer(metaBody);
    existingMetadata = JSON.parse(metaBuffer.toString('utf-8'));
    logger.debug('metadata', 'Found existing metadata for JSON merge', { key: metadataKey });
  } catch {
    logger.debug('metadata', 'No existing metadata found, starting from empty');
  }

  // Merge uploaded JSON into existing metadata
  const merged = mergeMetadata(existingMetadata, uploadedJson);

  // Write updated metadata.json to output bucket
  const metadataKey = `${outputBasePath}metadata.json`;
  const metadataBody = JSON.stringify(merged, null, 2);
  await putObject(outputBucket, metadataKey, metadataBody, CONTENT_TYPE_MAP.json);
  logger.info('metadata', 'Wrote merged metadata.json', { key: metadataKey });
}

/**
 * Process a single SQS record containing an S3 event notification.
 *
 * @param {Object} record - SQS record from the event
 * @param {Object} context - Lambda context object
 * @returns {Promise<{success: boolean, messageId: string}>} Processing result
 */
async function processRecord(record, context) {
  const messageId = record.messageId;

  // Parse S3 event from SQS message body
  const s3Event = JSON.parse(record.body);
  const s3Record = s3Event.Records[0];
  const sourceBucket = s3Record.s3.bucket.name;
  const sourceKey = decodeURIComponent(s3Record.s3.object.key.replace(/\+/g, ' '));
  const fileSize = s3Record.s3.object.size;

  // Set logger context for this record
  logger.setContext({
    requestId: messageId,
    sourceKey,
    outputBucket: ''
  });

  logger.info('processing', 'Processing SQS record', {
    messageId,
    sourceBucket,
    sourceKey,
    fileSize
  });

  // Get object tags
  const { TagSet } = await getObjectTagging(sourceBucket, sourceKey);
  const objectTags = tagSetToObject(TagSet);

  const imageOutputBucket = objectTags.ImageOutputBucket;
  const imageOutputPath = objectTags.ImageOutputPath || '';
  const objectStageId = objectTags.stageId || '';

  logger.debug('tags', 'Object tags retrieved', {
    ImageOutputBucket: imageOutputBucket || '(missing)',
    ImageOutputPath: imageOutputPath || '(empty)',
    stageId: objectStageId || '(empty)'
  });

  // Validate ImageOutputBucket tag exists
  if (!imageOutputBucket) {
    logger.error('tagValidation', 'Missing ImageOutputBucket tag', {
      key: sourceKey,
      bucket: sourceBucket
    });
    return { success: false, messageId };
  }

  // Update logger context with output bucket
  logger.setContext({
    requestId: messageId,
    sourceKey,
    outputBucket: imageOutputBucket
  });

  // Get/cache bucket tags
  const bucketTags = await getOrCacheBucketTags(imageOutputBucket);
  const allowEvents = bucketTags.AllowImageResizerEvents;
  const bucketBasePrefix = bucketTags['imageResizer:ImageOutputBasePrefix'] || null;

  // Validate AllowImageResizerEvents === 'true'
  if (allowEvents !== 'true') {
    logger.warn('authorization', 'Bucket not authorized for image resizer events', {
      bucket: imageOutputBucket,
      AllowImageResizerEvents: allowEvents || '(missing)'
    });
    // Intentional skip — return success so SQS does not retry
    return { success: true, messageId };
  }

  // Resolve output path
  const extension = getExtension(sourceKey);
  const originalFileName = getOriginalFileName(sourceKey);

  const outputBasePath = resolveOutputPath(
    bucketBasePrefix,
    settings.imageOutputBasePrefix,
    { ImageOutputPath: imageOutputPath, stageId: objectStageId },
    settings.stageId,
    originalFileName
  );

  logger.debug('pathResolution', 'Resolved output path', { outputBasePath });

  // Check file size against maxImageFileSize (for images only)
  if (IMAGE_EXTENSIONS.has(extension) && fileSize > settings.maxImageFileSize) {
    logger.error('fileSizeCheck', 'File exceeds maximum allowed size', {
      key: sourceKey,
      fileSize,
      maxImageFileSize: settings.maxImageFileSize
    });
    // Intentional skip — return success so SQS does not retry
    return { success: true, messageId };
  }

  // Branch on file extension
  if (IMAGE_EXTENSIONS.has(extension)) {
    await processImage(sourceBucket, sourceKey, imageOutputBucket, outputBasePath, originalFileName, extension);
  } else if (extension === 'json') {
    await processJsonMetadata(sourceBucket, sourceKey, imageOutputBucket, outputBasePath);
  } else {
    logger.warn('fileType', 'Unsupported file type, skipping', {
      key: sourceKey,
      extension: extension || '(none)'
    });
    // Intentional skip — return success so SQS does not retry
    return { success: true, messageId };
  }

  // Check remaining time for timeout awareness
  if (context && typeof context.getRemainingTimeInMillis === 'function') {
    const remaining = context.getRemainingTimeInMillis();
    logger.debug('timeout', 'Remaining execution time', { remainingMs: remaining });
    if (remaining < 5000) {
      logger.warn('timeout', 'Less than 5 seconds remaining, may not process additional records', {
        remainingMs: remaining
      });
    }
  }

  logger.info('processing', 'Record processed successfully', { messageId, sourceKey });
  return { success: true, messageId };
}

/**
 * Lambda handler entry point for SQS events.
 *
 * Processes each SQS record independently and returns partial batch
 * failure information via `batchItemFailures` so that only failed
 * records are retried by SQS.
 *
 * @param {Object} event - SQS event containing one or more records
 * @param {Array<Object>} event.Records - Array of SQS records
 * @param {Object} context - Lambda context object
 * @param {function(): number} context.getRemainingTimeInMillis - Returns remaining execution time in ms
 * @returns {Promise<{batchItemFailures: Array<{itemIdentifier: string}>}>} Partial batch failure response
 * @example
 * // This function is invoked by the Lambda runtime, not called directly.
 * // Configure as: Handler = handler.handler
 * // Event source: SQS with FunctionResponseTypes: [ReportBatchItemFailures]
 */
async function handler(event, context) {
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      const result = await processRecord(record, context);

      if (!result.success) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    } catch (error) {
      logger.error('processing', 'Error processing record', {
        messageId: record.messageId,
        error: error.message,
        sourceKey: (() => {
          try {
            const s3Event = JSON.parse(record.body);
            return s3Event.Records[0].s3.object.key;
          } catch {
            return '(unable to parse)';
          }
        })()
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  if (batchItemFailures.length > 0) {
    logger.warn('batchResult', 'Batch completed with failures', {
      total: event.Records.length,
      failed: batchItemFailures.length
    });
  } else {
    logger.info('batchResult', 'Batch completed successfully', {
      total: event.Records.length
    });
  }

  return { batchItemFailures };
}

export { handler };
