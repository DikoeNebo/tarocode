# Publish first GitHub Release (manual)

Repo remote is set to `https://github.com/DikoeNebo/keycode.git`.

## One-time: create the empty GitHub repo

1. Open https://github.com/new — name `keycode`, public, **no** README/license (we already have them).
2. Or with GitHub CLI after install: `gh repo create DikoeNebo/keycode --public --source=. --remote=origin --push`

## Push code (when ready to publish)

```powershell
git add -A
git status   # confirm tmp-remote-qr.png is NOT listed
git commit -m "chore: open-source release prep (MIT, icon, README)"
git push -u origin master
```

## Build artefacts (this machine)

```powershell
npm run build:all
powershell -File scripts/release-checksums.ps1
```

Expected in `dist/`:

- `Keycode-1.0.0-portable.exe`
- `Keycode-Setup-1.0.0.exe`
- `SHA256SUMS.txt`

Smoke: follow `docs/SMOKE.md` on the portable exe.

## Create Release v1.0.0

```powershell
git tag v1.0.0
git push origin v1.0.0
```

On GitHub → Releases → Draft a new release → tag `v1.0.0` → paste body from `docs/RELEASE-NOTES-v1.0.0.md` → upload the three `dist/` files → Publish.

Or with `gh`:

```powershell
gh release create v1.0.0 dist/Keycode-1.0.0-portable.exe dist/Keycode-Setup-1.0.0.exe dist/SHA256SUMS.txt --title "v1.0.0" --notes-file docs/RELEASE-NOTES-v1.0.0.md
```

## After publish

Use `docs/LAUNCH.md` for community posts.
