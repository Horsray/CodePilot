/**
 * 测试报告生成器
 * 用于生成详细的测试报告
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  testId: string;
  testName: string;
  category: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration: number;
  startTime: Date;
  endTime: Date;
  errorMessage?: string;
  stackTrace?: string;
}

interface TestSuite {
  suiteId: string;
  suiteName: string;
  category: string;
  tests: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  startTime: Date;
  endTime: Date;
}

interface TestReport {
  reportId: string;
  projectName: string;
  version: string;
  environment: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  suites: TestSuite[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    pending: number;
    passRate: number;
    failRate: number;
    coverage?: {
      statements: number;
      branches: number;
      functions: number;
      lines: number;
    };
  };
}

export class TestReportGenerator {
  private projectName: string;
  private version: string;
  private environment: string;

  constructor(
    projectName: string = 'CodePilot',
    version: string = '1.0.0',
    environment: string = 'test'
  ) {
    this.projectName = projectName;
    this.version = version;
    this.environment = environment;
  }

  /**
   * 生成测试报告
   */
  generateReport(suites: TestSuite[]): TestReport {
    const startTime = suites.length > 0 ? 
      new Date(Math.min(...suites.map(s => s.startTime.getTime()))) : 
      new Date();
    
    const endTime = suites.length > 0 ? 
      new Date(Math.max(...suites.map(s => s.endTime.getTime()))) : 
      new Date();
    
    const duration = endTime.getTime() - startTime.getTime();

    // 计算汇总信息
    const total = suites.reduce((sum, suite) => sum + suite.total, 0);
    const passed = suites.reduce((sum, suite) => sum + suite.passed, 0);
    const failed = suites.reduce((sum, suite) => sum + suite.failed, 0);
    const skipped = suites.reduce((sum, suite) => sum + suite.skipped, 0);
    const pending = total - passed - failed - skipped;

    const passRate = total > 0 ? (passed / total) * 100 : 0;
    const failRate = total > 0 ? (failed / total) * 100 : 0;

    return {
      reportId: `report_${Date.now()}`,
      projectName: this.projectName,
      version: this.version,
      environment: this.environment,
      startTime,
      endTime,
      duration,
      suites,
      summary: {
        total,
        passed,
        failed,
        skipped,
        pending,
        passRate,
        failRate,
      },
    };
  }

  /**
   * 生成HTML报告
   */
  generateHtmlReport(report: TestReport): string {
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${report.projectName} - 测试报告</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        
        .header .meta {
            font-size: 0.9rem;
            opacity: 0.9;
        }
        
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }
        
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        
        .summary-card h3 {
            font-size: 0.9rem;
            color: #666;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .summary-card .value {
            font-size: 2.5rem;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .summary-card.passed .value { color: #28a745; }
        .summary-card.failed .value { color: #dc3545; }
        .summary-card.skipped .value { color: #ffc107; }
        .summary-card.total .value { color: #007bff; }
        
        .progress-container {
            padding: 20px 30px;
            background: white;
        }
        
        .progress-bar {
            height: 20px;
            background: #e9ecef;
            border-radius: 10px;
            overflow: hidden;
            margin-bottom: 10px;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #28a745, #20c997);
            transition: width 0.5s ease;
        }
        
        .progress-text {
            text-align: center;
            font-size: 1.1rem;
            font-weight: 500;
        }
        
        .suites {
            padding: 30px;
        }
        
        .suite {
            margin-bottom: 30px;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            overflow: hidden;
        }
        
        .suite-header {
            background: #f8f9fa;
            padding: 15px 20px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .suite-title {
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        .suite-stats {
            font-size: 0.9rem;
            color: #666;
        }
        
        .tests {
            padding: 0;
        }
        
        .test {
            padding: 15px 20px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .test:last-child {
            border-bottom: none;
        }
        
        .test-info {
            flex: 1;
        }
        
        .test-name {
            font-weight: 500;
            margin-bottom: 5px;
        }
        
        .test-details {
            font-size: 0.85rem;
            color: #666;
        }
        
        .test-status {
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .test-status.passed {
            background: #d4edda;
            color: #155724;
        }
        
        .test-status.failed {
            background: #f8d7da;
            color: #721c24;
        }
        
        .test-status.skipped {
            background: #fff3cd;
            color: #856404;
        }
        
        .test-status.pending {
            background: #e2e3e5;
            color: #383d41;
        }
        
        .error-message {
            margin-top: 10px;
            padding: 10px;
            background: #f8d7da;
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.85rem;
            color: #721c24;
            white-space: pre-wrap;
            word-break: break-word;
        }
        
        .footer {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            color: #666;
            font-size: 0.9rem;
        }
        
        @media (max-width: 768px) {
            .summary {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .test {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .test-status {
                margin-top: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${report.projectName} 测试报告</h1>
            <div class="meta">
                版本: ${report.version} | 环境: ${report.environment} | 
                生成时间: ${new Date().toLocaleString('zh-CN')}
            </div>
        </div>
        
        <div class="summary">
            <div class="summary-card total">
                <h3>总测试数</h3>
                <div class="value">${report.summary.total}</div>
            </div>
            
            <div class="summary-card passed">
                <h3>通过</h3>
                <div class="value">${report.summary.passed}</div>
            </div>
            
            <div class="summary-card failed">
                <h3>失败</h3>
                <div class="value">${report.summary.failed}</div>
            </div>
            
            <div class="summary-card skipped">
                <h3>跳过</h3>
                <div class="value">${report.summary.skipped}</div>
            </div>
        </div>
        
        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${report.summary.passRate}%"></div>
            </div>
            <div class="progress-text">
                通过率: ${report.summary.passRate.toFixed(2)}% | 
                失败率: ${report.summary.failRate.toFixed(2)}%
            </div>
        </div>
        
        <div class="suites">
            ${report.suites.map(suite => `
                <div class="suite">
                    <div class="suite-header">
                        <div class="suite-title">${suite.suiteName}</div>
                        <div class="suite-stats">
                            ${suite.passed}/${suite.total} 通过 | 
                            耗时: ${this.formatDuration(suite.duration)}
                        </div>
                    </div>
                    
                    <div class="tests">
                        ${suite.tests.map(test => `
                            <div class="test">
                                <div class="test-info">
                                    <div class="test-name">${test.testName}</div>
                                    <div class="test-details">
                                        ID: ${test.testId} | 
                                        耗时: ${this.formatDuration(test.duration)}
                                    </div>
                                    ${test.status === 'failed' && test.errorMessage ? `
                                        <div class="error-message">${this.escapeHtml(test.errorMessage)}</div>
                                    ` : ''}
                                </div>
                                <div class="test-status ${test.status}">
                                    ${this.getStatusText(test.status)}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
        
        <div class="footer">
            <p>报告生成于: ${new Date().toLocaleString('zh-CN')}</p>
            <p>总耗时: ${this.formatDuration(report.duration)}</p>
        </div>
    </div>
</body>
</html>
    `;

    return html;
  }

  /**
   * 生成JSON报告
   */
  generateJsonReport(report: TestReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * 生成Markdown报告
   */
  generateMarkdownReport(report: TestReport): string {
    const md = `
# ${report.projectName} 测试报告

**版本:** ${report.version}  
**环境:** ${report.environment}  
**生成时间:** ${new Date().toLocaleString('zh-CN')}

## 测试摘要

| 指标 | 数量 | 百分比 |
|------|------|--------|
| 总测试数 | ${report.summary.total} | 100% |
| 通过 | ${report.summary.passed} | ${report.summary.passRate.toFixed(2)}% |
| 失败 | ${report.summary.failed} | ${report.summary.failRate.toFixed(2)}% |
| 跳过 | ${report.summary.skipped} | ${((report.summary.skipped / report.summary.total) * 100).toFixed(2)}% |

**通过率:** ${report.summary.passRate.toFixed(2)}%  
**总耗时:** ${this.formatDuration(report.duration)}

## 测试套件详情

${report.suites.map(suite => `
### ${suite.suiteName}

**状态:** ${suite.passed}/${suite.total} 通过  
**耗时:** ${this.formatDuration(suite.duration)}

| 测试名称 | 状态 | 耗时 |
|----------|------|------|
${suite.tests.map(test => 
  `| ${test.testName} | ${this.getStatusEmoji(test.status)} ${this.getStatusText(test.status)} | ${this.formatDuration(test.duration)} |`
).join('\n')}
`).join('\n')}

## 失败详情

${report.suites.some(s => s.tests.some(t => t.status === 'failed')) ? 
  report.suites.flatMap(s => s.tests.filter(t => t.status === 'failed')).map(test => `
#### ${test.testName} (${test.testId})

**错误信息:**
\`\`\`
${test.errorMessage || '无错误信息'}
\`\`\`
`).join('\n') : '无失败的测试'}

---
*报告生成于 ${new Date().toLocaleString('zh-CN')}*
    `;

    return md;
  }

  /**
   * 保存报告到文件
   */
  async saveReport(report: TestReport, format: 'html' | 'json' | 'markdown' = 'html'): Promise<string> {
    const reportsDir = path.join(process.cwd(), 'test-reports');
    
    // 确保目录存在
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    let content: string;
    let extension: string;
    let filename: string;

    switch (format) {
      case 'html':
        content = this.generateHtmlReport(report);
        extension = 'html';
        filename = `test-report-${report.reportId}.html`;
        break;
      case 'json':
        content = this.generateJsonReport(report);
        extension = 'json';
        filename = `test-report-${report.reportId}.json`;
        break;
      case 'markdown':
        content = this.generateMarkdownReport(report);
        extension = 'md';
        filename = `test-report-${report.reportId}.md`;
        break;
    }

    const filePath = path.join(reportsDir, filename);
    fs.writeFileSync(filePath, content, 'utf8');

    return filePath;
  }

  /**
   * 格式化持续时间
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(2);
      return `${minutes}m ${seconds}s`;
    }
  }

  /**
   * 获取状态文本
   */
  private getStatusText(status: string): string {
    switch (status) {
      case 'passed':
        return '通过';
      case 'failed':
        return '失败';
      case 'skipped':
        return '跳过';
      case 'pending':
        return '待定';
      default:
        return '未知';
    }
  }

  /**
   * 获取状态表情符号
   */
  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'passed':
        return '✅';
      case 'failed':
        return '❌';
      case 'skipped':
        return '⏭️';
      case 'pending':
        return '⏳';
      default:
        return '❓';
    }
  }

  /**
   * 转义HTML特殊字符
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 从测试结果文件生成报告
   */
  async generateFromTestResults(resultsPath: string): Promise<TestReport> {
    // 读取测试结果
    const resultsData = fs.readFileSync(resultsPath, 'utf8');
    const results = JSON.parse(resultsData);

    // 转换为TestSuite格式
    const suites: TestSuite[] = results.suites.map((suite: any) => ({
      suiteId: suite.id,
      suiteName: suite.name,
      category: suite.category || 'unknown',
      tests: suite.tests.map((test: any) => ({
        testId: test.id,
        testName: test.name,
        category: test.category || suite.category || 'unknown',
        status: test.status,
        duration: test.duration,
        startTime: new Date(test.startTime),
        endTime: new Date(test.endTime),
        errorMessage: test.errorMessage,
        stackTrace: test.stackTrace,
      })),
      passed: suite.tests.filter((t: any) => t.status === 'passed').length,
      failed: suite.tests.filter((t: any) => t.status === 'failed').length,
      skipped: suite.tests.filter((t: any) => t.status === 'skipped').length,
      total: suite.tests.length,
      duration: suite.duration,
      startTime: new Date(suite.startTime),
      endTime: new Date(suite.endTime),
    }));

    return this.generateReport(suites);
  }
}

// 导出默认实例
export default new TestReportGenerator();
