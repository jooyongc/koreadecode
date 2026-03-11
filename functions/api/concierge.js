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

IMPORTANT: Your entire response must be a single valid JSON object with NO text before or after it. Do NOT wrap it in markdown code blocks. Do NOT add any explanation outside the JSON.

Use this exact JSON structure:
{"title":"Trip title","summary":"Brief overview","days":[{"day":"Day 1","theme":"Theme","activities":[{"time":"09:00","activity":"Name","description":"Brief description"}]}]}

Keep each activity description under 80 characters to stay within token limits.`;
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

Create a complete day-by-day itinerary with 3-5 activities per day. Keep descriptions concise. Output ONLY the raw JSON object, no markdown, no explanation.`;

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

      // Try configured model first, then fallback to gemini-2.0-flash
      const modelsToTry = [model, 'gemini-2.0-flash'].filter((v, i, a) => a.indexOf(v) === i);

      for (const tryModel of modelsToTry) {
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${geminiKey}`,
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
            console.warn(`Concierge: ${tryModel} response not valid JSON:`, geminiText.substring(0, 300));
            continue;
          }

          if (geminiData.error) {
            console.warn(`Concierge: ${tryModel} API error:`, geminiData.error.message);
            continue;
          }

          rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (rawText) {
            console.log(`Concierge: ${tryModel} succeeded`);
            break;
          }
        } catch (geminiErr) {
          console.warn(`Concierge: ${tryModel} failed:`, geminiErr.message);
        }
      }

      if (!rawText) {
        return jsonResponse({ error: 'AI service is temporarily unavailable. Please try again.' }, 503, corsHeaders);
      }
    }

    // --- Parse JSON from response ---
    let itinerary;
    try {
      itinerary = extractJSON(rawText);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message, 'Raw:', rawText.substring(0, 500));
      return jsonResponse({
        error: 'AI returned invalid format. Please try again.',
      }, 500, corsHeaders);
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

function extractJSON(rawText) {
  let text = rawText.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '');

  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (_) {}

  // Try to find JSON object in the text (AI sometimes adds preamble/postamble)
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
    } catch (_) {}
  }

  // Attempt to repair truncated JSON
  let repaired = jsonStart !== -1 ? text.substring(jsonStart) : text;
  // Remove trailing incomplete string/key
  repaired = repaired.replace(/,\s*"[^"]*$/, '');
  repaired = repaired.replace(/,\s*$/, '');
  // Close unclosed brackets
  const opens = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
  const braces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
  for (let i = 0; i < opens; i++) repaired += ']';
  for (let i = 0; i < braces; i++) repaired += '}';

  try {
    return JSON.parse(repaired);
  } catch (e) {
    throw new Error(`Cannot parse AI response as JSON: ${e.message}`);
  }
}
