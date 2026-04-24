import { executeCommandInPtySession } from './src/lib/pty-manager';

async function main() {
  console.log('Running hanging command...');
  const res = await executeCommandInPtySession('test_id2', process.cwd(), 'sleep 5', 2000);
  console.log('Result:', res);
}

main().catch(console.error);
