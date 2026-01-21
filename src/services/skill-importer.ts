import { TFile, normalizePath, Notice, TFolder } from 'obsidian';
import type ObsidianGemini from '../main';
import * as fs from 'fs';
import * as path from 'path';

export class SkillImporter {
    private plugin: InstanceType<typeof ObsidianGemini>;

    constructor(plugin: InstanceType<typeof ObsidianGemini>) {
        this.plugin = plugin;
    }

    /**
     * Import skills from the configured external directory
     */
    async importSkills(): Promise<void> {
        const sourcePath = this.plugin.settings.skillsFolderPath;

        if (!sourcePath) {
            new Notice('Please configure Skills Folder Path in settings first.');
            return;
        }

        // Check if source path exists (using Node's fs for external paths)
        if (!fs.existsSync(sourcePath)) {
            new Notice(`Skills folder not found: ${sourcePath}`);
            return;
        }

        // Ensure target Prompts directory exists
        await this.plugin.promptManager.ensurePromptsDirectory();
        const targetDir = this.plugin.promptManager.getPromptsDirectory();

        try {
            // Find all SKILL.md files recursively
            const skillFiles = this.findSkillFiles(sourcePath);

            if (skillFiles.length === 0) {
                new Notice('No SKILL.md files found in the specified folder.');
                return;
            }

            let importedCount = 0;
            let updatedCount = 0;

            for (const skillFile of skillFiles) {
                const content = fs.readFileSync(skillFile, 'utf8');
                const skillName = this.extractSkillName(content);

                if (!skillName) {
                    this.plugin.logger.warn(`Could not determine name for skill at ${skillFile}`);
                    continue;
                }

                // Format: Skill-[Name].md
                // Sanitize name for filename
                const safeName = skillName.replace(/[^a-zA-Z0-9-]/g, '-');
                const targetFilename = `Skill-${safeName}.md`;
                const targetPath = normalizePath(`${targetDir}/${targetFilename}`);

                // Check if file exists in vault
                const existingFile = this.plugin.app.vault.getAbstractFileByPath(targetPath);

                if (existingFile instanceof TFile) {
                    // Update existing
                    await this.plugin.app.vault.modify(existingFile, content);
                    updatedCount++;
                } else {
                    // Create new
                    await this.plugin.app.vault.create(targetPath, content);
                    importedCount++;
                }
            }

            new Notice(`Skills Import: ${importedCount} created, ${updatedCount} updated.`);

        } catch (error) {
            this.plugin.logger.error('Failed to import skills:', error);
            new Notice(`Failed to import skills: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Recursively find all SKILL.md files
     */
    private findSkillFiles(dir: string): string[] {
        let results: string[] = [];

        try {
            const list = fs.readdirSync(dir);

            for (const file of list) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);

                if (stat && stat.isDirectory()) {
                    // Recursively search directories
                    results = results.concat(this.findSkillFiles(filePath));
                } else {
                    // Check for SKILL.md (case insensitive)
                    if (file.toLowerCase() === 'skill.md') {
                        results.push(filePath);
                    }
                }
            }
        } catch (error) {
            this.plugin.logger.error(`Error scanning directory ${dir}:`, error);
        }

        return results;
    }

    /**
     * Extract name from frontmatter
     */
    private extractSkillName(content: string): string | null {
        // Look for name: value in frontmatter
        const match = content.match(/^---\s*[\s\S]*?name:\s*(.*?)\s*[\r\n]/m);
        if (match && match[1]) {
            // Remove quotes if present
            return match[1].replace(/^["']|["']$/g, '').trim();
        }
        return null;
    }
}
