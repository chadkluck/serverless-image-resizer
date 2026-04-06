# Deployment Guide

This application is **Ready-to-Deploy-and-Run** with the [63Klabs Atlantis Templates and Scripts Platform for Serverless Deployments on AWS](https://github.com/63Klabs/atlantis)

- Use the Atlantis scripts from your organizations central SAM Config infrastructure repository to manage your application's repository and deployment.
- Add a pipeline to each branch in your repository you want to deploy from (`test`, `beta`, `main`)
- Make all code changes in the `dev` branch.
- To initiate a deployment, just merge your code from the `dev` branch to the `test` branch and push. This will kick-off the test deployment pipeline.
- You can subsequently deploy your code to the next branch/instance (`beta` and `main`/`prod`) by merging and pushing.

Follow your organization's guidelines for repository and pipeline management.

## Why Use Atlantis?

Like any other project, you can skip the Atlantis platform and go at it on your own using `sam deploy` from the CLI within the application-infrastructure directory.

However, if you are managing many projects manually (especially on your own or part of a small team), the Atlantis platform is highly recommended as it implements Platform Engineering and AWS best practices. Plus it utilizes AWS native resources including SAM deployments and CloudFormation without the need of proprietary DevOps tools. Everything is API, CloudFormation template, and SAM CLI based.

If this is your first time deploying to AWS, or deployments have been difficult to manage in the past and you are looking into automating some of your tasks, please look at the 63Klabs Atlantis Templates and Scripts Platform. (If you traditionally deploy applications through the Web Console, **PLEASE** look into Atlantis! We have many, many tutorials to get you started deploying production-ready applications!) using Platform Engineering and CI/CD best practices with scripts as easy as `create_repo.py`, `config.py`, and `deploy.py` that all use `samconfig` files written in `TOML` and the AWS API as the backbone.

## Create Repository and Initialize with this Code

Using the Atlantis SAM Config scripts in your organization's central infrastructure repository:

```bash
./cli/create_repo.py YOUR_REPO_NAME
# Choose 00-basic-apigw-lambda-nodejs.zip

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
