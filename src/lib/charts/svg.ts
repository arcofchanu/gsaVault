/**
 * Hand-written SVG chart builders — the single source of both the on-screen
 * charts and the vectors embedded in the PDF (PRD §6.1, §7). No chart library,
 * so nothing drags in a default light theme.
 *
 * Everything is laid out in absolute units with a monospace character-width
 * approximation, which is exact enough for JetBrains Mono and avoids needing
 * text measurement in either target.
 */
import type { Matrix, Tally, TimelinePoint } from '$lib/stats';

export interface ChartTheme {
	bg: string;
	red: string;
	redDim: string;
	text: string;
	muted: string;
	line: string;
	font: string;
	fontSize: number;
	/** Red fills use a gradient. Off for targets that cannot render one. */
	gradient: boolean;
}

/** On screen the charts sit on `--surface`. */
export const UI_THEME: ChartTheme = {
	bg: '#141414',
	red: '#E10600',
	redDim: '#5C0A08',
	text: '#F2F2F2',
	muted: '#8A8A8A',
	line: '#2A2A2A',
	font: 'JetBrains Mono, monospace',
	fontSize: 10,
	gradient: true
};

/**
 * In the PDF they sit on the full-bleed page black.
 *
 * `font` must name a family registered with pdfmake, and for SVG text that has
 * to be a standard PDF font rather than the embedded TTF — see
 * `fonts.generated.ts` for the full reason. Courier shares JetBrains Mono's
 * 0.6em advance, so the layout maths below is unaffected.
 */
export const PDF_THEME: ChartTheme = {
	...UI_THEME,
	bg: '#0A0A0A',
	font: 'Courier',
	fontSize: 7
};

/** Monospace advance width — JetBrains Mono is 0.6em per glyph. */
function charWidth(fontSize: number): number {
	return fontSize * 0.6;
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function ellipsize(value: string, maxChars: number): string {
	if (maxChars <= 1) return value.slice(0, Math.max(0, maxChars));
	return value.length <= maxChars ? value : value.slice(0, maxChars - 1) + '…';
}

interface TextOptions {
	anchor?: 'start' | 'middle' | 'end';
	fill?: string;
	size?: number;
	bold?: boolean;
	rotate?: number;
}

function text(value: string, x: number, y: number, theme: ChartTheme, opts: TextOptions = {}): string {
	const attrs = [
		`x="${x}"`,
		`y="${y}"`,
		`fill="${opts.fill ?? theme.text}"`,
		`font-family="${theme.font}"`,
		`font-size="${opts.size ?? theme.fontSize}"`,
		// Labels must never swallow a click meant for the cell underneath.
		'pointer-events="none"'
	];
	if (opts.bold) attrs.push('font-weight="bold"');
	if (opts.anchor) attrs.push(`text-anchor="${opts.anchor}"`);
	if (opts.rotate) attrs.push(`transform="rotate(${opts.rotate} ${x} ${y})"`);
	return `<text ${attrs.join(' ')}>${escapeXml(value)}</text>`;
}

function rect(
	x: number,
	y: number,
	w: number,
	h: number,
	fill: string,
	stroke?: string,
	extra = ''
): string {
	const strokeAttr = stroke === undefined ? '' : ` stroke="${stroke}" stroke-width="0.6"`;
	return `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${fill}"${strokeAttr}${extra}/>`;
}

/**
 * Gradient ids must be unique per document: several inline SVGs share one DOM,
 * so each chart namespaces its defs with the caller-supplied prefix.
 */
function gradientDefs(id: string, theme: ChartTheme): string {
	if (!theme.gradient) return '';
	return [
		'<defs>',
		`<linearGradient id="${id}-h" x1="0" y1="0" x2="1" y2="0">`,
		`<stop offset="0" stop-color="${theme.red}"/><stop offset="1" stop-color="#8E0503"/>`,
		'</linearGradient>',
		`<linearGradient id="${id}-v" x1="0" y1="0" x2="0" y2="1">`,
		`<stop offset="0" stop-color="${theme.red}"/><stop offset="1" stop-color="#A60504"/>`,
		'</linearGradient>',
		`<linearGradient id="${id}-fade" x1="0" y1="0" x2="0" y2="1">`,
		`<stop offset="0" stop-color="${theme.red}" stop-opacity="0.45"/>`,
		`<stop offset="1" stop-color="${theme.red}" stop-opacity="0"/>`,
		'</linearGradient>',
		'</defs>'
	].join('');
}

function redFill(id: string, theme: ChartTheme, axis: 'h' | 'v' = 'h'): string {
	return theme.gradient ? `url(#${id}-${axis})` : theme.red;
}

function svgWrap(
	width: number,
	height: number,
	body: string,
	theme: ChartTheme,
	defsId: string
): string {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		gradientDefs(defsId, theme),
		rect(0, 0, width, height, theme.bg),
		body,
		'</svg>'
	].join('');
}

