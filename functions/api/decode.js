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
    // Parse request
    const body = await request.json();
    const question = (body.question || '').trim();

    if (!question) {
      return jsonResponse({ error: 'Question is required' }, 400, corsHeaders);
    }
    if (question.length > 500) {
      return jsonResponse({ error: 'Question too long (max 500 chars)' }, 400, corsHeaders);
    }

    // Sanitize: strip HTML tags
    const cleanQuestion = question.replace(/<[^>]*>/g, '');

    // --- Rate Limiting ---
    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const ipHash = await hashIP(clientIp);

    const rateLimitOk = await checkRateLimit(SUPABASE_URL, SUPABASE_KEY, ipHash);
    if (!rateLimitOk) {
      return jsonResponse({ error: 'Slow down! Try again in a moment.' }, 429, corsHeaders);
    }

    // Record this request for rate limiting
    await supabasePost(SUPABASE_URL, SUPABASE_KEY, '/rest/v1/ai_rate_limits', { ip_hash: ipHash });

    // --- Load AI Config ---
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_config?feature_name=eq.decode_this&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const configs = await configRes.json();
    const config = configs[0] || {};

    if (config.is_active === false) {
      return jsonResponse({ error: 'This feature is currently disabled.' }, 503, corsHeaders);
    }

    const systemPrompt = config.system_prompt || 'You are Korea Decode AI, a Korean culture interpreter. Respond concisely in English.';
    const model = config.model || 'gemini-2.0-flash';
    const maxTokens = config.max_tokens || 500;
    const temperature = config.temperature ?? 0.7;

    // --- Call AI: Workers AI first, Gemini fallback ---
    let answer = '';

    // Attempt 1: Workers AI (Cloudflare)
    if (env.AI) {
      try {
        const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: cleanQuestion },
          ],
          max_tokens: maxTokens,
          temperature: temperature,
        });
        const aiText = typeof aiResponse.response === 'string' ? aiResponse.response : JSON.stringify(aiResponse.response || '');
        answer = aiText.trim();
        if (answer) {
          console.log('Decode: Workers AI succeeded');
        }
      } catch (aiErr) {
        console.warn('Decode: Workers AI failed, falling back to Gemini:', aiErr.message);
      }
    }

    // Attempt 2: Gemini API fallback
    if (!answer) {
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
              { role: 'user', parts: [{ text: `${systemPrompt}\n\nUser question: ${cleanQuestion}` }] }
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
        console.error('Decode: Gemini response not valid JSON:', geminiText.substring(0, 300));
        throw new Error('AI returned an invalid response.');
      }

      if (geminiData.error) {
        throw new Error(geminiData.error.message || 'Gemini API error');
      }

      answer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!answer) {
        throw new Error('Empty AI response');
      }
      console.log('Decode: Gemini fallback succeeded');
    }

    // --- Find Related Posts ---
    const keywords = extractKeywords(cleanQuestion);
    let relatedPosts = [];
    if (keywords.length > 0) {
      const orFilter = keywords.map(k => `title.ilike.%${k}%`).join(',');
      const postsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/posts?or=(${encodeURIComponent(orFilter)})&status=eq.published&select=id,title,slug&limit=2`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (postsRes.ok) {
        relatedPosts = await postsRes.json();
      }
    }

    // --- Log the query ---
    const answerSummary = answer.substring(0, 100);
    await supabasePost(SUPABASE_URL, SUPABASE_KEY, '/rest/v1/ai_decode_logs', {
      question: cleanQuestion,
      answer_summary: answerSummary,
      ip_hash: ipHash,
    });

    // --- Cleanup old rate limit records (older than 2 hours) ---
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await fetch(
      `${SUPABASE_URL}/rest/v1/ai_rate_limits?requested_at=lt.${twoHoursAgo}`,
      {
        method: 'DELETE',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      }
    );

    return jsonResponse({ answer, relatedPosts }, 200, corsHeaders);

  } catch (err) {
    console.error('Decode API Error:', err);
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

  // Check per-minute limit (5 requests)
  const minRes = await fetch(
    `${supabaseUrl}/rest/v1/ai_rate_limits?ip_hash=eq.${ipHash}&requested_at=gte.${oneMinAgo}&select=id`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const minData = await minRes.json();
  if (minData.length >= 5) return false;

  // Check per-hour limit (20 requests)
  const hourRes = await fetch(
    `${supabaseUrl}/rest/v1/ai_rate_limits?ip_hash=eq.${ipHash}&requested_at=gte.${oneHourAgo}&select=id`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const hourData = await hourRes.json();
  if (hourData.length >= 20) return false;

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

function extractKeywords(text) {
  const stopWords = new Set(['what', 'why', 'how', 'does', 'do', 'is', 'are', 'the', 'a', 'an', 'in', 'of', 'to', 'and', 'or', 'for', 'it', 'this', 'that', 'about', 'mean', 'explain', 'tell', 'me']);
  const words = text
    .replace(/[^\w\s가-힣]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .map(w => w.toLowerCase());
  // Return unique, max 4
  return [...new Set(words)].slice(0, 4);
}
