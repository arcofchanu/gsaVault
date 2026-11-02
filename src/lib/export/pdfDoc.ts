/**
 * Builds the pdfmake document definition for the vault report (PRD §6.1).
 *
 * Pure — no pdfmake import, no DOM — so the whole layout is unit-testable in
 * Node and can run inside a Web Worker unchanged.
 *
 * Page plan, repeated per competition so the footer can name the competition
 * the page belongs to:
 *   1   cover + report (stat block, scenario table)
 *   2   graphs (bars, heatmap, timeline — the same SVG builders as the UI)
 *   3+  payloads, packed continuously
 */
import {
	barChartSvg,
	coverBandSvg,
	heatmapSvg,
	PDF_THEME,
	timelineSvg,
	type SvgChart
} from '$lib/charts/svg';
import { isProfileEmpty, type Profile } from '$lib/profile';
import { buildTree, computeStats, type CompetitionNode } from '$lib/stats';
import { EMPTY_VALUE } from '$lib/config';
import { formatDate, formatDateTime, prettyJson, shortId, splitPlaceholders } from '$lib/util/text';
import type { Submission } from '$lib/types';
import { GLYPH_SUBSTITUTIONS, PDF_FONT, PDF_SVG_FONT } from '$lib/export/fonts.generated';

/* -------------------------------------------------------------- constants */

const BG = '#0A0A0A';
const TEXT = '#F2F2F2';
const MUTED = '#8A8A8A';
const RED = '#E10600';
const RED_DIM = '#5C0A08';
const LINE = '#2A2A2A';

/** A4 portrait, in points. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
const MARGIN_X = 36;
const MARGIN_TOP = 34;
const MARGIN_BOTTOM = 40;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

/* ------------------------------------------------------------------ types */

export interface PdfInput {
	/** Already filtered and sorted in tree order. */
	submissions: readonly Submission[];
	/** Human description of what this export covers. */
	scopeLabel: string;
	exportedAt: string;
	/** Researcher details for the cover. Omitted or empty prints no card. */
	profile?: Profile;
}

/** What one node of the document reported about itself during the layout pass. */
export interface NodeObservation {
	id: string;
	pages: number[];
	/** Space left below the node's top edge on its first page, in points. */
	spaceBelow?: number;
}

export interface PageIndex {
	/** page -> competition display name, for the footer. */
	competition: Record<number, string>;
	/** page -> group label, only where that page continues a group. */
	continuation: Record<number, string>;
	/**
	 * competition index -> free space left at the bottom of its cover once the
	 * researcher section is laid out at natural height. The final pass spreads
	 * it inside that section so the cover is filled to the bottom margin.
	 */
	coverSlack: Record<number, number>;
}

export const EMPTY_PAGE_INDEX: PageIndex = { competition: {}, continuation: {}, coverSlack: {} };

/** Suffix on the zero-height marker placed right after the researcher section. */
const HERO_END = 'heroEnd';

/* ------------------------------------------------------------- text utils */

/**
 * Replace glyphs the embedded font cannot draw (PRD §6.1 calls out `⚠`).
 * `fonts.generated.ts` leaves this map empty when the font covers everything.
 */
function substituteGlyphs(value: string): string {
	let out = value;
	for (const [glyph, replacement] of Object.entries(GLYPH_SUBSTITUTIONS)) {
		out = out.split(glyph).join(replacement);
	}
	return out;
}

export interface TextRun {
	text: string;
	color?: string;
	bold?: boolean;
}

/** Split into pdfmake inlines so `{{placeholders}}` come out red. */
export function richText(value: string, baseColor = TEXT): TextRun[] {
	return splitPlaceholders(substituteGlyphs(value)).map((segment) =>
		segment.placeholder
			? { text: segment.text, color: RED, bold: true }
			: { text: segment.text, color: baseColor }
	);
}

function plain(value: string): string {
	return substituteGlyphs(value);
}

/* ---------------------------------------------------------------- layouts */

/** Hairline horizontal rules only — vertical rules make a dense table noisy. */
const ROW_LAYOUT = {
	hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
		i === 0 || i === node.table.body.length ? 0 : 0.5,
	vLineWidth: () => 0,
	hLineColor: () => LINE,
	paddingLeft: () => 0,
	paddingRight: () => 8,
	paddingTop: () => 2.5,
	paddingBottom: () => 2.5
};

const BARE_LAYOUT = {
	hLineWidth: () => 0,
	vLineWidth: () => 0,
	paddingLeft: () => 0,
	paddingRight: () => 0,
	paddingTop: () => 0,
	paddingBottom: () => 0
};

