# Privacy Policy — CJ Product Hunter (Chrome Extension)

**Last updated:** 22 October 2026

**Unofficial.** CJ Product Hunter is an independent tool. It is not affiliated with, endorsed by, or sponsored by CJdropshipping.

## Summary

The extension runs entirely on your own computer and talks only to a **local backend you run yourself** (`http://localhost:3000`). The developer collects **no data at all** — there is no developer server, no analytics, no tracking, no accounts, and no third-party SDKs or ads.

## What the extension accesses, and why

### 1. Search terms you type
- Sent **only** to your local backend (`http://localhost:3000`), which forwards them to the CJdropshipping API so product results can be fetched. Without sending the query there would be no search results.
- Your **last search term** is saved in your browser's local extension storage (`chrome.storage.local`) so it can be prefilled next time. It never leaves your device and can be removed by clearing the extension's local storage (or by searching again with a different term).

### 2. CJdropshipping API key (optional, entered in Settings)
- Sent **only** to your local backend and stored in a local file on your own machine (`data/settings.json`).
- It is **never** stored inside the extension, never sent to the developer, and never sent to any third party other than CJdropshipping's own API (through your local backend) to authenticate your searches.
- You can remove it at any time from **Settings → Remove saved key**.

### 3. Local backend connection (host permission `http://localhost:3000/*`)
- The extension can connect to nothing except your own backend on this computer. It has **no** access to arbitrary websites: it declares no content scripts and no `<all_urls>` host permission.

### 4. Opening product pages
- Clicking a product opens `cjdropshipping.com` in a new tab using Chrome's standard "open tab" behavior. This does not read or modify those pages.

## What the developer collects

**Nothing.** No personal data, no usage statistics, no browsing history, no identifiers. The extension has no backend of its own.

## Data stored locally on your machine (by the local backend you run)

- `data/settings.json` — your API key (if you chose to save it).
- `.cj-token-cache.json` — a short-lived access token CJ issues for your key.
- In-memory search results and prices for the current session.

All of these stay on your computer. Delete the files to erase them.

## Remote code

The extension contains **no remote code**: all scripts ship inside the package, there is no `eval`, no dynamically loaded code, and no CDN scripts.

## Changes to this policy

Any change will be published with the corresponding extension update on the Chrome Web Store.

## Contact

Questions or requests: open an issue in the project repository (or use the contact address you publish with this policy).
