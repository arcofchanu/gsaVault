<script lang="ts">
	import { barChartSvg } from '$lib/charts/svg';
	import type { Tally } from '$lib/stats';

	let {
		items,
		id,
		maxRows,
		labelChars = 18
	}: { items: readonly Tally[]; id: string; maxRows?: number; labelChars?: number } = $props();

	let width = $state(0);

	const chart = $derived(
		width > 0 ? barChartSvg({ items, width, id, maxRows, labelChars }) : null
	);
</script>

<div class="bar" bind:clientWidth={width}>
	{#if items.length === 0}
		<p class="muted empty">no data</p>
	{:else if chart}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- generated locally by charts/svg.ts -->
		{@html chart.svg}
	{/if}
</div>

<style>
	.bar {
		width: 100%;
	}
	.bar :global(svg) {
		display: block;
		max-width: 100%;
	}
	.empty {
		margin: 0;
		font-size: var(--fs-sm);
	}
</style>
