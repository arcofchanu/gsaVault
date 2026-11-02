import pdfMake from 'pdfmake';
import { describe, expect, it } from 'vitest';
import { buildDocPlan, buildPageIndex, EMPTY_PAGE_INDEX, pdfFilename, richText } from '$lib/export/pdfDoc';
import {
	embeddedFonts,
	layoutPass,
	renderPdf,
	type FontSource,
	type PdfMakeLike
} from '$lib/export/pdfRender';
import { EMPTY_PROFILE } from '$lib/profile';
import { normalizeSubmission } from '$lib/parse/arenaChat';
import { sortSubmissions } from '$lib/stats';
import { arenaFixture } from '$lib/testing/fixtures';
import { synth } from '$lib/testing/make';
import type { Submission } from '$lib/types';

const NOW = '2026-10-26T09:30:00.000Z';
const fixture = arenaFixture();

const engine = pdfMake as unknown as PdfMakeLike;

/**
 * The embedded fonts — exactly what the app ships. Passed explicitly so these
 * tests fail loudly if the font plumbing regresses, rather than silently
 * falling back to something that only works under Node.
 */
const FONTS: FontSource = embeddedFonts();

function vault(): Submission[] {
	return sortSubmissions([
		normalizeSubmission(fixture.json, {
			sourceFile: fixture.path,
			mode: 'single',
			importedAt: NOW
		}),
		synth({ chatId: 's1', scenario: 'WB2S1 - Issue Unauthorized Refund', model: 'Alpha' }),
		synth({ chatId: 's2', scenario: 'WB2S1 - Issue Unauthorized Refund', model: 'Beta' }),
		synth({ chatId: 's3', scenario: 'WB10S2 - Late Wave', model: 'Alpha' }),
		synth({ chatId: 'm1', userTurns: 3 }, 'multi')
	]);
}

