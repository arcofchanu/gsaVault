import { EMPTY_VALUE, NO_WAVE } from '$lib/config';
import { dateCompare, naturalCompare, waveCompare } from '$lib/util/natural';
import type { Mode, Submission } from '$lib/types';

/* ------------------------------------------------------------------ tree */

export interface ModelNode {
	model: string;
	count: number;
	submissions: Submission[];
}

export interface ScenarioNode {
	code: string;
	label: string;
	full: string;
	count: number;
	models: ModelNode[];
}

export interface WaveNode {
	wave: string;
	count: number;
	scenarios: ScenarioNode[];
}

export interface CompetitionNode {
	slug: string;
	name: string;
	count: number;
	waves: WaveNode[];
}

export type VaultTree = CompetitionNode[];

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const out = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const bucket = out.get(k);
		if (bucket) bucket.push(item);
		else out.set(k, [item]);
	}
	return out;
}

/**
 * Competition -> Wave -> Scenario -> Model -> Submission, sorted exactly as
 * PRD §3 specifies. Every count here is derived, never stored.
 */
export function buildTree(submissions: readonly Submission[]): VaultTree {
	const byCompetition = groupBy(submissions, (s) => s.competition.slug);

	const competitions: CompetitionNode[] = [...byCompetition.entries()].map(([slug, comp]) => {
		const byWave = groupBy(comp, (s) => s.wave);

		const waves: WaveNode[] = [...byWave.entries()].map(([wave, waveSubs]) => {
			const byScenario = groupBy(waveSubs, (s) => s.scenario.code);

			const scenarios: ScenarioNode[] = [...byScenario.entries()].map(([code, scenarioSubs]) => {
				const byModel = groupBy(scenarioSubs, (s) => s.model);

				const models: ModelNode[] = [...byModel.entries()]
					.map(([model, modelSubs]) => ({
						model,
						count: modelSubs.length,
						submissions: [...modelSubs].sort((a, b) => dateCompare(a.createdAt, b.createdAt))
					}))
					// Break count desc, then name — the most-broken model reads first.
					.sort((a, b) => b.count - a.count || naturalCompare(a.model, b.model));

				const first = scenarioSubs[0];
				return {
					code,
					label: first ? first.scenario.label : EMPTY_VALUE,
					full: first ? first.scenario.full : code,
					count: scenarioSubs.length,
					models
				};
			});

			scenarios.sort((a, b) => naturalCompare(a.code, b.code) || naturalCompare(a.label, b.label));
			return { wave, count: waveSubs.length, scenarios };
		});

		waves.sort((a, b) => waveCompare(a.wave, b.wave));
		const first = comp[0];
		return {
			slug,
			name: first ? first.competition.name : slug,
			count: comp.length,
			waves
		};
	});

	competitions.sort((a, b) => naturalCompare(a.name, b.name));
	return competitions;
}

/** Tree order, flattened — the canonical order for the submission list and PDF. */
export function flattenTree(tree: VaultTree): Submission[] {
	const out: Submission[] = [];
	for (const comp of tree) {
		for (const wave of comp.waves) {
			for (const scenario of wave.scenarios) {
				for (const model of scenario.models) out.push(...model.submissions);
			}
		}
	}
	return out;
}

export function sortSubmissions(submissions: readonly Submission[]): Submission[] {
	return flattenTree(buildTree(submissions));
}

/* ----------------------------------------------------------------- stats */

export interface Tally {
	key: string;
	label: string;
	count: number;
}

export interface Matrix {
	/** Row headers, in tree order. */
	scenarios: { code: string; label: string; wave: string }[];
	/** Column headers, most-broken first. */
	models: string[];
	/** `cells[row][col]` = break count. */
	cells: number[][];
	max: number;
}

export interface TimelinePoint {
	/** `YYYY-MM-DD` */
	date: string;
	count: number;
}

export interface VaultStats {
	total: number;
	competitions: number;
	/** Distinct waves, excluding the "no wave" bucket — `—` is not a wave. */
	waves: number;
	scenarios: number;
	models: number;
	perModel: Tally[];
	perScenario: Tally[];
	matrix: Matrix;
	timeline: TimelinePoint[];
	dateRange: { from: string; to: string } | null;
}

function dayOf(iso: string): string | null {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return null;
	return new Date(t).toISOString().slice(0, 10);
}

