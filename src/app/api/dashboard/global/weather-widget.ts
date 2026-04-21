/**
 * Weather Widget HTML — small rectangular card with city persistence.
 * Data source: /api/weather proxy → Open-Meteo API (free, no API key needed).
 *
 * Layout: [城市名] [当前温度] [刷新] [三天预报: 图标+高温+低温]
 */

export const WEATHER_WIDGET_CODE = `
<div id="__root" style="
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--color-card, #f8f9fa);
  border-radius: 10px;
  min-height: 60px;
  color: var(--color-foreground, #1a1a1a);
  position: relative;
">
  <!-- City search (shown when no city is selected) -->
  <div id="city-search-box" style="display:none; align-items:center; gap:8px; flex:1;">
    <input id="city-input" type="text" placeholder="输入城市名称..."
      style="flex:1; padding:6px 10px; border:1px solid var(--color-border, #d1d5db); border-radius:6px; font-size:13px; background:var(--color-background); color:var(--color-foreground); outline:none;" />
    <button id="city-search-btn" style="
      padding:6px 12px; background:var(--color-primary,#3b82f6); color:white;
      border:none; border-radius:6px; font-size:13px; cursor:pointer;
    ">搜索</button>
  </div>

  <!-- Suggestions dropdown -->
  <div id="suggestions" style="
    display:none; position:absolute; top:100%; left:14px; right:14px; z-index:100;
    background:var(--color-card,#fff); border:1px solid var(--color-border,#d1d5db);
    border-radius:8px; margin-top:4px; max-height:160px; overflow-y:auto;
    box-shadow:0 4px 12px rgba(0,0,0,0.1);
  "></div>

  <!-- Main weather display -->
  <div id="weather-main" style="display:none; align-items:center; gap:12px; flex:1;">
    <div style="display:flex; align-items:center; gap:6px;">
      <span id="weather-icon" style="font-size:24px;">⛅</span>
      <div>
        <div id="city-name" style="font-size:13px; font-weight:600; color:var(--color-foreground);"></div>
        <div style="display:flex; align-items:center; gap:4px;">
          <span id="weather-desc" style="font-size:11px; color:var(--color-muted-foreground,#6b7280);"></span>
        </div>
      </div>
    </div>
    <div id="current-temp" style="
      font-size:28px; font-weight:700; color:var(--color-foreground);
      line-height:1; min-width:50px; text-align:center;
    "></div>
    <button id="refresh-btn" title="刷新" style="
      background:none; border:none; cursor:pointer; padding:4px;
      color:var(--color-muted-foreground,#9ca3af); font-size:16px; border-radius:4px;
      transition:color 0.2s;
    ">⟳</button>
  </div>

  <!-- 3-day forecast -->
  <div id="forecast" style="display:none; align-items:center; gap:8px;">
    <div id="forecast-list" style="display:flex; gap:12px;"></div>
  </div>

  <!-- Loading state -->
  <div id="loading" style="display:none; align-items:center; gap:8px; flex:1;">
    <span style="font-size:14px; color:var(--color-muted-foreground,#6b7280);">加载中...</span>
  </div>

  <!-- Error state -->
  <div id="error" style="display:none; align-items:center; flex:1;">
    <span id="error-msg" style="font-size:12px; color:#ef4444;"></span>
    <button id="retry-btn" style="
      margin-left:8px; padding:4px 10px; background:#f3f4f6; border:1px solid #d1d5db;
      border-radius:4px; font-size:12px; cursor:pointer;
    ">重试</button>
  </div>
</div>

<script>
(function() {
  var STORAGE_KEY = 'weather-widget-city';
  var currentCity = null;
  var currentLat = null;
  var currentLon = null;

  var root = document.getElementById('__root');
  var citySearchBox = document.getElementById('city-search-box');
  var cityInput = document.getElementById('city-input');
  var citySearchBtn = document.getElementById('city-search-btn');
  var suggestions = document.getElementById('suggestions');
  var weatherMain = document.getElementById('weather-main');
  var cityNameEl = document.getElementById('city-name');
  var weatherIcon = document.getElementById('weather-icon');
  var weatherDesc = document.getElementById('weather-desc');
  var currentTemp = document.getElementById('current-temp');
  var refreshBtn = document.getElementById('refresh-btn');
  var forecast = document.getElementById('forecast');
  var forecastList = document.getElementById('forecast-list');
  var loading = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var errorMsg = document.getElementById('error-msg');
  var retryBtn = document.getElementById('retry-btn');

  // WMO weather code to emoji + description
  var WMO_CODES = {
    0: ['☀️', '晴'], 1: ['🌤️', '多云'], 2: ['⛅', '阴'], 3: ['☁️', '阴'],
    45: ['🌫️', '雾'], 48: ['🌫️', '雾'],
    51: ['🌦️', '小雨'], 53: ['🌦️', '中雨'], 55: ['🌧️', '大雨'],
    61: ['🌦️', '小雨'], 63: ['🌧️', '中雨'], 65: ['⛈️', '大雨'],
    71: ['🌨️', '小雪'], 73: ['🌨️', '中雪'], 75: ['❄️', '大雪'],
    77: ['🌨️', '霰'], 80: ['🌦️', '阵雨'], 81: ['🌧️', '中阵雨'], 82: ['⛈️', '大阵雨'],
    85: ['🌨️', '阵雪'], 86: ['❄️', '大雪'],
    95: ['⛈️', '雷暴'], 96: ['⛈️', '雷暴'], 99: ['⛈️', '雷暴'],
  };

  function getWMO(code) { return WMO_CODES[code] || ['🌤️', '未知']; }

  function show(name) {
    [citySearchBox, weatherMain, forecast, loading, errorEl].forEach(function(el) { el.style.display = 'none'; });
    if (name === 'search') { citySearchBox.style.display = 'flex'; suggestions.style.display = 'none'; }
    else if (name === 'main') { weatherMain.style.display = 'flex'; forecast.style.display = 'flex'; }
    else if (name === 'loading') { loading.style.display = 'flex'; }
    else if (name === 'error') { errorEl.style.display = 'flex'; }
  }

  function setError(msg) { errorMsg.textContent = msg; show('error'); }

  function saveCity(city, lat, lon) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ city: city, lat: lat, lon: lon })); } catch(e) {}
  }

  function loadSavedCity() {
    try { var s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch(e) { return null; }
  }

  function searchCity(name, cb) {
    fetch('/api/weather?action=search&name=' + encodeURIComponent(name))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) { cb(data || []); })
      .catch(function() { cb([]); });
  }

  function fetchWeather(lat, lon, cb) {
    fetch('/api/weather?action=weather&lat=' + lat + '&lon=' + lon)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) { cb(data); })
      .catch(function() { cb(null); });
  }

  function render(city, data) {
    if (!data) { setError('获取天气数据失败'); return; }
    var current = data.current_weather || {};
    var daily = data.daily || {};
    var codes = daily.weathercode || [];
    var maxTemps = daily.temperature_2m_max || [];
    var minTemps = daily.temperature_2m_min || [];
    var days = daily.time || [];

    var w = getWMO(current.weathercode || 0);
    cityNameEl.textContent = city;
    weatherIcon.textContent = w[0];
    weatherDesc.textContent = w[1];
    currentTemp.textContent = (current.temperature !== undefined ? Math.round(current.temperature) : '--') + '°';
    weatherMain.style.display = 'flex';
    forecast.style.display = 'flex';

    forecastList.innerHTML = '';
    var count = Math.min(3, days.length);
    for (var i = 0; i < count; i++) {
      var dayName = getDayName(days[i]);
      var wi = getWMO(codes[i] || 0);
      var item = document.createElement('div');
      item.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:2px;';
      item.innerHTML =
        '<div style="font-size:11px; color:var(--color-muted-foreground,#6b7280);">' + dayName + '</div>' +
        '<div style="font-size:16px;">' + wi[0] + '</div>' +
        '<div style="font-size:12px; font-weight:600;">' + Math.round(maxTemps[i] || 0) + '°</div>' +
        '<div style="font-size:11px; color:var(--color-muted-foreground,#6b7280);">' + Math.round(minTemps[i] || 0) + '°</div>';
      forecastList.appendChild(item);
    }
  }

  function getDayName(dateStr) {
    if (!dateStr) return '--';
    var d = new Date(dateStr);
    var days = ['日', '一', '二', '三', '四', '五', '六'];
    var today = new Date();
    if (d.toDateString() === today.toDateString()) return '今天';
    var tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return '明天';
    return '周' + days[d.getDay()];
  }

  function loadWeather(city, lat, lon) {
    show('loading');
    currentCity = city; currentLat = lat; currentLon = lon;
    fetchWeather(lat, lon, function(data) {
      if (data) { render(city, data); saveCity(city, lat, lon); }
      else { setError('获取天气数据失败'); }
    });
  }

  function init() {
    var saved = loadSavedCity();
    if (saved && saved.city && saved.lat && saved.lon) { loadWeather(saved.city, saved.lat, saved.lon); }
    else { show('search'); }
  }

  citySearchBtn.onclick = function() {
    var q = cityInput.value.trim();
    if (!q) return;
    show('loading');
    searchCity(q, function(results) {
      if (!results || results.length === 0) { setError('未找到城市，请尝试其他名称'); return; }
      if (results.length === 1) { loadWeather(results[0].name, results[0].latitude, results[0].longitude); suggestions.style.display = 'none'; }
      else {
        suggestions.innerHTML = '';
        results.forEach(function(r) {
          var item = document.createElement('div');
          item.style.cssText = 'padding:8px 12px; cursor:pointer; font-size:13px; border-bottom:1px solid var(--color-border,#f3f4f6);';
          item.textContent = r.name + (r.admin1 ? ', ' + r.admin1 : '') + (r.country ? ', ' + r.country : '');
          item.onclick = function() { loadWeather(r.name, r.latitude, r.longitude); suggestions.style.display = 'none'; };
          item.onmouseenter = function() { item.style.background = 'var(--color-muted,#f3f4f6)'; };
          item.onmouseleave = function() { item.style.background = ''; };
          suggestions.appendChild(item);
        });
        suggestions.style.display = 'block';
        show('search');
      }
    });
  };

  cityInput.onkeydown = function(e) { if (e.key === 'Enter') citySearchBtn.click(); if (e.key === 'Escape') { suggestions.style.display = 'none'; } };

  refreshBtn.onclick = function() { if (currentCity && currentLat && currentLon) { loadWeather(currentCity, currentLat, currentLon); } };

  retryBtn.onclick = function() { show('search'); };

  // Listen for theme changes from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'widget:theme' && e.data.vars) {
      document.documentElement.style.setProperty('--color-background', e.data.vars['--background'] || '#ffffff');
      document.documentElement.style.setProperty('--color-foreground', e.data.vars['--foreground'] || '#1a1a1a');
      document.documentElement.style.setProperty('--color-card', e.data.vars['--card'] || '#ffffff');
      document.documentElement.style.setProperty('--color-border', e.data.vars['--border'] || '#e5e7eb');
      document.documentElement.style.setProperty('--color-muted-foreground', e.data.vars['--muted-foreground'] || '#6b7280');
      document.documentElement.style.setProperty('--color-primary', e.data.vars['--primary'] || '#3b82f6');
    }
  });

  init();
})();
</script>
`;
