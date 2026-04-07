import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

export async function GET() {
  try {
    const workingDirectory = getSetting('working_directory') || process.cwd();
    return NextResponse.json({ working_directory: workingDirectory });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get workspace settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { working_directory } = body;

    if (!working_directory) {
      return NextResponse.json(
        { error: 'working_directory is required' },
        { status: 400 }
      );
    }

    // Import setSetting dynamically to avoid issues
    const { setSetting } = await import('@/lib/db');
    setSetting('working_directory', working_directory);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update workspace settings' },
      { status: 500 }
    );
  }
}
