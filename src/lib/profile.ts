/**
 * The researcher's GSA public-profile details, shown on the PDF cover.
 *
 * Typed in by hand: the vault makes no network calls, so nothing can be read
 * off gray swan's site. Values are kept as free text so whatever the profile
 * page shows ("#12", "12 / 4,318", "1,204") can be reproduced verbatim.
 */
export interface Profile {
	name: string;
	/** Global rank, as shown on the profile. */
	rank: string;
	/** Unique behaviours broken, as shown on the profile. */
	uniqueBreaks: string;
	/** Total prize money won, as shown on the profile. Free text, so the
	 *  currency and formatting are whatever the profile displays. */
	earnings: string;
	/** Link to the public profile, printed under the name. */
	profileUrl: string;
	/** Square PNG data URL, or null. See `normalizePhoto`. */
	photo: string | null;
}

export const EMPTY_PROFILE: Profile = {
	name: '',
	rank: '',
	uniqueBreaks: '',
	earnings: '',
	profileUrl: '',
	photo: null
};

/** Side length the photo is normalised to. ~48pt in print at 4x density. */
export const PHOTO_SIZE = 192;

export function isProfileEmpty(profile: Profile): boolean {
	return (
		profile.name.trim() === '' &&
		profile.rank.trim() === '' &&
		profile.uniqueBreaks.trim() === '' &&
		profile.earnings.trim() === '' &&
		profile.profileUrl.trim() === '' &&
		profile.photo === null
	);
}

/** Coerce stored or imported JSON into a Profile, dropping anything unusable. */
export function readProfile(value: unknown): Profile {
	if (value === null || typeof value !== 'object') return { ...EMPTY_PROFILE };
	const rec = value as Record<string, unknown>;
	const str = (key: string) => (typeof rec[key] === 'string' ? (rec[key] as string) : '');
	const photo = rec.photo;
	return {
		name: str('name'),
		rank: str('rank'),
		uniqueBreaks: str('uniqueBreaks'),
		earnings: str('earnings'),
		profileUrl: str('profileUrl'),
		// Only data URLs: a remote src would be a network request on export.
		photo: typeof photo === 'string' && photo.startsWith('data:image/') ? photo : null
	};
}

/**
 * Re-encode a picked image as a small square PNG data URL.
 *
 * Three reasons not to store the file as-is: pdfkit embeds only PNG and JPEG,
 * so a WebP or AVIF avatar would fail at export time; the original may be
 * megabytes, and it has to fit in IndexedDB and the JSON bundle; and a data URL
 * keeps the PDF self-contained with no fetch. Centre-cropped so non-square
 * sources are not distorted.
 */
export async function normalizePhoto(file: File): Promise<string> {
	if (!file.type.startsWith('image/')) {
		throw new Error(`${file.name} is not an image`);
	}

	const bitmap = await createImageBitmap(file);
	try {
		const side = Math.min(bitmap.width, bitmap.height);
		const canvas = document.createElement('canvas');
		canvas.width = PHOTO_SIZE;
		canvas.height = PHOTO_SIZE;
		const ctx = canvas.getContext('2d');
		if (ctx === null) throw new Error('could not get a 2d canvas');
		ctx.drawImage(
			bitmap,
			(bitmap.width - side) / 2,
			(bitmap.height - side) / 2,
			side,
			side,
			0,
			0,
			PHOTO_SIZE,
			PHOTO_SIZE
		);
		return canvas.toDataURL('image/png');
	} finally {
		bitmap.close();
	}
}
