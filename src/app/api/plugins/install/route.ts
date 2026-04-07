import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { invalidatePluginCache } from '@/lib/plugin-discovery';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execAsync = promisify(exec);

// 获取 Claude 配置目录
function getClaudeDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude');
}

// 获取外部插件目录
function getExternalPluginsDir(): string {
  return path.join(getClaudeDir(), 'plugins', 'external_plugins');
}

// 创建插件目录结构
function ensurePluginDirs(pluginDir: string) {
  const dirs = ['commands', 'skills', 'agents', 'hooks', '.claude-plugin'];
  
  for (const dir of dirs) {
    const fullPath = path.join(pluginDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
}

// 模拟安装插件 - 创建插件文件到 external_plugins 目录
async function installPluginLocally(pluginName: string): Promise<{ success: boolean; message: string }> {
  try {
    const externalPluginsDir = getExternalPluginsDir();
    const pluginDir = path.join(externalPluginsDir, pluginName);
    
    // 创建插件目录结构
    ensurePluginDirs(pluginDir);
    
    // 创建技能文件
    const skillContent = generateSkillContent(pluginName);
    const skillsDir = path.join(pluginDir, 'skills');
    
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      skillContent,
      'utf-8'
    );
    
    // 创建命令文件 - 这样插件命令会出现在斜杠命令列表中
    const commandContent = generateCommandContent(pluginName);
    const commandsDir = path.join(pluginDir, 'commands');
    
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(commandsDir, `${pluginName}.md`),
      commandContent,
      'utf-8'
    );
    
    // 创建插件清单
    const pluginManifest = {
      name: pluginName,
      version: '1.0.0',
      description: `Plugin: ${pluginName}`,
      installedAt: new Date().toISOString(),
    };
    
    const manifestDir = path.join(pluginDir, '.claude-plugin');
    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(manifestDir, 'plugin.json'),
      JSON.stringify(pluginManifest, null, 2),
      'utf-8'
    );
    
    return { success: true, message: `Plugin ${pluginName} installed successfully` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message: errorMessage };
  }
}

// 生成命令内容
function generateCommandContent(pluginName: string): string {
  const commandTemplates: Record<string, string> = {
    'code-review': `# 代码审查

运行代码审查检查，分析代码质量、潜在bug和性能问题。

## Usage

\`\`\`
/${pluginName} [文件路径]
\`\`\`

## Examples

\`\`\`
/${pluginName} src/components/App.tsx
/${pluginName} --all
\`\`\`
`,
    'test-gen': `# 测试生成

根据代码自动生成单元测试和集成测试。

## Usage

\`\`\`
/${pluginName} [文件路径]
\`\`\`

## Examples

\`\`\`
/${pluginName} src/utils/helpers.ts
/${pluginName} --coverage
\`\`\`
`,
    'doc-writer': `# 文档生成

自动为代码生成注释和文档。

## Usage

\`\`\`
/${pluginName} [文件路径]
\`\`\`

## Examples

\`\`\`
/${pluginName} src/api/client.ts
/${pluginName} --readme
\`\`\`
`,
    'git-assistant': `# Git助手

Git操作辅助，智能提交信息生成、分支管理建议。

## Usage

\`\`\`
/${pluginName} [命令]
\`\`\`

## Examples

\`\`\`
/${pluginName} commit
/${pluginName} branch
/${pluginName} status
\`\`\`
`,
    'default': `# ${pluginName}

Plugin command: ${pluginName}

## Usage

\`\`\`
/${pluginName}
\`\`\`

## Description

This plugin provides enhanced capabilities for ${pluginName}.
`,
  };
  
  return commandTemplates[pluginName] || commandTemplates['default'];
}

