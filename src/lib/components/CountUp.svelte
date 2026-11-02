<script lang="ts">
	import { onMount } from 'svelte';

	let { value, duration = 550 }: { value: number; duration?: number } = $props();

	let display = $state(0);
	let animated = false;

	onMount(() => {
		const reduced =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduced || value === 0) {
			display = value;
			animated = true;
			return;
		}

		// Counts up once, on first load only (PRD §5). Later changes snap.
		const start = performance.now();
		const from = 0;
		const to = value;
		let frame = 0;
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			// ease-out so the number settles rather than stopping dead
			display = Math.round(from + (to - from) * (1 - (1 - t) ** 3));
			if (t < 1) frame = requestAnimationFrame(step);
			else animated = true;
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		if (animated) display = value;
	});
</script>

{display}
