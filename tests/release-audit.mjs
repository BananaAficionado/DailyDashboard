import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Report locations and categories only: never echo a credential into CI logs.
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const files = git('ls-files', '-z').toString().split('\0').filter(Boolean);
const failures = [];
const patterns = [
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['API secret', /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['personal filesystem path', /(?:\/Users\/|[A-Z]:\\Users\\)(?!Public\b|Shared\b|example\b|username\b)[A-Za-z0-9_.-]+/],
  ['private calendar URL', /https:\/\/(?:calendar\.google\.com\/calendar\/ical\/[^\s"']+\/private-[^\s"']+|outlook\.office365\.com\/owa\/calendar\/[^\s"']+)/],
];
function inspect(content, location) {
  for (const [category, pattern] of patterns) {
    if (pattern.test(content)) failures.push(`${location}: ${category}`);
  }
}
for (const path of files) {
  if (!existsSync(path)) continue; // Pending deletions are excluded from publication.
  if (/(?:^|\/)(?:keys\.env|\.env(?:\..+)?|dashboard-settings[^/]*\.json|[^/]*\.(?:pem|key|p12|pfx|p8|sqlite3?|db))$/i.test(path)
      && !path.endsWith('.env.example')) failures.push(`${path}: local credential/state file`);
  const bytes = readFileSync(path);
  if (!bytes.includes(0)) inspect(bytes.toString('utf8'), path);
}
if (process.argv.includes('--history')) {
  const objects = git('rev-list', '--objects', '--all').toString().trim().split('\n');
  for (const entry of objects) {
    const [sha, ...path] = entry.split(' ');
    if (git('cat-file', '-t', sha).toString().trim() !== 'blob') continue;
    const bytes = git('cat-file', 'blob', sha);
    if (!bytes.includes(0)) inspect(bytes.toString('utf8'), `history ${sha.slice(0, 12)} ${path.join(' ')}`);
  }
  const identities = git('log', '--all', '--format=%ae%n%ce').toString().trim().split('\n');
  if (identities.some(email => !/^[^@]+@(?:users\.noreply\.github\.com|noreply\.github\.com|github\.com)$/.test(email))) {
    failures.push('Git history: non-anonymous author/committer email (values redacted)');
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Release privacy checks passed (${files.length} tracked files${process.argv.includes('--history') ? ', including reachable history' : ''}).`);
}