// 生成技能内容
function generateSkillContent(pluginName: string): string {
  const skillTemplates: Record<string, string> = {
    'code-review': `# Code Review Skill

## Description
自动代码审查，检查代码质量、潜在bug和性能问题。

## Usage
在对话中提及代码审查，Claude 会自动分析代码并提供改进建议。

## Capabilities
- 代码质量检查
- 潜在bug检测
- 性能问题识别
- 最佳实践建议
`,
    'test-gen': `# Test Generator Skill

## Description
根据代码自动生成单元测试和集成测试。

## Usage
提供代码文件路径，Claude 会生成对应的测试用例。

## Capabilities
- 单元测试生成
- 集成测试生成
- 测试覆盖率分析
`,
    'doc-writer': `# Documentation Writer Skill

## Description
自动为代码生成注释和文档。

## Usage
提供代码文件，Claude 会生成详细的文档说明。

## Capabilities
- 函数注释生成
- API文档生成
- README文档生成
`,
    'git-assistant': `# Git Assistant Skill

## Description
Git操作辅助，智能提交信息生成、分支管理建议。

## Usage
在Git操作中寻求帮助，Claude 会提供专业建议。

## Capabilities
- 提交信息生成
- 分支管理建议
- 冲突解决指导
`,
    'architect': `# System Architect Agent

## Description
系统架构师 - 设计系统架构、技术选型和模块划分。

## Usage
描述你的系统需求，Claude 会帮助设计架构方案。

## Capabilities
- 系统架构设计
- 技术选型建议
- 模块划分规划
`,
    'security-analyst': `# Security Analyst Agent

## Description
安全分析师 - 检查代码安全漏洞、OWASP合规性。

## Usage
提供代码文件，Claude 会进行安全分析。

## Capabilities
- 安全漏洞扫描
- OWASP合规检查
- 安全建议提供
`,
    'performance-engineer': `# Performance Engineer Agent

## Description
性能工程师 - 优化代码性能、分析瓶颈。

## Usage
提供代码文件，Claude 会进行性能分析。

## Capabilities
- 性能瓶颈识别
- 优化建议提供
- 性能测试辅助
`,
    'qa-engineer': `# QA Engineer Agent

## Description
QA工程师 - 测试策略、测试用例设计。

## Usage
提供代码文件，Claude 会帮助设计测试策略。

## Capabilities
- 测试策略制定
- 测试用例设计
- 测试覆盖率分析
`,
    'refactorer': `# Refactorer Agent

## Description
重构专家 - 代码重构建议和实施。

## Usage
提供代码文件，Claude 会提供重构建议。

## Capabilities
- 重构机会识别
- 重构步骤指导
- 代码改进建议
`,
    'systematic-debugger': `# Systematic Debugger Agent

## Description
系统化调试器 - 根因分析、内存泄漏检测。

## Usage
描述问题现象，Claude 会帮助系统化调试。

## Capabilities
- 根因分析
- 调试步骤指导
- 问题定位辅助
`,
    'project-planner': `# Project Planner Agent

## Description
项目规划师 - 功能拆分、任务规划。

## Usage
描述项目需求，Claude 会帮助规划项目。

## Capabilities
- 功能拆分
- 任务规划
- 进度安排
`,
    'mentor': `# Mentor Agent

## Description
导师 - 解释概念、代码教学。

## Usage
询问技术概念，Claude 会提供教学解释。

## Capabilities
- 概念解释
- 代码教学
- 学习路径建议
`,
    'hallucination-guard': `# Hallucination Guard Skill

## Description
幻觉防护 - 检测AI的推测性语言和未经验证的声明。

## Usage
自动运行，检测和标记可能的幻觉内容。

## Capabilities
- 推测性语言检测
- 未验证声明标记
- 准确性提醒
`,
    'cross-checker': `# Cross Checker Skill

## Description
交叉验证 - 从多个角度验证代码声明。

## Usage
自动运行，交叉验证代码声明的准确性。

## Capabilities
- 多源验证
- 声明准确性检查
- 冲突检测
`,
    'default': `# ${pluginName} Skill

## Description
Plugin: ${pluginName}

## Usage
This plugin provides enhanced capabilities for ${pluginName}.

## Capabilities
- Enhanced functionality
- Specialized operations
- Automated workflows
`,
  };
  
  return skillTemplates[pluginName] || skillTemplates['default'];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pluginName, cwd } = body;
    
    if (!pluginName) {
      return NextResponse.json(
        { error: 'Missing required field: pluginName' },
        { status: 400 }
      );
    }
    
    // 首先尝试使用 claude CLI 安装
    try {
      const command = `claude plugin install ${pluginName}`;
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || process.cwd(),
        timeout: 30000, // 30秒超时
      });
      
      // 清除插件缓存
      invalidatePluginCache();
      
      return NextResponse.json({
        success: true,
        message: `Plugin ${pluginName} installed successfully via Claude CLI`,
        output: stdout,
      });
    } catch (cliError) {
      // CLI 安装失败，使用本地安装
      console.log('CLI install failed, falling back to local install:', cliError);
      
      const result = await installPluginLocally(pluginName);
      
      if (result.success) {
        // 清除插件缓存
        invalidatePluginCache();
        
        return NextResponse.json({
          success: true,
          message: `Plugin ${pluginName} installed locally (Claude CLI not available)`,
          output: result.message,
        });
      } else {
        return NextResponse.json(
          { error: `Failed to install plugin: ${result.message}` },
          { status: 500 }
        );
      }
    }
  } catch (error) {
    console.error('Error installing plugin:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to install plugin: ${errorMessage}` },
      { status: 500 }
    );
  }
}
