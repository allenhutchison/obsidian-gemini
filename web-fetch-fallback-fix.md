# Web Fetch Fallback Fix

## Problem
The web fetch tool was receiving `URL_RETRIEVAL_STATUS_ERROR` from Google's URL Context API but was still returning a successful result with the model's generic error message. The fallback mechanism wasn't being triggered.

### Root Cause
The initial fix was checking for snake_case field names (`url_retrieval_status`) when the API actually returns camelCase field names (`urlRetrievalStatus`).

## Solution
Updated the `web_fetch` tool to:

1. **Fixed field names**: Changed from snake_case to camelCase:
   - `url_retrieval_status` → `urlRetrievalStatus`
   - `retrieved_url` → `retrievedUrl`

2. **Check URL retrieval status**: After getting the result from Google's API, check if any of the URL metadata indicates a retrieval failure:
   - `URL_RETRIEVAL_STATUS_ERROR`
   - `URL_RETRIEVAL_STATUS_ACCESS_DENIED`
   - `URL_RETRIEVAL_STATUS_NOT_FOUND`

3. **Trigger fallback on failure**: When a retrieval error is detected, automatically fall back to the direct HTTP fetch method using Obsidian's `requestUrl`.

4. **Improved error handling**: 
   - The main catch block now also attempts fallback fetch for any other errors
   - The fallback method now returns a proper error result instead of throwing

## Testing
To test this fix:
1. Try accessing a URL that Google's URL Context can't access (like `https://heimdall.hutchistan.org`)
2. You should see in the console:
   - "URL Context Metadata: ..." showing the error status
   - "URL retrieval failed, attempting fallback fetch..."
   - The fallback will then attempt to fetch the page directly

## Expected Behavior
- If Google's URL Context fails, the tool automatically tries direct HTTP fetch
- If both methods fail, a clear error message is returned
- The fallback method provides basic HTML-to-text conversion for pages not in Google's index