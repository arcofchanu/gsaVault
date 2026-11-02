/**
 * End-to-end smoke test against a real browser.
 *
 * The Vitest suite covers parsing, stats, the bundle round-trip and the PDF.
 * What it cannot cover is the browser half: Svelte rendering, IndexedDB, and
 * the import path that starts at a file input. This script drives those by
 * feeding the real fixture into the app's file picker over the DevTools
 * protocol, then reading the rendered DOM back.
 *
 *   npm run build && npm run preview     # in one terminal
 *   npm run smoke                        # in another
 *
 * Set BROWSER to override the detected Edge/Chrome path.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const APP_URL = process.env.APP_URL ?? 'http://localhost:4173/';
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9333);

const BROWSER_CANDIDATES = [
	process.env.BROWSER,
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter((p) => typeof p === 'string' && p.length > 0);

function findBrowser() {
	const found = BROWSER_CANDIDATES.find((p) => existsSync(p));
	if (found === undefined) {
		throw new Error(`no browser found; set BROWSER=<path>. Tried:\n  ${BROWSER_CANDIDATES.join('\n  ')}`);
	}
	return found;
}

function fixturePath() {
	const dir = resolve(process.cwd(), 'fixtures');
	const name = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.json'));
	if (name === undefined) throw new Error('no JSON fixture in fixtures/');
	return join(dir, name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForJson(url, attempts = 40) {
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(url);
			if (res.ok) return await res.json();
		} catch {
			/* not up yet */
		}
		await sleep(250);
	}
	throw new Error(`timed out waiting for ${url}`);
}

/** Minimal CDP client over the built-in WebSocket. */
class Cdp {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(event.data);
			const entry = this.pending.get(message.id);
			if (entry === undefined) return;
			this.pending.delete(message.id);
			if (message.error) entry.reject(new Error(`${message.method}: ${message.error.message}`));
			else entry.resolve(message.result);
		});
	}

	static async connect(wsUrl) {
		const socket = new WebSocket(wsUrl);
		await new Promise((res, rej) => {
			socket.addEventListener('open', res, { once: true });
			socket.addEventListener('error', () => rej(new Error('CDP socket failed')), { once: true });
		});
		return new Cdp(socket);
	}

	send(method, params = {}) {
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, method });
			setTimeout(() => {
				if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
			}, 30_000);
		});
	}

	async evaluate(expression) {
		const result = await this.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true
		});
		if (result.exceptionDetails) {
			throw new Error(`page threw: ${result.exceptionDetails.text} ${result.result?.description ?? ''}`);
		}
		return result.result.value;
	}

	close() {
		this.socket.close();
	}
}

/**
 * Poll a directory until a download matching `pattern` has finished.
 *
 * Chromium creates the file immediately and fills it in, so a non-zero size
 * proves nothing — reading too early yields a truncated PDF whose trailing
 * objects (font dictionaries, xref) are missing. Wait for the size to stop
 * changing, and for the in-flight `.crdownload` sibling to disappear.
 */
async function waitForFile(dir, pattern, attempts = 120) {
	let lastSize = -1;
	let stable = 0;
	for (let i = 0; i < attempts; i++) {
		const entries = readdirSync(dir);
		const match = entries.find((f) => pattern.test(f));
		const inFlight = entries.some((f) => f.endsWith('.crdownload'));
		if (match !== undefined && !inFlight) {
			const path = join(dir, match);
			const size = readFileSync(path).length;
			if (size > 0 && size === lastSize) {
				if (++stable >= 2) return path;
			} else {
				stable = 0;
			}
			lastSize = size;
		}
		await sleep(250);
	}
	return null;
}

/**
 * Wait until no new request has been seen for `quietMs`. Used to let the
 * idle-time warm-up (PDF chunk, detail route) finish before measuring whether
 * the app issues any further requests.
 */
async function waitForQuiet(count, quietMs = 2000, maxMs = 30_000) {
	const deadline = Date.now() + maxMs;
	let last = -1;
	let stableSince = Date.now();
	while (Date.now() < deadline) {
		const now = count();
		if (now !== last) {
			last = now;
			stableSince = Date.now();
		} else if (Date.now() - stableSince >= quietMs) {
			return;
		}
		await sleep(200);
	}
}

