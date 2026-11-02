import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		// The PDF chunk inlines pdfmake plus two embedded TTFs so that exporting
		// costs no network request. ~2.3 MB is expected — see NETWORK.md.
		chunkSizeWarningLimit: 3000
	},
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node',
		globals: true
	}
});
