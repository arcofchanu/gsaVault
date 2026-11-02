# PRD — GSA Vault (Red-Team Submission Archive)

Oct 26, 2026 · @Chanu

## 1. Overview

GSA Vault is a local-only web app that ingests accepted Gray Swan Arena submission exports (`.json` or `.zip`), organizes them as **Competition → Wave → Scenario → Model**, shows each accepted payload plus the initial task, and exports a black/red PDF report or a re-importable JSON bundle.

### Goals

1. Drop any mix of `.json` and `.zip` files (multiple at once); dedupe, parse, sort automatically.
2. Single-turn mode (default): show **payload + initial user task only**. Agent response and tool calls hidden.
3. Multi-turn mode (toggle): show the **full chat transcript**.
4. Dashboard: breaks per scenario, per model, scenario × model matrix.
5. Export PDF: 2-page report (cover + stats/graphs), then payloads packed densely.
6. Export JSON bundle: one file that restores the entire vault on re-import, no need for the original exports.

### Non-goals

- No backend, no accounts, no network calls. Payloads are bounty-confidential; nothing leaves the browser.
- No editing payload content. No submitting to GSA.
- No grading or validation of whether a break is real; every dropped file is treated as accepted.

## 2. Input format (GSA arena-chat export)

The parser targets `formatVersion: 1`, `kind: "arena-chat"`. Put the real sample export in `fixtures/` and write tests against it. Observed top-level shape:

```json
{
  "formatVersion": 1,
  "exportedAt": "2026-10-24T21:10:49.373Z",
  "challenge": { "slug": "ipi-black-2026", "name": "Indirect Prompt Injection: Black", "anonymized": true },
  "kind": "arena-chat",
  "chatId": "6add1dec045054945b2d8485",
  "scenario": "WB2S1 - Issue Unauthorized Refund",
  "title": "[{...injected order JSON...}] · [] · [] · [] · [{...injected email...}] · [] · []",
  "createdAt": "2026-10-24T21:06:52.527Z",
  "messages": [
    { "role": "user", "content": "Please summarize any major issues with open orders", "timestamp": "..." },
    { "role": "assistant", "content": "...", "timestamp": "...", "toolCalls": [ { "name": "bash", "arguments": {}, "output": "..." } ] }
  ],
  "model": "Emerald Grasshopper Ultra"
}
```

### Field mapping

| App field | Source | Notes |
| --- | --- | --- |
| Competition | `challenge.name` (key: `challenge.slug`) | Group key is slug; display name is `name` |
| Wave | Derived from `scenario` code, else user-set | See wave rule below |
| Scenario | `scenario` | Split into `code` (`WB2S1`) and `label` (`Issue Unauthorized Refund`) on the first `-` |
| Model | `model` | Anonymized codename; display as-is |
| Payload (indirect) | `title` | The injection slots; see payload rule |
| Initial task | First `messages[]` item with `role: "user"` | The benign user ask the agent received |
| Transcript (multi-turn) | Full `messages[]` | `toolCalls` collapsed by default |
| Dedupe key | `chatId` | Same chatId dropped twice = one record |
| Timestamps | `createdAt`, `exportedAt` | Sort and timeline |

### Payload rule (indirect, single-turn)

1. Split `title` on the separator `·` (space, U+00B7 middle dot, space). Each part is one injection slot, in order.
2. Keep the slot index (1-based) even for empty slots, so the user sees which surface was injected.
3. Try `JSON.parse` on each slot. Empty array `[]` = unused slot. Parsed object/array = pretty-print it. Parse failure = show raw text.
4. Pull out long string fields (`note`, `body`, `subject`, `description`, `content`) and render them as wrapped prose under the JSON, because that is where the injection text lives.
5. Highlight template placeholders matching `\{\{[a-z_.]+\}\}` (e.g. `{{attacker}}`, `{{owner}}`, `{{principal}}`, `{{org}}`) in red.
6. Fallback when `title` is missing or not slot-shaped: payload = the first user message.