/**
 * A boxed block: label row on top, content below, hairline frame. Used for the
 * initial task and each payload slot so the report reads as cards rather than a
 * wall of text, matching the on-screen detail view.
 *
 * Single column, so `vLineWidth`'s index is 0 for the left edge and 1 for the
 * right; `hLineWidth` gets 0 for the top, 1 for the label rule and 2 for the
 * bottom. A box whose content outgrows the page splits and gets framed on each
 * page, and `headerRows: 1` repeats the label there.
 */
function boxLayout(accent: boolean) {
	return {
		hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
			i === 0 || i === node.table.body.length ? 0.5 : 0.3,
		vLineWidth: (i: number) => (accent && i === 0 ? 1.2 : 0.5),
		hLineColor: () => LINE,
		vLineColor: (i: number) => (accent && i === 0 ? RED : LINE),
		paddingLeft: () => 5,
		paddingRight: () => 5,
		paddingTop: () => 3,
		paddingBottom: () => 3
	};
}

const BOX_LAYOUT = boxLayout(false);
const BOX_ACCENT_LAYOUT = boxLayout(true);

/**
 * Frames one submission: the meta line as a repeating header row, then one row
 * per block (initial task, each used payload slot, or each transcript turn).
 *
 * A single table rather than a stack of boxes because it also satisfies the
 * packing rule from PRD §6.1 — the meta line is `headerRows: 1`, so it can
 * never be separated from the entry's first block, and it reappears at the top
 * of every page the entry continues onto. Rows stay breakable
 * (`dontBreakRows` defaults to false), so a long payload still flows instead of
 * being shunted whole onto a fresh page.
 */
function entryBox(submission: Submission, id: string, rows: unknown[][]): unknown {
	return {
		id,
		table: {
			headerRows: 1,
			widths: ['*'],
			body: [[{ text: plain(metaLine(submission)), style: 'meta' }], ...rows]
		},
		layout: BOX_ACCENT_LAYOUT,
		margin: [0, 6, 0, 6]
	};
}

/* ------------------------------------------------------------ page index */

/**
 * Turn the layout pass's observations into per-page labels.
 *
 * Node ids encode `competitionIndex:groupIndex:sequence` (group `-1` for cover
 * and graph pages), so one id per node recovers both spans. pdfmake requires
 * ids to be unique, hence the trailing sequence number.
 */
export function buildPageIndex(
	observations: readonly NodeObservation[],
	competitions: readonly string[],
	groupLabels: readonly string[]
): PageIndex {
	const compPages = new Map<number, Set<number>>();
	const groupPages = new Map<number, Set<number>>();
	const heroEnds: { ci: number; page: number; space: number }[] = [];

	for (const observation of observations) {
		const [rawComp, rawGroup, , marker] = observation.id.split(':');
		const ci = Number(rawComp);
		const gi = Number(rawGroup);
		if (marker === HERO_END && observation.spaceBelow !== undefined && observation.pages[0] !== undefined) {
			heroEnds.push({ ci, page: observation.pages[0], space: observation.spaceBelow });
		}
		if (Number.isInteger(ci) && ci >= 0) {
			const set = compPages.get(ci) ?? new Set<number>();
			observation.pages.forEach((p) => set.add(p));
			compPages.set(ci, set);
		}
		if (Number.isInteger(gi) && gi >= 0) {
			const set = groupPages.get(gi) ?? new Set<number>();
			observation.pages.forEach((p) => set.add(p));
			groupPages.set(gi, set);
		}
	}

	const competition: Record<number, string> = {};
	for (const [ci, pages] of compPages) {
		const name = competitions[ci];
		if (name === undefined) continue;
		for (const page of pages) competition[page] = name;
	}

	// A page shows a continuation header when a group that started earlier still
	// has content on it. Earliest such group wins — it owns the top of the page.
	const continuation: Record<number, string> = {};
	const ordered = [...groupPages.entries()].sort(
		(a, b) => Math.min(...a[1]) - Math.min(...b[1]) || a[0] - b[0]
	);
	for (const [gi, pages] of ordered) {
		const label = groupLabels[gi];
		if (label === undefined) continue;
		const first = Math.min(...pages);
		for (const page of pages) {
			if (page > first && continuation[page] === undefined) continuation[page] = label;
		}
	}

	// Only stretch when the section ended on the cover page itself; if it was
	// pushed over, there is nothing sensible to fill.
	const coverSlack: Record<number, number> = {};
	for (const end of heroEnds) {
		const pages = compPages.get(end.ci);
		if (pages === undefined || end.page !== Math.min(...pages)) continue;
		// A couple of points' headroom so rounding never tips it onto a new page.
		const slack = Math.floor(end.space - 4);
		if (slack > 0) coverSlack[end.ci] = slack;
	}

	return { competition, continuation, coverSlack };
}

