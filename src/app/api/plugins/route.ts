import { NextRequest, NextResponse } from 'next/server';
import { getPluginInfoList, setPluginEnabled } from '@/lib/plugin-discovery';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get('cwd') || undefined;
    
    const plugins = getPluginInfoList(cwd);
    
    return NextResponse.json({ plugins });
  } catch (error) {
    console.error('Error fetching plugins:', error);
    return NextResponse.json(
      { error: 'Failed to fetch plugins' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pluginKey, enabled, cwd } = body;
    
    if (!pluginKey || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required fields: pluginKey, enabled' },
        { status: 400 }
      );
    }
    
    const result = setPluginEnabled(pluginKey, enabled, cwd);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error toggling plugin:', error);
    return NextResponse.json(
      { error: 'Failed to toggle plugin' },
      { status: 500 }
    );
  }
}