export function computeStats(submissions: readonly Submission[]): VaultStats {
	const tree = buildTree(submissions);
	const ordered = flattenTree(tree);

	const competitions = new Set<string>();
	const waves = new Set<string>();
	const scenarioKeys = new Set<string>();
	const modelCounts = new Map<string, number>();
	const scenarioCounts = new Map<string, { label: string; count: number }>();
	const dayCounts = new Map<string, number>();

	for (const s of ordered) {
		competitions.add(s.competition.slug);
		if (s.wave !== NO_WAVE) waves.add(`${s.competition.slug}::${s.wave}`);
		scenarioKeys.add(`${s.competition.slug}::${s.scenario.code}`);
		modelCounts.set(s.model, (modelCounts.get(s.model) ?? 0) + 1);
		const prior = scenarioCounts.get(s.scenario.code);
		scenarioCounts.set(s.scenario.code, {
			label: s.scenario.label,
			count: (prior?.count ?? 0) + 1
		});
		const day = dayOf(s.createdAt);
		if (day !== null) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
	}

	const perModel: Tally[] = [...modelCounts.entries()]
		.map(([model, count]) => ({ key: model, label: model, count }))
		.sort((a, b) => b.count - a.count || naturalCompare(a.key, b.key));

	const perScenario: Tally[] = [...scenarioCounts.entries()]
		.map(([code, { label, count }]) => ({ key: code, label, count }))
		.sort((a, b) => b.count - a.count || naturalCompare(a.key, b.key));

	const timeline: TimelinePoint[] = [...dayCounts.entries()]
		.map(([date, count]) => ({ date, count }))
		.sort((a, b) => naturalCompare(a.date, b.date));

	const dates = ordered.map((s) => s.createdAt).filter((d) => !Number.isNaN(Date.parse(d)));
	dates.sort(dateCompare);
	const from = dates[0];
	const to = dates[dates.length - 1];

	return {
		total: ordered.length,
		competitions: competitions.size,
		waves: waves.size,
		scenarios: scenarioKeys.size,
		models: modelCounts.size,
		perModel,
		perScenario,
		matrix: buildMatrix(tree, perModel),
		timeline,
		dateRange: from !== undefined && to !== undefined ? { from, to } : null
	};
}

/** Rows in tree order, columns most-broken first (PRD §4.3). */
export function buildMatrix(tree: VaultTree, perModel: readonly Tally[]): Matrix {
	const scenarios: Matrix['scenarios'] = [];
	const rowCounts: Map<string, number>[] = [];

	for (const comp of tree) {
		for (const wave of comp.waves) {
			for (const scenario of wave.scenarios) {
				const counts = new Map<string, number>();
				for (const model of scenario.models) counts.set(model.model, model.count);
				scenarios.push({ code: scenario.code, label: scenario.label, wave: wave.wave });
				rowCounts.push(counts);
			}
		}
	}

	const models = perModel.map((m) => m.key);
	let max = 0;
	const cells = rowCounts.map((counts) =>
		models.map((model) => {
			const value = counts.get(model) ?? 0;
			if (value > max) max = value;
			return value;
		})
	);

	return { scenarios, models, cells, max };
}

/* ---------------------------------------------------------------- filter */

export interface Filter {
	/** Competition slug. */
	competition: string | null;
	wave: string | null;
	scenarioCode: string | null;
	model: string | null;
	mode: Mode | null;
	query: string;
}

export function emptyFilter(): Filter {
	return { competition: null, wave: null, scenarioCode: null, model: null, mode: null, query: '' };
}

export function isFilterActive(filter: Filter): boolean {
	return (
		filter.competition !== null ||
		filter.wave !== null ||
		filter.scenarioCode !== null ||
		filter.model !== null ||
		filter.mode !== null ||
		filter.query.trim() !== ''
	);
}

/** Everything the global search looks at: scenario, model, task, payload text. */
function searchCorpus(s: Submission): string {
	return [
		s.scenario.full,
		s.scenario.code,
		s.scenario.label,
		s.model,
		s.competition.name,
		s.wave,
		s.initialTask,
		...s.payloadSlots.map((slot) => slot.raw)
	]
		.join('\n')
		.toLowerCase();
}

export function matchesQuery(s: Submission, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (q === '') return true;
	// Every whitespace-separated term must appear somewhere.
	const corpus = searchCorpus(s);
	return q.split(/\s+/).every((term) => corpus.includes(term));
}

export function applyFilter(submissions: readonly Submission[], filter: Filter): Submission[] {
	return submissions.filter((s) => {
		if (filter.competition !== null && s.competition.slug !== filter.competition) return false;
		if (filter.wave !== null && s.wave !== filter.wave) return false;
		if (filter.scenarioCode !== null && s.scenario.code !== filter.scenarioCode) return false;
		if (filter.model !== null && s.model !== filter.model) return false;
		if (filter.mode !== null && s.mode !== filter.mode) return false;
		return matchesQuery(s, filter.query);
	});
}

/** Short human description of the active filter, for export filenames and the PDF. */
export function describeFilter(filter: Filter, tree: VaultTree): string {
	const parts: string[] = [];
	if (filter.competition !== null) {
		parts.push(tree.find((c) => c.slug === filter.competition)?.name ?? filter.competition);
	}
	if (filter.wave !== null) parts.push(`wave ${filter.wave}`);
	if (filter.scenarioCode !== null) parts.push(filter.scenarioCode);
	if (filter.model !== null) parts.push(filter.model);
	if (filter.mode !== null) parts.push(`${filter.mode}-turn`);
	if (filter.query.trim() !== '') parts.push(`"${filter.query.trim()}"`);
	return parts.length === 0 ? 'all submissions' : parts.join(' · ');
}
