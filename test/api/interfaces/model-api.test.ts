import { isExtendedRequest, BaseModelRequest, ExtendedModelRequest } from '../../../src/api/interfaces/model-api';

describe('isExtendedRequest', () => {
	it('classifies a base request by its kind discriminant', () => {
		const request: BaseModelRequest = { kind: 'base', prompt: 'one-shot prompt' };
		expect(isExtendedRequest(request)).toBe(false);
	});

	it('classifies an extended request by its kind discriminant', () => {
		const request: ExtendedModelRequest = {
			kind: 'extended',
			prompt: '',
			userMessage: 'hello',
			conversationHistory: [],
		};
		expect(isExtendedRequest(request)).toBe(true);
	});

	it('treats an extended request with an empty userMessage as extended (#859 regression)', () => {
		// The previous `'userMessage' in request` heuristic misclassified any
		// request carrying a userMessage key — even an empty string — and, on the
		// flip side, a base request with a stray empty userMessage was wrongly
		// routed through the extended path. The kind discriminant is authoritative,
		// so an empty userMessage no longer flips the branch either way.
		const followUp: ExtendedModelRequest = {
			kind: 'extended',
			prompt: '',
			userMessage: '',
			conversationHistory: [{ role: 'user', parts: [{ text: 'earlier turn' }] }],
		};
		expect(isExtendedRequest(followUp)).toBe(true);
	});
});
