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
    const { prompt } = body; 

    // --- HARDCODED KEYS ---
    const OPENAI_KEY = "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";
    const GEMINI_KEY = "AIzaSyCM14GVoAINRtX8fk5LdkWjtC_gVQfMBmw";
    const OPENROUTER_KEY = "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";

    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", 
    };

    let errors = [];

    // --- STRATEGY: OpenRouter Mass-Trial (Use extensive list to ensure hit) ---
    // Includes :free models and cheap paid models as fallback
    const OR_MODELS = [
        "google/gemini-2.0-flash-exp:free",
        "google/gemini-exp-1206:free",
        "meta-llama/llama-3-8b-instruct:free",
        "huggingfaceh4/zephyr-7b-beta:free",
        "mistralai/mistral-7b-instruct:free",
        // Paid/Standard models (Will use your OR credits if free fails)
        "google/gemini-1.5-flash",
        "openai/gpt-4o-mini",
        "openai/gpt-3.5-turbo"
    ];

    console.log("Starting AI Proxy...");

    // 1. OpenRouter (Primary & Most Robust)
    for (const model of OR_MODELS) {
        try {
            console.log(`Trying OpenRouter: ${model}`);
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
                const errMsg = data.error.message || JSON.stringify(data.error);
                console.warn(`OpenRouter(${model}) Failed: ${errMsg}`);
                errors.push(`OpenRouter(${model}): ${errMsg}`);
                // Try next model
                continue;
            }
            
            // Success!
            return new Response(JSON.stringify({ text: data.choices[0].message.content }), { headers: corsHeaders });

        } catch (e) {
            console.error(`OpenRouter(${model}) Net Error: ${e.message}`);
            errors.push(`OpenRouter(${model}) Net Error: ${e.message}`);
        }
    }

    // 2. OpenAI Direct (Fallback - likely to fail if region blocked)
    try {
        console.log("Trying OpenAI direct...");
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
        } else {
            errors.push(`OpenAI Direct: ${data.error.message}`);
        }
    } catch (e) {
        errors.push(`OpenAI Direct Error: ${e.message}`);
    }

    // 3. Gemini Direct (Fallback - likely to fail if region blocked)
    try {
        console.log("Trying Gemini direct...");
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        const data = await resp.json();
        if (!data.error) {
            return new Response(JSON.stringify({ text: data.candidates[0].content.parts[0].text }), { headers: corsHeaders });
        } else {
            errors.push(`Gemini Direct: ${data.error.message}`);
        }
    } catch (e) {
        errors.push(`Gemini Direct Error: ${e.message}`);
    }

    return new Response(JSON.stringify({ error: "ALL FAILED", details: errors }), { status: 500, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal Server Error: " + err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
}