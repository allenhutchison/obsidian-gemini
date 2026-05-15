import { ChatTimer } from '../../src/utils/timer-utils';

describe('ChatTimer', () => {
	let timer: ChatTimer;

	beforeEach(() => {
		vi.useFakeTimers();
		timer = new ChatTimer();
	});

	afterEach(() => {
		timer.destroy();
		vi.useRealTimers();
	});

	describe('start', () => {
		it('should set up the timer and update display immediately', () => {
			const el = document.createElement('span');
			timer.start(el);

			expect(timer.isRunning()).toBe(true);
			expect(el.textContent).toBe('0.0s');
		});

		it('should update the display periodically', () => {
			const el = document.createElement('span');
			timer.start(el);

			vi.advanceTimersByTime(500);
			// After 500ms the display should show ~0.5s
			expect(el.textContent).toBe('0.5s');

			vi.advanceTimersByTime(1500);
			// After 2000ms total
			expect(el.textContent).toBe('2.0s');
		});

		it('should clean up any previous timer when start is called again', () => {
			const el1 = document.createElement('span');
			const el2 = document.createElement('span');

			timer.start(el1);
			vi.advanceTimersByTime(300);
			// Start a new timer — the old one should be stopped
			timer.start(el2);

			expect(timer.isRunning()).toBe(true);
			// el2 should show 0.0s (just started)
			expect(el2.textContent).toBe('0.0s');
		});
	});

	describe('stop', () => {
		it('should stop the timer and clear state', () => {
			const el = document.createElement('span');
			timer.start(el);
			timer.stop();

			expect(timer.isRunning()).toBe(false);
			expect(timer.getElapsedTime()).toBe(0);
		});

		it('should be safe to call stop when not running', () => {
			expect(() => timer.stop()).not.toThrow();
			expect(timer.isRunning()).toBe(false);
		});

		it('should not update display after stop', () => {
			const el = document.createElement('span');
			timer.start(el);
			vi.advanceTimersByTime(200);
			timer.stop();

			const textAfterStop = el.textContent;
			vi.advanceTimersByTime(500);
			// Text should not change after stop
			expect(el.textContent).toBe(textAfterStop);
		});
	});

	describe('isRunning', () => {
		it('should return false before start', () => {
			expect(timer.isRunning()).toBe(false);
		});

		it('should return true while running', () => {
			const el = document.createElement('span');
			timer.start(el);
			expect(timer.isRunning()).toBe(true);
		});

		it('should return false after stop', () => {
			const el = document.createElement('span');
			timer.start(el);
			timer.stop();
			expect(timer.isRunning()).toBe(false);
		});
	});

	describe('getElapsedTime', () => {
		it('should return 0 when not started', () => {
			expect(timer.getElapsedTime()).toBe(0);
		});

		it('should return elapsed time in seconds', () => {
			const el = document.createElement('span');
			timer.start(el);

			vi.advanceTimersByTime(2500);
			expect(timer.getElapsedTime()).toBe(2.5);
		});
	});

	describe('destroy', () => {
		it('should stop the timer', () => {
			const el = document.createElement('span');
			timer.start(el);
			timer.destroy();

			expect(timer.isRunning()).toBe(false);
		});
	});
});
