# Network behaviour

Submission payloads are bounty-confidential, so the only acceptable amount of
network traffic is none. This is what the app actually does, and how to check it
rather than take it on trust.

## The guarantees

1. **No request ever leaves the origin.** There is no backend, no analytics, no
   telemetry, no font CDN, no error reporting. Fonts are compiled into the
   bundle; parsing, storage, charting and PDF generation all happen in the tab.
2. **No request at all after initial load.** Everything the app will ever need —
   including the ~2 MB PDF code path and the detail route — is pulled in during
   load, while the browser is idle. From then on, importing files, browsing,
   searching, exporting JSON and exporting PDF issue zero requests.
3. **pdfmake is explicitly locked down.** Before the first render,
   `preparePdfMake` installs `setUrlAccessPolicy(() => false)` and a
   `setLocalAccessPolicy` that permits nothing but the font sources named in the
   descriptor. Even a malicious `<img src="https://…">` smuggled into payload
   text cannot cause a fetch during PDF generation.
4. **Saving a file never touches the network.** Downloads go through
   `URL.createObjectURL` on a local Blob, revoked immediately after.

## How this is verified

`npm run smoke` records every `Network.requestWillBeSent` event over the
DevTools protocol for the whole session and asserts two things:

- **`never contacts a third party`** — every request URL is same-origin,
  `blob:`, `data:` or `about:`.
- **`issues no network requests after load`** — the log is watermarked once the
  idle warm-up has gone quiet, and nothing new appears while the test imports
  the fixture twice, navigates, searches, flips modes, exports a JSON bundle,
  clears and re-imports the vault, and exports a PDF.

To check by hand: open DevTools → Network, load the app, let it settle for a
couple of seconds, then clear the log and use the app. It stays empty.

You can also audit the build directly. The only absolute URLs in `build/` are
licence headers, XMP namespace identifiers and Svelte error-message doc links —
no fetched resources:

```bash
grep -rhoE "https?://[a-zA-Z0-9._/-]+" build/ | sort -u
```

The build does contain `XMLHttpRequest`, twice, both inside the copy of
`file-saver` vendored into pdfmake. It sits in the `saveAs(url)` branch, which
is only reachable when `saveAs` is handed a URL string. The app never calls
`saveAs` at all — it takes the bytes from `getBuffer()` and builds its own Blob —
so that code is unreachable.

## Why the PDF chunk is ~2 MB

Guarantee 2 is the reason. The PDF path bundles pdfmake plus two embedded
JetBrains Mono faces, and the Web Worker is inlined (`?worker&inline`) so
starting it does not fetch a worker file. Inlining costs about a third in
base64 overhead.

That whole chunk is imported during `requestIdleCallback` after first paint —
idle rather than eager so it never competes with rendering, and ahead of time so
that pressing **Export PDF** needs nothing from the network. The alternative,
loading it on demand, would be a smaller initial payload at the cost of one
same-origin request at export time.

## What is not promised

- The initial page load obviously fetches the app's own files. "After initial
  load" means after that has settled.
- If you serve the build from a remote host, loading it is a network request to
  that host. Nothing about your vault contents is included; submissions live in
  IndexedDB and are only ever read locally.
