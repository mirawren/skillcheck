# Releasing skillcheck

Releases have three public artifacts that must agree: the npm version, the immutable `vX.Y.Z` Git tag, and the moving `vX` GitHub Action tag. The release workflow checks the first two, publishes npm with provenance, moves the major tag, and prepares a GitHub release draft.

## One-time setup

1. Before the first release, confirm `npm view skillcheck` still reports the name as unclaimed and sign in to the npm account that should own it.
2. For the first publish, add a short-lived, package-scoped granular npm token with write access as the repository secret `NPM_TOKEN`. If the npm account requires two-factor authentication for writes, the automation token must also be allowed to bypass 2FA; revoke it immediately after trusted publishing is working.
3. Accept the GitHub Marketplace Developer Agreement before the first Marketplace listing.

The workflow's OpenID Connect permission attaches [npm provenance](https://docs.npmjs.com/generating-provenance-statements). The token authorizes the first publication; it is not exposed to pull-request workflows.

After the first publish, configure npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/) for GitHub user `mirawren`, repository `skillcheck`, workflow `release.yml`, with `npm publish` allowed. OIDC then authorizes later releases without a long-lived write token; revoke and remove `NPM_TOKEN` after verifying it.

## Prepare a release

1. Update `package.json`, `package-lock.json`, and the `action.yml` `version` input default to the same semantic version. `npm run check:workflows` enforces this so an immutable Action tag cannot execute a mutable npm range.
2. Move the accumulated notes under `Unreleased` to a dated version in [CHANGELOG.md](CHANGELOG.md).
3. From a clean checkout, run:

   ```sh
   npm ci
   npm run check
   npm run check:owner
   npm pack --dry-run
   ```

4. Commit the version and changelog, then create the matching immutable tag:

   ```sh
   VERSION=$(node -p "require('./package.json').version")
   git tag "v$VERSION"
   git push origin main "v$VERSION"
   ```

Pushing the tag is the release trigger. The workflow stops before publishing if the tag and package version differ or any project check fails. npm publication and GitHub release preparation are separate jobs; if only the latter fails, use GitHub's **Re-run failed jobs** action so npm is not invoked again for the same version.

The automated path accepts stable `vX.Y.Z` releases only. Do not point the floating `vX` Action tag at a prerelease; if a prerelease is ever needed, publish it through a separate workflow and npm dist-tag.

## Publish the GitHub Marketplace release

After both workflow jobs pass, open the generated draft release in GitHub. Select **Publish this Action to the GitHub Marketplace**, choose the appropriate categories, review the generated notes, and publish it. GitHub requires this owner-controlled UI step to accept its Marketplace terms; see [GitHub's official instructions](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace).

## Verify from outside the repository

Do not treat a green publish workflow as proof that users can install the result. In a temporary directory, verify the registry and CLI:

```sh
VERSION=$(node -p "require('./package.json').version")
npm view "skillcheck@$VERSION" version repository.url
npm install "skillcheck@$VERSION"
npx --no-install skillcheck --version
git ls-remote --tags origin "refs/tags/v$VERSION" "refs/tags/v${VERSION%%.*}"
```

Finally, run `uses: mirawren/skillcheck@v1` in a fresh public test repository. That end-to-end Action run is the proof for the installation path shown in the README.
