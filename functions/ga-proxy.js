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

  const PROPERTY_ID = '521499132';

  try {
    // Get Service Account JSON from Cloudflare environment secret
    const saJson = env.GA_SERVICE_ACCOUNT;
    if (!saJson) throw new Error("GA_SERVICE_ACCOUNT secret not configured");

    const sa = typeof saJson === 'string' ? JSON.parse(saJson) : saJson;
    if (!sa.client_email || !sa.private_key) {
      throw new Error("GA_SERVICE_ACCOUNT JSON missing client_email or private_key");
    }

    // 1. Create JWT
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // Import private key and sign
    const privateKey = await importPrivateKey(sa.private_key);
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      privateKey,
      new TextEncoder().encode(signingInput)
    );
    const encodedSignature = base64url(signature);
    const jwt = `${signingInput}.${encodedSignature}`;

    // 2. Exchange JWT for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Token exchange failed: " + JSON.stringify(tokenData));
    const accessToken = tokenData.access_token;

    // Helper to fetch GA4 report and check for errors
    async function fetchGA4Report(body, label) {
      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(`GA4 ${label} failed (${res.status}): ${JSON.stringify(data.error || data)}`);
      }
      return data;
    }

    // 3. Fetch GA4 reports (last 28 days)
    const reportData = await fetchGA4Report({
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "totalUsers" },
        { name: "activeUsers" },
        { name: "sessions" },
      ],
    }, "overview");

    // 4. Fetch top pages
    const pagesData = await fetchGA4Report({
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    }, "topPages");

    // 5. Fetch traffic sources
    const sourcesData = await fetchGA4Report({
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 6,
    }, "trafficSources");

    // 6. Fetch daily page views (last 7 days for trend)
    const trendData = await fetchGA4Report({
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
    }, "dailyTrend");

    // Parse overview metrics
    const overviewRow = reportData.rows?.[0]?.metricValues || [];
    const pageViews = parseInt(overviewRow[0]?.value || '0');
    const totalUsers = parseInt(overviewRow[1]?.value || '0');
    const activeUsers = parseInt(overviewRow[2]?.value || '0');
    const sessions = parseInt(overviewRow[3]?.value || '0');

    // Parse top pages
    const topPages = (pagesData.rows || []).map(r => ({
      path: r.dimensionValues[0].value,
      views: parseInt(r.metricValues[0].value),
    }));

    // Parse sources
    const totalSessions = (sourcesData.rows || []).reduce((sum, r) => sum + parseInt(r.metricValues[0].value), 0);
    const sources = (sourcesData.rows || []).map(r => ({
      name: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value),
      percent: totalSessions > 0 ? Math.round((parseInt(r.metricValues[0].value) / totalSessions) * 100) : 0,
    }));

    // Parse daily trend
    const dailyTrend = (trendData.rows || []).map(r => ({
      date: r.dimensionValues[0].value,
      views: parseInt(r.metricValues[0].value),
      users: parseInt(r.metricValues[1].value),
    }));

    const result = {
      pageViews,
      totalUsers,
      activeUsers,
      sessions,
      topPages,
      sources,
      dailyTrend,
    };

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "max-age=300",
      },
    });

  } catch (err) {
    console.error("GA Proxy Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

// --- Utility Functions ---

function base64url(input) {
  let str;
  if (typeof input === 'string') {
    str = btoa(input);
  } else {
    // ArrayBuffer
    const bytes = new Uint8Array(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    str = btoa(binary);
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
