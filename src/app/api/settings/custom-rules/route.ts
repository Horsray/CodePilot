import { NextResponse } from 'next/server';
import { 
  getAllCustomRules, 
  getCustomRule, 
  createCustomRule, 
  updateCustomRule, 
  deleteCustomRule 
} from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const rule = getCustomRule(id);
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({ rule });
  }

  const rules = getAllCustomRules();
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.type || !body.name || !body.content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const rule = createCustomRule({
      type: body.type,
      name: body.name,
      content: body.content,
      enabled: body.enabled !== false,
      project_ids: body.project_ids || '[]',
    });

    return NextResponse.json({ rule });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: 'Missing rule ID' }, { status: 400 });

    const rule = updateCustomRule(body.id, body);
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    return NextResponse.json({ rule });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'Missing rule ID' }, { status: 400 });

  const deleted = deleteCustomRule(id);
  if (!deleted) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}
