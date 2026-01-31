export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const { prompt, geminiKey, openaiKey, openrouterKey } = body;

    const GEMINI_MODELS = [
        "gemini-2.0-flash-exp",
        "gemini-1.5-flash",
        "gemini-1.5-flash-001",
        "gemini-1.5-flash-002",
        "gemini-1.5-pro"
    ];

    const OPENAI_MODELS = ["gpt-4o-mini", "gpt-3.5-turbo"];
    
    const OPENROUTER_MODELS = [
        "google/gemini-2.0-flash-exp:free",
        "google/gemini-exp-1206:free",
        "meta-llama/llama-3-8b-instruct:free"
    ];

    let lastError = null;
    let errors = [];

    // 1. Gemini
    if (geminiKey) {
        for (const model of GEMINI_MODELS) {
            try {
                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });
                const data = await resp.json();
                if (data.error) throw new Error(data.error.message);
                return new Response(JSON.stringify({ text: data.candidates[0].content.parts[0].text }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                errors.push(`Gemini(${model}): ${e.message}`);
                if (e.message.includes("API key")) break;
            }
        }
    }

    // 2. OpenAI
    if (openaiKey) {
        for (const model of OPENAI_MODELS) {
            try {
                const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openaiKey}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: prompt }]
                    })
                });
                const data = await resp.json();
                if (data.error) throw new Error(data.error.message);
                return new Response(JSON.stringify({ text: data.choices[0].message.content }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                errors.push(`OpenAI(${model}): ${e.message}`);
            }
        }
    }

    // 3. OpenRouter
    if (openrouterKey) {
        for (const model of OPENROUTER_MODELS) {
            try {
                const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openrouterKey}`,
                        'HTTP-Referer': 'https://koreadecode.com', 
                        'X-Title': 'Korea Decode Admin'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: prompt }]
                    })
                });
                const data = await resp.json();
                if (data.error) throw new Error(data.error.message);
                return new Response(JSON.stringify({ text: data.choices[0].message.content }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                errors.push(`OpenRouter(${model}): ${e.message}`);
            }
        }
    }

    return new Response(JSON.stringify({ error: "All models failed", details: errors }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}