// Example: put the hidden window at phone width with the mobile layout, so a
// screenshot shows what a phone user sees:
//   node scripts/test-env/cdp.mjs eval scripts/test-env/examples/mobile-width.js
//   node scripts/test-env/cdp.mjs shot mobile.png
//
// Resizing the real window persists across cdp.mjs calls, unlike a CDP
// Emulation.setDeviceMetricsOverride, which resets when the socket closes.
// app.emulateMobile() reloads the window, which would cut this evaluation off,
// so it is scheduled after the return; cdp.mjs waits for the reload on its next call.
// Undo with: app.emulateMobile(false) and setSize(1600, 1000).
require('electron').remote.getCurrentWindow().setSize(390, 844);
const switching = !app.isMobile;
if (switching) setTimeout(() => app.emulateMobile(true), 100);
return { size: require('electron').remote.getCurrentWindow().getSize(), mobileLayout: switching ? 'reloading' : true };
