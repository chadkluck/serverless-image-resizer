/**
 * Unit tests for handler.js — the SQS event handler for the Processor Lambda.
 *
 * Tests the full image processing flow, JSON metadata merge flow,
 * tag validation, authorization, file size enforcement, unsupported
 * file types, partial batch failure reporting, and timeout awareness.
 *
 * Validates: Requirements 1.5, 2.1, 2.2, 2.4, 10.3, 14.1
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Mock all handler dependencies using jest.unstable_mockModule ──

const mockGetObject = jest.fn();
const mockGetObjectTagging = jest.fn();
const mockGetBucketTagging = jest.fn();
const mockPutObject = jest.fn();

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/s3Client.js',
  () => ({
    getObject: mockGetObject,
    getObjectTagging: mockGetObjectTagging,
    getBucketTagging: mockGetBucketTagging,
    putObject: mockPutObject
  })
);

const mockResizeImage = jest.fn();
jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/imageProcessor.js',
  () => ({
    resizeImage: mockResizeImage
  })
);

const mockGenerateMetadata = jest.fn();
const mockMergeMetadata = jest.fn();
const mockMergeWithNewImage = jest.fn();
const mockExtractExif = jest.fn();

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/metadataManager.js',
  () => ({
    generateMetadata: mockGenerateMetadata,
    mergeMetadata: mockMergeMetadata,
    mergeWithNewImage: mockMergeWithNewImage,
    extractExif: mockExtractExif
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/bucketTagCache.js',
  () => ({
    getCachedTags: jest.fn().mockReturnValue(null),
    setCachedTags: jest.fn()
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/pathResolver.js',
  () => ({
    resolveOutputPath: jest.fn().mockReturnValue('test/public/images/photo/')
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/logger.js',
  () => {
    const noop = jest.fn();
    return {
      default: {
        error: noop,
        warn: noop,
        info: noop,
        debug: noop,
        trace: noop,
        setContext: noop
      }
    };
  }
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/config/settings.js',
  () => ({
    default: Object.freeze({
      sizes: { xxLarge: 3000, xLarge: 1920, large: 1000, medium: 800, small: 500, thumb: 250 },
      createWebpVersion: true,
      imageOutputBasePrefix: '/{stageId}/public/images',
      maxImageFileSize: 26214400,
      logLevel: 0,
      stageId: 'test',
      sourceBucket: 'source-bucket'
    })
  })
);

// Import handler after all mocks are registered
const { handler } = await import(
  '../../src/lambda/functions/processor/handler.js'
);


// ── Helpers ──

/**
 * Build a minimal SQS event wrapping an S3 notification.
 *
 * @param {string} messageId - SQS message ID
 * @param {Object} [overrides] - Optional overrides for the S3 record
 * @param {string} [overrides.key] - S3 object key
 * @param {number} [overrides.size] - S3 object size in bytes
 * @param {string} [overrides.bucket] - S3 bucket name
 * @returns {Object} SQS event with one record
 */
function buildSqsEvent(messageId, overrides = {}) {
  return {
    Records: [
      {
        messageId,
        body: JSON.stringify({
          Records: [
            {
              eventSource: 'aws:s3',
              eventName: 'ObjectCreated:Put',
              s3: {
                bucket: { name: overrides.bucket || 'source-bucket' },
                object: {
                  key: overrides.key || 'uploads/test/photo.jpg',
                  size: overrides.size !== undefined ? overrides.size : 1024
                }
              }
            }
          ]
        })
      }
    ]
  };
}

/**
 * Build a multi-record SQS event for partial batch failure testing.
 *
 * @param {Array<{messageId: string, key: string, size: number}>} records
 * @returns {Object} SQS event with multiple records
 */
function buildMultiRecordEvent(records) {
  return {
    Records: records.map(r => ({
      messageId: r.messageId,
      body: JSON.stringify({
        Records: [
          {
            eventSource: 'aws:s3',
            eventName: 'ObjectCreated:Put',
            s3: {
              bucket: { name: 'source-bucket' },
              object: {
                key: r.key,
                size: r.size
              }
            }
          }
        ]
      })
    }))
  };
}

/**
 * Create a simple async generator that yields chunks, simulating an S3 Body stream.
 *
 * @param {Buffer|string} content - Content to yield
 * @returns {Object} Async iterable stream-like object
 */