/* ------------------------------------------------------------------- bars */

export interface BarChartOptions {
	items: readonly Tally[];
	width: number;
	theme?: ChartTheme;
	/** Characters of label shown before ellipsis. */
	labelChars?: number;
	rowHeight?: number;
	/** Cap the number of bars; the remainder is summarised in a final row. */
	maxRows?: number;
	/** Namespace for this chart's gradient ids. Must be unique per page. */
	id?: string;
}

export interface SvgChart {
	svg: string;
	width: number;
	height: number;
}

/**
 * Horizontal bars — model and scenario names are long, so the label gets its
 * own gutter rather than being squeezed under a vertical bar.
 */
export function barChartSvg(options: BarChartOptions): SvgChart {
	const theme = options.theme ?? UI_THEME;
	const defsId = options.id ?? 'bar';
	const rowH = options.rowHeight ?? Math.round(theme.fontSize * 1.8);
	const gap = Math.max(2, Math.round(rowH * 0.25));
	const labelChars = options.labelChars ?? 20;
	const cw = charWidth(theme.fontSize);

	const maxRows = options.maxRows ?? options.items.length;
	const shown = options.items.slice(0, maxRows);
	const hidden = options.items.slice(maxRows);
	const rows: Tally[] = [...shown];
	if (hidden.length > 0) {
		rows.push({
			key: '__rest__',
			label: `+${hidden.length} more`,
			count: hidden.reduce((n, item) => n + item.count, 0)
		});
	}

	const labelW = Math.ceil(labelChars * cw) + 6;
	const valueW = Math.ceil(4 * cw) + 6;
	const barX = labelW + 6;
	const barW = Math.max(10, options.width - barX - valueW);
	const height = Math.max(rowH, rows.length * (rowH + gap) - gap) + 2;
	const max = rows.reduce((m, item) => Math.max(m, item.count), 0) || 1;

	const body: string[] = [`<line x1="${barX - 3}" y1="0" x2="${barX - 3}" y2="${height}" stroke="${theme.line}" stroke-width="1"/>`];

	rows.forEach((item, i) => {
		const y = i * (rowH + gap) + 1;
		const w = (item.count / max) * barW;
		const isRest = item.key === '__rest__';
		const baseline = y + rowH / 2 + theme.fontSize * 0.36;
		body.push(
			text(ellipsize(item.label, labelChars), labelW, baseline, theme, {
				anchor: 'end',
				fill: isRest ? theme.muted : theme.text
			}),
			rect(barX, y, w, rowH, isRest ? theme.redDim : redFill(defsId, theme, 'h')),
			text(String(item.count), barX + w + 4, baseline, theme, { fill: theme.muted })
		);
	});

	return {
		svg: svgWrap(options.width, height, body.join(''), theme, defsId),
		width: options.width,
		height
	};
}

/* ---------------------------------------------------------------- heatmap */