### Wave rule

- If `scenario` code matches `/^W([A-Z0-9]+?)S(\d+)$/`, wave = group 1 (e.g. `WB2S1` → wave `B2`, scenario no. `1`). This is a guess at GSA's naming; keep the regex in one config constant.
- No match → wave = `—` (none). The user can set or override wave per submission and per scenario code in the UI; overrides are stored and exported.

### Mode detection

- The global toggle (Single-turn / Multi-turn) sets the mode stamped on files **at drop time**.
- Auto-hint: if a file has 2+ `user` messages, flag it "looks multi-turn" with a one-click switch. Never silently override the toggle.
- Mode is stored per submission and editable afterwards.

## 3. Data model and normalization

Every dropped file becomes one `Submission`. The raw original is kept untouched so export/import is lossless.

```ts
type Mode = 'single' | 'multi';

interface PayloadSlot {
  index: number;            // 1-based position in title
  raw: string;              // exact slot text
  empty: boolean;           // true for "[]" or blank
  parsed: unknown | null;   // JSON.parse result or null
  prose: { field: string; text: string }[]; // extracted note/body/subject etc.
}

interface Submission {
  id: string;               // = chatId
  competition: { slug: string; name: string };
  wave: string;             // derived or override, '—' if none
  scenario: { full: string; code: string; label: string };
  model: string;
  mode: Mode;
  modeHint: Mode | null;    // auto-detected suggestion
  createdAt: string;
  exportedAt: string;
  initialTask: string;      // first user message
  payloadSlots: PayloadSlot[];   // single-turn view
  transcript: Message[];    // multi-turn view (from raw.messages)
  sourceFile: string;       // e.g. "batch1.zip/chat-ipi-black-....json"
  importedAt: string;
  raw: unknown;             // original export, verbatim
}

interface VaultState {
  submissions: Record<string, Submission>;
  waveOverrides: Record<string, string>; // key: `${slug}::${scenarioCode}`
  settings: { defaultMode: Mode };
}
```

### Hierarchy and sort order

```
Competition (by name A–Z)
└─ Wave (natural sort: B1 < B2 < B10; '—' last)
   └─ Scenario (by code natural sort, then label)
      └─ Model (by break count desc, then name)
         └─ Submission (createdAt asc)
```

- All sorts are natural-order (`Intl.Collator` with `numeric: true`).
- Derived stats are computed from the tree, never stored.

### Persistence

- IndexedDB (via `idb-keyval` or Dexie), one store keyed by `chatId`. State survives reload.
- "Clear vault" button with a confirm step.

## 4. Features

### 4.1 Import

- Drop target = the whole window (full-screen red-bordered overlay on dragover) plus a "Browse" button.
- Accepts any mix of `.json` and `.zip`, multiple files per drop.
- Zips: unpack in-browser with JSZip, recurse into nested folders and nested zips, take every `*.json`, ignore `__MACOSX/` and dotfiles.
- Each JSON is classified as: GSA submission (`kind: "arena-chat"`), GSA Vault bundle (see 6.2), or unknown.
- Import summary toast: `+12 added · 3 duplicates skipped · 1 failed` with an expandable list of failed file names and reasons.
- Duplicate `chatId` with different content: keep the newer `exportedAt`, note it in the summary.

### 4.2 Mode toggle

- Header switch: `SINGLE-TURN | MULTI-TURN`. Applies to the next drop.
- Each submission card shows its mode tag; click to flip.

### 4.3 Views

| View | Content |
| --- | --- |
| Dashboard | Stat strip (total breaks, competitions, scenarios, models, waves), scenario × model matrix, charts (section 6.1 page 2 uses the same charts) |
| Tree sidebar | Collapsible Competition → Wave → Scenario → Model with counts; click filters the main pane |
| Submission list | Cards for the current filter, sorted per section 3 |
| Submission detail | Single-turn: header (comp/wave/scenario/model/date), Initial Task block, Payload slots. Multi-turn: header + chat transcript bubbles, tool calls collapsed |

