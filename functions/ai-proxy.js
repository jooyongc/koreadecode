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
    const { prompt, userGeminiKey } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: "No prompt provided" }), { status: 400, headers: corsHeaders });
    }

    const GEMINI_KEY = userGeminiKey || env.GEMINI_KEY || '';
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: "No Gemini API key configured" }), { status: 400, headers: corsHeaders });
    }

    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
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
