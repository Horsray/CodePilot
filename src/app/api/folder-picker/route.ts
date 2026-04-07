import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function POST() {
  try {
    // Use osascript to open macOS folder picker dialog
    const script = `
      tell application "System Events"
        activate
        set folderPath to choose folder with prompt "选择项目文件夹"
        return POSIX path of folderPath
      end tell
    `;
    
    const result = execSync('osascript -e \'' + script.replace(/'/g, "'\\''") + '\'', {
      encoding: 'utf-8',
      timeout: 30000,
    });
    
    const path = result.trim();
    
    if (!path) {
      return NextResponse.json({ cancelled: true });
    }
    
    return NextResponse.json({ path });
  } catch (error) {
    // User cancelled or error
    return NextResponse.json({ cancelled: true });
  }
}
