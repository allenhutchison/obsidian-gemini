import { DatabaseExporter } from "./export";

export class PeriodicExport {
    private intervalId: NodeJS.Timeout | null = null;
    private readonly EXPORT_INTERVAL = 5 * 60 * 1000; // 5 minutes

    constructor(private exporter: DatabaseExporter) {}

    start() {
        if (this.intervalId) return;
        
        // Initial export
        void this.exporter.exportDatabaseToVault();
        
        // Set up periodic export
        this.intervalId = setInterval(() => {
            void this.exporter.exportDatabaseToVault();
        }, this.EXPORT_INTERVAL);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}