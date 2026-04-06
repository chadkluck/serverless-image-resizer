# Spec Questions - Round 2

Follow-up questions based on the answers from Round 1.

## Q17: Starter 03 Architecture Review - Recommendation

After reviewing Atlantis Starter 03 (Serverless Multi-Bucket CloudFront Invalidation Service), here's how it works:

1. S3 event → Ingestor Lambda (lightweight, fast)
2. Ingestor adds event to SQS queue and sets an EventBridge Scheduler timer
3. Timer allows batching (waits for more events before processing)
4. Scheduler triggers Processor Lambda which pulls from SQS and does the heavy work

For our image resizer, the tradeoffs are:

**Single Lambda (simpler):**
- S3 event → Lambda processes image immediately
- Simpler architecture, fewer resources, easier to debug
- Each image processed independently (no batching benefit for image resizing)
- Could hit concurrency limits on large batch uploads
- Use Lambda reserved concurrency to throttle

**Two Lambda + SQS (Starter 03 pattern):**
- S3 event → Ingestor Lambda → SQS → Processor Lambda
- SQS provides built-in retry, DLQ, and backpressure
- SQS batch window can group messages for the processor
- More resilient to failures (messages stay in queue)
- More complex infrastructure and debugging
- No real batching benefit since each image is processed independently

**Recommendation:** Use a single Lambda with SQS as the event source (not direct S3 invocation). This gives us:
- S3 event → SQS queue → Lambda (triggered by SQS)
- Built-in retry via SQS visibility timeout
- Built-in DLQ support (from Q6 answer)
- Backpressure via SQS batch size and Lambda concurrency
- Simpler than the 2-Lambda model since we don't need batching/consolidation
- Still resilient to failures

Does this approach work, or would you prefer the full 2-Lambda model from Starter 03?

**Answer:**
Use the recommended approach

## Q18: WebP Output Path Convention

With the WebP conversion feature, where should the `.webp` versions be stored? Same directory alongside the original format files?

```
<imageOutputBasePrefix>/<originalName>/large.jpg
<imageOutputBasePrefix>/<originalName>/large.webp
<imageOutputBasePrefix>/<originalName>/medium.jpg
<imageOutputBasePrefix>/<originalName>/medium.webp
...
```

Or in a subdirectory?

```
<imageOutputBasePrefix>/<originalName>/large.jpg
<imageOutputBasePrefix>/<originalName>/webp/large.webp
...
```

**Answer:**
Same directory as the original format

## Q19: Lambda Layer Build Process

For the Sharp Lambda Layer (`src/lambda/layers/sharp-arm64`), the layer needs to be built with the correct platform binaries during the CodeBuild phase. Should we:
- Add a build step in `buildspec.yml` that runs `npm install --arch=arm64 --platform=linux` in the layer directory?
- Include a pre-built layer zip?
- Use a build script (Python) to assemble the layer?

The layer directory structure for SAM would be:
```
src/lambda/layers/sharp-arm64/
  nodejs/
    package.json  (just sharp dependency)
```

SAM will handle packaging it. We just need to ensure `npm install` runs with the right platform flags during build. Does this approach work?

**Answer:**
Add a build step in `buildspec.yml` that runs `npm install --arch=arm64 --platform=linux` in the layer directory

## Q20: Source Bucket Versioning and Glacier Transition

From Q13/Q16 answers: When retention is 0 (keep originals), you want:
- Versioning enabled on the source bucket
- Non-current versions retained for 30 days
- Current objects transitioned to Glacier after 30 days

Should the Glacier transition apply to the entire `uploads/` prefix? And should we use Glacier Instant Retrieval, Glacier Flexible Retrieval, or Glacier Deep Archive?

**Answer:**
Apply the transition to the entire uploads/ prefix and use Glacier Deep Archive

## Q21: Lambda Function Timeout for Image Processing

With 2048 MB and 60 seconds, should we also set the `LAMBDA_TIMEOUT_IN_SEC` environment variable (already in the starter template) so the function can calculate internal timeouts? For example, if processing a batch of 6 sizes + webp variants, the function could check remaining time and fail gracefully rather than being killed mid-write.

**Answer:**
It might be better to remove the LAMBDA_TIMEOUT_IN_SEC and use the time remaining in the context passed to the handler.

## Q22: Metadata `sizes` Field - WebP Dimensions

When WebP versions are created, should the metadata.json `sizes` object include WebP dimensions too? They'd be the same pixel dimensions as the original format. Should we just add the `hasWebp` boolean (as you mentioned in Q1) and assume consumers know the WebP versions have the same dimensions?

**Answer:**
Just add the `hasWebp` boolean and assume consumers know WebP are same dimensions

## Q23: Maximum Image File Size

Should we enforce a maximum file size for uploaded images? Large files (50MB+ RAW images) could cause Lambda to run out of memory or timeout. A reasonable limit might be 20-25MB. Should this be configurable via a template parameter and environment variable?

**Answer:**
Yes, this should be configurable via a template parameter, passed as a lambda env variable, and set in settings.js if no env variable.

## Q24: S3 Event Source - SQS Configuration

If we go with the SQS-based approach (Q17), should the SQS queue be a standard queue or FIFO queue? Standard is simpler and higher throughput. FIFO guarantees ordering but has a 300 msg/sec limit. Since image processing order doesn't matter, standard seems right.

Also, what visibility timeout should we use? It should be at least 6x the Lambda timeout (AWS recommendation), so 360 seconds for a 60-second Lambda timeout.

**Answer:**
Use a standard queue. Use 6x the Lambda timeout.