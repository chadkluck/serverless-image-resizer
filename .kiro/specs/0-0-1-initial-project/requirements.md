# Requirements Document

## Introduction

This document defines the requirements for a Serverless Image Resizer application deployed on AWS using the Atlantis platform. The application receives images uploaded to a source S3 bucket, processes them through a Lambda function (triggered via SQS), resizes them into multiple predefined sizes, optionally creates WebP variants, extracts metadata, and writes the outputs to dynamically determined destination S3 buckets based on object and bucket tags. The application follows event-driven, serverless-first architecture principles and uses Sharp (via Lambda Layer) for image processing.

## Glossary

- **Image_Resizer**: The serverless application stack comprising the source S3 bucket, SQS queue, Dead Letter Queue, Lambda function, Sharp Lambda Layer, and associated IAM roles
- **Processor_Lambda**: The single Lambda function that receives SQS events and performs image resizing, WebP conversion, metadata generation, and output to destination buckets
- **Source_Bucket**: The S3 bucket owned by this stack where images and JSON metadata files are uploaded to the `uploads/` prefix for processing
- **Output_Bucket**: Any external S3 bucket tagged with `AllowImageResizerEvents=true` where resized images and metadata are written
- **Processing_Queue**: The standard SQS queue that receives S3 event notifications from the Source_Bucket and serves as the event source for the Processor_Lambda
- **Dead_Letter_Queue**: The SQS queue that receives messages from the Processing_Queue after repeated processing failures
- **Sharp_Layer**: The Lambda Layer containing the Sharp npm package built for the arm64/linux platform
- **Settings_Module**: The `config/settings.js` module that resolves configuration from environment variables with fallback defaults
- **Bucket_Tag_Cache**: An in-memory cache within the Processor_Lambda that stores Output_Bucket tag lookups to reduce repeated S3 API calls across invocations
- **Image_Output_Base_Prefix**: The base path prefix for output objects, resolved from the Output_Bucket tag `imageResizer:ImageOutputBasePrefix` or the stack parameter `ImageOutputBasePrefix`, with `@stageId` or `{stageId}` placeholders replaced by the actual stage identifier
- **Metadata_File**: The `metadata.json` file generated for each processed image containing EXIF data, descriptive fields, credit information, and size dimensions

## Requirements

### Requirement 1: S3 event ingestion via SQS

**User Story:** As an external process, I want to upload images and JSON files to the source bucket so that they are automatically queued for processing.

#### Acceptance Criteria

1. WHEN an object is created under the `uploads/` prefix of the Source_Bucket, THE Source_Bucket SHALL send an S3 event notification to the Processing_Queue
2. THE Source_Bucket SHALL filter S3 event notifications to the `uploads/` prefix only
3. THE Processing_Queue SHALL be a standard SQS queue with a visibility timeout equal to six times the Processor_Lambda timeout
4. WHEN a message in the Processing_Queue fails processing after the configured maximum receive count, THE Processing_Queue SHALL move the message to the Dead_Letter_Queue
5. THE Processor_Lambda SHALL use the Processing_Queue as its event source

### Requirement 2: Object tag validation and routing

**User Story:** As the system operator, I want uploaded objects to be routed to the correct output bucket and path based on object tags so that images are organized according to the uploading client's intent.

#### Acceptance Criteria

1. WHEN an object is received for processing, THE Processor_Lambda SHALL read the object tags `ImageOutputBucket`, `ImageOutputPath`, and `stageId` from the uploaded S3 object
2. IF the `ImageOutputBucket` tag is missing from the uploaded object, THEN THE Processor_Lambda SHALL reject the event and log an error
3. WHEN the `ImageOutputBucket` tag is present, THE Processor_Lambda SHALL retrieve the bucket tags `AllowImageResizerEvents` and `imageResizer:ImageOutputBasePrefix` from the specified Output_Bucket
4. IF the `AllowImageResizerEvents` tag does not exist on the Output_Bucket or is set to any value other than `true`, THEN THE Processor_Lambda SHALL ignore the event and log the reason
5. WHEN the Output_Bucket tag `imageResizer:ImageOutputBasePrefix` contains a `@stageId` placeholder but the uploaded object does not have a `stageId` tag, THEN THE Processor_Lambda SHALL reject the event and log an error
6. WHEN the Output_Bucket tag `imageResizer:ImageOutputBasePrefix` does not contain a `@stageId` placeholder, THE Processor_Lambda SHALL ignore the `stageId` tag from the uploaded object
7. IF the Output_Bucket does not have an `imageResizer:ImageOutputBasePrefix` tag, THEN THE Processor_Lambda SHALL use the stack parameter `ImageOutputBasePrefix` as the base prefix
8. THE Processor_Lambda SHALL store Output_Bucket tag lookups in the Bucket_Tag_Cache to reduce repeated S3 API calls across invocations within the same Lambda execution environment

