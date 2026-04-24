import { writePtySession, ensurePtySession, ensurePtyOutputBuffered } from './src/lib/pty-manager';

async function main() {
  const id = 'test_id_raw';
  const session = ensurePtySession(id, process.cwd());
  ensurePtyOutputBuffered(id);

  session.process.onData((data: string) => console.log('PTY OUTPUT:', JSON.stringify(data)));

  const command = `exit 1`;
  const startMarker = 'START_MARKER';
  const endMarker = 'END_MARKER';
  const eofMarker = `EOF_CODEPILOT_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const block = `__codepilot_script=$(mktemp)
cat << '${eofMarker}' > "$__codepilot_script"
export PAGER=cat
export GIT_PAGER=cat
export DEBIAN_FRONTEND=noninteractive
export NPM_CONFIG_YES=true
${command}
${eofMarker}
{ printf '\\n${startMarker}\\n'; source "$__codepilot_script"; __codepilot_status=$?; printf '\\n${endMarker}:%s__\\n' "$__codepilot_status"; }
rm -f "$__codepilot_script"
`;
  writePtySession(id, block + '\n');

  // just wait and read
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

main().catch(console.error);
