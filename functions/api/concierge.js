export async function onRequest(context) {
  const { request, env } = context;

  const ALLOWED_ORIGINS = [
    'https://koreadecode.com',
    'https://www.koreadecode.com',
    'https://koreadecode.pages.dev',
  ];
  const origin = request.headers.get('Origin') || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const SUPABASE_URL = env.SUPABASE_URL || 'https://agkkvtfwqmzgbrqhvohs.supabase.co';
  const SUPABASE_KEY = env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFna2t2dGZ3cW16Z2JycWh2b2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MTU5MDIsImV4cCI6MjA4NjE5MTkwMn0.nZZ8Qrt0dU_v4CSeiVy4DM1IQLAEGBmKldtiotb6Oh8';

  try {
    const body = await request.json();
    const vibes = body.vibes || [];
    const duration = (body.duration || '').trim();
    const city = (body.city || '').trim();
    const budget = (body.budget || '').trim();
    const extra = (body.extra || '').trim().substring(0, 300).replace(/<[^>]*>/g, '');

    if (vibes.length === 0) {
      return jsonResponse({ error: 'Please select at least one vibe' }, 400, corsHeaders);
    }
    if (!duration || !city || !budget) {
      return jsonResponse({ error: 'Duration, city, and budget are required' }, 400, corsHeaders);
    }

    // --- Rate Limiting ---
    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const ipHash = await hashIP(clientIp);

    const rateLimitOk = await checkRateLimit(SUPABASE_URL, SUPABASE_KEY, ipHash);
    if (!rateLimitOk) {
      return jsonResponse({ error: 'Slow down! Try again in a moment.' }, 429, corsHeaders);
    }

    await supabasePost(SUPABASE_URL, SUPABASE_KEY, '/rest/v1/ai_rate_limits', { ip_hash: ipHash });

    // --- Load AI Config ---
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_config?feature_name=eq.korea_concierge&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const configs = await configRes.json();
    const config = configs[0] || {};

    if (config.is_active === false) {
      return jsonResponse({ error: 'Korea Concierge is currently disabled.' }, 503, corsHeaders);
    }

    const systemPrompt = config.system_prompt || `You are Korea Concierge, a premium AI travel planner for Korea. Create personalized day-by-day itineraries.

Respond ONLY in valid JSON with this structure:
{
  "title": "Trip title",
  "summary": "Brief overview",
  "days": [
    {
      "day": "Day 1",
      "theme": "Theme for the day",
      "activities": [
        {
          "time": "09:00",
          "activity": "Activity name",
          "description": "Brief description"
        }
      ]
    }
  ]
}`;
    const model = config.model || 'gemini-2.0-flash';
    const maxTokens = config.max_tokens || 4000;
    const temperature = config.temperature ?? 0.7;

    // --- Build User Prompt ---
    const userPrompt = `Plan a trip with these preferences:
- Interests: ${vibes.join(', ')}
- Duration: ${duration}
- City: ${city}
- Budget: ${budget}
${extra ? `- Special requests: ${extra}` : ''}

Create a complete day-by-day itinerary. Remember to respond ONLY in valid JSON format as specified in your instructions.`;

    // --- Call AI: Workers AI first, Gemini fallback ---
    let rawText = '';

    // Attempt 1: Workers AI (Cloudflare)
    if (env.AI) {
      try {
        const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: temperature,
        });
        rawText = (aiResponse.response || '').trim();
        if (rawText) {
          console.log('Concierge: Workers AI succeeded');
        }
      } catch (aiErr) {
        console.warn('Concierge: Workers AI failed, falling back to Gemini:', aiErr.message);
      }
    }

    // Attempt 2: Gemini API fallback
    if (!rawText) {
      const geminiKey = env.GEMINI_API_KEY;
      if (!geminiKey) {
        return jsonResponse({ error: 'AI service not configured' }, 500, corsHeaders);
      }

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
            ],
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: temperature,
            },
          }),
        }
      );

      const geminiText = await geminiRes.text();
      let geminiData;
      try {
        geminiData = JSON.parse(geminiText);
      } catch (parseErr) {
        console.error('Concierge: Gemini response not valid JSON:', geminiText.substring(0, 300));
        throw new Error('AI returned an invalid response.');
      }

      if (geminiData.error) {
        throw new Error(geminiData.error.message || 'Gemini API error');
      }

      rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!rawText) {
        throw new Error('Empty AI response');
      }
      console.log('Concierge: Gemini fallback succeeded');
    }

    // --- Parse JSON from response (strip markdown code blocks if present) ---
    let itinerary;
    try {
      let cleaned = rawText.trim();
      // Strip markdown code fences
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
      itinerary = JSON.parse(cleaned);
    } catch (parseErr) {
      // Attempt to repair truncated JSON
      try {
        let repaired = rawText.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
        // Close any unclosed strings, arrays, objects
        const opens = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
        const braces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
        // Trim trailing incomplete key/value
        repaired = repaired.replace(/,\s*"[^"]*$/, '');
        repaired = repaired.replace(/,\s*$/, '');
        for (let i = 0; i < opens; i++) repaired += ']';
        for (let i = 0; i < braces; i++) repaired += '}';
        itinerary = JSON.parse(repaired);
      } catch (repairErr) {
        console.error('JSON parse error:', parseErr, 'Raw:', rawText.substring(0, 300));
        return jsonResponse({
          error: 'AI returned invalid format. Please try again.',
        }, 500, corsHeaders);
      }
    }

    // --- Fetch Affiliate Links ---
    let affiliateLinks = [];
    try {
      const affRes = await fetch(
        `${SUPABASE_URL}/rest/v1/affiliate_links?city=eq.${encodeURIComponent(city)}&is_active=eq.true&order=display_order.asc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (affRes.ok) {
        affiliateLinks = await affRes.json();
      }
    } catch (e) {
      console.warn('Affiliate links fetch failed:', e);
    }

    // --- Log the query ---
    await supabasePost(SUPABASE_URL, SUPABASE_KEY, '/rest/v1/ai_concierge_logs', {
      vibes: JSON.stringify(vibes),
      duration,
      city,
      budget,
      extra_text: extra || null,
    });

    // --- Cleanup old rate limit records ---
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await fetch(
      `${SUPABASE_URL}/rest/v1/ai_rate_limits?requested_at=lt.${twoHoursAgo}`,
      {
        method: 'DELETE',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      }
    );

    return jsonResponse({ itinerary, affiliateLinks }, 200, corsHeaders);

  } catch (err) {
    console.error('Concierge API Error:', err);
    return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500, corsHeaders);
  }
}

// --- Helpers ---

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function hashIP(ip) {
  const data = new TextEncoder().encode(ip + '_korea_decode_salt');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkRateLimit(supabaseUrl, supabaseKey, ipHash) {
  const now = new Date();
  const oneMinAgo = new Date(now - 60 * 1000).toISOString();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

  const minRes = await fetch(
    `${supabaseUrl}/rest/v1/ai_rate_limits?ip_hash=eq.${ipHash}&requested_at=gte.${oneMinAgo}&select=id`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const minData = await minRes.json();
  if (minData.length >= 3) return false;

  const hourRes = await fetch(
    `${supabaseUrl}/rest/v1/ai_rate_limits?ip_hash=eq.${ipHash}&requested_at=gte.${oneHourAgo}&select=id`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const hourData = await hourRes.json();
  if (hourData.length >= 10) return false;

  return true;
}

async function supabasePost(supabaseUrl, supabaseKey, path, data) {
  return fetch(`${supabaseUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  });
}