### Requirement 3: Image resizing

**User Story:** As a content publisher, I want uploaded images resized into multiple predefined sizes so that I have appropriately sized variants for different display contexts.

#### Acceptance Criteria

1. WHEN a supported image file (.jpg, .png, .gif) is processed, THE Processor_Lambda SHALL resize the image proportionally based on the long side into the following sizes: xxLarge (3000px), xLarge (1920px), large (1000px), medium (800px), small (500px), thumb (250px)
2. THE Processor_Lambda SHALL maintain the original aspect ratio for each resized variant
3. WHEN the original image long side is smaller than a size threshold, THE Processor_Lambda SHALL save the image at its original dimensions for that size tier and skip all larger size tiers
4. THE Processor_Lambda SHALL retain the original file format (.jpg, .png, .gif) for each resized variant
5. THE Processor_Lambda SHALL support additional image formats handled by Sharp if processing those formats does not add overhead or additional dependencies
6. THE Processor_Lambda SHALL write each resized variant to the Output_Bucket at the path `<Image_Output_Base_Prefix>/<ImageOutputPath>/<originalFileName>/<sizeName>.<originalExtension>`

### Requirement 4: WebP conversion

**User Story:** As a content publisher, I want WebP versions of each resized image so that I can serve optimized images to browsers that support WebP.

#### Acceptance Criteria

1. WHILE the `CREATE_WEBP_VERSION` environment variable is set to `true`, THE Processor_Lambda SHALL create a `.webp` variant for each resized image
2. THE Processor_Lambda SHALL store WebP variants in the same directory as the original format variants with the `.webp` extension
3. WHEN WebP conversion is enabled, THE Processor_Lambda SHALL set the `hasWebp` field to `true` in the Metadata_File
4. WHEN WebP conversion is disabled, THE Processor_Lambda SHALL set the `hasWebp` field to `false` in the Metadata_File
5. THE Settings_Module SHALL read the `CREATE_WEBP_VERSION` environment variable and default to `true` if the variable is not set

### Requirement 5: Metadata generation

**User Story:** As a content consumer, I want a metadata.json file generated for each processed image so that I can access image dimensions, EXIF data, and descriptive information programmatically.

#### Acceptance Criteria

1. WHEN an image is processed, THE Processor_Lambda SHALL generate a Metadata_File at `<Image_Output_Base_Prefix>/<ImageOutputPath>/<originalFileName>/metadata.json` in the Output_Bucket
2. THE Metadata_File SHALL contain the following top-level fields: `type`, `lastModified`, `created`, `exif`, `locationName`, `locationCoord`, `defaultDescription`, `defaultLongDescription`, `defaultAltText`, `defaultCaption`, `credit`, `copyright`, `dateTaken`, `hasWebp`, `sizes`
3. THE Processor_Lambda SHALL include a raw dump of all EXIF data in the `exif` field of the Metadata_File
4. WHEN the `credit` field is empty and the EXIF `Artist` tag is present, THE Processor_Lambda SHALL populate the `credit` field with the EXIF `Artist` value
5. THE `sizes` object in the Metadata_File SHALL list all size tiers (xxLarge, xLarge, large, medium, small, thumb) with `[width, height]` arrays for generated sizes and empty arrays `[]` for skipped sizes
6. THE Metadata_File SHALL contain no null values; all fields SHALL use empty values (`""`, `{}`, `[]`) when no data is available

### Requirement 6: JSON metadata upload and merge

**User Story:** As a content publisher, I want to upload a JSON file to update image metadata so that I can provide descriptions, captions, alt text, and credits without re-uploading the image.

#### Acceptance Criteria

