# Quarterly Auto Updates

## What this app uses

The app now uses:

- `electron-updater` in the Electron main process
- `electron-builder` for release packaging
- GitHub Releases as the update feed

Installed apps check GitHub Releases for a newer version, download it, and prompt the user to restart.

## What you need on GitHub

Your normal GitHub account is enough.

For a public repo:

- users can download updates without signing in
- you only need a GitHub token when you publish a new release

## What goes in `.env.local`

Add these:

```bash
GH_RELEASE_OWNER=your-github-username-or-org
GH_RELEASE_REPO=your-github-repo-name
GH_TOKEN=your-github-token-for-publishing-releases
```

`GH_RELEASE_OWNER` and `GH_RELEASE_REPO` tell `electron-builder` where the release feed lives.

`GH_TOKEN` is only needed when you want `electron-builder` to create or upload a GitHub Release for you.

## GitHub token

Use a token that can create releases and upload release assets.

In practice, that means the token needs repository write access.

For fine-grained GitHub tokens, make sure the repo is selected and `Contents` access is set to write.  
GitHub docs: https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens

`electron-builder` documents `GH_TOKEN` for GitHub publishing.  
Docs: https://www.electron.build/publish.html#github

## Build targets for updates

For macOS auto-updates, build both:

- `dmg`
- `zip`

For Windows auto-updates, use:

- `nsis`

That is already configured in `electron-builder.config.cjs`.

## Commands

Mac Apple Silicon:

```bash
npm run dist:mac-arm64
```

Mac Apple Silicon and publish to GitHub Releases:

```bash
npm run publish:mac-arm64
```

Windows NSIS installer:

```bash
npm run dist:win
```

Windows NSIS installer and publish to GitHub Releases:

```bash
npm run publish:win
```

## How release publishing works

When the GitHub env vars are present, `electron-builder` is configured to publish to GitHub Releases.

So the normal flow is:

1. bump the app version in `package.json`
2. run the publish command
3. `electron-builder` uploads the release artifacts and update metadata to GitHub Releases
4. installed apps see the new version and offer the update

## Important note about versions

Auto-update only works when the version number increases.

If the installed app is `0.1.0`, the next release must be something like:

- `0.1.1`
- `0.2.0`
- `1.0.0`

## Testing

Auto-update does not really work from `npm run dev`.

Test it like this:

1. build and install version `A`
2. bump `package.json` version
3. build and publish version `B`
4. open installed version `A`
5. the app should detect `B`
6. download it
7. prompt to restart

## UI status in this app

The `Controls` card now shows:

- current updater state
- installed app version
- a `Check for updates` action
- a `Restart to install update` action when a download is ready