function createMockStream(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    async *[Symbol.asyncIterator]() {
      yield buf;
    }
  };
}

/** Minimal Lambda context stub. */
const stubContext = {
  getRemainingTimeInMillis: () => 60000
};


// ── Setup for authorized bucket tags ──

/**
 * Configure mocks for a fully authorized output bucket.
 */
function setupAuthorizedBucket() {
  mockGetObjectTagging.mockResolvedValue({
    TagSet: [
      { Key: 'ImageOutputBucket', Value: 'output-bucket' },
      { Key: 'ImageOutputPath', Value: 'photos' },
      { Key: 'stageId', Value: 'test' }
    ]
  });

  mockGetBucketTagging.mockResolvedValue({
    TagSet: [
      { Key: 'AllowImageResizerEvents', Value: 'true' },
      { Key: 'imageResizer:ImageOutputBasePrefix', Value: '/web/@stageId/public/img' }
    ]
  });
}

// ── Tests ──

describe('handler.js unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Full image processing flow ──

  describe('image processing flow', () => {
    it('should resize image, create WebP variants, extract EXIF, generate metadata, and write all outputs', async () => {
      setupAuthorizedBucket();

      // Mock getObject to return a readable stream for the image
      mockGetObject.mockResolvedValue({
        Body: createMockStream(Buffer.from('fake-image-data'))
      });

      // Mock extractExif
      mockExtractExif.mockResolvedValue({ Artist: 'Jane Doe', Make: 'Canon' });

      // Mock resizeImage to return 2 resized images and 2 WebP images
      mockResizeImage.mockResolvedValue({
        resizedImages: [
          { sizeName: 'thumb', buffer: Buffer.from('thumb-data'), width: 250, height: 167, format: 'jpg' },
          { sizeName: 'small', buffer: Buffer.from('small-data'), width: 500, height: 333, format: 'jpg' }
        ],
        webpImages: [
          { sizeName: 'thumb', buffer: Buffer.from('thumb-webp'), width: 250, height: 167 },
          { sizeName: 'small', buffer: Buffer.from('small-webp'), width: 500, height: 333 }
        ]
      });

      // Mock generateMetadata
      const mockMetadata = {
        type: 'jpg',
        sizes: { thumb: [250, 167], small: [500, 333], medium: [], large: [], xLarge: [], xxLarge: [] },
        hasWebp: true,
        credit: 'Jane Doe',
        exif: { Artist: 'Jane Doe' }
      };
      mockGenerateMetadata.mockReturnValue(mockMetadata);

      // putObject resolves successfully
      mockPutObject.mockResolvedValue(undefined);

      const event = buildSqsEvent('msg-img-1');
      const result = await handler(event, stubContext);

      expect(result.batchItemFailures).toEqual([]);

      // putObject called for: 2 resized images + 2 WebP images + 1 metadata.json = 5
      expect(mockPutObject).toHaveBeenCalledTimes(5);

      // Verify resized images were written
      expect(mockPutObject).toHaveBeenCalledWith(
        'output-bucket',
        expect.stringContaining('thumb.jpg'),
        expect.any(Buffer),
        'image/jpeg'
      );
      expect(mockPutObject).toHaveBeenCalledWith(
        'output-bucket',
        expect.stringContaining('small.jpg'),
        expect.any(Buffer),
        'image/jpeg'
      );

      // Verify WebP images were written
      expect(mockPutObject).toHaveBeenCalledWith(
        'output-bucket',
        expect.stringContaining('thumb.webp'),
        expect.any(Buffer),
        'image/webp'
      );
      expect(mockPutObject).toHaveBeenCalledWith(
        'output-bucket',
        expect.stringContaining('small.webp'),
        expect.any(Buffer),
        'image/webp'
      );

      // Verify metadata.json was written
      expect(mockPutObject).toHaveBeenCalledWith(
        'output-bucket',
        expect.stringContaining('metadata.json'),
        expect.any(String),
        'application/json'
      );
    });
  });


  // ── JSON metadata merge flow ──

  describe('JSON metadata merge flow', () => {
    it('should read uploaded JSON, merge with existing metadata, and write updated metadata.json', async () => {
      setupAuthorizedBucket();

      const uploadedJson = { defaultCaption: 'New caption', credit: 'Updated credit' };
      const existingMeta = {
        type: 'jpg',
        sizes: { thumb: [250, 167] },
        hasWebp: true,
        exif: {},
        credit: 'Old credit'
      };
      const mergedMeta = { ...existingMeta, ...uploadedJson };

      // First getObject call: uploaded JSON file
      // Second getObject call: existing metadata.json
      mockGetObject
        .mockResolvedValueOnce({ Body: createMockStream(JSON.stringify(uploadedJson)) })
        .mockResolvedValueOnce({ Body: createMockStream(JSON.stringify(existingMeta)) });

      mockMergeMetadata.mockReturnValue(mergedMeta);
      mockPutObject.mockResolvedValue(undefined);

      const event = buildSqsEvent('msg-json-1', { key: 'uploads/test/photo.json' });
      const result = await handler(event, stubContext);

      expect(result.batchItemFailures).toEqual([]);

      // mergeMetadata should have been called with existing and uploaded
      expect(mockMergeMetadata).toHaveBeenCalledWith(existingMeta, uploadedJson);

      // putObject called once for the updated metadata.json
      expect(mockPutObject).toHaveBeenCalledTimes(1);
      expect(mockPutObject).toHaveBeenCalledWith(
        'output-bucket',
        expect.stringContaining('metadata.json'),
        expect.any(String),
        'application/json'
      );
    });
  });

  // ── Missing ImageOutputBucket tag → error ──

  describe('missing ImageOutputBucket tag', () => {
    it('should return batchItemFailures when ImageOutputBucket tag is missing', async () => {
      mockGetObjectTagging.mockResolvedValue({
        TagSet: [
          { Key: 'ImageOutputPath', Value: 'photos' }
          // No ImageOutputBucket tag
        ]
      });

      const event = buildSqsEvent('msg-no-bucket-1');
      const result = await handler(event, stubContext);

      expect(result.batchItemFailures).toEqual([
        { itemIdentifier: 'msg-no-bucket-1' }
      ]);

      // No objects should be written
      expect(mockPutObject).not.toHaveBeenCalled();
    });
  });

  // ── AllowImageResizerEvents not true → skip ──

  describe('AllowImageResizerEvents not true', () => {
    it('should skip processing and return success when bucket is not authorized', async () => {
      mockGetObjectTagging.mockResolvedValue({
        TagSet: [
          { Key: 'ImageOutputBucket', Value: 'output-bucket' },
          { Key: 'ImageOutputPath', Value: 'photos' }
        ]
      });

      mockGetBucketTagging.mockResolvedValue({
        TagSet: [
          { Key: 'AllowImageResizerEvents', Value: 'false' }
        ]
      });

      const event = buildSqsEvent('msg-not-auth-1');
      const result = await handler(event, stubContext);

      // Intentional skip — no batchItemFailures
      expect(result.batchItemFailures).toEqual([]);

      // No objects should be written
      expect(mockPutObject).not.toHaveBeenCalled();
    });
  });

  // ── File size exceeds limit → skip ──

  describe('file size exceeds limit', () => {
    it('should skip processing and return success when image exceeds maxImageFileSize', async () => {
      setupAuthorizedBucket();

      const oversizedBytes = 26214400 + 1; // 1 byte over the 25MB limit
      const event = buildSqsEvent('msg-oversize-1', {
        key: 'uploads/test/huge.jpg',
        size: oversizedBytes
      });

      const result = await handler(event, stubContext);

      // Intentional skip — no batchItemFailures
      expect(result.batchItemFailures).toEqual([]);

      // No objects should be written
      expect(mockPutObject).not.toHaveBeenCalled();
    });
  });

  // ── Unsupported file type → skip ──

  describe('unsupported file type', () => {
    it('should skip processing and return success for unsupported file extensions', async () => {
      setupAuthorizedBucket();

      const event = buildSqsEvent('msg-unsupported-1', {
        key: 'uploads/test/document.pdf'
      });

      const result = await handler(event, stubContext);

      // Intentional skip — no batchItemFailures
      expect(result.batchItemFailures).toEqual([]);

      // No objects should be written
      expect(mockPutObject).not.toHaveBeenCalled();
    });
  });


  // ── Partial batch failure reporting ──

  describe('partial batch failure reporting', () => {
    it('should report only failed records in batchItemFailures when some records fail', async () => {
      // Record 1: valid image — will succeed
      // Record 2: missing ImageOutputBucket — will fail
      // Record 3: valid image — will succeed

      // For record 1 and 3: authorized bucket, successful processing
      mockGetObjectTagging
        .mockResolvedValueOnce({
          TagSet: [
            { Key: 'ImageOutputBucket', Value: 'output-bucket' },
            { Key: 'ImageOutputPath', Value: 'photos' },
            { Key: 'stageId', Value: 'test' }
          ]
        })
        .mockResolvedValueOnce({
          TagSet: [
            // Missing ImageOutputBucket — this record will fail
            { Key: 'ImageOutputPath', Value: 'photos' }
          ]
        })
        .mockResolvedValueOnce({
          TagSet: [
            { Key: 'ImageOutputBucket', Value: 'output-bucket' },
            { Key: 'ImageOutputPath', Value: 'photos' },
            { Key: 'stageId', Value: 'test' }
          ]
        });

      mockGetBucketTagging.mockResolvedValue({
        TagSet: [
          { Key: 'AllowImageResizerEvents', Value: 'true' },
          { Key: 'imageResizer:ImageOutputBasePrefix', Value: '/web/@stageId/public/img' }
        ]
      });

      // Mock image processing for records 1 and 3
      mockGetObject.mockResolvedValue({
        Body: createMockStream(Buffer.from('fake-image'))
      });
      mockExtractExif.mockResolvedValue({});
      mockResizeImage.mockResolvedValue({
        resizedImages: [
          { sizeName: 'thumb', buffer: Buffer.from('t'), width: 250, height: 167, format: 'jpg' }
        ],
        webpImages: []
      });
      mockGenerateMetadata.mockReturnValue({ type: 'jpg', sizes: {} });
      mockPutObject.mockResolvedValue(undefined);

      const event = buildMultiRecordEvent([
        { messageId: 'msg-ok-1', key: 'uploads/test/a.jpg', size: 1024 },
        { messageId: 'msg-fail-1', key: 'uploads/test/b.jpg', size: 1024 },
        { messageId: 'msg-ok-2', key: 'uploads/test/c.jpg', size: 1024 }
      ]);

      const result = await handler(event, stubContext);

      // Only the second record should be in batchItemFailures
      expect(result.batchItemFailures).toEqual([
        { itemIdentifier: 'msg-fail-1' }
      ]);
    });
  });

  // ── Timeout awareness ──

  describe('timeout awareness', () => {
    it('should complete processing and check remaining time via context.getRemainingTimeInMillis', async () => {
      setupAuthorizedBucket();

      mockGetObject.mockResolvedValue({
        Body: createMockStream(Buffer.from('fake-image'))
      });
      mockExtractExif.mockResolvedValue({});
      mockResizeImage.mockResolvedValue({
        resizedImages: [
          { sizeName: 'thumb', buffer: Buffer.from('t'), width: 250, height: 167, format: 'jpg' }
        ],
        webpImages: []
      });
      mockGenerateMetadata.mockReturnValue({ type: 'jpg', sizes: {} });
      mockPutObject.mockResolvedValue(undefined);

      const mockGetRemainingTime = jest.fn().mockReturnValue(3000); // 3 seconds remaining
      const lowTimeContext = {
        getRemainingTimeInMillis: mockGetRemainingTime
      };

      const event = buildSqsEvent('msg-timeout-1');
      const result = await handler(event, lowTimeContext);

      expect(result.batchItemFailures).toEqual([]);

      // Verify context.getRemainingTimeInMillis was called
      expect(mockGetRemainingTime).toHaveBeenCalled();
    });

    it('should still succeed even when remaining time is very low', async () => {
      setupAuthorizedBucket();

      mockGetObject.mockResolvedValue({
        Body: createMockStream(Buffer.from('fake-image'))
      });
      mockExtractExif.mockResolvedValue({});
      mockResizeImage.mockResolvedValue({
        resizedImages: [
          { sizeName: 'thumb', buffer: Buffer.from('t'), width: 250, height: 167, format: 'jpg' }
        ],
        webpImages: []
      });
      mockGenerateMetadata.mockReturnValue({ type: 'jpg', sizes: {} });
      mockPutObject.mockResolvedValue(undefined);

      const lowTimeContext = {
        getRemainingTimeInMillis: () => 1000 // Only 1 second remaining
      };

      const event = buildSqsEvent('msg-timeout-2');
      const result = await handler(event, lowTimeContext);

      // Processing still completes — timeout awareness is informational
      expect(result.batchItemFailures).toEqual([]);
    });
  });
});