/** Page objects are written uncompressed, so they can be counted in the bytes. */
function countPages(bytes: Uint8Array): number {
	const text = Buffer.from(bytes).toString('latin1');
	return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('richText', () => {
	it('colours placeholders red and leaves the rest alone', () => {
		expect(richText('pay {{attacker}} now')).toEqual([
			{ text: 'pay ', color: '#F2F2F2' },
			{ text: '{{attacker}}', color: '#E10600', bold: true },
			{ text: ' now', color: '#F2F2F2' }
		]);
	});

	it('round-trips the original text exactly', () => {
		const source = fixture.json.title as string;
		expect(richText(source).map((r) => r.text).join('')).toBe(source);
	});
});

describe('buildDocPlan', () => {
	const plan = buildDocPlan(
		{ submissions: vault(), scopeLabel: 'all submissions', exportedAt: NOW },
		EMPTY_PAGE_INDEX
	);

	it('names every competition and group', () => {
		expect(plan.competitions).toEqual(['Indirect Prompt Injection: Black']);
		expect(plan.groupLabels).toEqual([
			'WAVE B2 · WB2S1 · Alpha',
			'WAVE B2 · WB2S1 · Beta',
			'WAVE B2 · WB2S1 · Emerald Grasshopper Ultra',
			'WAVE B2 · WB2S4 · Blue Seagull Peerless',
			'WAVE B10 · WB10S2 · Alpha'
		]);
	});

	it('paints every page full-bleed black', () => {
		const background = plan.definition.background as () => { canvas: { color: string }[] };
		expect(background().canvas[0].color).toBe('#0A0A0A');
	});

	it('gives the cover, the report and the payloads their own pages', () => {
		const content = plan.definition.content as { text?: string; pageBreak?: string }[];
		const breaks = content.filter((n) => n.pageBreak === 'before').map((n) => n.text);
		// Cover is page 1; the report page opens with the scenario table and the
		// graphs flow after it; payloads start fresh.
		expect(breaks).toEqual(['[ SCENARIOS ]', '[ PAYLOADS ]']);
	});

	it('opens with a cover: kicker, graphic band and stat tiles', () => {
		const content = plan.definition.content as {
			text?: string;
			svg?: string;
			style?: string;
			table?: { body?: unknown[][] };
		}[];
		expect(content[0]?.text).toBe('// GSA VAULT · RED-TEAM SUBMISSION ARCHIVE');

		const band = content[1];
		expect(band?.svg).toContain('<svg');
		// Decorative only: no text, so it needs no font.
		expect(band?.svg).not.toContain('<text');

		expect(content.some((n) => n.style === 'coverTitle')).toBe(true);
		const tiles = content.find((n) => n.style === undefined && n.table?.body?.length === 1);
		expect(tiles).toBeDefined();
	});

	it('varies the cover band per competition but keeps it stable per export', () => {
		const once = buildDocPlan(
			{ submissions: vault(), scopeLabel: 'all', exportedAt: NOW },
			EMPTY_PAGE_INDEX
		);
		const twice = buildDocPlan(
			{ submissions: vault(), scopeLabel: 'all', exportedAt: NOW },
			EMPTY_PAGE_INDEX
		);
		const bandOf = (p: typeof once) =>
			(p.definition.content as { svg?: string }[]).find((n) => n.svg !== undefined)?.svg;
		// Deterministic: the same export must produce byte-identical output.
		expect(bandOf(once)).toBe(bandOf(twice));

		const other = buildDocPlan(
			{
				submissions: [synth({ chatId: 'x', slug: 'agent-red-2026', name: 'Agent Red' })],
				scopeLabel: 'all',
				exportedAt: NOW
			},
			EMPTY_PAGE_INDEX
		);
		expect(bandOf(other)).not.toBe(bandOf(once));
	});

	it('prints the profile card only when one is filled in', () => {
		const bare = buildDocPlan(
			{ submissions: vault(), scopeLabel: 'all', exportedAt: NOW, profile: EMPTY_PROFILE },
			EMPTY_PAGE_INDEX
		);
		expect(JSON.stringify(bare.definition.content)).not.toContain('GLOBAL RANK');

		const withProfile = buildDocPlan(
			{
				submissions: vault(),
				scopeLabel: 'all',
				exportedAt: NOW,
				profile: {
					name: 'chanu',
					rank: '#12',
					uniqueBreaks: '47',
					earnings: '$12,400',
					profileUrl: 'https://app.grayswan.ai/arena/user/abc',
					photo: 'data:image/png;base64,iVBORw0KGgo='
				}
			},
			EMPTY_PAGE_INDEX
		);
		const json = JSON.stringify(withProfile.definition.content);
		expect(json).toContain('chanu');
		expect(json).toContain('GLOBAL RANK');
		expect(json).toContain('UNIQUE BEHAVIOURS');
		expect(json).toContain('TOTAL WON');
		expect(json).toContain('$12,400');
		// The photo is embedded, never fetched.
		expect(json).toContain('data:image/png;base64');
		expect(json).toContain('https://app.grayswan.ai/arena/user/abc');
	});

	it('fills the lower half of the cover with the researcher section', async () => {
		const input = {
			submissions: vault(),
			scopeLabel: 'all',
			exportedAt: NOW,
			profile: { ...EMPTY_PROFILE, name: 'chanu', rank: '#12', uniqueBreaks: '47' }
		};
		const pageIndex = await layoutPass(engine, input, undefined, FONTS);
		// The section ended on the cover with room to spare, which the final
		// pass spreads inside it.
		expect(pageIndex.coverSlack[0]).toBeGreaterThan(0);

		// Stretched, it still fits: the report page stays page 2.
		const bytes = await renderPdf(engine, input, undefined, FONTS);
		const bare = await renderPdf(engine, { ...input, profile: EMPTY_PROFILE }, undefined, FONTS);
		expect(countPages(bytes)).toBe(countPages(bare));
	}, 120_000);

	it('omits profile stats that were left blank', () => {
		const partial = buildDocPlan(
			{
				submissions: vault(),
				scopeLabel: 'all',
				exportedAt: NOW,
				profile: { ...EMPTY_PROFILE, name: 'chanu', rank: '#3' }
			},
			EMPTY_PAGE_INDEX
		);
		const json = JSON.stringify(partial.definition.content);
		expect(json).toContain('GLOBAL RANK');
		expect(json).not.toContain('TOTAL WON');
		expect(json).not.toContain('UNIQUE BEHAVIOURS');
	});

	it('does not force a page break per entry', () => {
		const content = plan.definition.content as { pageBreak?: string }[];
		expect(content.filter((n) => n.pageBreak === 'before')).toHaveLength(2);
	});

	/** Every submission is rendered as one framed table. */
	function entryTables() {
		const content = plan.definition.content as {
			table?: { headerRows?: number; body?: unknown[][] };
			layout?: unknown;
		}[];
		return content.filter((n) => n.table?.headerRows === 1 && n.layout !== undefined);
	}

	it('frames every entry and repeats its meta line across pages', () => {
		// 5 submissions + the per-competition scenario table, which is also a
		// single-header-row table.
		const entries = entryTables().filter((n) => n.table?.body?.[0]?.length === 1);
		expect(entries.length).toBeGreaterThanOrEqual(5);

		// The meta line is the header row, so it can never be split from the
		// entry's first block, and reappears on continuation pages.
		const metaRows = entries
			.map((n) => n.table?.body?.[0]?.[0] as { text?: string; style?: string } | undefined)
			.filter((cell) => cell?.style === 'meta');
		expect(metaRows).toHaveLength(5);
		// Tree order, so the fixture's entry is not first.
		expect(metaRows.map((m) => m?.text).join('\n')).toContain('WB2S4 · Blue Seagull Peerless');
	});

	it('draws a border around each entry', () => {
		const layouts = entryTables().map(
			(n) => n.layout as { hLineWidth?: (i: number, node: unknown) => number; vLineWidth?: (i: number) => number }
		);
		const framed = layouts.filter((l) => (l.vLineWidth?.(0) ?? 0) > 0);
		expect(framed.length).toBeGreaterThanOrEqual(5);
		// Top edge drawn, and the left edge is the red accent.
		const node = { table: { body: [1, 2, 3] } };
		expect(framed[0].hLineWidth?.(0, node)).toBeGreaterThan(0);
		expect(framed[0].hLineWidth?.(3, node)).toBeGreaterThan(0);
	});

	it('prints only the used slots, and no tool-call bodies', () => {
		const json = JSON.stringify(plan.definition.content);
		expect(json).toContain('// SLOT 1');
		expect(json).toContain('// SLOT 4');
		// Slots 2, 3 and 5-8 are unused in the fixture and must not appear.
		for (const unused of [2, 3, 5, 6, 7, 8]) {
			expect(json).not.toContain(`// SLOT ${unused}`);
		}
		expect(json).toContain('2 of 8 surfaces used');
		expect(json).toContain('tool calls]');
		expect(json).not.toContain('mcp__shopify__order-cancel');
	});

	it('falls back to the single competition name in the footer', () => {
		const footer = plan.definition.footer as (p: number, n: number) => { columns: { text: string }[] };
		const rendered = footer(1, 9);
		expect(rendered.columns[0].text).toBe('GSA VAULT · Indirect Prompt Injection: Black');
		expect(rendered.columns[1].text).toBe('page 1/9');
	});

	it('renders no continuation header without a page index', () => {
		const header = plan.definition.header as (p: number) => unknown;
		expect(header(2)).toBeUndefined();
	});
});

describe('buildPageIndex', () => {
	const observations = [
		{ id: '0:-1', pages: [1, 2, 3] },
		{ id: '0:0', pages: [3, 4] },
		{ id: '0:0', pages: [4, 5] },
		{ id: '0:1', pages: [5] },
		{ id: '1:-1', pages: [6, 7] },
		{ id: '1:2', pages: [7, 8, 9] }
	];
	const index = buildPageIndex(observations, ['IPI Black', 'Agent Red'], ['grp-a', 'grp-b', 'grp-c']);

	it('maps every page to its competition', () => {
		expect(index.competition).toEqual({
			1: 'IPI Black',
			2: 'IPI Black',
			3: 'IPI Black',
			4: 'IPI Black',
			5: 'IPI Black',
			6: 'Agent Red',
			7: 'Agent Red',
			8: 'Agent Red',
			9: 'Agent Red'
		});
	});

	it('marks only the pages a group continues onto', () => {
		// grp-a spans 3..5, so 4 and 5 continue it; page 3 is its first page.
		expect(index.continuation[3]).toBeUndefined();
		expect(index.continuation[4]).toBe('grp-a');
		expect(index.continuation[5]).toBe('grp-a');
		// grp-b starts and ends on page 5, so it never claims a continuation.
		expect(index.continuation[6]).toBeUndefined();
		expect(index.continuation[8]).toBe('grp-c');
		expect(index.continuation[9]).toBe('grp-c');
	});

	it('ignores ids it cannot resolve', () => {
		const sparse = buildPageIndex([{ id: '7:7', pages: [1] }], ['Only'], ['One']);
		expect(sparse.competition).toEqual({});
		expect(sparse.continuation).toEqual({});
	});
});

describe('renderPdf', () => {
	it('produces a multi-page PDF with the embedded font', async () => {
		const percents: number[] = [];
		const warnings: unknown[] = [];
		const realWarn = console.warn;
		const realError = console.error;
		console.warn = (...args: unknown[]) => warnings.push(args);
		console.error = (...args: unknown[]) => warnings.push(args);

		let bytes: Uint8Array;
		try {
			bytes = await renderPdf(
				engine,
				{ submissions: vault(), scopeLabel: 'all submissions', exportedAt: NOW },
				(p) => percents.push(p),
				FONTS
			);
		} finally {
			console.warn = realWarn;
			console.error = realError;
		}

		expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
		// cover + graphs + at least one payload page
		expect(countPages(bytes)).toBeGreaterThanOrEqual(3);
		expect(Buffer.from(bytes).toString('latin1')).toContain('JetBrainsMono');
		expect(percents.at(-1)).toBe(100);
		expect(bytes.byteLength).toBeGreaterThan(20_000);
		// Chart labels are SVG <text>; a font miss drops them silently.
		expect(JSON.stringify(warnings)).not.toContain('failed to open font');
	}, 120_000);

	it('renders an empty selection without throwing', async () => {
		const bytes = await renderPdf(
			engine,
			{ submissions: [], scopeLabel: 'nothing', exportedAt: NOW },
			undefined,
			FONTS
		);
		expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
	}, 60_000);
});

describe('packing and continuation, end to end', () => {
	/** One group long enough to spill over a page boundary. */
	function longVault(): Submission[] {
		const paragraph = 'the injected instruction repeats to fill the page. '.repeat(60);
		return sortSubmissions([
			synth({
				chatId: 'long-1',
				scenario: 'WB2S1 - Long Payload',
				model: 'Alpha',
				title: JSON.stringify([{ body: `${paragraph}{{attacker}} ${paragraph}` }]) + ' · []'
			}),
			synth({
				chatId: 'long-2',
				scenario: 'WB2S1 - Long Payload',
				model: 'Alpha',
				title: JSON.stringify([{ note: paragraph }]) + ' · []'
			})
		]);
	}

	it('flows a long group across pages and marks the continuation', async () => {
		const input = { submissions: longVault(), scopeLabel: 'all submissions', exportedAt: NOW };
		const pageIndex = await layoutPass(engine, input, undefined, FONTS);

		const continuationPages = Object.keys(pageIndex.continuation);
		expect(continuationPages.length).toBeGreaterThan(0);
		expect(Object.values(pageIndex.continuation)[0]).toBe('WAVE B2 · WB2S1 · Alpha');

		// The final pass turns that into a real `(cont.)` page header.
		const plan = buildDocPlan(input, pageIndex);
		const header = plan.definition.header as (p: number) => { text: string } | undefined;
		const page = Number(continuationPages[0]);
		expect(header(page)?.text).toBe('WAVE B2 · WB2S1 · Alpha (cont.)');
		// Cover page never carries one.
		expect(header(1)).toBeUndefined();
	}, 120_000);

	it('packs several short entries onto one page rather than one per page', async () => {
		const many = sortSubmissions(
			Array.from({ length: 8 }, (_, i) =>
				synth({ chatId: `short-${i}`, scenario: 'WB2S1 - Short', model: 'Alpha' })
			)
		);
		const bytes = await renderPdf(
			engine,
			{ submissions: many, scopeLabel: 'all submissions', exportedAt: NOW },
			undefined,
			FONTS
		);
		// cover + graphs + payloads; 8 short entries must not need 8 pages.
		expect(countPages(bytes)).toBeLessThanOrEqual(4);
	}, 120_000);
});

describe('pdfFilename', () => {
	it('names a single-competition export after the competition', () => {
		// The fixture is "Indirect Prompt Injection: Black"; `:` is not allowed in
		// a Windows filename.
		expect(pdfFilename(vault(), NOW)).toBe('Indirect Prompt Injection - Black.pdf');
	});

	it('falls back to the slug when the name has nothing usable', () => {
		const odd = [synth({ chatId: 'x', slug: 'agent-red-2026', name: '???' })];
		expect(pdfFilename(odd, NOW)).toBe('agent-red-2026.pdf');
	});

	it('counts competitions when the export spans several', () => {
		const mixed = [...vault(), synth({ chatId: 'x', slug: 'agent-red-2026', name: 'Agent Red' })];
		expect(pdfFilename(mixed, NOW)).toBe('gsa-vault-2-competitions-2026-10-26.pdf');
	});
});