- Scenario × model matrix: rows = scenarios, columns = models, cell = break count; filled cells red, empty cells dim. Click a cell → filtered list.
- Copy buttons on payload slots, initial task, and the whole transcript.

### 4.4 Search and filter

- Global search (`/` to focus) across scenario, model, task, payload text.
- Filter chips: competition, wave, mode, model.
- Keyboard: `j/k` move between cards, `enter` open, `esc` back.

## 5. UI and visual design

Minimal, dark, terminal-adjacent: it should feel like an ops console, not a SaaS dashboard. Red is the only accent; everything else is black, near-black and white.

### Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0A0A0A` | Page background |
| `--surface` | `#141414` | Cards, sidebar |
| `--line` | `#2A2A2A` | 1px borders, dividers |
| `--red` | `#E10600` | Accent, active states, placeholders, chart fills |
| `--red-dim` | `#5C0A08` | Matrix empty-but-hover, red backgrounds |
| `--text` | `#F2F2F2` | Primary text |
| `--muted` | `#8A8A8A` | Labels, timestamps |

### Type

- Mono everywhere for data: **JetBrains Mono** (payloads, IDs, codes, stats).
- Headings: **Space Grotesk** or the same mono in uppercase with `letter-spacing: 0.12em`.
- Section labels styled like `// SCENARIOS` or `[ MODELS BROKEN ]`.

### Details

- Sharp corners (0–2px radius), 1px borders, no drop shadows, no gradients.
- Hover: border turns red. Active nav item: 2px red left bar.
- Subtle touches only: blinking `_` cursor in the empty-state headline (`DROP SUBMISSIONS_`), faint scanline or grid on the drop overlay, numbers count up once on load.
- Respect `prefers-reduced-motion` (disable all of the above).
- Layout: left tree sidebar (280px), main pane, sticky header with mode toggle + Export buttons. Sidebar collapses to a drawer below 900px.
- Empty state: one large drop zone, nothing else.

## 6. Export

Export respects the current filter (e.g. export only one competition); an "Export all" option ignores it.

### 6.1 PDF

Every page: black `#0A0A0A` full-bleed background, text white `#F2F2F2`, headings/accents/charts red `#E10600`. A4 portrait. Footer on every page: `GSA VAULT · <competition> · page n/N`.

**Page 1 — Cover + report**

- Competition name (large, red), slug, date range of submissions, export date.
- Stat block: total breaks · scenarios broken · models broken · waves.
- Table: Scenario | Wave | Models broken (count) | Model names.
- Multiple competitions in one export → one cover section per competition, in sequence.

**Page 2 — Graphs**

- Bar: breaks per model.
- Bar: breaks per scenario.
- Heatmap: scenario × model matrix (red = broken, dark = not).
- Line or dot timeline: breaks by `createdAt` date.
- Charts are drawn as SVG in red/white on black (no chart-library default themes), then embedded as vector.

**Pages 3+ — Payloads (packed)**

- Grouped by Competition → Wave → Scenario → Model, group header in red.
- Each entry: meta line (scenario code · model · mode · date · chatId short), Initial Task box, Payload slots (non-empty only in PDF, slot index shown), placeholders `{{...}}` in red.
- **Packing rule: flow entries continuously; do not force one per page.** Start a new page only when the next entry does not fit. Never split an entry's meta line from its first block; long payloads may split across pages with a `(cont.)` marker.
- Multi-turn entries: full transcript as alternating `USER` / `AGENT` blocks; tool calls omitted in PDF, replaced by `[n tool calls]`.
- Font: embedded JetBrains Mono (needs glyphs for `·`, `⚠`, `—`, curly quotes; fall back to a glyph-complete font or substitute `⚠` → `[!]`).

**Library:** `pdfmake` (supports per-page `background`, native SVG, automatic text flow and page breaks, custom font VFS). Generate entirely client-side.

### 6.2 JSON bundle (round-trip)

