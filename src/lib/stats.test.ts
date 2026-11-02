import { describe, expect, it } from 'vitest';
import { NO_WAVE } from '$lib/config';
import {
	applyFilter,
	buildTree,
	computeStats,
	describeFilter,
	emptyFilter,
	flattenTree,
	matchesQuery
} from '$lib/stats';
import { synth } from '$lib/testing/make';

const submissions = [
	synth({ chatId: 'a', scenario: 'WB10S1 - Late Wave', model: 'Zeta', createdAt: '2026-10-22T10:00:00.000Z' }),
	synth({ chatId: 'b', scenario: 'WB2S1 - Refund', model: 'Alpha', createdAt: '2026-10-20T10:00:00.000Z' }),
	synth({ chatId: 'c', scenario: 'WB2S1 - Refund', model: 'Alpha', createdAt: '2026-10-21T10:00:00.000Z' }),
	synth({ chatId: 'd', scenario: 'WB2S1 - Refund', model: 'Beta', createdAt: '2026-10-20T11:00:00.000Z' }),
	synth({ chatId: 'e', scenario: 'FREEFORM - No Wave', model: 'Beta', createdAt: '2026-10-23T10:00:00.000Z' }),
	synth({
		chatId: 'f',
		slug: 'agent-red-2026',
		name: 'Agent Red',
		scenario: 'WA1S1 - Other Comp',
		model: 'Alpha',
		createdAt: '2026-10-19T10:00:00.000Z'
	})
];

describe('buildTree', () => {
	const tree = buildTree(submissions);

	it('sorts competitions by display name', () => {
		expect(tree.map((c) => c.name)).toEqual(['Agent Red', 'Indirect Prompt Injection: Black']);
	});

	it('sorts waves naturally with no-wave last', () => {
		const ipi = tree[1];
		expect(ipi.waves.map((w) => w.wave)).toEqual(['B2', 'B10', NO_WAVE]);
	});

	it('sorts models by break count then name', () => {
		const refund = tree[1].waves[0].scenarios[0];
		expect(refund.code).toBe('WB2S1');
		expect(refund.models.map((m) => `${m.model}:${m.count}`)).toEqual(['Alpha:2', 'Beta:1']);
	});

	it('sorts submissions inside a model by createdAt ascending', () => {
		const alpha = tree[1].waves[0].scenarios[0].models[0];
		expect(alpha.submissions.map((s) => s.id)).toEqual(['b', 'c']);
	});

	it('carries counts at every level', () => {
		expect(tree.map((c) => c.count)).toEqual([1, 5]);
		expect(tree[1].waves.map((w) => w.count)).toEqual([3, 1, 1]);
	});

	it('flattens in hierarchy order', () => {
		expect(flattenTree(tree).map((s) => s.id)).toEqual(['f', 'b', 'c', 'd', 'a', 'e']);
	});
});

describe('computeStats', () => {
	const stats = computeStats(submissions);

	it('counts the stat strip', () => {
		expect(stats.total).toBe(6);
		expect(stats.competitions).toBe(2);
		expect(stats.scenarios).toBe(4);
		expect(stats.models).toBe(3);
		// B2, B10, A1 — the no-wave bucket is not a wave.
		expect(stats.waves).toBe(3);
	});

	it('tallies per model, most broken first', () => {
		expect(stats.perModel.map((m) => `${m.key}:${m.count}`)).toEqual(['Alpha:3', 'Beta:2', 'Zeta:1']);
	});

	it('tallies per scenario, most broken first', () => {
		expect(stats.perScenario[0]).toMatchObject({ key: 'WB2S1', count: 3 });
	});

	it('builds the scenario x model matrix in tree order', () => {
		expect(stats.matrix.models).toEqual(['Alpha', 'Beta', 'Zeta']);
		expect(stats.matrix.scenarios.map((s) => s.code)).toEqual([
			'WA1S1',
			'WB2S1',
			'WB10S1',
			'FREEFORM'
		]);
		expect(stats.matrix.cells).toEqual([
			[1, 0, 0],
			[2, 1, 0],
			[0, 0, 1],
			[0, 1, 0]
		]);
		expect(stats.matrix.max).toBe(2);
	});

	it('builds an ascending timeline and date range', () => {
		expect(stats.timeline).toEqual([
			{ date: '2026-10-19', count: 1 },
			{ date: '2026-10-20', count: 2 },
			{ date: '2026-10-21', count: 1 },
			{ date: '2026-10-22', count: 1 },
			{ date: '2026-10-23', count: 1 }
		]);
		expect(stats.dateRange).toEqual({
			from: '2026-10-19T10:00:00.000Z',
			to: '2026-10-23T10:00:00.000Z'
		});
	});

	it('handles an empty vault', () => {
		const empty = computeStats([]);
		expect(empty.total).toBe(0);
		expect(empty.dateRange).toBeNull();
		expect(empty.matrix.cells).toEqual([]);
		expect(empty.matrix.max).toBe(0);
	});
});

describe('filter and search', () => {
	it('matches on scenario, model, task and payload text', () => {
		const s = submissions[1];
		expect(matchesQuery(s, 'refund')).toBe(true);
		expect(matchesQuery(s, 'alpha')).toBe(true);
		expect(matchesQuery(s, 'benign')).toBe(true);
		expect(matchesQuery(s, 'attacker')).toBe(true);
		expect(matchesQuery(s, 'nonsense')).toBe(false);
	});

	it('requires every search term to match', () => {
		const s = submissions[1];
		expect(matchesQuery(s, 'refund alpha')).toBe(true);
		expect(matchesQuery(s, 'refund zeta')).toBe(false);
	});

	it('narrows by chips', () => {
		const byComp = applyFilter(submissions, { ...emptyFilter(), competition: 'agent-red-2026' });
		expect(byComp.map((s) => s.id)).toEqual(['f']);

		const byWave = applyFilter(submissions, { ...emptyFilter(), wave: 'B2' });
		expect(byWave.map((s) => s.id).sort()).toEqual(['b', 'c', 'd']);

		const byModel = applyFilter(submissions, { ...emptyFilter(), model: 'Beta' });
		expect(byModel.map((s) => s.id).sort()).toEqual(['d', 'e']);

		const byCell = applyFilter(submissions, {
			...emptyFilter(),
			scenarioCode: 'WB2S1',
			model: 'Alpha'
		});
		expect(byCell.map((s) => s.id).sort()).toEqual(['b', 'c']);
	});

	it('narrows by mode', () => {
		const mixed = [...submissions, synth({ chatId: 'multi' }, 'multi')];
		expect(applyFilter(mixed, { ...emptyFilter(), mode: 'multi' }).map((s) => s.id)).toEqual(['multi']);
	});

	it('describes the active filter', () => {
		const tree = buildTree(submissions);
		expect(describeFilter(emptyFilter(), tree)).toBe('all submissions');
		expect(describeFilter({ ...emptyFilter(), competition: 'agent-red-2026', wave: 'A1' }, tree)).toBe(
			'Agent Red · wave A1'
		);
	});
});
