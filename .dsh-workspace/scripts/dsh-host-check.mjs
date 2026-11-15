import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const exe = 'D:/deepseek/DeepSeek Harness.exe';
const asar = 'D:/deepseek/resources/app.asar';
const cli = 'D:/deepseek/resources/runtime/cli/bin/dsh.cmd';
const profile = 'forward-step-test';
const profileRoot = `C:/Users/Alarm/.dsh/profiles/${profile}`;
const pluginRoot = 'D:/VScode/项目/提示词工具/.dsh-workspace/dsh-plugin/forward-step-dsh';

function runPowerShell(command) {
  const result = spawnSync('pwsh.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`PowerShell probe failed (${result.status}): ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function runCli(args) {
  const escapedArgs = args.map(value => `'${value.replaceAll("'", "''")}'`).join(' ');
  return runPowerShell(`& '${cli}' ${escapedArgs}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`);
}

const [exeBytes, asarBytes, profilePackage, versionsText] = await Promise.all([
  readFile(exe),
  readFile(asar),
  readFile(`${profileRoot}/package.json`, 'utf8'),
  readFile('D:/deepseek/resources/runtime/versions.json', 'utf8')
]);
const versions = JSON.parse(versionsText);
const shortcut = JSON.parse(runPowerShell(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut('C:/Users/Alarm/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/DeepSeek Harness.lnk'); [pscustomobject]@{TargetPath=$s.TargetPath;Arguments=$s.Arguments;WorkingDirectory=$s.WorkingDirectory}|ConvertTo-Json -Compress`));
const configSchema = JSON.parse(runCli(['--profile', profile, '--dump-config-schema']));
const diagnostics = configSchema['x-cordis']?.diagnostics ?? [];
const entries = configSchema['x-cordis']?.entries ?? [];
const packageJson = JSON.parse(profilePackage);
const receipt = {
  capturedAt: new Date().toISOString(),
  executable: exe,
  executableFileVersion: runPowerShell(`(Get-Item -LiteralPath '${exe}').VersionInfo.FileVersion`),
  executableSha256: createHash('sha256').update(exeBytes).digest('hex').toUpperCase(),
  asar,
  asarSha256: createHash('sha256').update(asarBytes).digest('hex').toUpperCase(),
  cli,
  cliVersion: runCli(['--version']),
  cliHelp: runCli(['--help']),
  pluginHelp: runCli(['plugin', '--profile', profile, '--help']),
  embeddedRuntime: versions,
  profile,
  profileRoot,
  profilePluginDependency: packageJson.dependencies?.['@local/forward-step-dsh'] ?? null,
  targetPlugin: resolve(pluginRoot),
  resolvedProfileEntries: entries.length,
  profileDiagnostics: diagnostics.length,
  profileDiagnosticDetails: diagnostics,
  shortcut,
  runtimeProbes: { gui: 'not-run', thirdPartyClientPanel: 'not-run', modelIsolation: 'not-run', storageRecovery: 'not-run', dispose: 'not-run' }
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error('Usage: node scripts/dsh-host-check.mjs --output <file>');
const output = resolve(process.argv[outputIndex + 1]);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(`HOST_CHECK: PASS`);
console.log(`PROFILE_DIAGNOSTICS: ${diagnostics.length}`);
console.log(`PROFILE_PLUGIN: ${receipt.profilePluginDependency}`);
console.log(`OUTPUT: ${output}`);
