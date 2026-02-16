/**
 * Inline attachment types and helpers for chat input.
 * Supports images, audio, video, PDF, and other binary types sent as inline data to Gemini.
 */

import { App } from 'obsidian';

/**
 * Represents a pending inline attachment (image, audio, video, PDF, etc.)
 */
export interface InlineAttachment {
	/** Base64 encoded data (without data URI prefix) */
	base64: string;
	/** MIME type (e.g., 'image/png', 'application/pdf') */
	mimeType: string;
	/** Unique ID for UI management */
	id: string;
	/** Path in vault after saving (optional, set after save) */
	vaultPath?: string;
	/** Original file name (for display in non-image previews) */
	fileName?: string;
}

/** Backward-compatible alias */
export type ImageAttachment = InlineAttachment;

/**
 * Generate a unique ID for an attachment
 */
export function generateAttachmentId(): string {
	return `att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
		'image/heic': 'heic',
		'image/heif': 'heif',
		'audio/wav': 'wav',
		'audio/mp3': 'mp3',
		'audio/aac': 'aac',
		'audio/flac': 'flac',
		'video/mp4': 'mp4',
		'video/mpeg': 'mpeg',
		'video/quicktime': 'mov',
		'video/x-flv': 'flv',
		'video/webm': 'webm',
		'video/x-ms-wmv': 'wmv',
		'video/3gpp': '3gp',
		'application/pdf': 'pdf',
	};
	return map[mimeType] || 'bin';
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
 * Validate base64 string format
 */
function isValidBase64(str: string): boolean {
	if (!str || typeof str !== 'string') {
		return false;
	}
	// Base64 should only contain valid characters
	const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
	return base64Regex.test(str);
}

/**
 * Save an attachment to the vault.
 * Returns the path of the saved file.
 */
export async function saveAttachmentToVault(app: App, attachment: InlineAttachment, folder?: string): Promise<string> {
	// Use provided folder or get from Obsidian config
	const folderPath = folder ?? getAttachmentFolder(app);

	// Ensure folder exists (if not root)
	if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.createFolder(folderPath);
	}

	// Generate filename with random suffix to prevent collisions
	const ext = getExtensionFromMimeType(attachment.mimeType);
	const randomSuffix = Math.random().toString(36).substring(2, 8);
	const prefix = attachment.mimeType.startsWith('image/') ? 'pasted-image' : 'attachment';
	const filename = `${prefix}-${Date.now()}-${randomSuffix}.${ext}`;
	const filePath = folderPath ? `${folderPath}/${filename}` : filename;

	// Validate and convert base64 to binary with error handling
	if (!isValidBase64(attachment.base64)) {
		throw new Error('Invalid base64 data');
	}

	let bytes: Uint8Array;
	try {
		const binaryString = atob(attachment.base64);
		bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
	} catch (error) {
		throw new Error('Failed to decode base64 data');
	}

	// Create file in vault
	await app.vault.createBinary(filePath, bytes.buffer as ArrayBuffer);

	return filePath;
}

/** Backward-compatible alias */
export const saveImageToVault = saveAttachmentToVault;
