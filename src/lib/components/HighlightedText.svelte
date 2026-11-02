<script lang="ts">
	import { splitPlaceholders } from '$lib/util/text';

	let { text = '' }: { text?: string } = $props();

	const segments = $derived(splitPlaceholders(text));
</script>

<!-- No whitespace between tags: the parent uses `white-space: pre-wrap`, so any
     newline in the markup would show up inside the payload text. -->
{#each segments as segment, i (i)}{#if segment.placeholder}<span class="ph">{segment.text}</span
		>{:else}{segment.text}{/if}{/each}