1. WHEN a `.json` file is uploaded to the `uploads/` prefix of the Source_Bucket with the same object tags as an image, THE Processor_Lambda SHALL use the JSON content to update the corresponding Metadata_File in the Output_Bucket
2. THE uploaded JSON file SHALL use the same `ImageOutputBucket`, `ImageOutputPath`, and `stageId` object tags as image uploads
3. WHEN an uploaded JSON file contains field values, THE Processor_Lambda SHALL overwrite the corresponding fields in the existing Metadata_File with the uploaded values
4. WHEN an uploaded JSON file contains null values for fields, THE Processor_Lambda SHALL replace those fields with empty values (`""`, `{}`, `[]`) in the Metadata_File
5. THE Processor_Lambda SHALL preserve the `sizes`, `exif`, and `hasWebp` fields from the existing Metadata_File when processing a JSON upload, unless explicitly provided in the uploaded JSON
6. WHEN a new image is uploaded and EXIF data is extracted, THE Processor_Lambda SHALL replace existing EXIF data but SHALL preserve non-empty descriptive fields (defaultDescription, defaultLongDescription, defaultAltText, defaultCaption, credit, copyright) that were previously set

### Requirement 7: Output path resolution

**User Story:** As a system operator, I want the output path to be dynamically resolved from bucket tags, object tags, and stack parameters so that multiple stages and applications can share output buckets with proper path isolation.

#### Acceptance Criteria

1. THE Processor_Lambda SHALL resolve the output base prefix by replacing `@stageId` in the Output_Bucket tag value or `{stageId}` in the stack parameter value with the actual `stageId` from the object tag
2. THE Processor_Lambda SHALL construct the full output path as `<resolvedBasePrefix>/<ImageOutputPath>/<originalFileName>/`
3. WHEN the `ImageOutputPath` object tag is not present, THE Processor_Lambda SHALL use an empty string for the ImageOutputPath segment
4. THE `ImageOutputBasePrefix` stack parameter SHALL default to `/{stageId}/public/images` and SHALL be passed to the Processor_Lambda as the `IMAGE_OUTPUT_BASE_PREFIX` environment variable

### Requirement 8: Source bucket lifecycle management

**User Story:** As a system operator, I want uploaded originals to be automatically cleaned up or archived based on configurable retention so that storage costs are managed appropriately.

#### Acceptance Criteria

1. WHEN the retention parameter is greater than zero, THE Source_Bucket SHALL apply an expiration lifecycle rule on the `uploads/` prefix with the configured number of days
2. THE Image_Resizer SHALL provide separate retention parameters for PROD (default 5 days) and non-PROD (default 1 day) environments
3. WHEN the retention parameter is set to zero, THE Source_Bucket SHALL enable versioning, transition current objects under the `uploads/` prefix to Glacier Deep Archive after 30 days, and retain non-current versions for 30 days
4. WHEN the retention parameter is set to zero, THE Source_Bucket SHALL not apply an expiration lifecycle rule

### Requirement 9: Lambda configuration and Sharp layer

**User Story:** As a developer, I want the Lambda function properly configured with Sharp as a layer and appropriate resource limits so that image processing completes reliably.

#### Acceptance Criteria

1. THE Processor_Lambda SHALL be configured with 2048 MB memory and 60 seconds timeout
2. THE Processor_Lambda SHALL use the arm64 architecture exclusively
3. THE Sharp_Layer SHALL be built during the CodeBuild phase using `npm install` with `--arch=arm64 --platform=linux` flags
4. THE Processor_Lambda SHALL use `context.getRemainingTimeInMillis()` to check remaining execution time rather than relying on a timeout environment variable
5. THE Processor_Lambda source code SHALL be located at `src/lambda/functions/processor/` and the Sharp_Layer source SHALL be located at `src/lambda/layers/sharp-arm64/`
6. THE Settings_Module SHALL read configuration from environment variables (`CREATE_WEBP_VERSION`, `IMAGE_OUTPUT_BASE_PREFIX`, `MAX_IMAGE_FILE_SIZE`) with fallback defaults

### Requirement 10: Maximum file size enforcement

**User Story:** As a system operator, I want to enforce a maximum file size for uploaded images so that the Lambda function does not run out of memory or timeout on excessively large files.

#### Acceptance Criteria

