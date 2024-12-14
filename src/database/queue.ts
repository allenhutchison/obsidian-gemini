export class DatabaseQueue {
    private dbQueue: (() => Promise<any>)[] = [];
    private isProcessingQueue = false;
    private lastProcessingStartTime: number | null = null;
    private readonly QUEUE_TIMEOUT = 5000;
    private operationId = 0;

    async enqueue<T>(operation: () => Promise<T>): Promise<T> {
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
            this.dbQueue.push(wrappedOperation);
            void this.processQueue();
        });
    }

    private async processQueue() {
        if (this.isProcessingQueue) {
            if (this.lastProcessingStartTime && 
                Date.now() - this.lastProcessingStartTime > this.QUEUE_TIMEOUT) {
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
                const operation = this.dbQueue.shift();
                if (!operation) continue;
                await operation();
            }
        } finally {
            this.isProcessingQueue = false;
            this.lastProcessingStartTime = null;
        }
    }
}