/* ------------------------------------------------------------------ build */

interface GroupPlan {
	index: number;
	label: string;
	submissions: Submission[];
}

/** Competition -> Wave -> Scenario -> Model, flattened to printable groups. */
function planGroups(competition: CompetitionNode, startIndex: number): GroupPlan[] {
	const groups: GroupPlan[] = [];
	let index = startIndex;
	for (const wave of competition.waves) {
		for (const scenario of wave.scenarios) {
			for (const model of scenario.models) {
				groups.push({
					index: index++,
					label: `WAVE ${wave.wave} · ${scenario.code} · ${model.model}`,
					submissions: model.submissions
				});
			}
		}
	}
	return groups;
}

/** Issues unique, span-encoding node ids. */
type Tagger = (groupIndex: number) => string;

/** Big numbers in framed tiles, one per column. */
function statTiles(values: { label: string; value: number }[], id: string): unknown {
	return {
		id,
		table: {
			widths: values.map(() => '*'),
			body: [
				values.map((cell) => ({
					stack: [
						{ text: String(cell.value), style: 'statValue' },
						{ text: cell.label.toUpperCase(), style: 'statLabel' }
					]
				}))
			]
		},
		layout: {
			hLineWidth: () => 0.5,
			// A rule between tiles, heavier frame outside.
			vLineWidth: (i: number, node: { table: { widths: unknown[] } }) =>
				i === 0 || i === node.table.widths.length ? 0.5 : 0.3,
			hLineColor: () => LINE,
			vLineColor: () => LINE,
			paddingLeft: () => 8,
			paddingRight: () => 8,
			paddingTop: () => 8,
			paddingBottom: () => 8
		},
		margin: [0, 14, 0, 0]
	};
}

const HERO_PAD = 14;
const HERO_PHOTO = 92;
const HERO_GAP = 20;
/** Width of the name column beside the photo. */
const HERO_TEXT_WIDTH = CONTENT_WIDTH - HERO_PAD * 2 - HERO_PHOTO - HERO_GAP - 2;
const PANEL = '#121212';

/**
 * Biggest name size that still fits one line, within a sane range. JetBrains
 * Mono advances 0.6em per glyph, so the width is predictable from the length.
 */
function heroNameSize(name: string): number {
	const chars = Math.max(1, [...name].length);
	return Math.max(18, Math.min(44, Math.floor(HERO_TEXT_WIDTH / (chars * 0.6))));
}

/** Square stand-in for a missing photo: the name's first letter. */
function monogram(name: string): unknown {
	const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
	const size = 56;
	// JetBrains Mono's line box is ~1.32em even at lineHeight 1.
	const line = size * 1.32;
	// Inner box is the photo size less the two half-point borders.
	const inner = HERO_PHOTO - 1;
	return {
		width: HERO_PHOTO,
		table: {
			widths: [inner],
			heights: [inner],
			body: [
				[
					{
						text: plain(initial),
						fontSize: size,
						bold: true,
						color: RED,
						alignment: 'center',
						lineHeight: 1,
						fillColor: PANEL,
						margin: [0, (inner - line) / 2, 0, 0]
					}
				]
			]
		},
		layout: {
			...BARE_LAYOUT,
			hLineWidth: () => 0.5,
			vLineWidth: () => 0.5,
			hLineColor: () => RED_DIM,
			vLineColor: () => RED_DIM
		}
	};
}

/**
 * The researcher's GSA public profile, as the lower half of the cover: big
 * photo and name, their achievements as large tiles, then what they did in
 * this competition. Hand-entered (the vault makes no network calls), and the
 * photo is an embedded data URL so the PDF stays self-contained.
 *
 * `slack` is the free space a layout pass measured under the section; it is
 * shared out between the blocks so the section runs to the bottom margin.
 */
