/**
 * Image attachment types and helpers for chat input
 */

import { App, TFile } from 'obsidian';

/**
 * Represents a pending image attachment
 */
export interface ImageAttachment {
	/** Base64 encoded image data (without data URI prefix) */
	base64: string;
	/** MIME type (e.g., 'image/png', 'image/jpeg') */
	mimeType: string;
	/** Unique ID for UI management */
	id: string;
	/** Path in vault after saving (optional, set after save) */
	vaultPath?: string;
}

/**
 * Generate a unique ID for an attachment
 */
export function generateAttachmentId(): string {
	return `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Convert a File or Blob to base64
 */
export function fileToBase64(file: File | Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			// Remove the data URI prefix (e.g., "data:image/png;base64,")
			const base64 = result.split(',')[1];
			resolve(base64);
		};
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

/**
 * Get MIME type from a File or Blob
 */
export function getMimeType(file: File | Blob): string {
	return file.type || 'image/png';
}

/**
 * Check if a MIME type is a supported image type
 */
export function isSupportedImageType(mimeType: string): boolean {
	const supported = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
	return supported.includes(mimeType);
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
	const map: Record<string, string> = {
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/gif': 'gif',
		'image/webp': 'webp',
	};
	return map[mimeType] || 'png';
}

/**
 * Get the default attachment folder from Obsidian settings
 */
export function getAttachmentFolder(app: App): string {
	// Access Obsidian's internal config for attachment location
	// @ts-ignore - accessing internal Obsidian config
	const attachmentFolderPath = app.vault.getConfig('attachmentFolderPath') as string;

	// If not set or empty, default to vault root
	if (!attachmentFolderPath || attachmentFolderPath === '/') {
		return '';
	}

	// Handle "./" which means "same folder as current file"
	// For chat context, we'll use the root folder in this case
	if (attachmentFolderPath === './') {
		return '';
	}

	return attachmentFolderPath;
}

/**
 * Save an image attachment to the vault
 * Returns the path of the saved file
 */
export async function saveImageToVault(app: App, attachment: ImageAttachment, folder?: string): Promise<string> {
	// Use provided folder or get from Obsidian config
	const folderPath = folder ?? getAttachmentFolder(app);

	// Ensure folder exists (if not root)
	if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.createFolder(folderPath);
	}

	// Generate filename
	const ext = getExtensionFromMimeType(attachment.mimeType);
	const filename = `pasted-image-${Date.now()}.${ext}`;
	const filePath = folderPath ? `${folderPath}/${filename}` : filename;

	// Convert base64 to binary
	const binaryString = atob(attachment.base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	// Create file in vault
	await app.vault.createBinary(filePath, bytes.buffer as ArrayBuffer);

	return filePath;
}
