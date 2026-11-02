<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import HighlightedText from '$lib/components/HighlightedText.svelte';
	import { prettyJson } from '$lib/util/text';
	import type { PayloadSlot } from '$lib/types';

	let {
		slots,
		source
	}: { slots: readonly PayloadSlot[]; source: 'title' | 'initialTask' } = $props();

	/**
	 * Unused injection surfaces are hidden by default — the slot index on each
	 * card already shows which surface was hit, and the header counts the rest.
	 * The toggle brings them back for anyone auditing surface coverage.
	 */
	let showEmpty = $state(false);

	const filled = $derived(slots.filter((s) => !s.empty));
	const visible = $derived(showEmpty ? slots : filled);

	function slotText(slot: PayloadSlot): string {
		return slot.parsed !== null ? prettyJson(slot.parsed) : slot.raw;
	}
</script>

<div class="payload">
	<div class="payload__head">
		<span class="label label--red">[ PAYLOAD · {filled.length}/{slots.length} SLOTS USED ]</span>
		<div class="payload__tools">
			{#if source === 'initialTask'}
				<span class="tag" title="This export had no slot-shaped title, so the payload falls back to the initial user task.">
					from task
				</span>
			{/if}
			{#if slots.length > filled.length}
				<button class="ghost" onclick={() => (showEmpty = !showEmpty)} type="button">
					{showEmpty ? 'hide empty' : 'show empty'}
				</button>
			{/if}
			<CopyButton
				label="copy all"
				text={() => filled.map((s) => `[slot ${s.index}]\n${slotText(s)}`).join('\n\n')}
			/>
		</div>
	</div>

	{#each visible as slot (slot.index)}
		<section class="slot" class:slot--empty={slot.empty}>
			<header class="slot__head">
				<span class="slot__index">SLOT {slot.index}</span>
				{#if slot.empty}
					<span class="muted slot__state">unused surface</span>
				{:else}
					<span class="muted slot__state">
						{slot.parsed === null ? 'raw text' : Array.isArray(slot.parsed) ? 'json array' : 'json'}
						· {slot.raw.length.toLocaleString()} chars
					</span>
					<CopyButton text={() => slotText(slot)} />
				{/if}
			</header>

			{#if !slot.empty}
				<pre class="block"><HighlightedText text={slotText(slot)} /></pre>

				{#each slot.prose as prose, i (prose.field + i)}
					<div class="prose">
						<span class="label">// {prose.field}</span>
						<div class="block prose__text"><HighlightedText text={prose.text} /></div>
					</div>
				{/each}
			{/if}
		</section>
	{/each}
</div>

<style>
	.payload__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap-3);
		flex-wrap: wrap;
	}

	.payload__head .label {
		margin-bottom: 0;
	}

	.payload__tools {
		display: flex;
		align-items: center;
		gap: var(--gap-2);
	}

	.slot {
		margin-top: var(--gap-3);
		border: 1px solid var(--line);
		border-left: 2px solid var(--red);
		background: var(--surface);
		padding: var(--gap-3);
		transition: border-color 0.1s linear;
	}

	.slot:hover {
		border-color: var(--red);
		border-left-color: var(--red);
	}

	.slot--empty {
		border-left-color: var(--line);
		padding: var(--gap-2) var(--gap-3);
		background: transparent;
	}

	.slot__head {
		display: flex;
		align-items: baseline;
		gap: var(--gap-3);
		margin-bottom: var(--gap-2);
	}

	.slot--empty .slot__head {
		margin-bottom: 0;
	}

	.slot__index {
		color: var(--red);
		font-size: var(--fs-xs);
		letter-spacing: var(--track);
		font-weight: 700;
	}

	.slot__state {
		flex: 1;
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: var(--track);
	}

	.prose {
		margin-top: var(--gap-3);
	}

	.prose__text {
		border-left: 2px solid var(--red-dim);
		line-height: 1.6;
	}
</style>
