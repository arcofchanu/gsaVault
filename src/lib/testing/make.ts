/** Synthetic GSA exports for tests. Pure — no Node APIs. */
import { normalizeSubmission } from '$lib/parse/arenaChat';
import type { Mode, Submission } from '$lib/types';

export interface SynthSpec {
	chatId: string;
	scenario?: string;
	model?: string;
	slug?: string;
	name?: string;
	createdAt?: string;
	title?: string;
	task?: string;
	userTurns?: number;
}

export function synthRaw(spec: SynthSpec): Record<string, unknown> {
	const turns = spec.userTurns ?? 1;
	const messages: Record<string, unknown>[] = [];
	for (let i = 0; i < turns; i++) {
		messages.push({
			role: 'user',
			content: i === 0 ? (spec.task ?? 'do the benign thing') : `follow up ${i}`,
			timestamp: spec.createdAt ?? '2026-10-20T00:00:00.000Z'
		});
		messages.push({
			role: 'assistant',
			content: `agent reply ${i}`,
			timestamp: spec.createdAt ?? '2026-10-20T00:00:00.000Z',
			toolCalls: [{ name: 'bash', arguments: {}, output: 'ok' }]
		});
	}
	return {
		formatVersion: 1,
		kind: 'arena-chat',
		exportedAt: '2026-10-24T00:00:00.000Z',
		challenge: {
			slug: spec.slug ?? 'ipi-black-2026',
			name: spec.name ?? 'Indirect Prompt Injection: Black',
			anonymized: true
		},
		chatId: spec.chatId,
		scenario: spec.scenario ?? 'WB2S1 - Issue Unauthorized Refund',
		title: spec.title ?? '[{"note":"pay {{attacker}} now"}] · [] · []',
		createdAt: spec.createdAt ?? '2026-10-20T00:00:00.000Z',
		messages,
		model: spec.model ?? 'Emerald Grasshopper Ultra'
	};
}

export function synth(spec: SynthSpec, mode: Mode = 'single'): Submission {
	return normalizeSubmission(synthRaw(spec), {
		sourceFile: `${spec.chatId}.json`,
		mode,
		importedAt: '2026-10-26T09:30:00.000Z'
	});
}

export function synthSource(spec: SynthSpec): { path: string; text: string } {
	return { path: `${spec.chatId}.json`, text: JSON.stringify(synthRaw(spec)) };
}
