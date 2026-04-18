export async function onRequest(context) {
  const { request, env } = context;

  // --- CORS: handle preflight ---
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const SUPABASE_URL = env.SUPABASE_URL || 'https://agkkvtfwqmzgbrqhvohs.supabase.co';
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFna2t2dGZ3cW16Z2JycWh2b2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MTU5MDIsImV4cCI6MjA4NjE5MTkwMn0.nZZ8Qrt0dU_v4CSeiVy4DM1IQLAEGBmKldtiotb6Oh8';

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
  const city = (url.searchParams.get('city') || '').trim().toLowerCase();
  const checkin = (url.searchParams.get('checkin') || '').trim();
  const nights = parseInt(url.searchParams.get('nights') || '0', 10);
  const pointsOnly = url.searchParams.get('points_only') === 'true';

  const offset = (page - 1) * limit;

  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact',
  };

  const selectFields = 'id,city,hotel_name,check_in,nights,cash_price,points_price,cpp,provider,deeplink,preset_id,featured,created_at';
  let filters = 'status=eq.active';

  if (city) filters += `&city=eq.${encodeURIComponent(city)}`;
  if (checkin && /^\d{4}-\d{2}-\d{2}$/.test(checkin)) {
    filters += `&check_in=eq.${encodeURIComponent(checkin)}`;
  }
  if (nights > 0) filters += `&nights=eq.${nights}`;
  if (pointsOnly) filters += `&points_price=not.is.null`;

  const queryURL = `${SUPABASE_URL}/rest/v1/hotel_deals?${filters}&select=${selectFields}&order=featured.desc,created_at.desc&offset=${offset}&limit=${limit}`;

  try {
    const res = await fetch(queryURL, { headers });

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ error: 'Failed to fetch deals', detail: errText }, 500);
    }

    const deals = await res.json();

    let total = 0;
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match) total = parseInt(match[1], 10);
    }

    const totalPages = Math.ceil(total / limit);

    return jsonResponse({
      deals,
      total,
      page,
      totalPages,
    });
  } catch (err) {
    return jsonResponse({ error: 'Internal error', detail: err.message }, 500);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=120, s-maxage=600',
      ...corsHeaders(),
    },
  });
}
