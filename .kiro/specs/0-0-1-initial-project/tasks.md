# Implementation Plan: Serverless Image Resizer

## Overview

Convert the Atlantis Starter 00 (API Gateway + Lambda) into an event-driven image processing pipeline. Images uploaded to a source S3 bucket are queued via SQS and processed by a Lambda function using Sharp (arm64 layer) to resize, create WebP variants, extract EXIF metadata, and write outputs to dynamically determined destination buckets. Implementation uses Node.js (nodejs24.x), Jest for testing, and fast-check for property-based tests.

## Tasks

- [x] 1. Restructure project directories and create foundational files
  - [x] 1.1 Create new directory structure and Lambda function package.json
    - Create `src/lambda/functions/processor/` directory with `package.json` (no sharp, no AWS SDK — only runtime dependencies if any)
    - Create `src/lambda/functions/processor/config/` and `src/lambda/functions/processor/utils/` directories
    - Create `src/lambda/layers/sharp-arm64/nodejs/package.json` with sharp dependency (`"sharp": "^0.33.0"`)
    - Remove old `src/index.js` and `src/package.json`
    - _Requirements: 9.5_

  - [x] 1.2 Create root-level test infrastructure
    - Create `application-infrastructure/package.json` with devDependencies: `jest`, `fast-check`, `@jest/globals`, `aws-sdk-client-mock`, `aws-sdk-client-mock-jest`
    - Create `application-infrastructure/test/jest.config.mjs` with ESM support, test match patterns for `test/unit/**/*.jest.mjs` and `test/property/**/*.jest.mjs`
    - Create `application-infrastructure/test/unit/` and `application-infrastructure/test/property/` directories
    - _Requirements: 12.1_

