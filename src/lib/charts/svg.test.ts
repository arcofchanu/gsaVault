import { describe, expect, it } from 'vitest';
import { barChartSvg, heatmapSvg, PDF_THEME, timelineSvg, UI_THEME } from '$lib/charts/svg';
import { computeStats } from '$lib/stats';
import { synth } from '$lib/testing/make';

function matrixOf(models: string[]) {
	return computeStats(
		models.map((m, i) => synth({ chatId: `c${i}`, model: m, scenario: 'WB2S1 - A' }))
	).matrix;
}

/** Row gutter width, mirroring the builder's own maths. */
function gutter(theme = UI_THEME, codeChars = 10) {
	return Math.ceil(codeChars * theme.fontSize * 0.6) + 8;
}

describe('heatmap sizing', () => {
	const CELL_MIN = Math.round(UI_THEME.fontSize * 2.4);
	const CELL_MAX = Math.round(UI_THEME.fontSize * 6.4);

	it('stretches cells to fill the width it is given', () => {
		const eight = Array.from({ length: 8 }, (_, i) => `Model ${i}`);
		const narrow = heatmapSvg({ matrix: matrixOf(eight), fitWidth: 320 });
		const wide = heatmapSvg({ matrix: matrixOf(eight), fitWidth: 760 });
		expect(wide.width).toBeGreaterThan(narrow.width);
		expect(wide.width).toBeLessThanOrEqual(760);
	});

	it('makes a single cell big enough to read, not an 18px dot', () => {
		const one = heatmapSvg({ matrix: matrixOf(['Blue Seagull Peerless']), fitWidth: 1100 });
		expect(one.width - gutter() - 2).toBe(CELL_MAX);
		expect(CELL_MAX).toBeGreaterThanOrEqual(60);
	});

	it('caps growth so a two-model matrix does not become a billboard', () => {
		const huge = heatmapSvg({ matrix: matrixOf(['Alpha', 'Beta']), fitWidth: 4000 });
		expect(huge.width).toBe(gutter() + 2 * CELL_MAX + 2);
	});

	it('bottoms out at the minimum and overflows for many models', () => {
		const many = Array.from({ length: 40 }, (_, i) => `Model ${i}`);
		const svg = heatmapSvg({ matrix: matrixOf(many), fitWidth: 600 });
		expect(svg.width).toBe(gutter() + 40 * CELL_MIN + 2);
		expect(svg.width).toBeGreaterThan(600); // container scrolls
	});

	it('uses the minimum before the container has been measured', () => {
		const svg = heatmapSvg({ matrix: matrixOf(['A', 'B']) });
		expect(svg.width).toBe(gutter() + 2 * CELL_MIN + 2);
	});

	it('honours an explicit cell size', () => {
		const svg = heatmapSvg({ matrix: matrixOf(['A']), cell: 11, theme: PDF_THEME });
		expect(svg.width).toBe(gutter(PDF_THEME) + 11 + 2);
	});

	it('scales the count labels with the cell', () => {
		const small = heatmapSvg({ matrix: matrixOf(['A']), cell: 14 });
		const big = heatmapSvg({ matrix: matrixOf(['A']), cell: 48 });
		const sizeOf = (svg: string) => Number(/font-size="([\d.]+)"[^>]*>1</.exec(svg)?.[1] ?? 0);
		expect(sizeOf(big.svg)).toBeGreaterThan(sizeOf(small.svg));
	});

	it('tags cells for click delegation only when interactive', () => {
		const plain = heatmapSvg({ matrix: matrixOf(['A']) });
		const live = heatmapSvg({ matrix: matrixOf(['A']), interactive: true });
		expect(plain.svg).not.toContain('data-cell');
		expect(live.svg).toContain('data-scenario="WB2S1"');
		expect(live.svg).toContain('data-model="A"');
	});

	it('survives an empty matrix', () => {
		const svg = heatmapSvg({ matrix: matrixOf([]), fitWidth: 600 });
		expect(svg.svg).toContain('no data');
	});
});

describe('chart builders in general', () => {
	it('escapes text so a payload cannot break the SVG', () => {
		const svg = barChartSvg({
			items: [{ key: 'x', label: '<script>&"', count: 1 }],
			width: 300
		});
		expect(svg.svg).not.toContain('<script>');
		expect(svg.svg).toContain('&lt;script&gt;');
	});

	it('never lets a label swallow a cell click', () => {
		const svg = heatmapSvg({ matrix: matrixOf(['A']), interactive: true });
		const texts = svg.svg.match(/<text [^>]*>/g) ?? [];
		expect(texts.length).toBeGreaterThan(0);
		expect(texts.every((t) => t.includes('pointer-events="none"'))).toBe(true);
	});

	it('keeps gradient ids namespaced per chart', () => {
		const a = barChartSvg({ items: [{ key: 'a', label: 'a', count: 1 }], width: 200, id: 'one' });
		const b = barChartSvg({ items: [{ key: 'b', label: 'b', count: 1 }], width: 200, id: 'two' });
		expect(a.svg).toContain('id="one-h"');
		expect(b.svg).toContain('id="two-h"');
	});

	it('draws flat fills when the theme has gradients off', () => {
		const flat = barChartSvg({
			items: [{ key: 'a', label: 'a', count: 1 }],
			width: 200,
			theme: { ...UI_THEME, gradient: false }
		});
		expect(flat.svg).not.toContain('linearGradient');
		expect(flat.svg).toContain('fill="#E10600"');
	});

	it('renders a single-point timeline without dividing by zero', () => {
		const svg = timelineSvg({ points: [{ date: '2026-10-20', count: 3 }], width: 400 });
		expect(svg.svg).toContain('<circle');
		expect(svg.svg).not.toContain('NaN');
	});

	it('summarises the overflow when there are more bars than rows', () => {
		const items = Array.from({ length: 20 }, (_, i) => ({
			key: `k${i}`,
			label: `Model ${i}`,
			count: 1
		}));
		const svg = barChartSvg({ items, width: 400, maxRows: 5 });
		expect(svg.svg).toContain('+15 more');
	});
});