function profileHero(
	profile: Profile,
	stats: ReturnType<typeof computeStats>,
	slack: number,
	id: () => string,
	endId: string
): unknown[] {
	const name = profile.name.trim() || EMPTY_VALUE;
	const url = profile.profileUrl.trim();

	const identity: unknown[] = [
		{ text: '// RED-TEAM RESEARCHER · GRAY SWAN ARENA', style: 'heroKicker' },
		{ text: plain(name), style: 'heroName', fontSize: heroNameSize(name) }
	];
	if (url !== '') identity.push({ text: plain(url), style: 'heroLink', link: url });

	const achievements = [
		{ label: 'GLOBAL RANK', value: profile.rank },
		{ label: 'UNIQUE BEHAVIOURS', value: profile.uniqueBreaks },
		{ label: 'TOTAL WON', value: profile.earnings }
	].filter((s) => s.value.trim() !== '');

	const topModel = stats.perModel[0];
	const topScenario = stats.perScenario[0];
	// The break counts are already in the tiles above; these say *what* broke.
	const highlights: [string, string][] = [];
	if (topModel !== undefined) highlights.push(['MOST BROKEN MODEL', `${topModel.label} · ${topModel.count}`]);
	if (topScenario !== undefined)
		highlights.push(['MOST BROKEN SCENARIO', `${topScenario.label} · ${topScenario.count}`]);
	if (stats.dateRange !== null) {
		highlights.push([
			'ACTIVE',
			`${formatDate(stats.dateRange.from)} → ${formatDate(stats.dateRange.to)}`
		]);
	}

	// Free space goes between the blocks, so the identity stays pinned under
	// the section label and the last block sits on the bottom margin.
	const gaps = Math.max(1, (achievements.length > 0 ? 1 : 0) + (highlights.length > 0 ? 1 : 0));
	const gap = Math.max(0, slack) / gaps;

	const rows: unknown[][] = [
		[
			{
				columns: [
					profile.photo !== null
						? // pdfkit embeds PNG/JPEG only; `normalizePhoto` guarantees PNG.
							{ image: profile.photo, width: HERO_PHOTO, height: HERO_PHOTO }
						: monogram(name),
					{ width: '*', stack: identity, margin: [HERO_GAP, 6, 0, 0] }
				],
				margin: [0, 0, 0, 6 + gap / 2]
			}
		]
	];

	if (achievements.length > 0) {
		rows.push([
			{
				stack: [
					{ text: '// ACHIEVEMENTS', style: 'heroLabel' },
					{
						table: {
							widths: achievements.map(() => '*'),
							body: [
								achievements.map((s) => ({
									stack: [
										{ text: plain(s.value), style: 'heroStat' },
										{ text: s.label, style: 'heroStatLabel' }
									],
									fillColor: PANEL
								}))
							]
						},
						layout: {
							hLineWidth: () => 0,
							vLineWidth: (i: number, node: { table: { widths: unknown[] } }) =>
								i === 0 || i === node.table.widths.length ? 0 : 6,
							vLineColor: () => BG,
							paddingLeft: () => 12,
							paddingRight: () => 12,
							paddingTop: () => 10,
							paddingBottom: () => 10
						}
					}
				],
				margin: [0, 6 + gap / 2, 0, 6 + gap / 2]
			}
		]);
	}

	if (highlights.length > 0) {
		rows.push([
			{
				stack: [
					{ text: '// IN THIS COMPETITION', style: 'heroLabel' },
					{
						columns: highlights.map(([label, value]) => ({
							width: '*',
							stack: [
								{ text: label, style: 'heroFactLabel' },
								{ text: plain(value), style: 'heroFact' }
							]
						})),
						columnGap: 16
					}
				],
				margin: [0, 6 + gap / 2, 0, 0]
			}
		]);
	}

	return [
		{ id: id(), text: '[ RESEARCHER ]', style: 'section', margin: [0, 16, 0, 8] },
		{
			id: id(),
			table: { widths: ['*'], body: rows, dontBreakRows: true },
			layout: {
				hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
					i === 0 || i === node.table.body.length ? 0.5 : 0.3,
				vLineWidth: (i: number) => (i === 0 ? 2 : 0.5),
				hLineColor: () => LINE,
				vLineColor: (i: number) => (i === 0 ? RED : LINE),
				paddingLeft: () => HERO_PAD,
				paddingRight: () => HERO_PAD,
				paddingTop: () => HERO_PAD,
				paddingBottom: () => HERO_PAD
			}
		},
		// Near-zero-height marker: where it lands tells the layout pass how much
		// of the cover is still empty. (pdfmake skips an empty canvas.)
		{ id: endId, text: ' ', fontSize: 1, lineHeight: 1 }
	];
}

