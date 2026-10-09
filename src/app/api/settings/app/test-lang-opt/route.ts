import { NextRequest, NextResponse } from 'next/server';
import { generateTextFromProvider } from '@/lib/text-generator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, model } = body;

    if (!providerId || !model) {
      return NextResponse.json({ error: 'Provider and Model are required' }, { status: 400 });
    }

    const res = await generateTextFromProvider({
      providerId,
      model,
      prompt: 'Hello! Please reply with "ok" if you receive this message.',
      system: 'You are a helpful assistant.',
    });

    return NextResponse.json({ success: true, response: res });
  } catch (error: any) {
    console.error('Test connection failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to connect to the model' },
      { status: 500 }
    );
  }
}
