<script lang="ts">
	import type { Mode } from '$lib/types';

	let { mode, competition }: { mode: Mode; competition: string | null } = $props();
</script>

<div class="overlay" aria-hidden="true">
	<div class="grid"></div>
	<div class="inner">
		<p class="head">DROP SUBMISSIONS</p>
		<p class="sub">.json &nbsp;·&nbsp; .zip &nbsp;·&nbsp; any mix, any depth</p>
		<p class="mode">
			stamping as <span class="red">{mode.toUpperCase()}-TURN</span>
			{#if competition !== null}<br />filing under <span class="red">{competition}</span>{/if}
		</p>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		background: var(--grad-drop);
		border: 2px solid var(--red);
		pointer-events: none;
	}

	/* Faint grid + scanline, per PRD §5. */
	.grid {
		position: absolute;
		inset: 0;
		background-image:
			repeating-linear-gradient(0deg, rgba(225, 6, 0, 0.09) 0 1px, transparent 1px 4px),
			linear-gradient(0deg, transparent 0 23px, rgba(225, 6, 0, 0.07) 23px 24px),
			linear-gradient(90deg, transparent 0 23px, rgba(225, 6, 0, 0.07) 23px 24px);
		background-size:
			100% 4px,
			24px 24px,
			24px 24px;
		animation: drift 8s linear infinite;
	}

	@keyframes drift {
		from {
			background-position:
				0 0,
				0 0,
				0 0;
		}
		to {
			background-position:
				0 4px,
				0 24px,
				24px 0;
		}
	}

	.inner {
		position: relative;
		text-align: center;
		padding: var(--gap-6);
		border: 1px solid var(--red);
		background: rgba(10, 10, 10, 0.82);
	}

	.head {
		margin: 0;
		font-size: var(--fs-2xl);
		font-weight: 700;
		letter-spacing: var(--track);
		color: var(--text);
	}

	.sub,
	.mode {
		margin: var(--gap-3) 0 0;
		color: var(--muted);
		font-size: var(--fs-sm);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}
</style>
