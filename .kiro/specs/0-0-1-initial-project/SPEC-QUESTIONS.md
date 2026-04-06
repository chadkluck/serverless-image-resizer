# Spec Questions

The following questions need to be answered before moving to the requirements phase.

## Q1: Supported Image Formats

The spec mentions `.jpg` and `.png` as examples. What is the full list of input image formats to support? Should we also support `.webp`, `.gif`, `.tiff`, `.avif`? And should the output format always match the input format, or should there be an option to convert (e.g., output everything as `.webp` for web optimization)?

**Answer:**

Support `.jpg`, `.png`, and `.gif`. All other formats are okay if they don't increase overhead.
Let's always keep the original extension type, but also always create a webp version as well.
Let's add a flag to turn on/off the webp conversion. As a template parameter `CreateWebpVersion` with value `true` as default. This should be passed to the Lambda function as env variable `CREATE_WEBP_VERSION`. Also set in settings.js as createWebpVersion (bool).
Also, add "hasWebp" (bool) to the metadata.json file.

## Q2: Output Format Conversion

Should resized images retain their original format (a `.png` stays `.png`, a `.jpg` stays `.jpg`), or should there be an option to convert to a specific format like `.webp`? The spec says "the file extension is retained" but want to confirm there's no conversion step desired.

**Answer:**
yes, retain original format, but also create a webp version (if CreateWebpVersion is true)

## Q3: Image Larger Than Source

If the original image is smaller than a size threshold (e.g., original is 600px wide but `xxLarge` is 3000px), should we skip that size, upscale it, or output the original dimensions for that size entry? The spec says "maintain proportions" but doesn't address upscaling.

**Answer:**
Do not upscale but save as original size for that file, and skip upper. For example if the original was 660px on the long end and medium size was set to 800px on the long end, save medium.jpg as the original size and skip large.jpg, x-large.jpg, xx-large.jpg. The metadata.json would then have empty arrays for size.large, size.xLarge, size.xxLarge

## Q4: Lambda Memory and Timeout

The current template defaults are 1024 MB and 10 seconds (API Gateway constraint). Since this is now S3-triggered (no API Gateway timeout), should we increase the timeout? Processing a large image through `sharp` for 6 sizes could take longer. Suggested defaults: 2048 MB memory, 60 seconds timeout. Does that sound right?

**Answer:**

Yes 2048 MB memory, 60 seconds timeout.

## Q5: Concurrency Limits

Should we set a reserved concurrency limit on the Lambda function to prevent a large batch upload from overwhelming downstream S3 buckets or hitting account-level Lambda concurrency limits?

**Answer:**
Examine the architecture of the Atlantis Application Starter 03. It uses a 2 lambda model with an SQS queue as well as an on-demand scheduler. There is an ingestor that accepts events, queues them up, and sets a schedule for a processing lambda function. Is that something we should look at? It is more complex but might be able to handle a larger workload. Follow up with a recommendation after reviewing.

## Q6: Error Handling and Dead Letter Queue

When processing fails (e.g., corrupt image, output bucket unreachable), should we:
- Simply log the error and move on?
- Use a Dead Letter Queue (SQS) for failed events?
- Send a notification (SNS)?

**Answer:**
Log the error and use a dead letter queue

## Q7: S3 Event Filter

The spec says "Anything uploaded to the uploads directory on the source bucket is used as an event trigger." Should the S3 event notification filter on the `uploads/` prefix only? This would prevent triggering on other objects placed in the bucket for other purposes.

**Answer:**
Yes, only trigger on the uploads/ prefix

## Q8: Object Tagging Mechanism

The spec relies on S3 object tags (`ImageOutputBucket`, `ImageOutputPath`, `stageId`). These tags must be set at upload time by the client. Should we document the required `x-amz-tagging` header format for the uploading client? Also, is there a default behavior if `ImageOutputBucket` tag is missing (reject/ignore)?

**Answer:**
yes, document the required x-amz-tagging header, as well as the corresponding cli command.
Reject if ImageOutputBucket is missing

