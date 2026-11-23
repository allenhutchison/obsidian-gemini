import { IndexRunProgress } from '../../src/services/rag-run-progress';

// #1703: one holder owns an indexing run's progress, with named reset policies.
describe('IndexRunProgress', () => {
	function populated(): IndexRunProgress {
		const p = new IndexRunProgress();
		p.reset(1000);
		p.setProgress({ current: 3, total: 10 });
		p.recordIndexed('a.md');
		p.recordSkipped('b.md');
		p.recordFailure({ path: 'c.md', error: 'boom', timestamp: 1 });
		p.recordFailure();
		return p;
	}

	test('starts empty', () => {
		expect(new IndexRunProgress().snapshot()).toEqual({
			progress: { current: 0, total: 0 },
			currentFile: undefined,
			startTime: undefined,
			indexed: 0,
			skipped: 0,
			failed: 0,
			failedFiles: [],
		});
	});

	test('record methods accumulate and track the current file', () => {
		const snap = populated().snapshot();
		expect(snap.indexed).toBe(1);
		expect(snap.skipped).toBe(1);
		expect(snap.failed).toBe(2);
		expect(snap.failedFiles).toEqual([{ path: 'c.md', error: 'boom', timestamp: 1 }]);
		expect(snap.currentFile).toBe('b.md');
		expect(snap.startTime).toBe(1000);
		expect(snap.progress).toEqual({ current: 3, total: 10 });
	});

	test('reset() clears everything, and reset(startTime) stamps the new run', () => {
		const p = populated();
		p.reset(2000);
		expect(p.snapshot()).toMatchObject({ indexed: 0, skipped: 0, failed: 0, failedFiles: [], startTime: 2000 });
		expect(p.getProgress()).toEqual({ current: 0, total: 0 });
		p.reset();
		expect(p.snapshot().startTime).toBeUndefined();
	});

	test("a second run after a finished one reports only that run's counts", () => {
		const p = populated();
		p.finishRun();
		p.reset(3000);
		p.recordIndexed('d.md');
		expect(p.snapshot()).toMatchObject({ indexed: 1, skipped: 0, failed: 0, failedFiles: [] });
	});

	test('finishRun() clears the current file and start time but keeps the totals', () => {
		const p = populated();
		p.finishRun();
		const snap = p.snapshot();
		expect(snap.currentFile).toBeUndefined();
		expect(snap.startTime).toBeUndefined();
		expect(snap).toMatchObject({ indexed: 1, skipped: 1, failed: 2 });
		expect(snap.progress).toEqual({ current: 3, total: 10 });
	});

	test('snapshot() is a copy', () => {
		const p = populated();
		const snap = p.snapshot();
		snap.failedFiles.push({ path: 'x', error: 'y', timestamp: 0 });
		snap.progress.current = 99;
		expect(p.snapshot().failedFiles).toHaveLength(1);
		expect(p.getProgress().current).toBe(3);
	});

	test('counts() matches the snapshot without the failure list', () => {
		const p = populated();
		const { failedFiles, ...rest } = p.snapshot();
		expect(failedFiles).toHaveLength(1);
		const counts = p.counts();
		expect(counts).toEqual(rest);
		expect('failedFiles' in counts).toBe(false);
	});
});