/**
 * Click the first button whose trimmed text matches, waiting for it to appear.
 * Reports what buttons *were* on the page if it never shows up.
 */
async function clickButton(cdp, pattern, label, attempts = 40) {
	const finder = `[...document.querySelectorAll('button')].find((b) => ${pattern}.test(b.textContent.trim()))`;
	for (let i = 0; i < attempts; i++) {
		if (await cdp.evaluate(`${finder} !== undefined`)) {
			await cdp.evaluate(`${finder}.click()`);
			return;
		}
		await sleep(250);
	}
	const available = await cdp.evaluate(
		"JSON.stringify([...document.querySelectorAll('button')].map((b) => b.textContent.trim()))"
	);
	const where = await cdp.evaluate('location.href');
	throw new Error(`no button matching ${pattern} (${label}).\n  at ${where}\n  buttons: ${available}`);
}

/**
 * Export now always asks which competition. Open the dialog for "kind", pick
 * "choice" (a competition slug, or "__all__"), and confirm. Returns the labels
 * the dialog offered, so callers can check it.
 */
async function exportVia(cdp, kind, choice = '__all__') {
	await clickButton(cdp, new RegExp('^' + kind + '$'), 'open the ' + kind + ' export dialog');
	await waitFor(cdp, 'document.querySelector(".modal input[name=export-scope]") !== null', 'the export dialog');
	const offered = await cdp.evaluate("JSON.stringify([...document.querySelectorAll('.modal .choice__label')].map((n) => n.textContent.trim()))");
	await cdp.evaluate("document.querySelector('.modal input[name=export-scope][value=\"" + choice + "\"]').click()");
	await clickButton(cdp, new RegExp('^export ' + kind + '$'), 'confirm the ' + kind + ' export');
	return JSON.parse(offered);
}

/** Send one key press to the focused element. */
async function press(cdp, key, text) {
	await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, ...(text ? { text } : {}) });
	await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
}

/** Poll the page until `expression` returns truthy. */
async function waitFor(cdp, expression, label, attempts = 60) {
	for (let i = 0; i < attempts; i++) {
		if (await cdp.evaluate(expression)) return;
		await sleep(250);
	}
	const seen = await cdp.evaluate('document.querySelector("main")?.innerText?.slice(0, 400) ?? "(no main)"');
	throw new Error(`timed out waiting for ${label}.\nmain was:\n${seen}`);
}

/**
 * Case-insensitive contains. Much of the UI is `text-transform: uppercase`,
 * and `innerText` returns the *rendered* text, so comparisons must not care.
 */
function has(haystack, needle) {
	return haystack.toLowerCase().includes(needle.toLowerCase());
}

