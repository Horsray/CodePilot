import { executeCommandInPtySession } from './src/lib/pty-manager';

async function main() {
  console.log('Running test command...');
  const res = await executeCommandInPtySession('test_id', process.cwd(), 'ls -la');
  console.log('Result:', res);
}

main().catch(console.error);
