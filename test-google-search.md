# Test Google Search Citations

Try these searches in Agent Mode to test citation functionality:

1. "What is the current stock price of Apple?"
2. "Latest news about artificial intelligence in 2025"
3. "How to make sourdough bread starter"

## What to look for:
- Citations should appear inline in the response as [1], [2], etc.
- A "Sources" section should appear at the bottom with full links
- The tool execution details should show the citations in the Google Search result

## Debug steps if citations don't appear:
1. Check browser console for the log messages:
   - "Search metadata: ..."
   - "Has groundingChunks: ..."
   - "Has groundingSupports: ..."
   - "Google Search citations found: ..."
2. Expand the Google Search tool execution details to see the raw result
3. Check if the formatted tool results include the citation instruction