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

    // --- 1순위: Cloudflare Workers AI (무료, 지역 제한 없음) ---
    if (env.AI) {
      try {
        const cfModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
        const messages = [{ role: 'user', content: prompt }];
        const aiOptions = {};
        if (generationConfig) {
          if (typeof generationConfig.temperature === 'number') aiOptions.temperature = generationConfig.temperature;
          if (typeof generationConfig.maxOutputTokens === 'number') aiOptions.max_tokens = generationConfig.maxOutputTokens;
          if (typeof generationConfig.topP === 'number') aiOptions.top_p = generationConfig.topP;
        }
        const result = await env.AI.run(cfModel, { messages, ...aiOptions });
        if (result.response) {
          return new Response(JSON.stringify({ text: result.response }), { headers: corsHeaders });
        }
      } catch (aiErr) {
        console.error("[Workers AI] Failed, falling back to Gemini:", aiErr.message);
      }
    }

    // --- 2순위: Gemini API (직접 호출) ---
    const GEMINI_KEY = userGeminiKey || env.GEMINI_API_KEY || env.GEMINI_KEY || '';
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: "No Gemini API key configured" }), { status: 400, headers: corsHeaders });
    }

    const allowedModels = [
      'gemini-2.5-flash', 'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-1.5-pro', 'gemini-1.5-flash'
    ];
    const selectedModel = (model && allowedModels.includes(model)) ? model : 'gemini-2.5-flash';

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }]
    };

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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${GEMINI_KEY}`;
    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    // 응답이 JSON인지 확인
    const respText = await resp.text();
    let data;
    try {
      data = JSON.parse(respText);
    } catch (parseErr) {
      return new Response(JSON.stringify({ error: "Gemini returned invalid response (HTTP " + resp.status + ")" }), { status: 500, headers: corsHeaders });
    }

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
