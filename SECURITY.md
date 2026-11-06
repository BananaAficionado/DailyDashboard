# Security

Report vulnerabilities through [GitHub’s private reporting form](https://github.com/BananaAficionado/DailyDashboard/security/advisories/new), rather than a public issue. Include the affected version, operating system, reproduction steps, and likely impact. Leave credentials and private calendar data out of reports.

## Local credentials

The credential-storage and CSP changes are on `main`. The published V0.5.12 installer predates them; they require a new build.

Desktop account tokens and saved integration secrets are encrypted locally. The encryption key is kept in the operating system’s credential store. Existing localStorage tokens and plaintext settings secrets migrate when the desktop app loads; old copies are removed after the encrypted write succeeds.

If the operating system credential store is locked or unavailable, unlock it before reconnecting an account. The app does not fall back to plaintext storage.

## Builds and updates

Release builds use a content security policy. Updates are downloaded from this repository’s release API and checked against GitHub’s SHA-256 digest. A checksum verifies the downloaded file, not the identity of the publisher; release publishing access should remain limited to maintainers.