function scenarioTable(competition: CompetitionNode, id: string): unknown {
	const body: unknown[][] = [
		[
			{ text: 'SCENARIO', style: 'th' },
			{ text: 'WAVE', style: 'th' },
			{ text: 'MODELS', style: 'th' },
			{ text: 'MODEL NAMES', style: 'th' }
		]
	];

	for (const wave of competition.waves) {
		for (const scenario of wave.scenarios) {
			body.push([
				{
					text: [
						{ text: plain(scenario.code), color: RED, bold: true },
						{ text: plain(scenario.label === EMPTY_VALUE ? '' : `  ${scenario.label}`), color: TEXT }
					],
					style: 'td'
				},
				{ text: plain(wave.wave), style: 'td', color: MUTED },
				{ text: String(scenario.models.length), style: 'td', alignment: 'right' },
				{
					text: plain(scenario.models.map((m) => `${m.model} (${m.count})`).join(', ')),
					style: 'td',
					color: MUTED
				}
			]);
		}
	}

	return {
		id,
		table: { headerRows: 1, widths: ['*', 28, 34, 190], body },
		layout: ROW_LAYOUT
	};
}

/**
 * A same-sized placeholder. The first layout pass only needs chart dimensions
 * to work out page breaks, and rasterising four real charts per competition is
 * the single most expensive thing in the document.
 */
function blankChart(chart: SvgChart): SvgChart {
	return {
		...chart,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${chart.width}" height="${chart.height}" viewBox="0 0 ${chart.width} ${chart.height}"><rect x="0" y="0" width="${chart.width}" height="${chart.height}" fill="${BG}"/></svg>`
	};
}

function chartsPage(
	submissions: readonly Submission[],
	tag: Tagger,
	blank: boolean
): unknown[] {
	const id = () => tag(-1);
	const stats = computeStats(submissions);
	const half = Math.floor((CONTENT_WIDTH - 14) / 2);
	const maybeBlank = (chart: SvgChart) => (blank ? blankChart(chart) : chart);

	const perModel = maybeBlank(
		barChartSvg({
			items: stats.perModel,
			width: half,
			theme: PDF_THEME,
			id: 'pdf-model',
			maxRows: 18,
			labelChars: 18
		})
	);
	const perScenario = maybeBlank(
		barChartSvg({
			items: stats.perScenario,
			width: half,
			theme: PDF_THEME,
			id: 'pdf-scenario',
			maxRows: 18,
			labelChars: 12
		})
	);
	const heat = maybeBlank(
		heatmapSvg({
			matrix: stats.matrix,
			theme: PDF_THEME,
			id: 'pdf-heat',
			// Fill the text column; stay dense enough for print once there are
			// many models, at which point the whole grid scales down to fit.
			fitWidth: CONTENT_WIDTH,
			cellMin: 10,
			cellMax: 26
		})
	);
	const time = maybeBlank(
		timelineSvg({
			points: stats.timeline,
			width: CONTENT_WIDTH,
			height: 110,
			theme: PDF_THEME,
			id: 'pdf-time'
		})
	);

	return [
		// Flows after the scenario table rather than claiming its own page; it
		// breaks only if what follows does not fit.
		{ id: id(), text: '[ GRAPHS ]', style: 'section', margin: [0, 18, 0, 0] },
		{
			id: id(),
			columns: [
				{
					width: half,
					stack: [
						{ text: '// BREAKS PER MODEL', style: 'chartLabel' },
						{ svg: perModel.svg, width: half, font: PDF_SVG_FONT }
					]
				},
				{ width: 14, text: '' },
				{
					width: half,
					stack: [
						{ text: '// BREAKS PER SCENARIO', style: 'chartLabel' },
						{ svg: perScenario.svg, width: half, font: PDF_SVG_FONT }
					]
				}
			],
			margin: [0, 8, 0, 16]
		},
		{ id: id(), text: '// BREAKS BY DATE', style: 'chartLabel' },
		{ id: id(), svg: time.svg, width: CONTENT_WIDTH, font: PDF_SVG_FONT, margin: [0, 0, 0, 16] },
		{ id: id(), text: '// SCENARIO × MODEL', style: 'chartLabel' },
		{
			id: id(),
			svg: heat.svg,
			// Wide matrices scale down to the text column rather than clipping.
			width: Math.min(CONTENT_WIDTH, heat.width),
			font: PDF_SVG_FONT
		}
	];
}