1. THE Image_Resizer SHALL provide a `MaxImageFileSize` template parameter that is passed to the Processor_Lambda as the `MAX_IMAGE_FILE_SIZE` environment variable
2. THE Settings_Module SHALL provide a default maximum file size value when the `MAX_IMAGE_FILE_SIZE` environment variable is not set
3. WHEN an uploaded image file exceeds the configured maximum file size, THE Processor_Lambda SHALL reject the file and log an error with the file size and the configured limit

### Requirement 11: IAM permissions for dynamic output buckets

**User Story:** As a system operator, I want the Lambda function to have the minimum permissions needed to write to dynamically determined output buckets so that security is maintained while supporting flexible bucket routing.

#### Acceptance Criteria

1. THE Processor_Lambda execution role SHALL include `s3:PutObject` permission with a wildcard resource (`arn:aws:s3:::*`) scoped to the PutObject action only
2. THE Processor_Lambda execution role SHALL include `s3:GetBucketTagging` permission with a wildcard resource (`arn:aws:s3:::*`) scoped to the GetBucketTagging action only
3. THE Processor_Lambda execution role SHALL include `s3:GetObject` and `s3:GetObjectTagging` permissions scoped to the Source_Bucket
4. THE Processor_Lambda SHALL verify Output_Bucket authorization by checking bucket tags at runtime before writing objects, since bucket tags cannot be used in IAM condition policies

### Requirement 12: Build and deployment pipeline

**User Story:** As a developer, I want the buildspec to handle testing, Sharp layer building, and SAM packaging so that deployments are fully automated through the Atlantis pipeline.

#### Acceptance Criteria

1. THE buildspec.yml SHALL include a step to run Jest tests before packaging
2. THE buildspec.yml SHALL include a step to build the Sharp_Layer by running `npm install` with arm64/linux platform flags in the `src/lambda/layers/sharp-arm64/nodejs/` directory
3. THE buildspec.yml SHALL use the Atlantis pipeline template (`template-pipeline.yml`) for deployments
4. THE Image_Resizer SHALL use Python for any supporting deployment scripts

### Requirement 13: Upload documentation

**User Story:** As a client developer integrating with the image resizer, I want clear documentation on how to upload images with the required tags so that I can correctly trigger image processing.

#### Acceptance Criteria

1. THE Image_Resizer documentation SHALL describe the required `x-amz-tagging` HTTP header format for uploading objects with tags via the S3 API
2. THE Image_Resizer documentation SHALL provide example AWS CLI commands for uploading images and JSON files with the required object tags (`ImageOutputBucket`, `ImageOutputPath`, `stageId`)
3. THE Image_Resizer documentation SHALL describe the required bucket tags (`AllowImageResizerEvents`, `imageResizer:ImageOutputBasePrefix`) and their expected values including the `@stageId` placeholder format

### Requirement 14: Logging and observability

**User Story:** As a system operator, I want meaningful log output for processing decisions so that I can troubleshoot failures and monitor system behavior without excessive log volume.

#### Acceptance Criteria

1. THE Processor_Lambda SHALL log processing decisions including: object tag validation results, bucket authorization outcomes, sizes generated, sizes skipped, and any errors encountered
2. THE Processor_Lambda SHALL not log full AWS SDK client responses
3. THE Processor_Lambda SHALL use a configurable log level controlled by the `LOG_LEVEL` environment variable
4. IF an error occurs during image processing, THEN THE Processor_Lambda SHALL log the error details including the source object key, the Output_Bucket name, and the error message

### Requirement 15: Settings and configuration management

**User Story:** As a developer, I want all configurable values centralized in a settings module so that configuration is consistent and easy to modify.

#### Acceptance Criteria

1. THE Settings_Module SHALL be located at `config/settings.js` within the Processor_Lambda source directory
2. THE Settings_Module SHALL read each setting from its corresponding environment variable and fall back to a default value when the environment variable is not set
3. THE Settings_Module SHALL expose the following settings: image size thresholds (xxLarge, xLarge, large, medium, small, thumb), createWebpVersion (boolean), imageOutputBasePrefix (string), maxImageFileSize (number)
4. THE Processor_Lambda SHALL not contain hard-coded configuration values; all configurable values SHALL be read from the Settings_Module
