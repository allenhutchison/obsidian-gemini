import { DatabaseExporter } from './export';

export class PeriodicExport {
	private intervalId: NodeJS.Timeout | null = null;
	private readonly EXPORT_INTERVAL = 5 * 60 * 1000; // 5 minutes

	constructor(private exporter: DatabaseExporter) {
		//console.debug('Periodic export initialized');
	}

	start() {
		if (this.intervalId) {
			//console.debug('Periodic export already running');
			return;
		}

		//console.debug(`Starting periodic export (interval: ${this.EXPORT_INTERVAL}ms)`);

		// Initial export
		//console.debug('Running initial export');
		void this.exporter.exportDatabaseToVault();

		// Set up periodic export
		this.intervalId = setInterval(() => {
			//console.debug('Running scheduled export');
			void this.exporter.exportDatabaseToVault();
		}, this.EXPORT_INTERVAL);
	}

	stop() {
		if (this.intervalId) {
			//console.debug('Stopping periodic export');
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}
}
