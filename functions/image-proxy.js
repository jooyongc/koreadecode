export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  const url = new URL(request.url);
  const source = url.searchParams.get("source") || "unsplash";
  const query = url.searchParams.get("query");
  const count = Math.min(parseInt(url.searchParams.get("count") || "5"), 30);
  const orientation = url.searchParams.get("orientation") || "landscape";

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing 'query' parameter" }), { status: 400, headers: corsHeaders });
  }

  try {
    if (source === "pexels") {
      return await fetchPexels(env, query, count, orientation, corsHeaders);
    } else {
      return await fetchUnsplash(env, query, count, orientation, corsHeaders);
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: "Proxy error: " + err.message }), { status: 500, headers: corsHeaders });
  }
}

async function fetchUnsplash(env, query, count, orientation, corsHeaders) {
  const key = env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: "UNSPLASH_ACCESS_KEY not configured" }), { status: 500, headers: corsHeaders });
  }

  const resp = await fetch(
    `https://api.unsplash.com/search/photos?page=1&per_page=${count}&query=${encodeURIComponent(query)}&orientation=${orientation}&client_id=${key}`
  );
  const data = await resp.json();

  if (!data.results) {
    return new Response(JSON.stringify({ source: "unsplash", images: [] }), { headers: corsHeaders });
  }

  const images = data.results.map(img => ({
    url: img.urls.regular,
    thumb: img.urls.small,
    alt: img.alt_description || query,
    user: img.user.name,
    user_link: img.user.links.html,
    source: "unsplash"
  }));

  return new Response(JSON.stringify({ source: "unsplash", images }), { headers: corsHeaders });
}

async function fetchPexels(env, query, count, orientation, corsHeaders) {
  const key = env.PEXELS_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: "PEXELS_API_KEY not configured" }), { status: 500, headers: corsHeaders });
  }

  const resp = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=${orientation}`,
    { headers: { Authorization: key } }
  );
  const data = await resp.json();

  if (!data.photos) {
    return new Response(JSON.stringify({ source: "pexels", images: [] }), { headers: corsHeaders });
  }

  const images = data.photos.map(photo => ({
    url: photo.src.large2x || photo.src.large,
    thumb: photo.src.medium,
    alt: photo.alt || query,
    user: photo.photographer,
    user_link: photo.photographer_url,
    source: "pexels"
  }));

  return new Response(JSON.stringify({ source: "pexels", images }), { headers: corsHeaders });
}
