// __mocks__/obsidian.ts

// Mock for the Notice class
export class Notice {
  constructor(message: string, duration?: number) {
    // In a test environment, you might want to log the notice
    // or store it for assertions, rather than actually displaying it.
    // console.log(`[Mock Notice]: ${message} (Duration: ${duration !== undefined ? duration : 'default'})`);
  }
  // Add any methods that your code might call on a Notice instance, if any.
  // e.g., hide()
  hide() {
    // console.log('[Mock Notice]: Hide called');
  }
}

// Mock for App class or other Obsidian components if needed by your tests
// For example, if your plugin uses this.app.vault.read(), you'd need to mock app and vault.
export const App = jest.fn().mockImplementation(() => ({
  // Mock any app properties or methods your plugin uses
  vault: {
    // Example: Mock vault methods if they are used directly or indirectly by models.ts
    read: jest.fn().mockResolvedValue(''), // Mock implementation of read
    // Add other vault methods as needed
  },
  // Add other app properties/methods as needed
}));

// You can export other Obsidian specific utilities or classes if your code uses them
// For example:
// export const requestUrl = jest.fn().mockResolvedValue({ json: {}, status: 200 });
// export const moment = jest.requireActual('moment'); // If you use moment and want the real one

// If there are other specific named exports from 'obsidian' that your code uses,
// they would need to be mocked here as well.
// For example, if you used `import { Vault } from 'obsidian';` you'd add:
// export class Vault { /* ... mock implementation ... */ }

// Default export if your code uses `import obsidian from 'obsidian';`
// export default {
//   Notice,
//   App,
//   // ... other default exports
// };
