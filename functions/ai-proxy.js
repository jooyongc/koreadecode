export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight requests
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

  try {
    const body = await request.json();
    const { prompt, userOpenRouterKey, userOpenAIKey, userGeminiKey } = body;

    // --- KEYS (User provided > Default) ---
    const OPENROUTER_KEY = userOpenRouterKey || "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";
    const GEMINI_KEY = userGeminiKey || "AIzaSyCM14GVoAINRtX8fk5LdkWjtC_gVQfMBmw";
    const OPENAI_KEY = userOpenAIKey || "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";

    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    };

    let errors = [];

    // --- 1. OpenRouter (Primary - free models available) ---
    const OR_MODELS = [
        "google/gemini-2.0-flash-exp:free",
        "google/gemini-exp-1206:free",
        "meta-llama/llama-3-8b-instruct:free",
        "mistralai/mistral-7b-instruct:free",
        "google/gemini-1.5-flash",
        "openai/gpt-4o-mini"
    ];

    for (const model of OR_MODELS) {
        try {
            const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_KEY}`,
                    'HTTP-Referer': 'https://koreadecode.com',
                    'X-Title': 'Korea Decode Admin'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: prompt }]
                })
            });

            const data = await resp.json();

            if (data.error) {
                errors.push(`OpenRouter(${model}): ${data.error.message || JSON.stringify(data.error)}`);
                continue;
            }

            return new Response(JSON.stringify({ text: data.choices[0].message.content }), { headers: corsHeaders });
        } catch (e) {
            errors.push(`OpenRouter(${model}): ${e.message}`);
        }
    }

    // --- 2. Gemini Direct ---
    try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        const data = await resp.json();
        if (!data.error) {
            return new Response(JSON.stringify({ text: data.candidates[0].content.parts[0].text }), { headers: corsHeaders });
        }
        errors.push(`Gemini: ${data.error.message}`);
    } catch (e) {
        errors.push(`Gemini: ${e.message}`);
    }

    // --- 3. OpenAI Direct (Final fallback) ---
    try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }]
            })
        });
        const data = await resp.json();
        if (!data.error) {
            return new Response(JSON.stringify({ text: data.choices[0].message.content }), { headers: corsHeaders });
        }
        errors.push(`OpenAI: ${data.error.message}`);
    } catch (e) {
        errors.push(`OpenAI: ${e.message}`);
    }

    return new Response(JSON.stringify({ error: "All AI providers failed", details: errors }), { status: 500, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal Server Error: " + err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
}
