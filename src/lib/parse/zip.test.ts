import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { importSources } from '$lib/parse/import';
import { expandFiles, isIgnoredEntry } from '$lib/parse/zip';
import { arenaFixture } from '$lib/testing/fixtures';

const fixture = arenaFixture();

/** The fixture with a fresh chatId, so each copy is a distinct submission. */
function variant(chatId: string): string {
	return JSON.stringify({ ...fixture.json, chatId });
}

async function zipFile(name: string, build: (zip: JSZip) => void | Promise<void>): Promise<File> {
	const zip = new JSZip();
	await build(zip);
	const bytes = await zip.generateAsync({ type: 'arraybuffer' });
	return new File([bytes], name, { type: 'application/zip' });
}

describe('isIgnoredEntry', () => {
	it('skips macOS resource forks, dotfiles and thumbnails', () => {
		expect(isIgnoredEntry('__MACOSX/._sub.json')).toBe(true);
		expect(isIgnoredEntry('batch/.DS_Store')).toBe(true);
		expect(isIgnoredEntry('batch/._sub.json')).toBe(true);
		expect(isIgnoredEntry('batch/Thumbs.db')).toBe(true);
		expect(isIgnoredEntry('batch/nested/sub.json')).toBe(false);
	});
});

describe('expandFiles', () => {
	let sources: Awaited<ReturnType<typeof expandFiles>>;

	beforeAll(async () => {
		const inner = await zipFile('inner.zip', (zip) => {
			zip.file('sub-c.json', variant('chat-c'));
		});
		const outer = await zipFile('batch1.zip', async (zip) => {
			zip.file('sub-a.json', variant('chat-a'));
			zip.folder('nested')!.file('sub-b.json', variant('chat-b'));
			zip.file('__MACOSX/._sub-a.json', 'junk');
			zip.file('.DS_Store', 'junk');
			zip.file('readme.txt', 'not a submission');
			zip.file('inner.zip', await inner.arrayBuffer());
		});
		const loose = new File([variant('chat-d')], 'loose.json', { type: 'application/json' });
		sources = await expandFiles([outer, loose]);
	});

	it('finds every JSON through nested folders and a nested zip', () => {
		expect(sources.failed).toEqual([]);
		expect(sources.sources.map((s) => s.path).sort()).toEqual([
			'batch1.zip/inner.zip/sub-c.json',
			'batch1.zip/nested/sub-b.json',
			'batch1.zip/sub-a.json',
			'loose.json'
		]);
	});

	it('imports a mixed drop of zips and loose files in one pass', () => {
		const result = importSources(sources.sources, {
			mode: 'single',
			now: '2026-10-26T09:30:00.000Z',
			existing: {},
			waveOverrides: {}
		});
		expect(result.added.map((s) => s.id).sort()).toEqual(['chat-a', 'chat-b', 'chat-c', 'chat-d']);
		expect(result.failed).toEqual([]);
		expect(result.added[0].sourceFile).toContain('batch1.zip/');
	});

	it('collapses a loose file that is also inside the zip', async () => {
		const zipped = await zipFile('dup.zip', (zip) => {
			zip.file('same.json', fixture.text);
		});
		const loose = new File([fixture.text], 'same.json', { type: 'application/json' });
		const expanded = await expandFiles([zipped, loose]);
		const result = importSources(expanded.sources, {
			mode: 'single',
			now: '2026-10-26T09:30:00.000Z',
			existing: {},
			waveOverrides: {}
		});
		expect(result.added).toHaveLength(1);
		expect(result.duplicates).toHaveLength(1);
	});

	it('reports unsupported top-level files and unreadable zips', async () => {
		const notAZip = new File([new Uint8Array([1, 2, 3, 4])], 'broken.zip');
		const image = new File([new Uint8Array([0])], 'screenshot.png');
		const result = await expandFiles([notAZip, image]);
		expect(result.sources).toEqual([]);
		expect(result.failed).toHaveLength(2);
		expect(result.failed[0].reason).toMatch(/unreadable zip/);
		expect(result.failed[1].reason).toMatch(/not a \.json or \.zip/);
	});
});
