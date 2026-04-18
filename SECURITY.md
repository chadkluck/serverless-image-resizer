# Security Policy

This repository is built with security best practices in mind. 

It demonstrates and encourages:
- Failing deployments when dependency vulnerability checks fail
- Implementing role-based access with the Principle of Least Privilege
- Standardizing tagging and naming conventions to better scope access policies
- Use of SSM Parameter Store and Secrets Manager for sensitive information
- Retaining logs for a limited time and purging after expiration

It is the responsibility of the developer/maintainer of any repository that was cloned, forked, copied, or otherwise, to:
- Maintain and improve upon practices described above
- Update all external Python libraries and Node packages to secure versions
- Update Lambda layers regularly to latest versions
- Practice safe coding and scripting
- Utilize industry best practices and standards for security

## Reporting a Vulnerability

This repository was created using [chadkluck/serverless-image-resizer](https://github.com/chadkluck/serverless-image-resizer) as a template.

### Starter Code

If a developer using the Starter finds a **vulnerability in the code or configuration provided by the starter**, they are encouraged to report it using the [Security and quality](https://github.com/chadkluck/serverless-image-resizer/security) section of the original GitHub repository.

### Custom Code

If a developer or end user discovers a **vulnerability in modified starter code** then they are encouraged to report it using the methods described in the repository from which they retrieved the code.