function metaLine(submission: Submission): string {
	return [
		submission.scenario.code,
		submission.model,
		`${submission.mode}-turn`,
		formatDate(submission.createdAt),
		shortId(submission.id)
	].join(' · ');
}

function singleTurnEntry(submission: Submission, id: () => string): unknown[] {
	const rows: unknown[][] = [
		[
			{
				stack: [
					{ text: '// INITIAL TASK', style: 'blockLabel' },
					{
						text:
							submission.initialTask.trim() === ''
								? [{ text: EMPTY_VALUE, color: MUTED }]
								: richText(submission.initialTask),
						style: 'task',
						preserveLeadingSpaces: true
					}
				]
			}
		]
	];

	// Unused injection surfaces are left out entirely; the slot index still
	// shows which surface each payload came from.
	const used = submission.payloadSlots.filter((slot) => !slot.empty);

	if (used.length === 0) {
		rows.push([{ text: '// NO PAYLOAD SLOTS USED', style: 'blockLabel', color: MUTED }]);
	}

	for (const slot of used) {
		const source = slot.parsed !== null ? prettyJson(slot.parsed) : slot.raw;
		const stack: unknown[] = [
			{
				text: `// SLOT ${slot.index}${submission.payloadSource === 'initialTask' ? ' (from task)' : ''} · ${used.length} of ${submission.payloadSlots.length} surfaces used`,
				style: 'blockLabel'
			},
			{ text: richText(source, MUTED), style: 'payload', preserveLeadingSpaces: true }
		];
		for (const prose of slot.prose) {
			stack.push(
				{ text: plain(`// ${prose.field}`), style: 'proseLabel' },
				{ text: richText(prose.text), style: 'prose', preserveLeadingSpaces: true }
			);
		}
		rows.push([{ stack }]);
	}

	return [entryBox(submission, id(), rows)];
}

function multiTurnEntry(submission: Submission, id: () => string): unknown[] {
	if (submission.transcript.length === 0) {
		return [
			entryBox(submission, id(), [
				[{ text: `// TRANSCRIPT · ${EMPTY_VALUE}`, style: 'blockLabel', color: MUTED }]
			])
		];
	}

	const rows: unknown[][] = submission.transcript.map((message, i) => {
		const role =
			message.role === 'user'
				? 'USER'
				: message.role === 'assistant'
					? 'AGENT'
					: message.role.toUpperCase();
		return [
			{
				stack: [
					{
						text: [
							{ text: `// ${role}`, color: message.role === 'user' ? RED : MUTED, bold: true },
							// Tool calls are never printed — only counted (PRD §6.1).
							{
								text:
									message.toolCalls.length > 0 ? `  [${message.toolCalls.length} tool calls]` : '',
								color: MUTED
							},
							{ text: `   ${i + 1}/${submission.transcript.length}`, color: MUTED }
						],
						style: 'role'
					},
					{
						text:
							message.content.trim() === ''
								? [{ text: EMPTY_VALUE, color: MUTED }]
								: richText(message.content),
						style: 'task',
						preserveLeadingSpaces: true
					}
				]
			}
		];
	});

	return [entryBox(submission, id(), rows)];
}

export interface DocPlan {
	definition: Record<string, unknown>;
	/** Competition display names, indexed as in the node ids. */
	competitions: string[];
	/** Group labels, indexed as in the node ids. */
	groupLabels: string[];
}

export interface DocOptions {
	/** First pass: swap charts for same-sized blanks. Much faster, same layout. */
	blankCharts?: boolean;
}

/**
 * Build the document. Pass a `pageIndex` from a first layout pass to get the
 * per-page competition footer and the `(cont.)` group header; pass
 * `EMPTY_PAGE_INDEX` for that first pass.
 */
