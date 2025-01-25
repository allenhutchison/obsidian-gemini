import { MarkdownRenderer, TFile } from 'obsidian';
import { getDataViewAPI } from './dataview-utils';

export async function getLinksFromDataviewBlocks(file: TFile): Promise<{ link: string }[]> {
    iterateCodeblocksInFile(file, (cb) => {
        if (cb.language === "dataview") {
            // Process the Dataview query here
            console.info("DATA VIEW BLOCK FOUND");
            console.info(cb.text); 
            evaluateDataviewQuery(cb.text, file);
        }
    });

    return [];
}

export async function getLinksFromBlock(block: string): Promise<{ link: string }[]> {
    const dvApi = getDataViewAPI();
    if (!dvApi) {
        return [];
    }
    const result = await dvApi.evaluate(block);
    console.info(result);
    return [];
}

async function evaluateDataviewQuery(query: string, file: TFile) {
    const dvApi = getDataViewAPI();
    if (dvApi) {
      try {
        const result = await dvApi.query(query, file.path);
        console.info(result);
        console.info(result.value.type);
        if (result.value.type === "list") {
            console.info("Found a list");
          result.value.values.forEach(value => {
            // Assuming the list contains file names
            if (typeof value === "string") {
              // Create an Obsidian link for the file
              const linkText = `[[${value}]]`;
              MarkdownRenderer.renderMarkdown(
                linkText,
                document.createElement("div"),
                file.path,
                null
              );
              console.info(linkText);
            }
          });
        }
      } catch (error) {
        // Handle errors
        console.error("Error evaluating Dataview query:", error);
      }
    }
  }

async function iterateCodeblocksInFile(file: TFile, callback: (cb: { start: number, end: number, text: string, language: string }) => void) {
    const fileContent = await this.app.vault.read(file);
    const lines = fileContent.split("\n");
  
    let codeblock: { start: number, end: number, text: string, language: string } | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("```")) {
        if (codeblock) {
          // End of previous codeblock
          callback(codeblock);
          codeblock = null;
        } else {
          // Start of new codeblock
          const language = line.substring(3).trim(); // Extract language
          codeblock = {
            start: i,
            end: -1, // Will be updated when the codeblock ends
            text: "",
            language,
          };
        }
      } else if (codeblock) {
        codeblock.text += line + "\n";
      }
    }
  
    // If the last codeblock wasn't closed, process it
    if (codeblock) {
      codeblock.end = lines.length - 1;
      callback(codeblock);
    }
  }