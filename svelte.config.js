import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// SPA: `index.html` is the fallback for every route, resolved client-side.
		adapter: adapter({ fallback: 'index.html', strict: false }),
		// Relative asset paths so the build also works served from any subpath.
		paths: { relative: true }
	}
};

export default config;