export interface HeatmapOptions {
	matrix: Matrix;
	theme?: ChartTheme;
	/** Fixed cell size. Overrides `fitWidth`. */
	cell?: number;
	/**
	 * Width to fill: cells grow to use it, between `cellMin` and `cellMax`. Past
	 * `cellMin` the grid overflows and its container scrolls instead.
	 */
	fitWidth?: number;
	cellMin?: number;
	cellMax?: number;
	/** Characters of scenario code shown in the row gutter. */
	codeChars?: number;
	/** Characters of model name shown in the rotated column header. */
	modelChars?: number;
	/** Namespace for this chart's gradient ids. Must be unique per page. */
	id?: string;
	/**
	 * Tag every cell with `data-scenario` / `data-model` / `data-count` so the
	 * on-screen matrix can delegate clicks. Off for the PDF.
	 */
	interactive?: boolean;
}

/**
 * Scenario x model grid: filled cells red (opacity scaled by count), empty
 * cells a dim outline (PRD §4.3, §6.1).
 */
export function heatmapSvg(options: HeatmapOptions): SvgChart {
	const theme = options.theme ?? UI_THEME;
	const defsId = options.id ?? 'heat';
	const codeChars = options.codeChars ?? 10;
	const minModelChars = options.modelChars ?? 16;
	const cw = charWidth(theme.fontSize);

	const gutter = Math.ceil(codeChars * cw) + 8;
	const { scenarios, models, cells, max } = options.matrix;

	// Size the header to the longest actual model name so nothing is truncated.
	// The option acts as a minimum floor to keep the header from collapsing when
	// every name is short.
	const longestModel = models.reduce((m, name) => Math.max(m, [...name].length), 0);
	const modelChars = Math.max(minModelChars, longestModel);
	const headerH = Math.ceil(modelChars * cw) + 8;

	// A fixed cell size leaves a handful of models rattling around inside a wide
	// panel, so by default the cells stretch to fill the width they are given.
	const cellMin = options.cellMin ?? Math.round(theme.fontSize * 2.4);
	const cellMax = options.cellMax ?? Math.round(theme.fontSize * 6.4);
	const cell =
		options.cell ??
		(options.fitWidth !== undefined && models.length > 0
			? Math.max(
					cellMin,
					Math.min(cellMax, Math.floor((options.fitWidth - gutter - 2) / models.length))
				)
			: cellMin);

	const width = gutter + models.length * cell + 2;
	const height = headerH + scenarios.length * cell + 2;
	if (scenarios.length === 0 || models.length === 0) {
		const w = Math.max(width, 80);
		const h = Math.max(height, 40);
		return {
			svg: svgWrap(w, h, text('no data', 4, 14, theme, { fill: theme.muted }), theme, defsId),
			width: w,
			height: h
		};
	}

	// Counts scale with the cell so a stretched grid does not read as empty.
	const countSize = Math.min(theme.fontSize * 1.5, Math.max(theme.fontSize, cell * 0.42));

	const body: string[] = [];

	// Model name headers are drawn after the grid cells (see below) so the
	// rotated labels sit on top of the cells rather than being covered by them.

	scenarios.forEach((scenario, row) => {
		const y = headerH + row * cell;
		body.push(
			text(ellipsize(scenario.code, codeChars), gutter - 6, y + cell / 2 + theme.fontSize * 0.36, theme, {
				anchor: 'end',
				fill: theme.muted
			})
		);
		models.forEach((model, col) => {
			const x = gutter + col * cell;
			const value = cells[row]?.[col] ?? 0;
			const hook = options.interactive
				? ` data-cell="1" data-scenario="${escapeXml(scenario.code)}" data-model="${escapeXml(model)}" data-count="${value}"`
				: '';
			if (value === 0) {
				body.push(rect(x + 1, y + 1, cell - 2, cell - 2, theme.bg, theme.line, hook));
			} else {
				// Opacity carries the magnitude; the fill itself stays one red.
				const intensity = max <= 1 ? 1 : 0.45 + 0.55 * (value / max);
				body.push(
					`<g opacity="${intensity.toFixed(2)}">${rect(x + 1, y + 1, cell - 2, cell - 2, redFill(defsId, theme, 'v'), undefined, hook)}</g>`,
					text(String(value), x + cell / 2, y + cell / 2 + countSize * 0.36, theme, {
						anchor: 'middle',
						fill: '#0A0A0A',
						bold: true,
						size: countSize
					})
				);
			}
		});
	});

	// Draw rotated model-name headers last so they paint on top of every cell,
	// visible on both empty (black) and filled (red) backgrounds.
	models.forEach((model, col) => {
		const x = gutter + col * cell + cell / 2 + theme.fontSize * 0.36;
		body.push(
			text(ellipsize(model, modelChars), x, headerH - 5, theme, {
				anchor: 'end',
				fill: theme.muted,
				rotate: -90
			})
		);
	});

	return { svg: svgWrap(width, height, body.join(''), theme, defsId), width, height };
}

