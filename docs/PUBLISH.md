# Publish GitHub Release (manual)

Repo: `https://github.com/DikoeNebo/tarocode`  
Remote: `origin` → that URL.

## Checklist (every public tag)

1. `npm test` and `npm run check` green.
2. Close any running Keycode / unlock `dist-release/` (Defender can lock `app.asar`; if build fails, use `--config.directories.output=dist-out` then copy artefacts).
3. Build:

```powershell
npm run build:all
powershell -File scripts/release-checksums.ps1
```

4. Expected in `dist-release/` (or your chosen output folder):

- `TaroCode-X.Y.Z-portable.exe`
- `TaroCode-Setup-X.Y.Z.exe`
- `TaroCode-Setup-X.Y.Z.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt` — **UTF-8 without BOM** (the script writes it that way; do not re-save with Notepad “UTF-8” if that adds a BOM)

5. Smoke the **portable** exe with [`SMOKE.md`](SMOKE.md) (not `npm start`).
6. Confirm no secrets in docs/screenshots (`#token=`, QR, LAN IP, real chats).
7. Commit release notes + docs, then tag that commit.

## Push + GitHub Release (`gh`)

```powershell
# one-time if needed
gh auth login --hostname github.com --git-protocol https --web

git push origin master
git tag -a vX.Y.Z -m "Keycode vX.Y.Z"
git push origin vX.Y.Z

gh release create vX.Y.Z `
  dist-release/TaroCode-X.Y.Z-portable.exe `
  dist-release/TaroCode-Setup-X.Y.Z.exe `
  dist-release/TaroCode-Setup-X.Y.Z.exe.blockmap `
  dist-release/latest.yml `
  dist-release/SHA256SUMS.txt `
  --title "vX.Y.Z — …" `
  --notes-file docs/RELEASE-NOTES-vX.Y.Z.md
```

Update release body later without re-uploading binaries:

```powershell
gh release edit vX.Y.Z --notes-file docs/RELEASE-NOTES-vX.Y.Z.md
```

Replace one asset (example: checksums):

```powershell
gh release delete-asset vX.Y.Z SHA256SUMS.txt --yes
gh release upload vX.Y.Z dist-release/SHA256SUMS.txt
```

## Verify after publish

```powershell
gh release view vX.Y.Z --json assets --jq ".assets[] | {name,size,state}"
# Screenshot / download URLs should return HTTP 200
# Local hashes must match SHA256SUMS.txt and GitHub asset digests
```

## After publish

Community posts: [`LAUNCH.md`](LAUNCH.md).
