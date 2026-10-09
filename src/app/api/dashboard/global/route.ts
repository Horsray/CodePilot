import { NextResponse } from 'next/server';
import { readGlobalRegistry, toggleGlobalWidget, removeGlobalWidget, reorderGlobalWidgets, upsertGlobalWidget } from '@/lib/dashboard-store';
import type { DashboardWidget } from '@/types/dashboard';

/** GET /api/dashboard/global — read global widgets */
export async function GET() {
  try {
    const config = readGlobalRegistry();
    return NextResponse.json(config);
  } catch (e) {
    console.error('[dashboard global] GET failed:', e);
    return NextResponse.json({ error: 'Failed to read global dashboard' }, { status: 500 });
  }
}

/** POST /api/dashboard/global — add a widget to global registry */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { widget } = body as { widget: DashboardWidget };
    if (!widget || !widget.id) {
      return NextResponse.json({ error: 'Missing widget or widget.id' }, { status: 400 });
    }
    upsertGlobalWidget(widget);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[dashboard global] POST failed:', e);
    return NextResponse.json({ error: 'Failed to add widget' }, { status: 500 });
  }
}

/** PUT /api/dashboard/global — toggle, remove, or reorder */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { action, widgetId, isGlobal, widgetIds } = body;

    if (action === 'toggle' && widgetId) {
      toggleGlobalWidget(widgetId, !!isGlobal);
      return NextResponse.json({ success: true });
    }

    if (action === 'remove' && widgetId) {
      removeGlobalWidget(widgetId);
      return NextResponse.json({ success: true });
    }

    if (action === 'reorder' && Array.isArray(widgetIds)) {
      reorderGlobalWidgets(widgetIds);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action or parameters' }, { status: 400 });
  } catch (e) {
    console.error('[dashboard global] PUT failed:', e);
    return NextResponse.json({ error: 'Failed to update global dashboard' }, { status: 500 });
  }
}
