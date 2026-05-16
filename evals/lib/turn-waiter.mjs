/**
 * Wait for an agent turn to reach a terminal event in the eval collector.
 *
 * The eval harness intentionally dispatches the message with a short-lived
 * `obsidian eval` call, then observes progress via the collector. Keeping the
 * CLI child open for the full model turn made long sweeps vulnerable to CLI
 * bridge hangs even after the plugin had emitted `turnEnd`.
 */

const TERMINAL_EVENTS = new Set(['turnEnd', 'turnError']);

function defaultSleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object[]} events
 * @returns {boolean}
 */
export function hasTerminalTurnEvent(events) {
	return (events || []).some((event) => TERMINAL_EVENTS.has(event?.event));
}

/**
 * @param {object} opts
 * @param {() => Promise<object[]>} opts.peekEvents
 * @param {number} opts.timeoutMs
 * @param {number} opts.pollIntervalMs
 * @param {(events: object[]) => void|Promise<void>} [opts.onPoll]
 * @param {(error: Error) => void|Promise<void>} [opts.onPollError]
 * @param {() => number} [opts.now]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @returns {Promise<{ completed: boolean, events: object[] }>}
 */
export async function waitForTurnCompletion({
	peekEvents,
	timeoutMs,
	pollIntervalMs,
	onPoll = async () => {},
	onPollError = async () => {},
	now = Date.now,
	sleep = defaultSleep,
}) {
	const deadline = now() + timeoutMs;
	let lastEvents = [];

	while (true) {
		try {
			const events = await peekEvents();
			lastEvents = events;
			await onPoll(events);
			if (hasTerminalTurnEvent(events)) {
				return { completed: true, events };
			}
		} catch (err) {
			await onPollError(err);
		}

		const remainingMs = deadline - now();
		if (remainingMs <= 0) {
			return { completed: false, events: lastEvents };
		}
		await sleep(Math.min(pollIntervalMs, remainingMs));
	}
}
