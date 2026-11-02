/**
 * Test-only helpers for reading `fixtures/`. Node APIs — never imported by app
 * code, so this never reaches the client bundle.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE_DIR = resolve(process.cwd(), 'fixtures');

export function fixtureNames(): string[] {
	return readdirSync(FIXTURE_DIR)
		.filter((name) => name.toLowerCase().endsWith('.json'))
		.sort();
}

export function readFixture(name: string): { path: string; text: string } {
	return { path: name, text: readFileSync(resolve(FIXTURE_DIR, name), 'utf8') };
}

/** The GSA arena export checked into `fixtures/` (there is exactly one today). */
export function arenaFixture(): { path: string; text: string; json: Record<string, unknown> } {
	const names = fixtureNames();
	const name = names[0];
	if (name === undefined) throw new Error('no JSON fixture found in fixtures/');
	const { path, text } = readFixture(name);
	return { path, text, json: JSON.parse(text) as Record<string, unknown> };
}
