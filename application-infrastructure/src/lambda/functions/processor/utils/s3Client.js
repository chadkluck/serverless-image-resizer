/**
 * Wrapper around AWS SDK v3 S3 client operations used by the
 * Processor Lambda. Provides simplified interfaces for reading
 * objects, reading tags, and writing objects.
 *
 * Uses the AWS SDK already available in the Lambda nodejs24.x
 * runtime — no bundling or npm install required.
 *
 * @module utils/s3Client
 * @example
 * import { getObject, getObjectTagging, getBucketTagging, putObject } from './utils/s3Client.js';
 *
 * // Read an uploaded image from the source bucket
 * const { Body, ContentLength, ContentType } = await getObject('source-bucket', 'uploads/photo.jpg');
 *
 * // Read object tags to determine routing
 * const { TagSet } = await getObjectTagging('source-bucket', 'uploads/photo.jpg');
 *
 * // Read bucket tags for authorization and prefix resolution
 * const { TagSet: bucketTags } = await getBucketTagging('output-bucket');
 *
 * // Write a resized image to the output bucket
 * await putObject('output-bucket', 'prod/images/photo/large.jpg', resizedBuffer, 'image/jpeg');
 */

import {
  S3Client,
  GetObjectCommand,
  GetObjectTaggingCommand,
  GetBucketTaggingCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';

/** @type {S3Client} */
const client = new S3Client();

/**
 * Retrieve an object from an S3 bucket.
 *
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<{Body: ReadableStream, ContentLength: number, ContentType: string}>} Object data with body stream, size, and MIME type
 * @throws {Error} When the object does not exist or access is denied
 * @example
 * const { Body, ContentLength, ContentType } = await getObject('my-bucket', 'uploads/photo.jpg');
 * const chunks = [];
 * for await (const chunk of Body) {
 *   chunks.push(chunk);
 * }
 * const buffer = Buffer.concat(chunks);
 */
async function getObject(bucket, key) {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  return {
    Body: response.Body,
    ContentLength: response.ContentLength,
    ContentType: response.ContentType
  };
}

/**
 * Retrieve the tags associated with an S3 object.
 *
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<{TagSet: Array<{Key: string, Value: string}>}>} Object containing the tag set array
 * @throws {Error} When the object does not exist or access is denied
 * @example
 * const { TagSet } = await getObjectTagging('my-bucket', 'uploads/photo.jpg');
 * const outputBucket = TagSet.find(t => t.Key === 'ImageOutputBucket')?.Value;
 */
async function getObjectTagging(bucket, key) {
  const response = await client.send(
    new GetObjectTaggingCommand({ Bucket: bucket, Key: key })
  );
  return { TagSet: response.TagSet };
}

/**
 * Retrieve the tags associated with an S3 bucket.
 * Used to read authorization and prefix configuration from
 * output bucket tags.
 *
 * @param {string} bucket - S3 bucket name
 * @returns {Promise<{TagSet: Array<{Key: string, Value: string}>}>} Object containing the bucket tag set array
 * @throws {Error} When the bucket does not exist or access is denied
 * @example
 * const { TagSet } = await getBucketTagging('output-bucket');
 * const isAllowed = TagSet.find(t => t.Key === 'AllowImageResizerEvents')?.Value === 'true';
 */
async function getBucketTagging(bucket) {
  const response = await client.send(
    new GetBucketTaggingCommand({ Bucket: bucket })
  );
  return { TagSet: response.TagSet };
}

/**
 * Write an object to an S3 bucket.
 *
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {Buffer|string} body - Object content to write
 * @param {string} contentType - MIME type of the object (e.g. 'image/jpeg', 'application/json')
 * @returns {Promise<void>}
 * @throws {Error} When access is denied or the bucket does not exist
 * @example
 * await putObject('output-bucket', 'prod/images/photo/large.jpg', imageBuffer, 'image/jpeg');
 */
async function putObject(bucket, key, body, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

export { getObject, getObjectTagging, getBucketTagging, putObject };
