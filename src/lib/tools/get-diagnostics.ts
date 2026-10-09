import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolContext } from './index';

const execAsync = promisify(exec);

/**
 * Tool to get linter or compiler diagnostics for the current codebase.
 */
export function createGetDiagnosticsTool(ctx: ToolContext) {
  return tool({
    description: 'Get linter or compiler diagnostics for the current codebase. ' +
                 'Runs linting checks (e.g., eslint) and returns errors and warnings. ' +
                 'Use this to verify code quality after making changes.',
    inputSchema: z.object({
      path: z.string().optional().describe('Optional file path to check diagnostics for. If omitted, checks the whole project.'),
    }),
    execute: async ({ path: filePath }) => {
      try {
        // Try to find a lint command in package.json or use npx eslint
        // For a more robust implementation, we'd check for the presence of eslint config files
        const cmd = filePath ? `npx eslint "${filePath}" --format json` : 'npm run lint -- --format json';
        
        const { stdout, stderr } = await execAsync(cmd, { cwd: ctx.workingDirectory });
        
        // If it returns empty but exit code was 0, no errors
        if (!stdout && !stderr) {
          return 'No diagnostics found. The code looks clean!';
        }

        try {
          // Attempt to parse JSON output for a cleaner report
          const results = JSON.parse(stdout);
          if (Array.isArray(results) && results.length > 0) {
            let report = 'Linter Diagnostics Found:\n\n';
            results.forEach((file: any) => {
              if (file.messages.length > 0) {
                report += `File: ${file.filePath}\n`;
                file.messages.forEach((msg: any) => {
                  report += `  - [${msg.severity === 2 ? 'ERROR' : 'WARN'}] Line ${msg.line}:${msg.column}: ${msg.message} (${msg.ruleId})\n`;
                });
                report += '\n';
              }
            });
            return report || 'No diagnostics found.';
          }
        } catch {
          // Fallback to raw output if not JSON
        }

        return stdout || stderr || 'No diagnostics found.';
      } catch (err: any) {
        // ESLint exits with non-zero code if errors are found
        if (err.stdout) {
          try {
            const results = JSON.parse(err.stdout);
            if (Array.isArray(results)) {
              let report = 'Linter Diagnostics Found (Exit Code ' + err.code + '):\n\n';
              results.forEach((file: any) => {
                if (file.messages.length > 0) {
                  report += `File: ${file.filePath}\n`;
                  file.messages.forEach((msg: any) => {
                    report += `  - [${msg.severity === 2 ? 'ERROR' : 'WARN'}] Line ${msg.line}:${msg.column}: ${msg.message} (${msg.ruleId})\n`;
                  });
                  report += '\n';
                }
              });
              return report;
            }
          } catch { /* fallback */ }
          return err.stdout;
        }
        return `Error running diagnostics: ${err.message}`;
      }
    },
  });
}

// 中文注释：功能名称「获取诊断信息」，用法是通过运行 ESLint 等工具获取代码中的语法错误或规范警告。
// 在 Team 模式下，Verifier Agent 会调用此工具来确保代码质量。