## Q9: metadata.json vs details.json Naming

The spec mentions both `details.json` in the size listing and `metadata.json` in the example output paths. Which name should we use consistently?

**Answer:**
Use metadata.json

## Q10: JSON Metadata Upload Path

When a user uploads a `.json` file to update metadata, does it follow the same path convention as images? For example, if the image was `uploads/batch1/myImage.jpg`, would the metadata update be `uploads/batch1/myImage.json`? And should the same object tags (`ImageOutputBucket`, `ImageOutputPath`, `stageId`) be required on the JSON file?

**Answer:**
The same object tags should be used (`ImageOutputBucket`, `ImageOutputPath`, `stageId`). They should be required the same way they are for images. (stageId only required if output base path requires it). Remember, the path after upload/ does not dictate where the image or json file is uploaded. It is all tag based.

## Q11: EXIF Data Extraction Scope

How much EXIF data should we extract? The metadata schema includes `locationCoord`, `dateTaken`, `credit`, `copyright`. Should we map specific EXIF tags to these fields (e.g., `GPSLatitude` → `locationCoord.lat`, `DateTimeOriginal` → `dateTaken`, `Artist` → `credit`, `Copyright` → `copyright`)? Or keep EXIF as a raw dump in the `exif` field and leave the other fields empty unless provided by a JSON upload?

**Answer:**
EXIF should be a raw dump in the exif field. It may be used to fill in missing data not already present. If credit is empty then set to Artist value.

## Q12: IAM Permissions for Output Buckets

The spec says the Lambda can't have a static list of output buckets in its execution role. The Lambda will need `s3:PutObject` on the output bucket and `s3:GetBucketTagging` to read bucket tags. Since we can't scope these to specific buckets at deploy time, should we use a wildcard resource (`arn:aws:s3:::*`) for these specific actions? This is broader than typical least-privilege but seems necessary for the dynamic bucket design. Or should we use a resource condition/tag-based policy?

**Answer:**
Yes, use wild cards. I would like to use a resource condition/tag-based policy, but to my knowledge bucket tags cannot be used in IAM conditional policies the same way other resource tags can be. If I am wrong let me know. Otherwise i think we are forced to use wildcards with lambda checking the tags.

## Q13: Source Bucket Cleanup

The spec mentions lifecycle-based retention for originals in the source bucket. Should the lifecycle rule apply to the entire `uploads/` prefix, or should it also cover uploaded `.json` metadata files?

**Answer:**
It should cover the entire uploads/ prefix and everything in it including .json.
Also, if the retention is 0, then there SHOULD be a storage level migration policy, move to glacier after 30 days.

## Q14: Sharp Lambda Layer vs Bundled

`sharp` has native binaries that need to match the Lambda runtime architecture. Should we:
- Bundle `sharp` directly in the deployment package (simpler, larger package)?
- Use a Lambda Layer for `sharp` (shared across functions, separate versioning)?

The spec mentions `arm64` architecture. `sharp` supports this but needs the correct platform binary.

**Answer:**
Use Lambda layers. We are only going to support arm64. You can explicitly use the arm64 conditions in the template. We will need to restructure the src directory.
src/lambda/functions/processor
src/lambda/layers/sharp-arm64

## Q15: Metadata `sizes` Field for Missing Sizes

The spec says "All size properties should be listed, even if they are empty." For sizes that were skipped (e.g., image too small for `xxLarge`), should the value be `[]` (empty array) or `[0, 0]` or omitted from the sizes object?

**Answer:**
Use the empty array

## Q16: Re-processing Behavior

If the same image filename is uploaded again with the same tags, should it completely overwrite all existing resized images and metadata in the output bucket? Or should there be any versioning/backup of the previous versions?

**Answer:**
It will be up to the output bucket to have versioning enabled with a lifecycle policy. This application will just overwrite and not maintain a backup on it's own.
However, we should version the source bucket IF the lifecycle policy is set to not delete uploaded files, but rather move them to a different storage level. Non current objects should be retained for 30 days.