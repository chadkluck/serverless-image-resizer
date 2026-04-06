# Deployment Guide

This application is **Ready-to-Deploy-and-Run** with the [63Klabs Atlantis Templates and Scripts Platform for Serverless Deployments on AWS](https://github.com/63Klabs/atlantis)

- Use the Atlantis scripts from your organization's central SAM Config infrastructure repository to manage your application's repository and deployment.
- Add a pipeline to each branch in your repository you want to deploy from (`test`, `beta`, `main`)
- Make all code changes in the `dev` branch.
- To initiate a deployment, just merge your code from the `dev` branch to the `test` branch and push. This will kick-off the test deployment pipeline.
- You can subsequently deploy your code to the next branch/instance (`beta` and `main`/`prod`) by merging and pushing.

Follow your organization's guidelines for repository and pipeline management.

## Build Process

The `buildspec.yml` automates the following steps during CodeBuild:

1. **Install Lambda function dependencies** — runs `npm install --production` in `src/lambda/functions/processor/`
2. **Build Sharp layer** — runs `npm install --arch=arm64 --platform=linux` in `src/lambda/layers/sharp-arm64/nodejs/` to compile the Sharp native binary for the Lambda arm64 runtime
3. **Run tests** — installs dev dependencies and executes `npx jest --config test/jest.config.mjs --ci --coverage` for the full test suite (unit + property-based tests)
4. **SSM parameter setup** — creates any required SSM parameters via build scripts
5. **SAM package** — packages the CloudFormation template and uploads artifacts to S3

## Why Use Atlantis?

Like any other project, you can skip the Atlantis platform and go at it on your own using `sam deploy` from the CLI within the application-infrastructure directory.

However, if you are managing many projects manually (especially on your own or part of a small team), the Atlantis platform is highly recommended as it implements Platform Engineering and AWS best practices. Plus it utilizes AWS native resources including SAM deployments and CloudFormation without the need of proprietary DevOps tools. Everything is API, CloudFormation template, and SAM CLI based.

If this is your first time deploying to AWS, or deployments have been difficult to manage in the past and you are looking into automating some of your tasks, please look at the 63Klabs Atlantis Templates and Scripts Platform. (If you traditionally deploy applications through the Web Console, **PLEASE** look into Atlantis! We have many, many tutorials to get you started deploying production-ready applications!) using Platform Engineering and CI/CD best practices with scripts as easy as `create_repo.py`, `config.py`, and `deploy.py` that all use `samconfig` files written in `TOML` and the AWS API as the backbone.

## Create Repository and Initialize with this Code

Using the Atlantis SAM Config scripts in your organization's central infrastructure repository:

```bash
./cli/create_repo.py YOUR_REPO_NAME

# Create a pipeline for the test branch
./cli/config.py pipeline PREFIX YOUR_PROJECT_ID test

# Deploy the pipeline
./cli/deploy.py pipeline PREFIX YOUR_PROJECT_ID test
```

Clone the repository to your local machine and perform your first merge:

```bash
git clone HTTPS_CLONE_URL

cd YOUR_CLONED_REPO

git switch dev
git switch test
git merge dev
git push
```

This will now kick off your first deployment. Make sure it deploys without errors before going back to `dev` and making changes.

## Development and Deploy Process

Always make and commit your changes in `dev`

Perform merges to advance code to the next branch. `dev` -> `test` -> `beta` -> `main`

```bash
git switch dev
git switch test
git merge dev
git push
# Always return to dev for new changes
git switch dev
```

When you are ready to move code to the next stage, merge:

```bash
git switch test
git pull # always a good idea
git switch beta
git pull # always a good idea
git merge test
git push
# Always return to dev for new changes
git switch dev
```

### Setting Up Pipelines

For each branch you wish to deploy from, set up a pipeline using your organization's central Atlantis SAM Config repository.

```bash
# Create a pipeline for the test branch
./cli/config.py pipeline PREFIX YOUR_PROJECT_ID beta

# Deploy the pipeline
./cli/deploy.py pipeline PREFIX YOUR_PROJECT_ID beta
```

## Setting Up Destination Bucket(s)

This application is intended to place resized images in an S3 bucket using Origin Access Controle (OAC) behind a CloudFront distribution.

Any bucket, existing or new, must have the `AllowImageResizerEvents` tag set to `true`. The `imageResizer:ImageOutputBasePrefix` is optional.

```
AllowImageResizerEvents=true
imageResizer:ImageOutputBasePrefix=/path/to/public/images
```

By default, `ImageOutputBasePrefix` is set to `/{stageId}/public/images` and can be changed globally as a deployment parameter.

### Existing Buckets

If you have an existing bucket, just add the necessary `AllowImageResizerEvents` tag and optionally the `imageResizer:ImageOutputBasePrefix`

### New Buckets and CloudFront Distribution using Atlantis

Atlanis has deployment templates available to create new S3 buckets with OAC fronted by CloudFront.

From your organization's SAM Config repository:

#### Create Bucket

For your first bucket, leave defaults unless specified below. Replace `acme`, `my-assets`, and `--profile default` with your own `Prefix`, `ProjectId`, and default profile.

```bash
./cli/config.py storage acme my-assets --profile default
# - Choose the S3 OAC template
# - When asked for tags add:
#   - AllowImageResizerEvents=true
# (Optionally, add imageResizer:ImageOutputBasePrefix if you don't want to use the default)

./cli/deploy.py storage acme my-assets --profile default
# - You will need the S3 Domain from the OUTPUTS section
```

#### Create CloudFront Distribution

For your first distribution deployment, leave defaults unless specified below. Replace `acme`, `my-assets`, and `--profile default` with your own `Prefix`, `ProjectId`, and default profile.

```bash
./cli/config.py network acme my-assets test --profile default
# - Choose the CloudFront dist with Route53 (you don't need to configure Route53)
# - Use the S3 Origin Domain supplied from the previous output
# - Leave the defaults

./cli/deploy.py network acme my-assets test --profile default
```

## Test

Once the Resizer application stack, S3 buckets, and CloudFront distribution is set up, you can perform a manual upload to test (be sure to replace values with your own):

```bash
aws s3api put-object \
  --bucket my-assets \
  --key uploads/batch1/photo.jpg \
  --body ./photo.jpg \
  --content-type image/jpeg \
  --tagging "ImageOutputBucket=my-output-bucket&ImageOutputPath=posts/2026-05-09&stageId=test"
```

Rather than uploading manually, you will most likely want to create a script or automated process that executes the `put-object` request with the necessary tags.

Additional information regarding uploading images may be found in [End-User Documentation](./docs/end-user/README.md).

## Optional CloudFront Cache Invalidation

Atlantis has a ready-to-deploy CloudFront cache invalidator service that much like this application, can monitor multiple buckets and submit invalidation requests in consolidated batches.

Once you have this application deployed, configured, and working to your expections, check out [Serverless Multi-Bucket CloudFront Invalidation Service](https://github.com/63Klabs/atlantis-starter-03-serverless-cloudfront-cache-invalidation).
