<script lang="ts">
	import { prettyJson } from '$lib/util/text';
	import type { ToolCall } from '$lib/types';

	let { calls }: { calls: readonly ToolCall[] } = $props();

	/** Outputs above this size stay collapsed until asked for (PRD §7). */
	const BIG = 4000;

	let open = $state(false);
	let expanded = $state<Record<number, boolean>>({});

	function sizeOf(value: unknown): number {
		if (value === null || value === undefined) return 0;
		return typeof value === 'string' ? value.length : prettyJson(value).length;
	}

	function render(value: unknown): string {
		return typeof value === 'string' ? value : prettyJson(value);
	}
</script>

<div class="tools">
	<button class="ghost toggle" onclick={() => (open = !open)} type="button" aria-expanded={open}>
		{open ? '−' : '+'} [ {calls.length} TOOL CALL{calls.length === 1 ? '' : 'S'} ]
	</button>

	{#if open}
		<ol class="list">
			{#each calls as call, i (i)}
				{@const outSize = sizeOf(call.output)}
				{@const isBig = outSize > BIG}
				<li class="call">
					<header class="call__head">
						<span class="call__n">{String(i + 1).padStart(2, '0')}</span>
						<span class="call__name">{call.name}</span>
						{#if call.outputError !== undefined && call.outputError !== null}
							<span class="tag tag--red">error</span>
						{/if}
						<span class="muted call__size">{outSize.toLocaleString()} chars</span>
					</header>

					{#if call.arguments !== null && call.arguments !== undefined}
						<pre class="block args">{render(call.arguments)}</pre>
					{/if}

					{#if outSize === 0}
						<p class="muted none">—</p>
					{:else if isBig && !expanded[i]}
						<button
							class="ghost reveal"
							onclick={() => (expanded = { ...expanded, [i]: true })}
							type="button"
						>
							show output ({outSize.toLocaleString()} chars)
						</button>
					{:else}
						<pre class="block out">{render(call.output)}</pre>
					{/if}

					{#if call.outputError !== undefined && call.outputError !== null}
						<pre class="block err">{render(call.outputError)}</pre>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.tools {
		margin-top: var(--gap-2);
	}

	.toggle {
		font-size: var(--fs-xs);
		letter-spacing: var(--track);
	}

	.list {
		list-style: none;
		margin: var(--gap-2) 0 0;
		padding: 0;
	}

	.call {
		border: 1px solid var(--line);
		border-left: 2px solid var(--line);
		padding: var(--gap-2) var(--gap-3);
		margin-top: var(--gap-2);
		background: var(--bg);
	}

	.call__head {
		display: flex;
		align-items: baseline;
		gap: var(--gap-2);
		font-size: var(--fs-xs);
	}

	.call__n {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.call__name {
		color: var(--red);
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.call__size {
		margin-left: auto;
		white-space: nowrap;
	}

	.args,
	.out,
	.err {
		margin-top: var(--gap-2);
		font-size: var(--fs-sm);
		max-height: 320px;
		overflow: auto;
		background: var(--surface);
	}

	.err {
		border-left: 2px solid var(--red);
	}

	.none {
		margin: var(--gap-1) 0 0;
		font-size: var(--fs-sm);
	}

	.reveal {
		margin-top: var(--gap-2);
		font-size: var(--fs-xs);
	}
</style>
