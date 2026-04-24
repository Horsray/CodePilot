import fs from 'fs';
const file = fs.readFileSync('src/lib/agent-loop.ts', 'utf-8');
const lines = file.split('\n');
lines.forEach((line, i) => {
  if (line.includes('maxSteps') || line.includes('throw')) {
    console.log(`${i + 1}: ${line}`);
  }
});
