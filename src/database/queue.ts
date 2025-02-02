export class DatabaseQueue {
	private dbQueue: { operation: () => Promise<any>; name: string }[] = [];
	private isProcessingQueue = false;
	private lastProcessingStartTime: number | null = null;
	private readonly QUEUE_TIMEOUT = 5000;
	private operationId = 0;

	async enqueue<T>(operation: () => Promise<T>, name?: string): Promise<T> {
		const operationName = name || operation.name || 'anonymous';
		return new Promise<T>((resolve, reject) => {
			const wrappedOperation = async () => {
				try {
					const result = await operation();
					resolve(result);
					return result;
				} catch (error) {
					reject(error);
					throw error;
				}
			};
			this.dbQueue.push({ operation: wrappedOperation, name: operationName });
			void this.processQueue();
		});
	}

	private async processQueue() {
		if (this.isProcessingQueue) {
			if (this.lastProcessingStartTime && Date.now() - this.lastProcessingStartTime > this.QUEUE_TIMEOUT) {
				this.isProcessingQueue = false;
			} else {
				return;
			}
		}

		this.isProcessingQueue = true;
		this.lastProcessingStartTime = Date.now();

		try {
			while (this.dbQueue.length > 0) {
				const opId = ++this.operationId;
				const queueItem = this.dbQueue.shift();
				if (!queueItem) continue;

				//console.debug(`[Queue] Starting operation ${opId}: ${queueItem.name}`);
				const startTime = Date.now();

				try {
					const result = await queueItem.operation();
					//console.debug(`[Queue] Completed operation ${opId}: ${queueItem.name} in ${Date.now() - startTime}ms`);
					await new Promise((resolve) => setTimeout(resolve, 0)); // Ensure next tick
				} catch (error) {
					console.error(`[Queue] Operation ${opId}: ${queueItem.name} failed:`, error);
					throw error;
				}
			}
		} finally {
			this.isProcessingQueue = false;
			this.lastProcessingStartTime = null;
		}
	}
}