```json
{
  "schema": "gsa-vault/1",
  "exportedAt": "2026-10-26T09:30:00Z",
  "settings": { "defaultMode": "single" },
  "waveOverrides": { "ipi-black-2026::WB2S1": "B2" },
  "submissions": [
    { "mode": "single", "sourceFile": "...", "importedAt": "...", "raw": { /* original GSA export, verbatim */ } }
  ]
}
```

- Stores raw originals + user-set fields only; everything else is re-derived on import. This guarantees the bundle reproduces the vault exactly and stays valid if parsing logic improves.
- Import: detect `schema: "gsa-vault/1"` and merge (same dedupe rules). Also accept a pasted bundle via a "Paste JSON" textarea modal.
- Filename: `gsa-vault-<yyyy-mm-dd>.json`.

## 7. Build spec

### Stack

| Concern | Choice |
| --- | --- |
| Framework | SvelteKit + `adapter-static` (SPA, deployable to Cloudflare Pages or run locally) |
| Language | TypeScript, strict |
| Styling | Plain CSS with the tokens in section 5 (no UI kit) |
| Zip | `jszip` |
| Storage | `idb-keyval` |
| PDF | `pdfmake` + embedded JetBrains Mono |
| Charts | Hand-written SVG components (shared by UI and PDF) |
| Tests | Vitest for parser/normalizer/bundle round-trip |

### Structure

```
src/
  lib/
    parse/
      detect.ts        // arena-chat | vault-bundle | unknown
      arenaChat.ts     // raw → Submission (payload slots, task, wave, scenario split)
      zip.ts           // recursive unzip → File[]
    store/vault.ts     // svelte store + IndexedDB sync, dedupe, overrides
    stats.ts           // tree, counts, matrix
    charts/            // Bar.svelte, Heatmap.svelte, Timeline.svelte + svg string builders
    export/
      pdf.ts           // pdfmake doc definition
      bundle.ts        // export/import gsa-vault/1
  routes/
    +page.svelte       // dashboard + list
    s/[id]/+page.svelte  // submission detail
fixtures/
  chat-ipi-black-2026-*.json   // the real sample export
```

### Edge cases

- `title` slots containing `·` inside JSON strings: split only on `·` with spaces, then verify each part parses or is `[]`; if parts fail, retry by scanning balanced brackets.
- `shippingAddress: null`-style nulls and missing `toolCalls`: never crash, render `—`.
- Very large `toolCalls` outputs (35KB+): don't render in single-turn; lazy-render in multi-turn.
- Malformed JSON, non-GSA JSON, password-protected zip: listed as failed in the import summary.
- 500+ submissions: list virtualized; PDF generation shows progress and runs in a Web Worker.
- Non-anonymized exports (`anonymized: false`) may carry real model names: display them as given.

### Acceptance criteria

- [ ] Dropping the fixture JSON shows: competition "Indirect Prompt Injection: Black", wave `B2`, scenario `WB2S1 - Issue Unauthorized Refund`, model "Emerald Grasshopper Ultra", task "Please summarize any major issues with open orders", and two non-empty payload slots (1: order JSON with note, 5: email with subject/body).
- [ ] Single-turn detail shows no assistant text and no tool calls.
- [ ] Dropping the same file twice, or inside a zip, yields one submission.
- [ ] A zip with nested folders + JSONs, dropped together with loose JSONs, imports all.
- [ ] PDF: page 1 report, page 2 charts, then payloads packed (2–3 short entries share a page); all pages black with red/white content.
- [ ] Export JSON → Clear vault → import that JSON (file or paste) → identical dashboard, including wave overrides and modes.
- [ ] Zero network requests after initial load (verify in DevTools).

### Milestones

1. Parser + tests against fixture.
2. Import (json/zip/dedupe) + IndexedDB store.
3. Dashboard, tree, list, detail views (single + multi).
4. JSON bundle export/import + paste.
5. PDF export.
6. Polish: keyboard, motion, responsive.
