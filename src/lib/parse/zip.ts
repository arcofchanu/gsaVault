import JSZip from 'jszip';
import type { ImportFailure, SourceFile } from '$lib/types';

/** Stop recursing into nested zips at this depth (zip-bomb guard). */
const MAX_ZIP_DEPTH = 6;

export interface ExpandResult {
	sources: SourceFile[];
	failed: ImportFailure[];
}

function basename(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1] ?? path;
}

/** macOS resource forks, dotfiles and Windows thumbnails are never payloads. */
export function isIgnoredEntry(path: string): boolean {
	return path.split('/').some((segment) => {
		if (segment === '') return false;
		const lower = segment.toLowerCase();
		return lower === '__macosx' || segment.startsWith('.') || lower === 'thumbs.db';
	});
}

function hasExt(path: string, ext: string): boolean {
	return basename(path).toLowerCase().endsWith(ext);
}

export function isJsonPath(path: string): boolean {
	return hasExt(path, '.json');
}

export function isZipPath(path: string): boolean {
	return hasExt(path, '.zip');
}

async function expandZip(
	data: ArrayBuffer | Uint8Array,
	prefix: string,
	depth: number,
	out: ExpandResult
): Promise<void> {
	if (depth > MAX_ZIP_DEPTH) {
		out.failed.push({ path: prefix, reason: `nested zips deeper than ${MAX_ZIP_DEPTH} levels` });
		return;
	}

	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(data);
	} catch (err) {
		out.failed.push({
			path: prefix,
			reason: `unreadable zip (encrypted or corrupt): ${(err as Error).message}`
		});
		return;
	}

	const entries = Object.values(zip.files).filter((entry) => !entry.dir);
	for (const entry of entries) {
		const path = `${prefix}/${entry.name}`;
		if (isIgnoredEntry(entry.name)) continue;

		if (isJsonPath(entry.name)) {
			try {
				out.sources.push({ path, text: await entry.async('string') });
			} catch (err) {
				out.failed.push({ path, reason: `could not read from zip: ${(err as Error).message}` });
			}
			continue;
		}

		if (isZipPath(entry.name)) {
			try {
				await expandZip(await entry.async('arraybuffer'), path, depth + 1, out);
			} catch (err) {
				out.failed.push({ path, reason: `could not read nested zip: ${(err as Error).message}` });
			}
			continue;
		}
		// Anything else inside a zip is silently ignored — zips routinely carry
		// READMEs and screenshots alongside the exports.
	}
}

/**
 * Flatten a drop into readable JSON documents: loose `.json` files pass through,
 * `.zip` files are unpacked in-browser and recursed into, including nested zips
 * and nested folders (PRD §4.1).
 */
export async function expandFiles(files: readonly File[]): Promise<ExpandResult> {
	const out: ExpandResult = { sources: [], failed: [] };

	for (const file of files) {
		if (isIgnoredEntry(file.name)) continue;

		if (isJsonPath(file.name)) {
			try {
				out.sources.push({ path: file.name, text: await file.text() });
			} catch (err) {
				out.failed.push({ path: file.name, reason: `could not read file: ${(err as Error).message}` });
			}
			continue;
		}

		if (isZipPath(file.name)) {
			try {
				await expandZip(await file.arrayBuffer(), file.name, 1, out);
			} catch (err) {
				out.failed.push({ path: file.name, reason: `could not read zip: ${(err as Error).message}` });
			}
			continue;
		}

		out.failed.push({ path: file.name, reason: 'not a .json or .zip file' });
	}

	return out;
}
