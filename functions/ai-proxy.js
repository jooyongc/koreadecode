export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await request.json();
    const { prompt, userGeminiKey, model, generationConfig } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: "No prompt provided" }), { status: 400, headers: corsHeaders });
    }

    const GEMINI_KEY = userGeminiKey || env.GEMINI_API_KEY || env.GEMINI_KEY || '';
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: "No Gemini API key configured" }), { status: 400, headers: corsHeaders });
    }

    // Model selection with default
    const allowedModels = [
      'gemini-2.5-flash', 'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-1.5-pro', 'gemini-1.5-flash'
    ];
    const selectedModel = (model && allowedModels.includes(model)) ? model : 'gemini-2.5-flash';

    // Build request body
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    // Whitelist generationConfig params
    if (generationConfig && typeof generationConfig === 'object') {
      const allowed = {};
      if (typeof generationConfig.temperature === 'number') allowed.temperature = generationConfig.temperature;
      if (typeof generationConfig.maxOutputTokens === 'number') allowed.maxOutputTokens = generationConfig.maxOutputTokens;
      if (typeof generationConfig.topP === 'number') allowed.topP = generationConfig.topP;
      if (typeof generationConfig.topK === 'number') allowed.topK = generationConfig.topK;
      if (Object.keys(allowed).length > 0) {
        requestBody.generationConfig = allowed;
      }
    }

    // Cloudflare AI Gateway를 통해 호출 (한국 지역 차단 우회)
    const CF_ACCOUNT_ID = '17e57edaae05b0482ff770f37a54812d';
    const CF_GATEWAY = 'koreadecode';
    const resp = await fetch(`https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY}/google-ai-studio/v1beta/models/${selectedModel}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await resp.json();
    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), { status: 500, headers: corsHeaders });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: "Empty response from Gemini" }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ text }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Server Error: " + err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
}
