/**
 * 天气 API 代理路由
 * 由于 widget 在 sandboxed iframe 中运行，CSP 禁止 fetch 外部 API。
 * 此路由作为代理，允许 widget 通过 /api/weather 访问 Open-Meteo API。
 */

import { NextRequest, NextResponse } from 'next/server';

const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const action = searchParams.get('action');

  try {
    if (action === 'search') {
      // 城市搜索
      const name = searchParams.get('name');
      if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

      const url = `${GEO_API}?name=${encodeURIComponent(name)}&count=5&language=zh`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      const data = await res.json();
      return NextResponse.json(data);

    } else if (action === 'weather') {
      // 天气查询
      const lat = searchParams.get('lat');
      const lon = searchParams.get('lon');
      if (!lat || !lon) return NextResponse.json({ error: 'Missing lat/lon' }, { status: 400 });

      const url = `${WEATHER_API}?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`;
      const res = await fetch(url, { next: { revalidate: 1800 } });
      const data = await res.json();
      return NextResponse.json(data);

    } else {
      return NextResponse.json({ error: 'Invalid action. Use ?action=search&name=xxx or ?action=weather&lat=xxx&lon=xxx' }, { status: 400 });
    }
  } catch (err) {
    console.error('[weather/api] Error:', err);
    return NextResponse.json({ error: 'Proxy error' }, { status: 500 });
  }
}