- [x] 2. Implement settings module and logger
  - [x] 2.1 Implement `config/settings.js`
    - Export a frozen configuration object reading from environment variables with fallback defaults
    - Settings: `sizes` (xxLarge=3000, xLarge=1920, large=1000, medium=800, small=500, thumb=250), `createWebpVersion` (bool, default true), `imageOutputBasePrefix` (string, default `/{stageId}/public/images`), `maxImageFileSize` (number, default 26214400), `logLevel` (number, default 0), `stageId` (string, default ''), `sourceBucket` (string, default '')
    - _Requirements: 4.5, 9.6, 10.2, 15.1, 15.2, 15.3, 15.4_

  - [x] 2.2 Implement `utils/logger.js`
    - Configurable log level from settings
    - Methods: `error()`, `warn()`, `info()`, `debug()`, `trace()`
    - Structured JSON output including `requestId`, `sourceKey`, `outputBucket`, `action`
    - Must not log full AWS SDK responses
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 2.3 Write unit tests for settings module
    - Test each env var set → correct parsed value
    - Test each env var unset → correct default value
    - Test frozen object cannot be modified
    - `test/unit/settings.jest.mjs`
    - _Requirements: 15.2, 15.3_

  - [x] 2.4 Write property test for settings module
    - **Property 11: Settings module environment variable resolution**
    - **Validates: Requirements 9.6, 15.2**
    - `test/property/settings-property.jest.mjs`

  - [x] 2.5 Write unit tests for logger
    - Test log level filtering, structured output format, context fields
    - `test/unit/logger.jest.mjs`
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 3. Implement utility modules
  - [x] 3.1 Implement `utils/bucketTagCache.js`
    - Module-level `Map` for caching bucket tag lookups
    - `getCachedTags(bucketName)` → cached tag object or `null`
    - `setCachedTags(bucketName, tags)` → void
    - No TTL — cache lives for Lambda execution environment lifetime
    - _Requirements: 2.8_

  - [x] 3.2 Implement `utils/s3Client.js`
    - Wrap AWS SDK v3 S3 client: `getObject`, `getObjectTagging`, `getBucketTagging`, `putObject`
    - Use SDK already available in Lambda runtime (no bundling)
    - _Requirements: 2.1, 2.3, 11.1, 11.2, 11.3_

  - [x] 3.3 Implement `utils/pathResolver.js`
    - `resolveOutputPath(bucketBasePrefix, stackBasePrefix, objectTags, stageId)` → resolved full prefix string
    - Replace `@stageId` in bucket tag values, `{stageId}` in stack parameter values
    - Construct `<resolvedBasePrefix>/<ImageOutputPath>/<originalFileName>/`
    - Handle missing `ImageOutputPath` (empty string, no double slashes)
    - _Requirements: 2.5, 2.6, 7.1, 7.2, 7.3, 7.4_

  - [x] 3.4 Implement `utils/imageProcessor.js`
    - `resizeImage(imageBuffer, originalFormat, sizes, createWebp)` → `{ resizedImages, webpImages }`
    - Determine long side, iterate tiers smallest to largest
    - If original long side >= tier: resize proportionally. If < tier: save at original dimensions, skip larger tiers
    - If `createWebp` true, create `.webp` variant for each resized image
    - Retain original format for each variant
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2_

  - [x] 3.5 Implement `utils/metadataManager.js`
    - `generateMetadata(exifData, sizes, hasWebp, originalFormat)` → metadata object
    - `mergeMetadata(existingMetadata, uploadedJson)` → merged metadata object
    - `extractExif(imageBuffer)` → raw EXIF object
    - All fields always present, no null values (use `""`, `{}`, `[]`)
    - All six size tiers in `sizes` object, skipped tiers use `[]`
    - Populate `credit` from EXIF `Artist` if `credit` is empty
    - On image re-upload: replace EXIF, preserve non-empty descriptive fields
    - On JSON upload: overwrite provided fields, convert null to empty, preserve `sizes`/`exif`/`hasWebp` unless explicitly provided
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 3.6 Write unit tests for bucketTagCache
    - Test first call returns null, setCachedTags stores, getCachedTags retrieves
    - `test/unit/bucketTagCache.jest.mjs`
    - _Requirements: 2.8_

  - [x] 3.7 Write unit tests for pathResolver
    - Test `@stageId` replacement, `{stageId}` replacement, missing ImageOutputPath, no placeholder ignores stageId
    - `test/unit/pathResolver.jest.mjs`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 3.8 Write property test for path resolution
    - **Property 5: Output path resolution with placeholder substitution**
    - **Validates: Requirements 2.6, 3.6, 7.1, 7.2, 7.3**
    - `test/property/pathResolver-property.jest.mjs`

  - [x] 3.9 Write unit tests for imageProcessor
    - Test resize for various image dimensions, skip logic, format retention, WebP toggle
    - Mock Sharp where needed
    - `test/unit/imageProcessor.jest.mjs`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1_

  - [x] 3.10 Write property tests for imageProcessor
    - **Property 2: Image resize tier selection and skip logic**
    - **Property 3: Aspect ratio preservation**
    - **Property 4: Output format retention**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
    - `test/property/imageProcessor-property.jest.mjs`

  - [x] 3.11 Write unit tests for metadataManager
    - Test metadata generation with various EXIF inputs, all fields present, no nulls
    - Test merge: overwrite fields, null-to-empty conversion, preserve sizes/exif/hasWebp
    - Test credit from EXIF Artist
    - Test image re-upload preserves non-empty descriptive fields
    - `test/unit/metadataManager.jest.mjs`
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 6.3, 6.4, 6.5, 6.6_

  - [x] 3.12 Write property tests for metadataManager
    - **Property 6: Metadata schema completeness and no-null invariant**
    - **Property 7: Credit populated from EXIF Artist**
    - **Property 8: JSON metadata merge with null-to-empty conversion**
    - **Property 9: JSON merge preserves protected fields**
    - **Property 10: Image re-upload preserves non-empty descriptive fields**
    - **Validates: Requirements 5.2, 5.4, 5.5, 5.6, 6.3, 6.4, 6.5, 6.6**
    - `test/property/metadataManager-property.jest.mjs`

