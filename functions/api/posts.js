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
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10)));
  const category = url.searchParams.get('category') || '';
  const search = url.searchParams.get('search') || '';

  const offset = (page - 1) * limit;

  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact',
  };

  // --- Build query filters ---
  const selectFields = 'id,title,slug,category,image,views,created_at,writer_name,writer_avatar';
  let filters = 'status=eq.published';

  if (category) {
    filters += `&category=eq.${encodeURIComponent(category)}`;
  }

  if (search) {
    // Use Supabase full-text or ilike on title
    filters += `&title=ilike.*${encodeURIComponent(search)}*`;
  }

  const queryURL = `${SUPABASE_URL}/rest/v1/posts?${filters}&select=${selectFields}&order=created_at.desc&offset=${offset}&limit=${limit}`;

  try {
    const res = await fetch(queryURL, { headers });

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ error: 'Failed to fetch posts', detail: errText }, 500);
    }

    const posts = await res.json();

    // Supabase returns total count in content-range header when Prefer: count=exact
    let total = 0;
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      // Format: "0-11/42" or "*/42"
      const match = contentRange.match(/\/(\d+)/);
      if (match) {
        total = parseInt(match[1], 10);
      }
    }

    const totalPages = Math.ceil(total / limit);

    return jsonResponse({
      posts,
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
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      ...corsHeaders(),
    },
  });
}
