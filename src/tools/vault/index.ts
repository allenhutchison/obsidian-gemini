import { Tool } from '../types';
import { ReadFileTool } from './read-file-tool';
import { WriteFileTool } from './write-file-tool';
import { ListFilesTool } from './list-files-tool';
import { CreateFolderTool } from './create-folder-tool';
import { DeleteFileTool } from './delete-file-tool';
import { MoveFileTool } from './move-file-tool';
import { SearchFilesTool } from './search-files-tool';
import { SearchFileContentsTool } from './search-file-contents-tool';
import { GetWorkspaceStateTool } from './get-workspace-state-tool';

export { ReadFileTool } from './read-file-tool';
export { WriteFileTool } from './write-file-tool';
export { ListFilesTool } from './list-files-tool';
export { CreateFolderTool } from './create-folder-tool';
export { DeleteFileTool } from './delete-file-tool';
export { MoveFileTool } from './move-file-tool';
export { SearchFilesTool } from './search-files-tool';
export { SearchFileContentsTool } from './search-file-contents-tool';
export { GetWorkspaceStateTool } from './get-workspace-state-tool';

/**
 * Get all available vault tools
 */
export function getVaultTools(): Tool[] {
	return [
		new ReadFileTool(),
		new WriteFileTool(),
		new ListFilesTool(),
		new CreateFolderTool(),
		new DeleteFileTool(),
		new MoveFileTool(),
		new SearchFilesTool(),
		new SearchFileContentsTool(),
		new GetWorkspaceStateTool(),
	];
}
