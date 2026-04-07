import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface GitConfigRequest {
  provider: 'github' | 'gitlab' | 'other';
  token: string;
  username: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: GitConfigRequest = await request.json();
    const { provider, token, username } = body;

    if (!token || !username) {
      return NextResponse.json(
        { error: 'Token and username are required' },
        { status: 400 }
      );
    }

    // Store credentials in a secure location
    const configDir = path.join(os.homedir(), '.codepilot');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const configPath = path.join(configDir, 'git-credentials.json');
    const config = {
      provider,
      username,
      token,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    // Configure git globally
    try {
      execSync(`git config --global user.name "${username}"`, { stdio: 'ignore' });
      execSync(`git config --global user.email "${username}@users.noreply.github.com"`, { stdio: 'ignore' });
      
      // Configure credential helper
      execSync('git config --global credential.helper store', { stdio: 'ignore' });
      
      // Store credentials in git credential store
      const credentialStorePath = path.join(os.homedir(), '.git-credentials');
      let credentials = '';
      if (fs.existsSync(credentialStorePath)) {
        credentials = fs.readFileSync(credentialStorePath, 'utf-8');
      }
      
      // Add credential for the provider
      const host = provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : '*';
      const credentialLine = `https://${username}:${token}@${host}\n`;
      
      if (!credentials.includes(credentialLine.trim())) {
        fs.appendFileSync(credentialStorePath, credentialLine, { mode: 0o600 });
      }
    } catch (error) {
      console.error('Git config error:', error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save configuration' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const configDir = path.join(os.homedir(), '.codepilot');
    const configPath = path.join(configDir, 'git-credentials.json');
    
    if (!fs.existsSync(configPath)) {
      return NextResponse.json({ configured: false });
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return NextResponse.json({
      configured: true,
      provider: config.provider,
      username: config.username,
      updatedAt: config.updatedAt,
    });
  } catch (error) {
    return NextResponse.json({ configured: false });
  }
}
