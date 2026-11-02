<script lang="ts">
	import { heatmapSvg } from '$lib/charts/svg';
	import type { Matrix } from '$lib/stats';

	let {
		matrix,
		id = 'heat',
		onselect
	}: {
		matrix: Matrix;
		id?: string;
		/** Clicking a cell filters the list (PRD §4.3). */
		onselect?: (scenarioCode: string, model: string) => void;
	} = $props();

	/** Measured so the cells can stretch to fill the panel. */
	let width = $state(0);

	const chart = $derived(
		heatmapSvg({
			matrix,
			id,
			interactive: onselect !== undefined,
			// Before the first measurement, fall back to the minimum cell size.
			fitWidth: width > 0 ? width : undefined
		})
	);

	/**
	 * The SVG is generated as a string so the PDF can reuse the same builder,
	 * so cell clicks are delegated and read back off `data-*` attributes.
	 */
	function onclick(event: MouseEvent) {
		if (onselect === undefined) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		const cell = target.closest('[data-cell]');
		if (cell === null) return;
		const scenario = cell.getAttribute('data-scenario');
		const model = cell.getAttribute('data-model');
		if (scenario !== null && model !== null) onselect(scenario, model);
	}
</script>

<div class="heat scroll-x" bind:clientWidth={width} {onclick} role="presentation">
	{@html chart.svg}
</div>

<style>
	.heat :global(svg) {
		display: block;
	}
	.heat :global(rect[data-cell]) {
		cursor: pointer;
	}
	/* Hovering an empty cell still offers the (empty) filter. */
	.heat :global(rect[data-cell][data-count='0']:hover) {
		fill: var(--red-dim);
	}
	.heat :global(rect[data-cell]:not([data-count='0']):hover) {
		stroke: var(--text);
		stroke-width: 1;
	}
</style>