- [x] 4. Checkpoint - Ensure all utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Lambda handler
  - [x] 5.1 Implement `handler.js`
    - SQS event handler with partial batch failure reporting (`ReportBatchItemFailures`)
    - For each SQS record: parse S3 event, get object tags, validate `ImageOutputBucket`, get/cache bucket tags, validate `AllowImageResizerEvents === 'true'`, resolve output path, check file size, branch on extension (image vs JSON)
    - Image path: resize, optional WebP, extract EXIF, generate metadata, write all outputs
    - JSON path: read existing metadata from output bucket, merge uploaded JSON, write updated metadata
    - Use `context.getRemainingTimeInMillis()` for timeout awareness
    - Intentional skips (bucket not authorized, file too large, unsupported type) return success to SQS
    - Failures return `batchItemFailures` for retry
    - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.6, 4.1, 4.3, 4.4, 5.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 9.4, 10.3, 11.4, 14.1, 14.4_

  - [x] 5.2 Write property test for bucket authorization
    - **Property 1: Bucket authorization rejects non-true values**
    - **Validates: Requirements 2.4, 11.4**
    - `test/property/authorization-property.jest.mjs`

  - [x] 5.3 Write property test for file size enforcement
    - **Property 12: File size enforcement**
    - **Validates: Requirements 10.3**
    - `test/property/fileSizeCheck-property.jest.mjs`

  - [x] 5.4 Write unit tests for handler
    - Test full image processing flow (mocked S3 and Sharp)
    - Test JSON metadata merge flow
    - Test missing ImageOutputBucket tag → error
    - Test AllowImageResizerEvents not true → skip
    - Test file size exceeds limit → skip
    - Test unsupported file type → skip
    - Test partial batch failure reporting
    - Test timeout awareness
    - `test/unit/handler.jest.mjs`
    - _Requirements: 1.5, 2.1, 2.2, 2.4, 10.3, 14.1_

