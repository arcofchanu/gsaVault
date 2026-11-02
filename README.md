# GSA Vault

A local-only web app that archives accepted Gray Swan Arena submission exports.
Drop any mix of `.json` and `.zip` files; the vault parses, dedupes and sorts
them into **Competition → Wave → Scenario → Model**, shows each accepted payload
next to the benign task the agent was given, and exports either a black/red PDF
report or a re-importable JSON bundle.

Payloads are bounty-confidential. Nothing leaves the browser — see
[NETWORK.md](NETWORK.md), which is verified by an automated check rather than
just asserted here.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
```

To build and serve the static SPA:

```bash
npm run build
npm run preview        # http://localhost:4173
```

The build in `build/` is plain static files — host it anywhere, or open it
through any local static server.

## Verifying it

```bash
npm test               # 141 unit tests: parser, zip, stats, charts, bundle, PDF
npm run check          # svelte-check, TypeScript strict
npm run smoke          # 53 end-to-end checks in a real browser
```

`npm test` covers everything that can be checked without a browser, including
real PDF generation against the fixture.

`npm run smoke` needs `npm run preview` running in another terminal. It drives
headless Edge or Chrome over the DevTools protocol: it feeds
`fixtures/*.json` into the app's actual file input, then verifies the dashboard,
the detail views, dedupe, IndexedDB persistence across a reload, the JSON
round-trip, the PDF (including that it rendered in the Web Worker), and that the
app issues no network requests after load. Override the browser with
`BROWSER=/path/to/chrome`.

## Layout

```
src/
  lib/
    config.ts              every tunable pattern: wave regex, slot separator,
                           prose fields, placeholder pattern, dedupe key
    profile.ts             researcher profile for the PDF cover, photo encoding
    competitions.ts        competition list, creating one, moving a wave (pure)
    types.ts               Submission, PayloadSlot, VaultBundle, ...
    parse/
      detect.ts            arena-submission | vault-bundle | unknown
      slots.ts             title -> injection slots, prose extraction
      arenaChat.ts         raw export -> Submission
      zip.ts               recursive unzip -> JSON documents
      import.ts            dedupe + bundle expansion (pure)
    store/
      persist.ts           IndexedDB via idb-keyval
      vault.svelte.ts      reactive vault, re-derived from raw
      ui.svelte.ts         filter, overlays, toasts
    stats.ts               tree, counts, matrix, filtering
    charts/
      svg.ts               hand-written SVG builders (UI + PDF)
      Bar / Heatmap / Timeline.svelte
    export/
      bundle.ts            gsa-vault/1 export/import
      pdfDoc.ts            pdfmake document definition (pure, testable)
      pdfRender.ts         two-pass render driver
      pdf.worker.ts        runs it off the main thread
      pdf.ts              public entry, worker + main-thread fallback
      fonts.generated.ts   embedded JetBrains Mono (npm run fonts)
  routes/
    +page.svelte           dashboard + submission list
    s/[id]/+page.svelte    submission detail
scripts/
  build-fonts.mjs          TTF -> base64 module, with a glyph-coverage check
  smoke.mjs                browser end-to-end checks
fixtures/
  submission-ipi-black-2026-*.json
```

### Three ideas worth knowing

**Everything is re-derived from `raw`.** A submission's stored form is only the
verbatim export plus the fields a user can set (`mode`, `sourceFile`,
`importedAt`, an optional assigned `competition`, plus the wave overrides and
competition renames keyed separately). Both IndexedDB and the JSON bundle store
exactly that shape, so a reload, a bundle re-import and a parser improvement all
flow through one code path and cannot disagree.

**Nothing reactive may cross a clone boundary.** Both `postMessage` (to the PDF
worker) and `IDBObjectStore.put` run the structured-clone algorithm, which
throws `DataCloneError` on Svelte's `$state` proxies — quietly, in the IndexedDB
case, because the in-memory value is already right and only a reload reveals the
loss. The store funnels every write through `snapshot()` (`$state.snapshot`), and
`export/pdf.ts` rebuilds its input as plain data. Two browser checks guard this:
*profile and rename survive a reload*, and *nothing failed to persist*.

**The PDF is laid out twice.** pdfmake renders headers and footers *before* it
reports which pages each node ended up on, so a single pass cannot label a page
with the competition it belongs to. The first pass runs with the charts blanked
(same dimensions, far cheaper) purely to collect that mapping; the second uses
it for the per-page footer and the `(cont.)` header on pages that continue a
group.

## Regenerating the fonts

`src/lib/export/fonts.generated.ts` is committed. Rebuild it after changing the
font source:

```bash
npm run fonts
```

It verifies that every glyph the report needs (`·` `—` `→` `×` `…` curly
quotes) exists in both faces and fails loudly otherwise.

## Where this differs from the PRD

Each of these is a deliberate decision, not an oversight.

### Driven by the real fixture

1. **`kind` is not just `arena-chat`.** The fixture is
   `kind: "arena-submission"`. Both are accepted, plus a lenient shape match (a
   dedupe key plus a `messages` array) so a slightly-off export is archived
   rather than dropped.
2. **Acceptance criterion 1 describes a different export** than the one in
   `fixtures/` (it names `WB2S1` / "Emerald Grasshopper Ultra" / slots 1 and 5).
   The tests assert the fixture that actually exists: `WB2S4` / "Cancel Target
   Order" / "Blue Seagull Peerless", wave `B2`, eight slots with 1 and 4 filled.
   Everything the criterion was checking is covered.
3. **The placeholder pattern allows digits and uppercase.** The PRD's
   `\{\{[a-z_.]+\}\}` misses the fixture's own `{{wb2s4_target_order}}`.
4. **`createdAt` has a fallback chain.** `arena-submission` exports have no
   `createdAt`, so it falls back to `submittedAt`, then the first message
   timestamp, then `exportedAt` — otherwise the timeline and sort order break.
5. **`status` and `judge` are preserved in `raw` but never shown or counted.**
   Per the PRD's non-goal, every dropped file is treated as accepted.

### Driven by the platform

6. **Chart label text in the PDF is Courier, not JetBrains Mono.** Body text,
   headings and payloads all use the embedded JetBrains Mono. Only text *inside*
   the chart SVGs differs, because pdfmake 0.3 requires string font sources
   (`Printer.resolveUrls` rewrites every descriptor value as a URL) and
   svg-to-pdfkit hands that string to pdfkit's own loader, which in the browser
   cannot see pdfmake's virtual filesystem. An embedded TTF therefore cannot
   back SVG `<text>`; the alternative was chart labels silently vanishing.
   Courier is a standard PDF font needing no file, and shares JetBrains Mono's
   0.6em advance, so the chart layout maths is unchanged.
7. **The store is `store/vault.svelte.ts`, not `store/vault.ts`.** Svelte 5
   runes require the `.svelte.ts` extension.

### Judgement calls

8. **The submission list renders incrementally, not with true virtualisation.**
   It renders 80 cards and pulls in the next 80 as a sentinel scrolls into view,
   which keeps the DOM small while scrolling without assuming a fixed card
   height. A recycling virtualiser would cap the DOM absolutely; this does not,
   so a vault of several thousand fully scrolled to the bottom will hold a large
   DOM. Worth revisiting if that becomes real.
9. **Wave overrides are per (competition, scenario code).** That is the shape of
   `waveOverrides` in the PRD's own data model, so a per-submission override has
   nowhere to live; the detail view says so when you edit one.
10. **The PDF repeats cover + graphs per competition.** The required footer
    (`GSA VAULT · <competition> · page n/N`) only makes sense if pages belong to
    a competition, so each competition gets a complete report section in
    sequence rather than all covers being grouped up front.
11. **Headings use JetBrains Mono uppercase** rather than Space Grotesk — the
    PRD offered either, and one font family keeps the bundle smaller.
12. **No rounded corners anywhere, and gradients are used.** Both per explicit
    instruction, superseding the PRD's "0–2px radius" and "no gradients".
13. **The empty state carries a "select files" button**, so the drop zone is not
    the only way in. The PRD describes the empty state as "one large drop zone,
    nothing else", but §4.1 also asks for a Browse button; this puts one where
    it is actually needed. Both it and the header's `browse` open the same
    single hidden input.
14. **Unused injection surfaces are hidden by default** in the detail view, not
    just in the PDF — the header still counts them (`2/8 SLOTS USED`) and a
    toggle reveals them for auditing surface coverage.
15. **Each PDF entry is one framed table** rather than loose stacked text. The
    frame gives the report its card-per-submission look, and making the meta
    line the table's `headerRows: 1` is also how the PRD's packing rule is
    satisfied: it cannot be split from the entry's first block, and it reappears
    at the top of every page a long entry continues onto.

### Beyond the PRD

Asked for after the fact, so the PRD says nothing about them.

16. **The PDF page plan is cover / report / payloads.** The PRD put the stat
    block and scenario table on page 1 alongside the cover. Page 1 is now a
    proper cover — kicker, a decorative graphic band, the competition name,
    four big stat tiles and, when a profile is filled in, a researcher section
    (large photo and name, achievement tiles, most-broken model and scenario)
    that is stretched to the bottom margin using the space measured in the
    layout pass. The PDF is named after the competition
    (`Indirect Prompt Injection - Black.pdf`) — and the scenario table moved to
    page 2, where the graphs flow after it. The band is deliberately *not*
    data-driven: a lattice whose lit cells tracked break counts would look empty
    for a small vault or imply a scale the data does not support. It varies by
    competition slug (via a deterministic hash, so a given export is still
    byte-identical every time) and contains no text, so it needs no font.
17. **A researcher profile on the cover** — name, photo, global rank, unique
    behaviours broken, total won, and a link to the public profile. It is typed
    in through the `profile` button and stored locally: the vault makes no
    network calls, so nothing can be read off Gray Swan's site, and the labels
    are my wording rather than theirs. Values are free text so whatever the
    profile page shows is reproduced verbatim. The photo is centre-cropped and
    re-encoded as a 192px PNG — pdfkit embeds only PNG and JPEG, so a WebP
    avatar would otherwise fail at export time, and a data URL keeps the PDF
    self-contained.
18. **Competitions are first-class: renamed, created, and worked in one at a
    time.** Renaming is keyed by slug, so the group key never moves and every
    submission follows. The header's `into` picker sets the *active*
    competition, which does three things at once: the next drop or paste is
    filed under it (overriding the `challenge` in the file), the home page
    shows only it, and export pre-selects it. `all · file by challenge` is the
    old behaviour. The active competition is simply `filter.competition`, so the
    picker, the sidebar and the home page cannot disagree; `clear all` keeps it,
    because it is where you are working rather than a search. Submissions
    arriving inside a vault bundle keep their own provenance either way.
    `new competition…` (in the picker, or at the foot of the sidebar) creates a
    real, saved competition that is listed before anything is filed in it, and
    an empty one can be removed. Hand-made competitions get a `custom-` slug
    prefix so they cannot collide with a real GSA challenge slug.
19. **Waves can be moved between competitions.** Drag a wave in the sidebar onto
    another competition, or use its `move` button. The sidebar always lists
    every competition, whatever is active, so it is the place to do this. A
    move re-files each submission of that wave, and carries any hand-set wave
    override across, because overrides are keyed per competition and would
    otherwise silently revert. A competition emptied by a move stays listed.
20. **Export asks which competition.** Both `pdf` and `json` open a dialog
    listing every competition, `every competition`, and — when a wave,
    scenario, model, mode or search narrows things further — the current view.
    This replaces the old `filtered` / `all` toggle.
21. **`gsa-vault/1` gained four optional fields** — `competitionNames`,
    `profile`, `competitions` (empty competitions, carried by a whole-vault
    export) and a per-entry `competition`. All optional, so a bundle written
    before they existed still imports, and a vault with none of them set writes
    a bundle byte-identical to the old shape. The schema id is unchanged for
    that reason.
