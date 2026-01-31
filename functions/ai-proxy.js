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
    const { prompt } = body; // We ignore client-side keys now

    // --- HARDCODED KEYS (Provided by User) ---
    const OPENAI_KEY = "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";
    const GEMINI_KEY = "AIzaSyCM14GVoAINRtX8fk5LdkWjtC_gVQf5LdkWjtC_gVQ"; // Masked partially in log for safety, but using full key in logic
    const OPENROUTER_KEY = "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";

    // Response Headers for CORS
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", 
    };

    let errors = [];

    // STRATEGY: Try OpenAI first (Paid, Most Stable) -> Then Gemini -> Then OpenRouter

    // 1. OpenAI (GPT-4o-mini)
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
        
        if (data.error) {
            // If OpenAI fails (e.g. region block), log and continue
            errors.push(`OpenAI Error: ${data.error.message}`);
        } else {
            return new Response(JSON.stringify({ text: data.choices[0].message.content }), { headers: corsHeaders });
        }
    } catch (e) {
        errors.push(`OpenAI Network Error: ${e.message}`);
    }

    // 2. Gemini (1.5 Flash)
    try {
        // Use v1beta and standard model name
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AIzaSyCM14GVoAINRtX8fk5LdkWjtC_gVQfMBmw`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        const data = await resp.json();
        if (data.error) {
            errors.push(`Gemini Error: ${data.error.message}`);
        } else {
            return new Response(JSON.stringify({ text: data.candidates[0].content.parts[0].text }), { headers: corsHeaders });
        }
    } catch (e) {
        errors.push(`Gemini Network Error: ${e.message}`);
    }

    // 3. OpenRouter (Final Fallback)
    try {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_KEY}`
            },
            body: JSON.stringify({
                // Using a very standard model ID that usually works
                model: "mistralai/mistral-7b-instruct:free", 
                messages: [{ role: "user", content: prompt }]
            })
        });
        const data = await resp.json();
        if (data.error) {
            errors.push(`OpenRouter Error: ${data.error.message}`);
        } else {
            return new Response(JSON.stringify({ text: data.choices[0].message.content }), { headers: corsHeaders });
        }
    } catch (e) {
        errors.push(`OpenRouter Network Error: ${e.message}`);
    }

    return new Response(JSON.stringify({ error: "ALL FAILED", details: errors }), { status: 500, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal Server Error: " + err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
}