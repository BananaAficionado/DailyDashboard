import { rm, realpath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// Only remove the disposable profiles allocated by this project's browser suites.
export async function cleanupTestBrowser(chrome, profile) {
  const name = /^(dashboard-design-|dashboard-matrix-|daily-dashboard-maps-|daily-dashboard-clock-|daily-dashboard-responsive-|daily-dashboard-short-)[A-Za-z0-9]{6}$/;
  if (!name.test(basename(profile)) || await realpath(dirname(profile)) !== await realpath(tmpdir())) {
    throw new Error('Refusing to clean a profile outside the test temporary directory');
  }
  if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) {
    const closed = new Promise(resolve => chrome.once('close', resolve));
    chrome.kill('SIGTERM');
    await closed;
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
