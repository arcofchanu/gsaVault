import { NO_WAVE } from '$lib/config';

/** One collator for every sort in the app: natural order, so B2 < B10. */
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
	return collator.compare(a, b);
}

/** Natural order, except the "no wave" marker always sorts last. */
export function waveCompare(a: string, b: string): number {
	if (a === b) return 0;
	if (a === NO_WAVE) return 1;
	if (b === NO_WAVE) return -1;
	return collator.compare(a, b);
}

/** Ascending by ISO timestamp; unparseable/missing values sort last. */
export function dateCompare(a: string, b: string): number {
	const ta = Date.parse(a);
	const tb = Date.parse(b);
	const va = Number.isNaN(ta) ? Infinity : ta;
	const vb = Number.isNaN(tb) ? Infinity : tb;
	return va - vb;
}