/* ------------------------------------------------------------ cover band */

/**
 * Deterministic 32-bit hash (FNV-1a). Used to vary the cover's accent pattern
 * per competition without `Math.random`, so the same export always produces a
 * byte-identical PDF.
 */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export interface CoverBandOptions {
	/** Varies the accent pattern. Pass the competition slug. */
	seed: string;
	width: number;
	height?: number;
	theme?: ChartTheme;
	id?: string;
}

/**
 * The decorative band across the top of the PDF cover.
 *
 * Deliberately *not* data-driven: a lattice whose lit cells tracked break
 * counts would either look empty for a small vault or imply a scale the data
 * does not support. The pattern varies by competition so covers are
 * distinguishable, and the real numbers live in the stat tiles beneath it.
 * No text, so it needs no font.
 */
export function coverBandSvg(options: CoverBandOptions): SvgChart {
	const theme = options.theme ?? UI_THEME;
	const defsId = options.id ?? 'cover';
	const width = options.width;
	const height = options.height ?? 150;
	const seed = hash(options.seed);

	const step = 11;
	const cols = Math.floor(width / step);
	const rows = Math.floor(height / step);
	const body: string[] = [];

	// Dim lattice: the "surface" the payloads were fired at.
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const x = c * step + (width - cols * step) / 2;
			const y = r * step + (height - rows * step) / 2;
			const n = hash(`${seed}:${r}:${c}`);
			// ~7% of cells accent, with a diagonal bias so it reads as motion.
			const diagonal = (c + r * 2) % 9 === seed % 9;
			const lit = n % 100 < 4 || (diagonal && n % 100 < 42);
			if (lit) {
				const strong = n % 7 === 0;
				body.push(
					`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${step - 3}" height="${step - 3}" fill="${
						strong ? redFill(defsId, theme, 'v') : theme.redDim
					}" opacity="${strong ? 1 : 0.75}"/>`
				);
			} else {
				body.push(
					`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${step - 3}" height="${step - 3}" fill="${theme.line}" opacity="0.5"/>`
				);
			}
		}
	}

	// Scanline wash over the lattice.
	for (let y = 0; y < height; y += 4) {
		body.push(
			`<rect x="0" y="${y}" width="${width}" height="1" fill="${theme.bg}" opacity="0.55"/>`
		);
	}

	// Crop marks at the corners, and a heavy rule along the bottom edge.
	const tick = 10;
	for (const [cx, cy, dx, dy] of [
		[0, 0, 1, 1],
		[width, 0, -1, 1],
		[0, height, 1, -1],
		[width, height, -1, -1]
	] as const) {
		body.push(
			`<line x1="${cx}" y1="${cy}" x2="${cx + dx * tick}" y2="${cy}" stroke="${theme.red}" stroke-width="1.5"/>`,
			`<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + dy * tick}" stroke="${theme.red}" stroke-width="1.5"/>`
		);
	}
	body.push(
		`<rect x="0" y="${height - 3}" width="${width}" height="3" fill="${redFill(defsId, theme, 'h')}"/>`
	);

	return { svg: svgWrap(width, height, body.join(''), theme, defsId), width, height };
}

