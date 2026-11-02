<script lang="ts">
	import { timelineSvg } from '$lib/charts/svg';
	import type { TimelinePoint } from '$lib/stats';

	let {
		points,
		id = 'tl',
		height = 96
	}: { points: readonly TimelinePoint[]; id?: string; height?: number } = $props();

	let width = $state(0);

	const chart = $derived(width > 0 ? timelineSvg({ points, width, height, id }) : null);
</script>

<div class="timeline" bind:clientWidth={width}>
	{#if points.length === 0}
		<p class="muted empty">no data</p>
	{:else if chart}
		{@html chart.svg}
	{/if}
</div>

<style>
	.timeline {
		width: 100%;
	}
	.timeline :global(svg) {
		display: block;
		max-width: 100%;
	}
	.empty {
		margin: 0;
		font-size: var(--fs-sm);
	}
</style>