export function buildDocPlan(
	input: PdfInput,
	pageIndex: PageIndex,
	options: DocOptions = {}
): DocPlan {
	const tree = buildTree(input.submissions);
	const competitions = tree.map((c) => c.name);
	const groupLabels: string[] = [];
	const content: unknown[] = [];
	const profile =
		input.profile !== undefined && !isProfileEmpty(input.profile) ? input.profile : null;

	let groupCursor = 0;
	let sequence = 0;

	tree.forEach((competition, ci) => {
		// Unique id per node, carrying the competition and group it belongs to.
		const tag: Tagger = (groupIndex) => `${ci}:${groupIndex}:${sequence++}`;
		const cover = () => tag(-1);

		const compSubmissions = competition.waves.flatMap((w) =>
			w.scenarios.flatMap((s) => s.models.flatMap((m) => m.submissions))
		);
		const stats = computeStats(compSubmissions);

		/* ---- page 1: cover ---- */
		if (ci > 0) {
			content.push({ id: cover(), text: '', pageBreak: 'before', margin: [0, 0, 0, 0] });
		}

		content.push({
			id: cover(),
			text: '// GSA VAULT · RED-TEAM SUBMISSION ARCHIVE',
			style: 'coverKicker'
		});

		const band = coverBandSvg({
			seed: competition.slug,
			width: CONTENT_WIDTH,
			// Shorter when the researcher section needs the room.
			height: profile !== null ? 72 : 150,
			theme: PDF_THEME,
			id: `pdf-band-${ci}`
		});
		content.push({
			id: cover(),
			svg: options.blankCharts === true ? blankChart(band).svg : band.svg,
			width: CONTENT_WIDTH,
			margin: [0, 8, 0, 18]
		});

		content.push({ id: cover(), text: plain(competition.name), style: 'coverTitle' });
		content.push({ id: cover(), text: plain(competition.slug), style: 'coverSlug' });
		content.push({
			id: cover(),
			text: plain(
				stats.dateRange === null
					? 'no dated submissions'
					: `${formatDate(stats.dateRange.from)} → ${formatDate(stats.dateRange.to)}`
			),
			style: 'coverMeta'
		});
		content.push({
			id: cover(),
			text: plain(`exported ${formatDateTime(input.exportedAt)} · scope: ${input.scopeLabel}`),
			style: 'coverMeta'
		});
		content.push(
			statTiles(
				[
					{ label: 'breaks', value: stats.total },
					{ label: 'scenarios broken', value: stats.scenarios },
					{ label: 'models broken', value: stats.models },
					{ label: 'waves', value: stats.waves }
				],
				cover()
			)
		);

		// The lower half of the cover belongs to the researcher.
		if (profile !== null) {
			content.push(
				...profileHero(
					profile,
					stats,
					pageIndex.coverSlack[ci] ?? 0,
					cover,
					`${ci}:-1:${sequence++}:${HERO_END}`
				)
			);
		}

		/* ---- page 2: report — scenario table, then the graphs ---- */
		content.push({
			id: cover(),
			text: '[ SCENARIOS ]',
			style: 'section',
			pageBreak: 'before',
			margin: [0, 0, 0, 6]
		});
		content.push(scenarioTable(competition, cover()));
		content.push(...chartsPage(compSubmissions, tag, options.blankCharts === true));

		/* ---- pages 3+: payloads, packed ---- */
		content.push({
			id: cover(),
			text: '[ PAYLOADS ]',
			style: 'section',
			pageBreak: 'before',
			margin: [0, 0, 0, 4]
		});

		const groups = planGroups(competition, groupCursor);
		groupCursor += groups.length;

		for (const group of groups) {
			groupLabels[group.index] = group.label;
			const id = () => tag(group.index);
			content.push({
				id: id(),
				text: plain(group.label),
				style: 'groupHeader',
				margin: [0, 10, 0, 2]
			});
			for (const submission of group.submissions) {
				content.push(
					...(submission.mode === 'single'
						? singleTurnEntry(submission, id)
						: multiTurnEntry(submission, id))
				);
			}
		}
	});

	const footerFallback = competitions.length === 1 ? competitions[0]! : input.scopeLabel;

	const definition: Record<string, unknown> = {
		pageSize: 'A4',
		pageOrientation: 'portrait',
		pageMargins: [MARGIN_X, MARGIN_TOP, MARGIN_X, MARGIN_BOTTOM],
		info: {
			title: `GSA Vault · ${input.scopeLabel}`,
			subject: 'Gray Swan Arena red-team submission archive',
			creator: 'GSA Vault'
		},
		// Full-bleed black on every page, margins included.
		background: () => ({
			canvas: [{ type: 'rect', x: 0, y: 0, w: PAGE_WIDTH, h: PAGE_HEIGHT, color: BG }]
		}),
		header: (currentPage: number) => {
			const label = pageIndex.continuation[currentPage];
			if (label === undefined) return undefined;
			return {
				text: plain(`${label} (cont.)`),
				style: 'contHeader',
				margin: [MARGIN_X, 14, MARGIN_X, 0]
			};
		},
		footer: (currentPage: number, pageCount: number) => ({
			columns: [
				{
					text: plain(
						`GSA VAULT · ${pageIndex.competition[currentPage] ?? footerFallback}`
					),
					style: 'footer'
				},
				{
					text: `page ${currentPage}/${pageCount}`,
					style: 'footer',
					alignment: 'right'
				}
			],
			margin: [MARGIN_X, 10, MARGIN_X, 0]
		}),
		defaultStyle: {
			// Body text is the embedded JetBrains Mono; only chart SVGs differ.
			font: PDF_FONT,
			fontSize: 7,
			color: TEXT,
			lineHeight: 1.22
		},
		styles: {
			coverKicker: { fontSize: 6.5, color: MUTED, characterSpacing: 1.2 },
			coverTitle: { fontSize: 26, bold: true, color: RED, characterSpacing: 0.6, margin: [0, 0, 0, 4] },
			coverSlug: { fontSize: 8, color: MUTED, characterSpacing: 1 },
			coverMeta: { fontSize: 7.5, color: MUTED, margin: [0, 3, 0, 0] },
			heroKicker: { fontSize: 6.5, color: RED, characterSpacing: 1.2, margin: [0, 0, 0, 8] },
			heroName: { bold: true, color: TEXT, lineHeight: 1.05 },
			heroLink: { fontSize: 7.5, color: MUTED, margin: [0, 8, 0, 0] },
			heroLabel: { fontSize: 6.5, color: MUTED, characterSpacing: 1, margin: [0, 0, 0, 8] },
			heroStat: { fontSize: 24, bold: true, color: RED },
			heroStatLabel: { fontSize: 6, color: MUTED, characterSpacing: 0.8, margin: [0, 6, 0, 0] },
			heroFactLabel: { fontSize: 6, color: MUTED, characterSpacing: 0.8, margin: [0, 0, 0, 4] },
			heroFact: { fontSize: 9, color: TEXT },
			statValue: { fontSize: 22, bold: true, color: TEXT },
			statLabel: { fontSize: 6, color: MUTED, characterSpacing: 0.8, margin: [0, 4, 0, 0] },
			section: { fontSize: 9.5, bold: true, color: RED, characterSpacing: 1 },
			chartLabel: { fontSize: 6.5, color: MUTED, characterSpacing: 0.8, margin: [0, 0, 0, 4] },
			th: { fontSize: 6, bold: true, color: RED, characterSpacing: 0.8 },
			td: { fontSize: 7 },
			groupHeader: { fontSize: 8.5, bold: true, color: RED, characterSpacing: 0.6 },
			meta: { fontSize: 6.5, color: MUTED, characterSpacing: 0.4 },
			blockLabel: { fontSize: 6, color: RED, characterSpacing: 0.6, margin: [0, 4, 0, 1] },
			proseLabel: { fontSize: 6, color: MUTED, characterSpacing: 0.6, margin: [0, 4, 0, 1] },
			task: { fontSize: 7, margin: [0, 0, 0, 2] },
			payload: { fontSize: 6.3, color: MUTED, lineHeight: 1.15 },
			prose: { fontSize: 7.2, lineHeight: 1.35, margin: [0, 0, 0, 2] },
			role: { fontSize: 6.5, margin: [0, 4, 0, 1] },
			contHeader: { fontSize: 6, color: RED_DIM, characterSpacing: 0.6 },
			footer: { fontSize: 6, color: MUTED, characterSpacing: 0.5 }
		},
		content
	};

	return { definition, competitions, groupLabels };
}

/** Strip what Windows, macOS or Linux refuse in a filename. */
function safeFilename(value: string): string {
	return value
		.replace(/[\u0000-\u001f]/g, '')
		.replace(/\s*[\\/:*?"<>|]+\s*/g, ' - ')
		.replace(/\s+/g, ' ')
		.replace(/^[\s.-]+|[\s.-]+$/g, '');
}

/**
 * Named after the competition: `Indirect Prompt Injection - Black.pdf`. An
 * export spanning several competitions has no single name, so it falls back
 * to `gsa-vault-2-competitions-2026-10-26.pdf`.
 */
export function pdfFilename(submissions: readonly Submission[], exportedAt: string): string {
	const slugs = [...new Set(submissions.map((s) => s.competition.slug))];
	if (slugs.length === 1) {
		const first = submissions[0]!;
		const name = safeFilename(first.competition.name) || safeFilename(first.competition.slug);
		if (name !== '') return `${name}.pdf`;
	}
	const day = formatDate(exportedAt);
	return `gsa-vault-${slugs.length}-competitions-${day === EMPTY_VALUE ? 'export' : day}.pdf`;
}