const checks = [];
function check(name, ok, detail = '') {
	checks.push({ name, ok, detail });
	console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || detail === '' ? '' : `\n          ${detail}`}`);
}

/** Not applicable to this target; recorded but not counted as a failure. */
function skip(name, why) {
	checks.push({ name, ok: true, skipped: true });
	console.log(`  skip  ${name}\n          ${why}`);
}

async function main() {
	const browser = findBrowser();
	const fixture = fixturePath();
	const profile = mkdtempSync(join(tmpdir(), 'gsa-smoke-'));
	console.log(`browser  ${browser}`);
	console.log(`fixture  ${fixture}`);
	console.log(`app      ${APP_URL}\n`);

	const child = spawn(
		browser,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--no-first-run',
			'--disable-extensions',
			`--remote-debugging-port=${DEBUG_PORT}`,
			`--user-data-dir=${profile}`,
			'about:blank'
		],
		{ stdio: 'ignore' }
	);

	let cdp;
	try {
		const version = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
		console.log(`${version.Browser}\n`);

		const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
		const page = targets.find((t) => t.type === 'page');
		if (page === undefined) throw new Error('no page target');

		cdp = await Cdp.connect(page.webSocketDebuggerUrl);
		await cdp.send('Runtime.enable');
		await cdp.send('Page.enable');
		await cdp.send('DOM.enable');
		await cdp.send('Network.enable');

		// Surface page errors, and log every request so the local-only claim can
		// be checked rather than asserted.
		const pageErrors = [];
		const pageWarnings = [];
		const requests = [];
		cdp.socket.addEventListener('message', (event) => {
			const msg = JSON.parse(event.data);
			if (msg.method === 'Runtime.exceptionThrown') {
				pageErrors.push(msg.params.exceptionDetails.text ?? 'exception');
			}
			if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
				pageErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
			}
			if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') {
				pageWarnings.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
			}
			if (msg.method === 'Network.requestWillBeSent') {
				requests.push(msg.params.request.url);
			}
		});

		await cdp.send('Page.navigate', { url: APP_URL });
		await waitFor(cdp, 'document.querySelector("main") !== null', 'the app shell');
		await waitFor(
			cdp,
			'document.body.innerText.includes("DROP SUBMISSIONS")',
			'the empty state'
		);
		check('boots to the empty state', true);

		// The picker buttons can't be followed through a native file dialog, so
		// verify the wiring instead: both must reach the one hidden file input.
		const wiring = await cdp.evaluate(`(() => {
			const input = document.querySelector('input[type="file"]');
			if (!input) return 'no file input';
			const find = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));
			const real = input.click.bind(input);
			const opened = [];
			input.click = () => opened.push(1);
			try {
				const zone = find(/^select files/i);
				const header = find(/^browse$/i);
				if (!zone) return 'no drop-zone button';
				if (!header) return 'no header browse button';
				zone.click();
				const afterZone = opened.length;
				header.click();
				return afterZone === 1 && opened.length === 2 ? 'wired' : 'not wired';
			} finally {
				input.click = real;
			}
		})()`);
		check('both pickers open the file input', wiring === 'wired', wiring);

		/* ---- import the fixture through the real file input ---- */
		const { root } = await cdp.send('DOM.getDocument');
		const { nodeId } = await cdp.send('DOM.querySelector', {
			nodeId: root.nodeId,
			selector: 'input[type="file"]'
		});
		if (!nodeId) throw new Error('file input not found');
		await cdp.send('DOM.setFileInputFiles', { nodeId, files: [fixture] });

		await waitFor(cdp, 'document.body.innerText.includes("WB2S4")', 'the imported submission');

		const text = await cdp.evaluate('document.body.innerText');
		check('shows the competition', has(text, 'Indirect Prompt Injection: Black'));
		check('shows the scenario code and label', has(text, 'WB2S4') && has(text, 'Cancel Target Order'));
		check('shows the model', has(text, 'Blue Seagull Peerless'));
		check('derives wave B2', /wave\s+B2/i.test(text));
		check('reports one break', has(text, '+1 added'));
		check('renders the stat strip', has(text, 'breaks') && has(text, 'scenarios'));

		const charts = await cdp.evaluate('document.querySelectorAll(".panel svg").length');
		check('draws the charts', charts >= 4, `found ${charts} svg charts`);

		const matrixCells = await cdp.evaluate('document.querySelectorAll("[data-cell]").length');
		check('draws the scenario x model matrix', matrixCells >= 1, `${matrixCells} cells`);

		/* ---- dedupe: the same file again must not add a second record ---- */
		await cdp.send('DOM.setFileInputFiles', { nodeId, files: [fixture] });
		await waitFor(cdp, 'document.body.innerText.includes("duplicates skipped")', 'the dedupe toast');
		const afterDupe = await cdp.evaluate(
			'document.querySelectorAll("[data-card]").length'
		);
		check('dedupes a re-dropped file', afterDupe === 1, `${afterDupe} cards`);

		/* ---- search, filter chips and keyboard (PRD §4.4) ---- */
		await cdp.evaluate('document.body.focus()');
		await press(cdp, '/', '/');
		check(
			'"/" focuses the search box',
			(await cdp.evaluate('document.activeElement?.id')) === 'vault-search'
		);

		await cdp.evaluate(`(() => {
			const box = document.getElementById('vault-search');
			box.value = 'zzzz-no-such-payload';
			box.dispatchEvent(new Event('input', { bubbles: true }));
		})()`);
		await waitFor(cdp, 'document.querySelectorAll("[data-card]").length === 0', 'an empty result');
		check('search narrows the list to nothing on a miss', true);

		await cdp.evaluate(`(() => {
			const box = document.getElementById('vault-search');
			box.value = 'cancellation queue';
			box.dispatchEvent(new Event('input', { bubbles: true }));
		})()`);
		await waitFor(
			cdp,
			'document.querySelectorAll("[data-card]").length === 1',
			'a payload-text search hit'
		);
		check('search matches payload text, not just metadata', true);

		await clickButton(cdp, /^clear all$/, 'clear filter');
		await waitFor(cdp, 'document.querySelectorAll("[data-card]").length === 1', 'the cleared filter');

		// Clicking a matrix cell filters to that scenario x model pair. The cell is
		// an SVG <rect>, which has no .click(), and the handler is delegated on the
		// wrapper — so dispatch a bubbling MouseEvent.
		await cdp.evaluate(
			'document.querySelector("[data-cell]").dispatchEvent(new MouseEvent("click", { bubbles: true }))'
		);
		await waitFor(cdp, 'document.querySelectorAll(".chips .chip").length > 0', 'the filter chips');
		const chipText = await cdp.evaluate(
			'JSON.stringify([...document.querySelectorAll(".chips .chip")].map((c) => c.textContent.trim()))'
		);
		check(
			'clicking a matrix cell filters the list',
			chipText.includes('WB2S4') && chipText.includes('Blue Seagull Peerless'),
			chipText
		);
		await clickButton(cdp, /^clear all$/, 'clear filter');
		await waitFor(cdp, 'document.querySelectorAll("[data-card]").length === 1', 'the full list');

		// Enter opens the card under the keyboard cursor.
		await cdp.evaluate('document.activeElement?.blur()');
		await press(cdp, 'Enter');
		await waitFor(cdp, 'location.pathname.includes("/s/")', 'enter opening the detail view');
		check('enter opens the focused card', true);

		// Escape goes back.
		await press(cdp, 'Escape');
		await waitFor(cdp, '!location.pathname.includes("/s/")', 'escape returning to the list');
		check('escape returns to the list', true);

		/* ---- detail view: single-turn hides the agent ----
		   Waits key off DOM structure, not innerText: `text-transform:uppercase`
		   means the list card's "// initial task" label also reads as
		   "// INITIAL TASK", so a text match would pass before navigating. */
		await cdp.evaluate('document.querySelector("[data-card] a").click()');
		await waitFor(
			cdp,
			'location.pathname.includes("/s/") && document.querySelector(".payload") !== null',
			'the detail view'
		);
		const detail = await cdp.evaluate('document.body.innerText');
		const slotLabels = await cdp.evaluate(
			'JSON.stringify([...document.querySelectorAll(".slot__index")].map((e) => e.textContent))'
		);
		check('detail shows the initial task', has(detail, 'cancel the orders customers asked to cancel'));
		check(
			'detail shows only the used payload slots',
			JSON.parse(slotLabels).join(',') === 'SLOT 1,SLOT 4' &&
				!/UNUSED SURFACE/i.test(detail) &&
				/2\/8 SLOTS USED/i.test(detail),
			slotLabels
		);
		check(
			'single-turn hides agent output and tool calls',
			!has(detail, 'mcp__shopify__order-cancel') && !/TOOL CALL/i.test(detail)
		);
		const placeholders = await cdp.evaluate('document.querySelectorAll(".payload .ph").length');
		check('highlights template placeholders', placeholders > 0, `${placeholders} highlighted`);

		// The unused surfaces are hidden, not dropped — the toggle brings them back.
		await clickButton(cdp, /^show empty$/, 'reveal unused slots');
		await waitFor(
			cdp,
			'document.querySelectorAll(".slot__index").length === 8',
			'all eight slots after revealing'
		);
		check('unused surfaces can be revealed on demand', true);
		await clickButton(cdp, /^hide empty$/, 'hide unused slots again');
		await waitFor(cdp, 'document.querySelectorAll(".slot__index").length === 2', 'used slots only');

		/* ---- flip to multi-turn: transcript and tool calls appear ----
		   Target the detail page's mode tag; the header toggle also reads
		   "single-turn" and comes first in document order. */
		await cdp.evaluate('document.querySelector(".facts button.tag--button").click()');
		await waitFor(cdp, 'document.querySelector(".transcript") !== null', 'the transcript');
		const multi = await cdp.evaluate('document.body.innerText');
		check('multi-turn shows the transcript', has(multi, 'USER') && has(multi, 'AGENT'));
		check('multi-turn offers the tool calls', /23 TOOL CALLS/i.test(multi));
		check(
			'multi-turn hides the payload slot view',
			!(await cdp.evaluate('document.querySelector(".payload") !== null'))
		);

		// Tool call bodies stay collapsed until asked for.
		check('tool call bodies are collapsed', !has(multi, 'mcp__shopify__order-cancel'));
		await cdp.evaluate('document.querySelector(".transcript button.toggle").click()');
		await waitFor(
			cdp,
			'document.body.innerText.includes("mcp__shopify__order-cancel")',
			'the expanded tool calls'
		);
		check('tool calls expand on demand', true);

		// Put it back, so the reload check sees the mode that was persisted.
		await cdp.evaluate('document.querySelector(".facts button.tag--button").click()');
		await waitFor(cdp, 'document.querySelector(".payload") !== null', 'single-turn again');

		/* ---- renaming a competition (sidebar) ---- */
		await clickButton(cdp, /^edit$/, 'rename competition');
		await waitFor(cdp, 'document.querySelector(".rename") !== null', 'the rename field');
		await cdp.evaluate(`(() => {
			const box = document.querySelector('.rename');
			box.value = 'IPI Black · Wave 2';
			box.dispatchEvent(new Event('input', { bubbles: true }));
			box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		})()`);
		await waitFor(
			cdp,
			'document.body.innerText.toLowerCase().includes("ipi black · wave 2")',
			'the renamed competition'
		);
		const renamed = await cdp.evaluate('document.body.innerText');
		check(
			'renames a competition everywhere it appears',
			has(renamed, 'IPI Black · Wave 2') && !has(renamed, 'Indirect Prompt Injection: Black')
		);

		/* ---- GSA profile ---- */
		await clickButton(cdp, /^profile$/, 'open profile editor');
		await waitFor(cdp, 'document.querySelector(".modal input") !== null', 'the profile editor');
		await cdp.evaluate(`(() => {
			const set = (label, value) => {
				const field = [...document.querySelectorAll('.modal .field')]
					.find((f) => f.textContent.trim().toLowerCase().startsWith(label));
				const input = field.querySelector('input');
				input.value = value;
				input.dispatchEvent(new Event('input', { bubbles: true }));
			};
			set('name', 'chanu');
			set('global rank', '#12');
			set('unique behaviours broken', '47');
			set('total money won', '$12,400');
			set('public profile url', 'https://app.grayswan.ai/arena/user/6a34359d38ad1e98f8707b0f');
		})()`);
		await clickButton(cdp, /^save$/, 'save the profile');
		await waitFor(
			cdp,
			'document.querySelector(".modal") === null',
			'the profile editor closing'
		);
		const reopened = await cdp.evaluate(`(async () => {
			[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'profile').click();
			await new Promise((r) => setTimeout(r, 400));
			const values = [...document.querySelectorAll('.modal .field input')].map((i) => i.value);
			[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'cancel').click();
			return JSON.stringify(values);
		})()`);
		check(
			'stores the profile and reloads it into the editor',
			reopened.includes('chanu') && reopened.includes('#12') && reopened.includes('$12,400'),
			reopened
		);

		/* ---- persistence across a reload ---- */
		await cdp.send('Page.navigate', { url: APP_URL });
		await waitFor(cdp, 'document.body.innerText.includes("WB2S4")', 'the vault after reload');
		check('survives a reload (IndexedDB)', true);

		// Everything user-set has to survive too, not just the submissions.
		// IndexedDB clones its values, so any reactive proxy reaching it fails.
		const afterReload = await cdp.evaluate(`(async () => {
			[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'profile').click();
			await new Promise((r) => setTimeout(r, 500));
			const values = [...document.querySelectorAll('.modal .field input')].map((i) => i.value);
			[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'cancel').click();
			return JSON.stringify({
				profile: values,
				competition: document.querySelector('.node--comp .name')?.textContent?.trim(),
				storageError: document.querySelector('.storage-error')?.textContent ?? null
			});
		})()`);
		const state = JSON.parse(afterReload);
		check(
			'profile and rename survive a reload',
			state.profile.includes('chanu') &&
				state.profile.includes('$12,400') &&
				(state.competition ?? '').toLowerCase().includes('ipi black'),
			afterReload
		);
		check('nothing failed to persist', state.storageError === null, state.storageError ?? '');

		/* ---- JSON bundle round trip: export, clear, paste back ---- */
		const downloads = join(profile, 'downloads');
		mkdirSync(downloads, { recursive: true });
		await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

		const offered = await exportVia(cdp, 'json');
		check(
			'export asks which competition',
			offered.some((l) => has(l, 'IPI Black')) && offered.some((l) => has(l, 'every competition')),
			JSON.stringify(offered)
		);
		const bundlePath = await waitForFile(downloads, /^gsa-vault-.*\.json$/);
		check('exports a JSON bundle', bundlePath !== null, `in ${downloads}`);

		const bundleText = readFileSync(bundlePath, 'utf8');
		const bundle = JSON.parse(bundleText);
		check(
			'bundle is self-describing and lossless',
			bundle.schema === 'gsa-vault/1' &&
				bundle.submissions.length === 1 &&
				bundle.submissions[0].raw.chatId === '6adbb51d9b5a244e4220071a'
		);
		check(
			'bundle carries the rename and the profile',
			bundle.competitionNames?.['ipi-black-2026'] === 'IPI Black · Wave 2' &&
				bundle.profile?.name === 'chanu' &&
				bundle.profile?.earnings === '$12,400',
			JSON.stringify({ names: bundle.competitionNames, profile: bundle.profile?.name })
		);

		// Clear the vault (two-step confirm), then paste the bundle back in.
		await clickButton(cdp, /^clear vault$/, 'clear vault');
		await clickButton(cdp, /^confirm clear$/, 'confirm clearing the vault');
		await waitFor(cdp, 'document.body.innerText.includes("DROP SUBMISSIONS")', 'the cleared vault');
		check('clears the vault behind a confirm step', true);

		await clickButton(cdp, /^paste$/, 'open paste modal');
		await waitFor(cdp, 'document.querySelector(".modal textarea") !== null', 'the paste modal');
		await cdp.evaluate(`(() => {
			const area = document.querySelector('.modal textarea');
			area.value = ${JSON.stringify(bundleText)};
			area.dispatchEvent(new Event('input', { bubbles: true }));
			return area.value.length;
		})()`);
		await cdp.evaluate(
			'[...document.querySelectorAll(".modal button")].find((b) => b.textContent.trim() === "Import").click()'
		);
		await waitFor(cdp, 'document.body.innerText.includes("WB2S4")', 'the re-imported vault');

		const restored = await cdp.evaluate('document.body.innerText');
		const restoredCards = await cdp.evaluate('document.querySelectorAll("[data-card]").length');
		check(
			're-import restores the dashboard identically',
			// The rename came back with the bundle, so the renamed title is correct.
			has(restored, 'IPI Black · Wave 2') &&
				has(restored, 'Blue Seagull Peerless') &&
				has(restored, 'Cancel Target Order') &&
				/wave\s+B2/i.test(restored) &&
				restoredCards === 1,
			`${restoredCards} card(s)`
		);

		/* ---- filing an import under a chosen competition ----
		   A fresh chatId: re-dropping the same file is a duplicate, which dedupe
		   correctly skips, so it would never exercise the picker. */
		await cdp.evaluate(`(() => {
			const select = document.querySelector('.into__select');
			select.value = '__new__';
			select.dispatchEvent(new Event('change', { bubbles: true }));
		})()`);
		await waitFor(cdp, 'document.querySelector(".into__new") !== null', 'the new-competition field');
		await cdp.evaluate(`(() => {
			const box = document.querySelector('.into__new');
			box.value = 'Wave 3 Sweep';
			box.dispatchEvent(new Event('input', { bubbles: true }));
			box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		})()`);
		await waitFor(cdp, 'document.querySelector(".into__select.is-set") !== null', 'the chosen target');

		// A new competition is a real, saved one: listed while still empty, and
		// the home page switches to it.
		await waitFor(cdp, 'document.body.innerText.toLowerCase().includes("nothing filed here yet")', 'the empty competition view');
		const emptyComp = await cdp.evaluate(`(() => {
			const names = [...document.querySelectorAll('.node--comp .name')].map((n) => n.textContent.trim());
			return JSON.stringify({ names, cards: document.querySelectorAll('[data-card]').length });
		})()`);
		const ec = JSON.parse(emptyComp);
		check(
			'a new competition is listed before anything is filed in it',
			ec.names.includes('Wave 3 Sweep') && ec.names.some((n) => has(n, 'IPI Black')) && ec.cards === 0,
			emptyComp
		);

		const moved = JSON.stringify(JSON.parse(readFileSync(fixture, 'utf8')));
		const relabelled = moved.replace('6adbb51d9b5a244e4220071a', 'smoke-filed-elsewhere');
		await clickButton(cdp, /^paste$/, 'open paste modal');
		await waitFor(cdp, 'document.querySelector(".modal textarea") !== null', 'the paste modal');
		await cdp.evaluate(`(() => {
			const area = document.querySelector('.modal textarea');
			area.value = ${JSON.stringify(relabelled)};
			area.dispatchEvent(new Event('input', { bubbles: true }));
		})()`);
		await clickButton(cdp, /^Import$/, 'import the pasted export');
		await waitFor(
			cdp,
			'document.querySelectorAll("[data-card]").length === 1 && !document.body.innerText.toLowerCase().includes("nothing filed here yet")',
			'the submission filed under the new competition'
		);

		/** Sidebar competitions as { name: count }. */
		const sidebarCounts = async () =>
			JSON.parse(
				await cdp.evaluate(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.node--comp')].map((n) => [n.querySelector('.name').textContent.trim(), Number(n.querySelector('.count').textContent)])))`)
			);
		const filed = await sidebarCounts();
		const ipiName = Object.keys(filed).find((n) => has(n, 'IPI Black'));
		check(
			'files a dropped file under a chosen competition',
			filed['Wave 3 Sweep'] === 1 && ipiName !== undefined && filed[ipiName] === 1,
			JSON.stringify(filed)
		);
		check(
			'home page shows only the active competition',
			(await cdp.evaluate('document.querySelectorAll("[data-card]").length')) === 1,
			'expected one card while Wave 3 Sweep is active'
		);

		/* ---- moving a whole wave between competitions ---- */
		// Through the "move" menu: Wave 3 Sweep's B2 -> IPI Black.
		const sweepGroup = `[...document.querySelectorAll('.group')].find((g) => g.querySelector('.node--comp .name')?.textContent.trim() === 'Wave 3 Sweep')`;
		const ipiGroup = `[...document.querySelectorAll('.group')].find((g) => /ipi black/i.test(g.querySelector('.node--comp .name')?.textContent ?? ''))`;
		await cdp.evaluate(`${sweepGroup}.querySelector('.row--wave button[aria-label^="Move wave"]').click()`);
		await waitFor(cdp, 'document.querySelector(".move__select") !== null', 'the move menu');
		await cdp.evaluate(`(() => {
			const select = document.querySelector('.move__select');
			select.value = [...select.options].find((o) => /ipi black/i.test(o.textContent)).value;
			select.dispatchEvent(new Event('change', { bubbles: true }));
		})()`);
		await waitFor(cdp, `${sweepGroup}.querySelector('.row--wave') === null`, 'the wave to leave Wave 3 Sweep');
		const afterMenu = await sidebarCounts();
		check(
			'moves a wave to another competition from the menu',
			afterMenu['Wave 3 Sweep'] === 0 && afterMenu[ipiName] === 2,
			JSON.stringify(afterMenu)
		);
		check(
			'an emptied competition stays in the sidebar',
			'Wave 3 Sweep' in afterMenu,
			JSON.stringify(afterMenu)
		);

		// And back again by drag and drop.
		await cdp.evaluate(`(() => {
			const row = ${ipiGroup}.querySelector('.row--wave');
			const target = ${sweepGroup};
			const dt = new DataTransfer();
			row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
			target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
			target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
			row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		})()`);
		await waitFor(cdp, `${sweepGroup}.querySelector('.row--wave') !== null`, 'the wave to arrive by drag');
		const afterDrag = await sidebarCounts();
		check(
			'moves a wave by drag and drop',
			afterDrag['Wave 3 Sweep'] === 2 && afterDrag[ipiName] === 0,
			JSON.stringify(afterDrag)
		);

		// Back to every competition so the rest of the run sees the whole vault.
		await cdp.evaluate(`(() => {
			const select = document.querySelector('.into__select');
			select.value = '__auto__';
			select.dispatchEvent(new Event('change', { bubbles: true }));
		})()`);
		await waitFor(cdp, 'document.querySelectorAll("[data-card]").length === 2', 'both submissions');

		/* ---- PDF export (exercises the inlined Web Worker) ---- */
		// Let the idle warm-up settle, then watermark the request log: everything
		// the app needs is now cached, so the export must not touch the network.
		await waitForQuiet(() => requests.length);
		const watermark = requests.length;

		await exportVia(cdp, 'pdf');
		// Generous: a cold dev server transforms pdfmake on the first export.
		const pdfPath = await waitForFile(downloads, /^gsa-vault-.*\.pdf$/, 480);
		check('exports a PDF', pdfPath !== null, `in ${downloads}`);

		if (pdfPath !== null) {
			const pdf = readFileSync(pdfPath);
			const latin = pdf.toString('latin1');
			const head = pdf.subarray(0, 5).toString('latin1');
			const pages = (latin.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
			check('PDF is well formed', head === '%PDF-', `header ${JSON.stringify(head)}`);
			check('PDF has cover, graphs and payload pages', pages >= 3, `${pages} pages`);
			check('PDF embeds JetBrains Mono', latin.includes('JetBrainsMono'));
			check('PDF chart labels have a font', latin.includes('Courier'));
		}

		// The worker is the whole point of rendering off-thread; a silent fallback
		// to the main thread must not pass as success. (Warnings raised *inside*
		// the worker are on a separate CDP target and never reach this listener,
		// which is why the font check above inspects the PDF itself.)
		const fellBack = pageWarnings.filter((w) => /PDF worker unavailable/i.test(w));
		check(
			'renders in the Web Worker, not the fallback',
			fellBack.length === 0,
			fellBack.join('\n          ')
		);

		/* ---- zero network requests after initial load ----
		   Only meaningful against the production build: the dev server streams
		   unbundled modules on demand and runs an HMR client, and `?worker&inline`
		   is a build-time transform that dev ignores. */
		const isDevServer = requests.some((url) => url.includes('@vite/client'));
		const late = requests
			.slice(watermark)
			.filter((url) => !url.startsWith('blob:') && !url.startsWith('data:'));
		if (isDevServer) {
			skip(
				'issues no network requests after load',
				'dev server: modules are served on demand and HMR is live. Run against `npm run preview`.'
			);
		} else {
			check(
				'issues no network requests after load',
				late.length === 0,
				late.slice(0, 6).join('\n          ')
			);
		}
		check(
			'never contacts a third party',
			requests.every(
				(url) =>
					url.startsWith(APP_URL) ||
					url.startsWith('blob:') ||
					url.startsWith('data:') ||
					url.startsWith('about:')
			),
			requests.filter((u) => !u.startsWith(APP_URL) && !u.startsWith('blob:') && !u.startsWith('data:') && !u.startsWith('about:')).join('\n          ')
		);

		const errors = pageErrors.filter((e) => !/favicon/i.test(e));
		check('no page errors', errors.length === 0, errors.join('\n          '));
	} finally {
		cdp?.close();
		child.kill();
		await sleep(300);
		try {
			rmSync(profile, { recursive: true, force: true });
		} catch {
			/* profile still locked on Windows; harmless */
		}
	}

	const failed = checks.filter((c) => !c.ok);
	const skipped = checks.filter((c) => c.skipped === true).length;
	const ran = checks.length - skipped;
	console.log(
		`\n${ran - failed.length}/${ran} checks passed${skipped > 0 ? ` (${skipped} skipped)` : ''}`
	);
	if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error(`\nsmoke test failed: ${err.message}`);
	process.exitCode = 1;
});
