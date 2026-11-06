# Public release preparation

Automatic downloads and installation are opt-in. Notifications are on by default, public release checks need no token (optional authentication remains available while releases are private), and downloads require a valid matching SHA-256 digest. See [update behaviour](startup-updates.md).

## Privacy audit

The working source contains no personal author name, personal email address, home-directory path or embedded provider credential found by the release audit. The existing local credential file is ignored and is not bundled. The README captures use the offline demo and no connected accounts.

Before publishing, run:

```sh
npm run audit:release
npm run build
npm test
cargo test --lib --locked --manifest-path src-tauri/Cargo.toml
```

The audit reports categories and locations without printing secrets. It checks tracked source, so stage intended new files before the final audit. It does not scan ignored installation data. Credential detection is pattern-based and cannot certify that arbitrary sensitive information is absent.

## Git history requires a separate publication step

The original reachable history contains a personal author/committer email, a personal author name and an earlier application identifier using that name. An old release note also refers to an unrelated private repository. These remain retrievable after an ordinary cleanup commit.

Prepare a sanitized mirror with anonymous GitHub author/committer/tagger identities, replacements in historical blobs and messages, and the private context section removed. Verify every branch and tag in that mirror before publishing:

```sh
node tests/release-audit.mjs --history
```

Replacing the GitHub branches and tags requires a coordinated history rewrite. This changes commit IDs, invalidates old signatures and may require collaborators to clone again. Keep the original local checkout and backup private. Do not make the original repository public until the sanitized refs are published and verified.

GitHub pull-request refs, cached commits, release text, uploaded installers, Actions logs/artifacts and existing clones are separate from Git branches and tags. Review those surfaces as well. An old installer can contain former metadata even when the current source is clean. If GitHub retains sensitive commits through pull-request refs or caches, request removal through GitHub Support. Rotate any actual credentials discovered during that review; deleting source does not revoke a credential.

## Publishing updates

The updater reads stable releases from `BananaAficionado/DailyDashboard`. A `V*` or `v*` tag triggers the Windows workflow, which builds and uploads the NSIS installer to GitHub Releases. Keep the tag, frontend version, Cargo version and Tauri version aligned. Publish a compatible Windows installer with GitHub's SHA-256 asset digest; drafts, prereleases, incompatible assets and missing digests cannot install automatically.

After publication, verify an unauthenticated release check, download and digest validation from a previous installed version. Windows installation/restart, rollback and physical monitor recovery require a Windows device; browser and macOS native checks do not cover those paths.