- [x] 6. Checkpoint - Ensure all Lambda tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update CloudFormation template
  - [x] 7.1 Remove API Gateway resources and parameters from `template.yml`
    - Remove resources: `WebApi`, `ApiGatewayAccessLogGroup`, `ApiGatewayExecutionLogGroup`, `ConfigLambdaPermission`, `ConfigLambdaPermissionLive`
    - Remove parameters: `ApiPathBase`, `ApiGatewayLoggingEnabled`
    - Remove condition: `ApiGatewayLoggingIsEnabled`
    - Remove related outputs: `ApiEndpoint`, `CloudWatchApiGatewayExecutionLogGroup`, `CloudWatchApiGatewayAccessLogGroup`
    - Remove `Globals` section (Api OpenApiVersion)
    - _Requirements: 1.1 (replacing API Gateway with S3+SQS)_

  - [x] 7.2 Add new parameters to `template.yml`
    - `CreateWebpVersion` (String, default `true`, AllowedValues `true`/`false`)
    - `ImageOutputBasePrefix` (String, default `/{stageId}/public/images`, with AllowedPattern)
    - `MaxImageFileSize` (Number, default 26214400)
    - `SourceBucketRetentionInDaysForPROD` (Number, default 5)
    - `SourceBucketRetentionInDaysForDEVTEST` (Number, default 1)
    - Modify `FunctionTimeOutInSeconds`: default 60, MaxValue 900
    - Modify `FunctionMaxMemoryInMB`: default 2048
    - Remove `FunctionArchitecture` parameter (hardcode arm64)
    - _Requirements: 4.5, 7.4, 8.2, 9.1, 9.2, 10.1_

  - [x] 7.3 Add new conditions to `template.yml`
    - `UseS3BucketNameOrgPrefix`: `!Not [!Equals [!Ref S3BucketNameOrgPrefix, ""]]`
    - `SourceBucketArchiveMode`: conditional on retention = 0 for current environment
    - _Requirements: 8.1, 8.3, 8.4_

  - [x] 7.4 Add SourceBucket resource to `template.yml`
    - `AWS::S3::Bucket` with regional naming (`BucketNamespace: account-regional`)
    - Conditional org prefix in bucket name
    - S3 event notification to ProcessingQueue filtered to `uploads/` prefix
    - Lifecycle rules: expiration mode (retention > 0) or archive mode (retention = 0 with Glacier Deep Archive transition at 30 days, non-current version expiration at 30 days)
    - Conditional versioning (archive mode only)
    - DeletionPolicy: Retain for PROD, Delete for non-PROD
    - _Requirements: 1.1, 1.2, 8.1, 8.2, 8.3, 8.4_

  - [x] 7.5 Add SQS resources to `template.yml`
    - `ProcessingQueue`: standard SQS, visibility timeout 360s (6x Lambda timeout), redrive policy to DLQ with maxReceiveCount 3
    - `DeadLetterQueue`: standard SQS, 14-day message retention
    - `ProcessingQueuePolicy`: allow S3 to send messages from SourceBucket
    - _Requirements: 1.3, 1.4_

  - [x] 7.6 Add SharpLayer and ProcessorFunction to `template.yml`
    - `SharpLayer` (AWS::Serverless::LayerVersion): ContentUri `src/lambda/layers/sharp-arm64/`, compatible with nodejs24.x and arm64
    - `ProcessorFunction` (AWS::Serverless::Function): replaces AppFunction, CodeUri `src/lambda/functions/processor/`, Handler `handler.handler`, Runtime nodejs24.x, arm64, Layers includes SharpLayer, SQS event source with BatchSize 1 and ReportBatchItemFailures
    - Environment variables: NODE_ENV, DEPLOY_ENVIRONMENT, LOG_LEVEL, CREATE_WEBP_VERSION, IMAGE_OUTPUT_BASE_PREFIX, MAX_IMAGE_FILE_SIZE, SOURCE_BUCKET, STAGE_ID
    - Update AppLogGroup, AppFunctionErrorsAlarm, AppFunctionErrorAlarmNotification to reference ProcessorFunction
    - Update gradual deployment configuration (AutoPublishAlias, DeploymentPreference)
    - _Requirements: 1.5, 9.1, 9.2, 9.3, 9.5_

  - [x] 7.7 Update IAM policy in `template.yml`
    - Add `ReadSourceBucket` statement: `s3:GetObject`, `s3:GetObjectTagging` on `${SourceBucket.Arn}/*`
    - Add `WriteToOutputBuckets` statement: `s3:PutObject` on `arn:aws:s3:::*`
    - Add `ReadBucketTags` statement: `s3:GetBucketTagging` on `arn:aws:s3:::*`
    - Add `SqsConsume` statement: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` on ProcessingQueue
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 7.8 Update Outputs section in `template.yml`
    - Remove API Gateway outputs
    - Add SourceBucket name/ARN output
    - Add ProcessingQueue URL output
    - Add DeadLetterQueue URL output
    - Update Lambda web console link to ProcessorFunction
    - Update CloudWatch log group link
    - _Requirements: 1.1_

- [x] 8. Update build and deployment configuration
  - [x] 8.1 Update `template-configuration.json`
    - Remove `ApiPathBase` and `ApiGatewayLoggingEnabled` from Parameters
    - _Requirements: 12.3_

  - [x] 8.2 Update `buildspec.yml`
    - Update `pre_build` to install Lambda function dependencies from `src/lambda/functions/processor/`
    - Add Sharp layer build step: `cd src/lambda/layers/sharp-arm64/nodejs && npm install --arch=arm64 --platform=linux`
    - Add Jest test step: `npx jest --run --ci --coverage` (before SAM packaging)
    - Remove old `cd src && npm install` references
    - _Requirements: 9.3, 12.1, 12.2, 12.4_

- [x] 9. Checkpoint - Validate template and build configuration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Update documentation
  - [x] 10.1 Update end-user documentation (`docs/end-user/`)
    - Document required `x-amz-tagging` HTTP header format for S3 uploads
    - Provide AWS CLI examples for uploading images and JSON files with object tags (`ImageOutputBucket`, `ImageOutputPath`, `stageId`)
    - Document required bucket tags (`AllowImageResizerEvents`, `imageResizer:ImageOutputBasePrefix`) with `@stageId` placeholder format
    - Document supported image formats and size tiers
    - Document metadata.json schema and JSON upload for metadata updates
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 10.2 Update admin-ops documentation (`docs/admin-ops/`)
    - Document error log monitoring with CloudWatch log filter patterns
    - Document DLQ inspection commands (AWS CLI)
    - Document source bucket lifecycle management
    - Document CloudWatch metrics and alarm configuration
    - _Requirements: 14.1, 14.4_

  - [x] 10.3 Update developer documentation (`docs/developer/`)
    - Document architecture overview (S3 → SQS → Lambda pipeline)
    - Document local development setup and testing guide
    - Document module structure and responsibilities
    - Document deployment via Atlantis pipeline
    - _Requirements: 9.5, 12.3_

  - [x] 10.4 Update root documentation files
    - Update `ARCHITECTURE.md` with new architecture diagram and directory structure
    - Update `README.md` with project description, features, and quick start
    - Update `CHANGELOG.md` with v0.0.1 changes
    - Update `DEPLOYMENT.md` with new build and deployment steps
    - _Requirements: 12.3_

- [x] 11. Final checkpoint - Ensure all tests pass and documentation is complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All code uses JavaScript (Node.js) with ESM modules
- AWS SDK v3 is used but not bundled (available in Lambda runtime)
- Sharp is provided via Lambda Layer, not bundled with function code
