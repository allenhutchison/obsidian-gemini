import { App, TFile, Notice } from "obsidian";

export async function updateFrontmatter(app: App, file: TFile, newFrontmatter: any) {
    if (!file) {
        console.error("No active file.");
        return;
    }

    try {
        const originalContent = await app.vault.read(file);
        const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/; // Matches frontmatter block
        const existingFrontmatterMatch = originalContent.match(frontmatterRegex);
        let updatedContent;

        if (existingFrontmatterMatch) {  // Existing frontmatter
            const existingFrontmatter = existingFrontmatterMatch[1]; //Extract existing frontmatter
            const updatedFrontmatter = this.mergeFrontmatter(existingFrontmatter, newFrontmatter);

            updatedContent = originalContent.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---\n`);
        } else {  //No frontmatter exists yet, prepend to the file
            const newFrontmatterString = `---\n${this.stringifyFrontmatter(newFrontmatter)}\n---\n`;
            updatedContent = `${newFrontmatterString}${originalContent}`;
        }
        await app.vault.modify(file, updatedContent); // Write the updated content
        new Notice("Frontmatter updated successfully!"); //Give some sort of confirmation
    } catch (error) {
        console.error("Error updating frontmatter:", error);
        new Notice("Error updating frontmatter. See console for details.");
    }
}

//Helper function to merge frontmatter
function mergeFrontmatter(existingFrontmatter: string, newFrontmatter: any): string {
  const existing = this.parseFrontmatter(existingFrontmatter);

  const merged = { ...existing, ...newFrontmatter };  // Merge, with newFrontmatter overwriting existing keys
  return this.stringifyFrontmatter(merged); // Stringify using YAML or preferred format
}


// Helper function to stringify frontmatter (YAML)
function stringifyFrontmatter(frontmatter: any): string {
    let fmString = "";
  for (const key in frontmatter) {
    fmString += `${key}: ${frontmatter[key]}\n`;
  }
    return fmString;
}

// Helper function to parse frontmatter (YAML)
function parseFrontmatter(frontmatterString: string): any {
    const lines = frontmatterString.split('\n');
    let frontmatter = {};
    for (let line of lines) {
        line = line.trim();
        if (line !== "") { // ignore empty lines
            const parts = line.split(':');
            if (parts.length >= 2) { //At least 2 parts make a valid frontmatter entry
                const key = parts[0].trim();
                const value = parts.slice(1).join(':').trim(); //handle edge cases where : are in values
                frontmatter[key] = value;
            }
        }
    }
  return frontmatter;
}