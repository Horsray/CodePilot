import { NextRequest, NextResponse } from 'next/server';
import { readDashboard, removeWidget, updateSettings, moveWidget, reorderWidgets, addWidget, readGlobalRegistry } from '@/lib/dashboard-store';
import type { DashboardWidget } from '@/types/dashboard';

/** Helper to inject global widgets before returning */
function withGlobalWidgets(config: any) {
  const globalRegistry = readGlobalRegistry();
  const globalWidgets = globalRegistry.widgets.filter(w => w.isGlobal);
  const globalIds = new Set(globalWidgets.map(w => w.id));
  const localWidgets = config.widgets.filter((w: any) => !globalIds.has(w.id));
  return { ...config, widgets: [...globalWidgets, ...localWidgets] };
}

/** GET /api/dashboard?dir={workingDirectory} — read dashboard config */
export async function GET(req: NextRequest) {
  try {
    const dir = req.nextUrl.searchParams.get('dir');
    if (!dir) {
      return NextResponse.json({ error: 'Missing dir parameter' }, { status: 400 });
    }
    const config = readDashboard(dir);
    return NextResponse.json(withGlobalWidgets(config));
  } catch (e) {
    console.error('[dashboard] GET failed:', e);
    return NextResponse.json({ error: 'Failed to read dashboard' }, { status: 500 });
  }
}

/** POST /api/dashboard — add a widget to project dashboard */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { workingDirectory, widget } = body as { workingDirectory?: string; widget?: DashboardWidget };
    if (!workingDirectory || !widget || !widget.id) {
      return NextResponse.json({ error: 'Missing workingDirectory or widget' }, { status: 400 });
    }
    const config = addWidget(workingDirectory, widget);
    return NextResponse.json(withGlobalWidgets(config));
  } catch (e) {
    console.error('[dashboard] POST failed:', e);
    return NextResponse.json({ error: 'Failed to add widget' }, { status: 500 });
  }
}

/** PUT /api/dashboard — update settings or reorder widgets */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { workingDirectory, settings, widgetId, move, widgetOrder } = body;
    if (!workingDirectory) {
      return NextResponse.json({ error: 'Missing workingDirectory' }, { status: 400 });
    }
    // Absolute reorder (race-free)
    if (Array.isArray(widgetOrder)) {
      const config = reorderWidgets(workingDirectory, widgetOrder);
      return NextResponse.json(withGlobalWidgets(config));
    }
    // Relative reorder (legacy)
    if (widgetId && move) {
      const config = moveWidget(workingDirectory, widgetId, move);
      return NextResponse.json(withGlobalWidgets(config));
    }
    // Update settings
    if (settings) {
      const config = updateSettings(workingDirectory, settings);
      return NextResponse.json(withGlobalWidgets(config));
    }
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  } catch (e) {
    console.error('[dashboard] PUT failed:', e);
    return NextResponse.json({ error: 'Failed to update dashboard' }, { status: 500 });
  }
}

/** DELETE /api/dashboard?dir={workingDirectory}&widgetId={id} — remove a widget */
export async function DELETE(req: NextRequest) {
  try {
    const dir = req.nextUrl.searchParams.get('dir');
    const widgetId = req.nextUrl.searchParams.get('widgetId');
    if (!dir || !widgetId) {
      return NextResponse.json({ error: 'Missing dir or widgetId parameter' }, { status: 400 });
    }
    const config = removeWidget(dir, widgetId);
    return NextResponse.json(withGlobalWidgets(config));
  } catch (e) {
    console.error('[dashboard] DELETE failed:', e);
    return NextResponse.json({ error: 'Failed to delete widget' }, { status: 500 });
  }
}
