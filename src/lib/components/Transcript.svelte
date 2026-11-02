<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import HighlightedText from '$lib/components/HighlightedText.svelte';
	import ToolCalls from '$lib/components/ToolCalls.svelte';
	import { formatDateTime } from '$lib/util/text';
	import type { Message } from '$lib/types';

	let { transcript }: { transcript: readonly Message[] } = $props();

	function roleLabel(role: string): string {
		if (role === 'user') return 'USER';
		if (role === 'assistant') return 'AGENT';
		return role.toUpperCase();
	}

	function plainText(): string {
		return transcript
			.map((m) => {
				const tools =
					m.toolCalls.length > 0 ? `\n[${m.toolCalls.length} tool calls]` : '';
				return `${roleLabel(m.role)}:\n${m.content}${tools}`;
			})
			.join('\n\n');
	}
</script>

<div class="transcript">
	<div class="transcript__head">
		<span class="label label--red">[ TRANSCRIPT · {transcript.length} MESSAGES ]</span>
		<CopyButton label="copy transcript" text={plainText} />
	</div>

	{#if transcript.length === 0}
		<p class="muted">—</p>
	{/if}

	{#each transcript as message, i (i)}
		<article class="turn" class:turn--user={message.role === 'user'}>
			<header class="turn__head">
				<span class="turn__role">{roleLabel(message.role)}</span>
				{#if message.timestamp !== ''}
					<span class="muted turn__time">{formatDateTime(message.timestamp)}</span>
				{/if}
			</header>

			{#if message.content.trim() === ''}
				<p class="muted empty">—</p>
			{:else}
				<div class="block body"><HighlightedText text={message.content} /></div>
			{/if}

			{#if message.toolCalls.length > 0}
				<ToolCalls calls={message.toolCalls} />
			{/if}
		</article>
	{/each}
</div>

<style>
	.transcript__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap-3);
	}
	.transcript__head .label {
		margin-bottom: 0;
	}

	.turn {
		margin-top: var(--gap-3);
		border: 1px solid var(--line);
		border-left: 2px solid var(--line);
		background: var(--surface);
		padding: var(--gap-3);
	}

	/* User turns carry the red bar — they are the benign ask the agent received. */
	.turn--user {
		border-left-color: var(--red);
	}

	.turn__head {
		display: flex;
		align-items: baseline;
		gap: var(--gap-3);
		margin-bottom: var(--gap-2);
	}

	.turn__role {
		font-size: var(--fs-xs);
		font-weight: 700;
		letter-spacing: var(--track);
		color: var(--muted);
	}

	.turn--user .turn__role {
		color: var(--red);
	}

	.turn__time {
		font-size: var(--fs-xs);
	}

	.body {
		line-height: 1.6;
	}

	.empty {
		margin: 0;
	}
</style>
