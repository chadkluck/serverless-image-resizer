/**
 * Property-based tests for file size enforcement in handler.js
 *
 * Feature: 0-0-1-initial-project, Property 12: File size enforcement
 *
 * Validates: Requirements 10.3
 *
 * For any image file size that exceeds the configured maxImageFileSize
 * (26214400 bytes), the handler treats the event as an intentional skip
 * (returns success with no batchItemFailures), and does not call getObject
 * or putObject (file is rejected before downloading or writing).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import fc from 'fast-check';

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

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/imageProcessor.js',
  () => ({
    resizeImage: jest.fn()
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/metadataManager.js',
  () => ({
    generateMetadata: jest.fn(),
    mergeMetadata: jest.fn(),
    mergeWithNewImage: jest.fn(),
    extractExif: jest.fn()
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
    resolveOutputPath: jest.fn().mockReturnValue('some/output/path/')
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

/**
 * Build a minimal SQS event wrapping an S3 notification with a given file size
 * and image extension.
 *
 * @param {string} messageId - SQS message ID
 * @param {number} fileSize - Size of the uploaded file in bytes
 * @param {string} extension - File extension (e.g., 'jpg', 'png', 'gif')
 * @returns {Object} SQS event with one record
 */
function buildSqsEvent(messageId, fileSize, extension) {
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
                bucket: { name: 'source-bucket' },
                object: {
                  key: `uploads/test/photo.${extension}`,
                  size: fileSize
                }
              }
            }
          ]
        })
      }
    ]
  };
}

/** Minimal Lambda context stub. */
const stubContext = {
  getRemainingTimeInMillis: () => 60000
};

describe('Property 12: File size enforcement', () => {
  // **Validates: Requirements 10.3**

  beforeEach(() => {
    jest.clearAllMocks();

    // Object tags include a valid ImageOutputBucket
    mockGetObjectTagging.mockResolvedValue({
      TagSet: [
        { Key: 'ImageOutputBucket', Value: 'output-bucket' },
        { Key: 'ImageOutputPath', Value: 'photos' }
      ]
    });

    // Bucket tags authorize the output bucket
    mockGetBucketTagging.mockResolvedValue({
      TagSet: [
        { Key: 'AllowImageResizerEvents', Value: 'true' }
      ]
    });
  });

  it('should return success with no batchItemFailures and never call getObject or putObject for oversized image files', async () => {
    // Feature: 0-0-1-initial-project, Property 12: File size enforcement
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 26214401, max: 100000000 }),
        fc.constantFrom('jpg', 'jpeg', 'png', 'gif'),
        async (fileSize, extension) => {
          jest.clearAllMocks();

          // Re-stub after clearAllMocks
          mockGetObjectTagging.mockResolvedValue({
            TagSet: [
              { Key: 'ImageOutputBucket', Value: 'output-bucket' },
              { Key: 'ImageOutputPath', Value: 'photos' }
            ]
          });

          mockGetBucketTagging.mockResolvedValue({
            TagSet: [
              { Key: 'AllowImageResizerEvents', Value: 'true' }
            ]
          });

          const event = buildSqsEvent(`msg-${fileSize}-${extension}`, fileSize, extension);
          const result = await handler(event, stubContext);

          // Handler returns success (no batchItemFailures) — intentional skip
          expect(result.batchItemFailures).toEqual([]);

          // getObject is never called (file is rejected before downloading)
          expect(mockGetObject).not.toHaveBeenCalled();

          // putObject is never called (no objects written)
          expect(mockPutObject).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
