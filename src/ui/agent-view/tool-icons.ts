/**
 * Tool-name → Lucide icon-id map shared by the agent view's tool renderers.
 *
 * Both the message-history tool rows (`agent-view-messages.ts`) and the live
 * tool-activity block (`agent-view-tool-display.ts`) map a tool name to the
 * icon `setIcon()` should render. The two maps had drifted apart (each was a
 * partial, overlapping copy), so they are unified here as a single source of
 * truth. Callers keep their own fallback icon for unmapped tool names.
 */
export const TOOL_ICONS: Record<string, string> = {
	read_file: 'file-text',
	write_file: 'file-edit',
	list_files: 'folder-open',
	create_folder: 'folder-plus',
	delete_file: 'trash-2',
	move_file: 'file-symlink',
	find_files_by_name: 'search',
	find_files_by_content: 'search',
	google_search: 'globe',
	google_maps: 'map-pin',
	fetch_url: 'link',
	generate_image: 'image',
};
