# Publishing Warp

This guide covers shipping Warp so other people can install it.

## 1. Build a public VSIX

```bash
npm install
npm run package:public
# → warp-0.8.1.vsix
```

Inspect contents (should **not** include CV, localtools, old vsix, src, node_modules):

```bash
npx vsce ls --tree
```

Share the VSIX for sideload installs:

```bash
code --install-extension warp-0.8.1.vsix
cursor --install-extension warp-0.8.1.vsix
```

## 2. Choose a publisher id

`package.json` currently uses:

```json
"publisher": "warp-agent"
```

Extension id → **`warp-agent.warp`**.

If you already have a Visual Studio Marketplace publisher (Azure DevOps), change `publisher` to that id and re-package.

### Create a Marketplace publisher

1. https://marketplace.visualstudio.com/manage  
2. Sign in with a Microsoft account  
3. Create a publisher (e.g. `yourname` or `warp-agent`)  
4. Create a **Personal Access Token** (Azure DevOps) with **Marketplace → Manage** scope  
5. Login and publish:

```bash
npx vsce login YOUR_PUBLISHER_ID
npx vsce publish
# or: npx vsce publish -p YOUR_PAT
```

## 3. Open VSX (Cursor / VSCodium friendly)

1. https://open-vsx.org/  
2. Create account + namespace matching `publisher` if possible  
3. Create a personal access token  
4. Publish:

```bash
npx ovsx publish warp-0.8.1.vsix -p YOUR_OPENVSX_TOKEN
```

## 4. GitHub release (recommended even without marketplaces)

1. Create a public repo, push this project (respect `.gitignore`)  
2. Tag `v0.8.1`  
3. Attach `warp-0.8.1.vsix` to the GitHub Release  
4. Point README install section at the release URL  

Optional: add `repository` / `bugs` / `homepage` fields to `package.json` once the repo exists:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/YOUR_USER/warp.git"
},
"bugs": {
  "url": "https://github.com/YOUR_USER/warp/issues"
},
"homepage": "https://github.com/YOUR_USER/warp#readme"
```

Then drop `--allow-missing-repository` from the package script.

## 5. Checklist before each release

- [ ] Bump `version` in `package.json`  
- [ ] Update `CHANGELOG.md`  
- [ ] Bump `assetV` in `src/webviewHtml.ts` if webview assets changed  
- [ ] `npm run compile` clean  
- [ ] `npm run package:public`  
- [ ] Install VSIX on a clean profile and smoke-test: open chat, sign-in path, `/` menu, one prompt  
- [ ] Confirm VSIX has no personal files (`Alec_Cohen_CV.pdf`, `localtools`, etc.)

## 6. Privacy / legal

- MIT license is included  
- Do not ship user `auth.json`, session dumps, or personal documents  
- README already notes Warp is not an official xAI product  
