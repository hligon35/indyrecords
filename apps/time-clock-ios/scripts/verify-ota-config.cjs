const { expo } = require('../app.config.js');

if (!expo.extra.clockUrl) {
  console.error('Set EXPO_PUBLIC_CLOCK_URL to the protected Time Clock HTTPS origin before publishing an update.');
  process.exitCode = 1;
}
