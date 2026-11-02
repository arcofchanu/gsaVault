<script lang="ts">
	let {
		text,
		label = 'copy',
		title = 'Copy to clipboard'
	}: { text: string | (() => string); label?: string; title?: string } = $props();

	let state = $state<'idle' | 'ok' | 'fail'>('idle');
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** Fallback for non-secure contexts (e.g. the build opened over file://). */
	function legacyCopy(value: string): boolean {
		const area = document.createElement('textarea');
		area.value = value;
		area.setAttribute('readonly', '');
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		}
		document.body.removeChild(area);
		return ok;
	}

	async function copy() {
		const value = typeof text === 'function' ? text() : text;
		let ok = false;
		try {
			await navigator.clipboard.writeText(value);
			ok = true;
		} catch {
			ok = legacyCopy(value);
		}
		state = ok ? 'ok' : 'fail';
		clearTimeout(timer);
		timer = setTimeout(() => (state = 'idle'), 1400);
	}
</script>

<button class="ghost copy" class:ok={state === 'ok'} onclick={copy} {title} type="button">
	{state === 'idle' ? label : state === 'ok' ? 'copied' : 'failed'}
</button>

<style>
	.copy {
		font-size: var(--fs-xs);
	}
	.copy.ok {
		color: var(--red);
	}
</style>