/* --------------------------------------------------------------- timeline */

export interface TimelineOptions {
	points: readonly TimelinePoint[];
	width: number;
	height?: number;
	theme?: ChartTheme;
	/** Namespace for this chart's gradient ids. Must be unique per page. */
	id?: string;
}

function dayNumber(date: string): number {
	const t = Date.parse(`${date}T00:00:00Z`);
	return Number.isNaN(t) ? 0 : Math.round(t / 86_400_000);
}

/**
 * Dot-and-line timeline on a real date axis, so gaps between submission days
 * read as gaps rather than being collapsed.
 */
export function timelineSvg(options: TimelineOptions): SvgChart {
	const theme = options.theme ?? UI_THEME;
	const defsId = options.id ?? 'tl';
	const width = options.width;
	const height = options.height ?? 90;
	const padLeft = Math.ceil(charWidth(theme.fontSize) * 3) + 6;
	const padRight = 6;
	const padTop = 8;
	const axisY = height - theme.fontSize - 8;

	const points = options.points;
	if (points.length === 0) {
		return {
			svg: svgWrap(width, height, text('no data', 4, 14, theme, { fill: theme.muted }), theme, defsId),
			width,
			height
		};
	}

	const first = dayNumber(points[0]!.date);
	const last = dayNumber(points[points.length - 1]!.date);
	const span = Math.max(1, last - first);
	const maxCount = points.reduce((m, p) => Math.max(m, p.count), 0) || 1;
	const plotW = Math.max(10, width - padLeft - padRight);
	const plotH = Math.max(10, axisY - padTop);

	const x = (date: string) =>
		points.length === 1 ? padLeft + plotW / 2 : padLeft + ((dayNumber(date) - first) / span) * plotW;
	const y = (count: number) => axisY - (count / maxCount) * plotH;

	const body: string[] = [
		`<line x1="${padLeft}" y1="${axisY}" x2="${padLeft + plotW}" y2="${axisY}" stroke="${theme.line}" stroke-width="1"/>`,
		text(String(maxCount), padLeft - 4, padTop + theme.fontSize * 0.8, theme, {
			anchor: 'end',
			fill: theme.muted
		}),
		text('0', padLeft - 4, axisY, theme, { anchor: 'end', fill: theme.muted })
	];

	if (points.length > 1) {
		const path = points.map((p) => `${x(p.date).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');
		if (theme.gradient) {
			// Area under the line, fading to nothing at the axis.
			const area = `${padLeft.toFixed(1)},${axisY.toFixed(1)} ${path} ${(padLeft + plotW).toFixed(1)},${axisY.toFixed(1)}`;
			body.push(`<polygon points="${area}" fill="url(#${defsId}-fade)"/>`);
		}
		body.push(`<polyline points="${path}" fill="none" stroke="${theme.red}" stroke-width="1"/>`);
	}

	for (const p of points) {
		const cx = x(p.date);
		const cy = y(p.count);
		body.push(
			`<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${axisY}" stroke="${theme.redDim}" stroke-width="1"/>`,
			`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.2" fill="${theme.red}"/>`
		);
	}

	// Only the endpoints are labelled — intermediate dates never fit.
	const firstLabel = points[0]!.date.slice(5);
	const lastLabel = points[points.length - 1]!.date.slice(5);
	body.push(text(firstLabel, padLeft, height - 2, theme, { anchor: 'start', fill: theme.muted }));
	if (points.length > 1) {
		body.push(text(lastLabel, padLeft + plotW, height - 2, theme, { anchor: 'end', fill: theme.muted }));
	}

	return { svg: svgWrap(width, height, body.join(''), theme, defsId), width, height };
}
