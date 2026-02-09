import { supabase } from '/js/supabase-config.js';

const UNSPLASH_ACCESS_KEY = 'Ikq6GOeQuWc_77ydvsODR4GFqahyl7mdL6YCQRGqPIg';

// --- AI CALL: Direct Gemini API from browser ---
async function callAI(prompt) {
    const geminiKey = localStorage.getItem('gemini_key');
    if (!geminiKey) {
        throw new Error("Gemini API Key가 설정되지 않았습니다. Settings에서 키를 입력해주세요.");
    }

    console.log("[AI] Calling Gemini directly...");
    try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message);
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Empty response from Gemini");
        console.log("[AI] Gemini success");
        return text;
    } catch (e) {
        console.error("[AI] Gemini failed:", e);
        throw new Error("AI Error: " + e.message);
    }
}

function cleanJSONResponse(text) {
    text = text.trim();
    if (text.startsWith("```json")) {
        text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (text.startsWith("```")) {
        text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    return text;
}



let quill;
let activeImage = '';
let currentUser = null;
let editingPostId = null;
let editingPersonaId = null;
let availablePersonas = [];

// --- CORE INITIALIZATION ---
async function init() {
    // Initialize Quill Editor
    quill = new Quill('#editor-container', {
        theme: 'snow',
        modules: {
            toolbar: [
                [{ 'header': [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'blockquote'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ['link', 'clean']
            ]
        }
    });
    quill.on('text-change', calculateSEOScore);

    // Supabase Auth: Check existing session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        document.getElementById('login-section').style.display = 'none';
        loadDashboard();
        loadPersonas();
    } else {
        document.getElementById('login-section').style.display = 'flex';
    }

    // Supabase Auth State Listener
    supabase.auth.onAuthStateChange((event, session) => {
        if (session) {
            currentUser = session.user;
            document.getElementById('login-section').style.display = 'none';
            loadDashboard();
            loadPersonas();
        } else {
            currentUser = null;
            document.getElementById('login-section').style.display = 'flex';
        }
    });

    // --- STATIC EVENT LISTENERS ---
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
        el.addEventListener('click', () => switchView(el.dataset.view));
    });

    document.getElementById('btn-login').addEventListener('click', doLogin);
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabase.auth.signOut();
    });

    document.getElementById('btn-reset-ai').addEventListener('click', resetAI);
    document.getElementById('btn-seo-polish').addEventListener('click', runSEOPolish);
    document.getElementById('btn-run-ai-phase1').addEventListener('click', runAIPhase1);
    document.getElementById('btn-run-ai-phase2').addEventListener('click', runAIPhase2);
    document.getElementById('btn-search-unsplash').addEventListener('click', searchUnsplashAI);
    document.getElementById('btn-save-post').addEventListener('click', publishPost);
    document.getElementById('btn-show-preview').addEventListener('click', showMobilePreview);

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-remove-duplicates').addEventListener('click', removeDuplicates);
    document.getElementById('btn-generate-persona').addEventListener('click', generateRandomPersona);
    document.getElementById('btn-save-persona').addEventListener('click', saveOrUpdatePersona);
    document.getElementById('btn-cancel-persona').addEventListener('click', resetPersonaForm);

    document.getElementById('btn-run-automation').addEventListener('click', runAutomation);
    document.getElementById('btn-start-migration').addEventListener('click', startMigration);

    document.getElementById('btn-close-unsplash').addEventListener('click', () => closeModal('modal-unsplash'));
    document.getElementById('btn-close-preview').addEventListener('click', () => closeModal('modal-preview'));

    const personaList = document.getElementById('persona-list');
    personaList.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const action = button.dataset.action;
        const id = button.dataset.id;
        if (action === 'edit') editPersona(id);
        else if (action === 'delete') deletePersona(id);
    });

    const savedKey = localStorage.getItem('gemini_key');
    document.getElementById('setting-gemini-key').value = savedKey || '';
    document.getElementById('setting-gemini-key').placeholder = 'AIzaSy...';

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('auto-start-date').value = now.toISOString().slice(0, 16);
}


// --- VIEW SWITCHING ---
const switchView = (viewName) => {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${viewName}"]`).classList.add('active');

    if (viewName === 'posts') loadPosts();
    if (viewName === 'dashboard') loadDashboard();
    if (viewName === 'automation') loadQueue();
    if (viewName === 'settings') loadPersonas();
    if (viewName === 'ai-writer') {
        if (!editingPostId) resetAI();
        refreshPersonaSelect();
    }
};

// --- AUTHENTICATION ---
async function doLogin() {
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    try {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
        if (error) throw error;
    } catch (err) {
        document.getElementById('login-error').innerText = err.message;
    }
}

// --- SETTINGS ---
const saveSettings = () => {
    const k = document.getElementById('setting-gemini-key').value.trim();
    if (!k) return alert('Gemini API Key를 입력해주세요.');
    localStorage.setItem('gemini_key', k);
    alert('Gemini API Key 저장 완료!');
};

// --- MODALS ---
const closeModal = (id) => document.getElementById(id).style.display = 'none';


// --- PERSONA MANAGEMENT ---
async function loadPersonas() {
    const list = document.getElementById('persona-list');
    list.innerHTML = 'Loading...';
    try {
        const { data, error } = await supabase.from('personas').select('*');
        if (error) throw error;

        availablePersonas = data || [];
        list.innerHTML = '';
        availablePersonas.forEach(p => {
            list.innerHTML += `
                <div class="persona-card">
                    <div style="display:flex; align-items:center;">
                        <div class="persona-avatar">${p.name[0]}</div>
                        <div class="persona-details">
                            <div class="persona-name">${p.name} (${p.age})</div>
                            <div class="persona-role">${p.nationality} • ${p.job}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-outline" data-action="edit" data-id="${p.id}" style="padding: 4px 8px; font-size:12px;"><i class="ph ph-pencil"></i></button>
                        <button class="btn btn-outline" data-action="delete" data-id="${p.id}" style="color:var(--danger); border-color:var(--danger); padding: 4px 8px; font-size:12px;"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
            `;
        });
        if (availablePersonas.length === 0) list.innerHTML = '<div style="color:var(--text-muted); padding:10px;">No personas created yet.</div>';
        refreshPersonaSelect();
    } catch (e) {
        console.error(e);
        list.innerHTML = 'Failed to load personas.';
    }
}

const editPersona = (id) => {
    const p = availablePersonas.find(item => item.id === id);
    if (!p) return;

    editingPersonaId = id;
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-age').value = p.age;
    document.getElementById('p-gender').value = p.gender;
    document.getElementById('p-nationality').value = p.nationality;
    document.getElementById('p-job').value = p.job;
    document.getElementById('p-likes').value = p.likes;
    document.getElementById('p-bio').value = p.bio;

    document.getElementById('persona-form-title').innerText = "Edit Persona";
    document.getElementById('btn-save-persona').innerText = "Update Persona";
    document.getElementById('btn-cancel-persona').style.display = 'block';

    document.getElementById('persona-form-title').scrollIntoView({ behavior: "smooth" });
};

const resetPersonaForm = () => {
    editingPersonaId = null;
    document.getElementById('p-name').value = '';
    document.getElementById('p-likes').value = '';
    document.getElementById('p-bio').value = '';
    document.getElementById('persona-form-title').innerText = "Create New Persona";
    document.getElementById('btn-save-persona').innerText = "Add Persona";
    document.getElementById('btn-cancel-persona').style.display = 'none';
};

function generateRandomPersona() {
    const names = ["Emma", "Liam", "Sophia", "Noah", "Olivia", "James", "Ava", "William"];
    const jobs = ["Travel Blogger", "K-Beauty Editor", "Food Critic", "K-Pop Stan", "Digital Nomad", "Student"];
    const countries = ["USA", "UK", "Canada", "Australia", "France", "Germany", "Singapore"];
    const likesList = ["Spicy tteokbokki", "Hidden cafes", "Indie music", "Skincare routines", "History", "Street food"];

    const rName = names[Math.floor(Math.random() * names.length)] + " " + ["Smith", "Kim", "Lee", "Johnson", "Brown"][Math.floor(Math.random() * 5)];
    const rJob = jobs[Math.floor(Math.random() * jobs.length)];
    const rCountry = countries[Math.floor(Math.random() * countries.length)];
    const rLikes = likesList[Math.floor(Math.random() * likesList.length)];

    document.getElementById('p-name').value = rName;
    document.getElementById('p-job').value = rJob;
    document.getElementById('p-nationality').value = rCountry;
    document.getElementById('p-likes').value = rLikes;

    const bio = `Hi, I'm ${rName}! I'm a ${rJob} from ${rCountry} currently exploring every corner of Korea. I'm obsessed with ${rLikes} and love sharing my honest experiences. Follow along for my local tips!`;
    document.getElementById('p-bio').value = bio;
}

async function saveOrUpdatePersona() {
    const name = document.getElementById('p-name').value;
    const age = document.getElementById('p-age').value;
    const gender = document.getElementById('p-gender').value;
    const nationality = document.getElementById('p-nationality').value;
    const job = document.getElementById('p-job').value;
    const likes = document.getElementById('p-likes').value;
    const bio = document.getElementById('p-bio').value;

    if (!name || !job) return alert('Name and Job are required');

    const personaData = { name, age, gender, nationality, job, likes, bio };

    if (editingPersonaId) {
        const { error } = await supabase.from('personas').update(personaData).eq('id', editingPersonaId);
        if (error) return alert('Error: ' + error.message);
        alert('Persona Updated!');
    } else {
        const { error } = await supabase.from('personas').insert(personaData);
        if (error) return alert('Error: ' + error.message);
        alert('Persona Created!');
    }

    resetPersonaForm();
    loadPersonas();
}

const deletePersona = async (id) => {
    if (confirm('Are you sure you want to delete this persona?')) {
        await supabase.from('personas').delete().eq('id', id);
        loadPersonas();
    }
};

function refreshPersonaSelect() {
    const sel = document.getElementById('ai-persona-select');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="default">Default AI (Generic)</option>';
    availablePersonas.forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${p.name} - ${p.job} (${p.nationality})</option>`;
    });
    if (currentVal) sel.value = currentVal;
}


// --- DASHBOARD ANALYTICS ---
async function loadDashboard() {
    const { data: posts, error } = await supabase.from('posts').select('title, views, status');
    if (error) { console.error(error); return; }

    let totalViews = 0;
    let scheduled = 0;
    let postList = [];

    (posts || []).forEach(d => {
        if (d.status === 'scheduled') scheduled++;
        totalViews += (d.views || 0);
        postList.push({ title: d.title, views: d.views || 0 });
    });

    // Fetch GA4 Data (via Proxy)
    try {
        const gaRes = await fetch('/ga-proxy', { method: 'POST' });
        if (gaRes.ok) {
            const gaData = await gaRes.json();
            if (gaData.pageViews) {
                document.getElementById('stat-views').innerText = gaData.pageViews.toLocaleString();
            } else {
                document.getElementById('stat-views').innerText = totalViews.toLocaleString();
            }
        } else {
            document.getElementById('stat-views').innerText = totalViews.toLocaleString();
        }
    } catch (e) {
        console.warn("GA Fetch Failed, using DB stats:", e);
        document.getElementById('stat-views').innerText = totalViews.toLocaleString();
    }

    document.getElementById('stat-posts').innerText = (posts || []).length;
    document.getElementById('stat-scheduled').innerText = scheduled;

    postList.sort((a, b) => b.views - a.views);
    const top5 = postList.slice(0, 5);
    const tbody = document.querySelector('#dashboard-top-posts tbody');
    tbody.innerHTML = '';
    top5.forEach(p => {
        tbody.innerHTML += `<tr><td>${p.title}</td><td style="text-align:right; font-weight:bold;">${p.views.toLocaleString()}</td></tr>`;
    });
}

async function removeDuplicates() {
    if (!confirm("This will delete duplicate posts (keeping oldest). Continue?")) return;
    const btn = document.getElementById('btn-remove-duplicates');
    btn.innerText = "Processing...";
    btn.disabled = true;
    try {
        const { data, error } = await supabase.from('posts').select('id, title, created_at').order('created_at', { ascending: true });
        if (error) throw error;

        const seen = new Set();
        let count = 0;
        for (const d of (data || [])) {
            if (seen.has(d.title)) {
                await supabase.from('posts').delete().eq('id', d.id);
                count++;
            } else {
                seen.add(d.title);
            }
        }
        alert(`Deleted ${count} duplicates.`);
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "Remove Duplicate Posts";
        btn.disabled = false;
    }
}

window.editPost = async (id) => {
    editingPostId = id;
    switchView('ai-writer');
    document.getElementById('writer-heading').innerText = "Edit Post";
    document.getElementById('btn-save-post').innerHTML = '<i class="ph ph-floppy-disk"></i> Update';

    const { data: p, error } = await supabase.from('posts').select('*').eq('id', id).single();
    if (error || !p) return;

    document.getElementById('ai-suggested-title').value = p.title;
    document.getElementById('ai-category').value = p.category;
    quill.clipboard.dangerouslyPasteHTML(p.content);
    activeImage = p.image;
    if (activeImage) {
        document.getElementById('selected-ai-img').src = activeImage;
        document.getElementById('selected-ai-img').style.display = 'block';
        document.getElementById('ai-img-placeholder').style.display = 'none';
    }
    document.getElementById('step-1').classList.remove('active');
    document.getElementById('step-2').style.opacity = '1';
    document.getElementById('step-2').style.pointerEvents = 'auto';
    document.getElementById('step-2').classList.remove('active');
    document.getElementById('step-3').style.opacity = '1';
    document.getElementById('step-3').style.pointerEvents = 'auto';
    document.getElementById('step-3').classList.add('active');
};

window.resetAI = () => {
    editingPostId = null;
    document.getElementById('writer-heading').innerText = "AI Content Creator";
    document.getElementById('btn-save-post').innerHTML = '<i class="ph ph-paper-plane-right"></i> Publish';

    document.getElementById('step-1').classList.add('active');
    document.getElementById('step-2').style.opacity = '0.5';
    document.getElementById('step-2').style.pointerEvents = 'none';
    document.getElementById('step-3').style.opacity = '0.5';
    document.getElementById('ai-topic').value = '';
    document.getElementById('ai-suggested-title').value = '';
    document.getElementById('ai-keywords-container').innerHTML = '';
    quill.setText('');
    activeImage = '';
    document.getElementById('selected-ai-img').style.display = 'none';
    document.getElementById('ai-img-placeholder').style.display = 'block';
};

window.runAIPhase1 = async () => {
    const topic = document.getElementById('ai-topic').value;
    if (!topic) return alert('Please enter a topic');

    const btn = document.querySelector('#step-1 .btn-ai');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Brainstorming SEO Plan...';
    btn.disabled = true;

    // Get selected persona for title generation
    const personaId = document.getElementById('ai-persona-select').value;
    let persona = availablePersonas.find(p => p.id === personaId);
    let personaContext = '';
    if (persona) {
        personaContext = `
**Writer Persona Context (titles MUST reflect this voice):**
- Name: ${persona.name}, a ${persona.age} ${persona.gender} ${persona.nationality} ${persona.job}
- Passionate about: ${persona.likes}
- Voice: ${persona.nationality === 'USA' ? 'Casual American English, uses slang and pop-culture references' : persona.nationality === 'UK' ? 'Witty British English, dry humor' : persona.nationality === 'Australia' ? 'Laid-back Australian tone, friendly slang' : persona.nationality === 'France' ? 'Sophisticated European perspective, refined taste' : persona.nationality === 'Germany' ? 'Precise, detail-oriented, practical perspective' : persona.nationality === 'Singapore' ? 'Southeast Asian perspective, multicultural awareness' : persona.nationality === 'Japan' ? 'Attention to aesthetics and detail, cultural bridge perspective' : 'International perspective with unique cultural lens'}
- The titles should sound like something THIS specific person would write — not generic blog titles.
`;
    }

    try {
        const prompt = `
Analyze the topic: "${topic}".
${personaContext}
Your task is to generate a comprehensive SEO plan for a blog post on this topic for the website 'Korea Decode'.

Provide your response in a clean JSON format, like this:
{
  "suggested_titles": [
    "Unique, engaging, SEO-friendly title that matches the writer's voice 1",
    "Alternative creative title reflecting the persona's perspective 2",
    "Another compelling title with the writer's unique angle 3"
  ],
  "seo_keywords": [
    "primary keyword",
    "secondary keyword",
    "long-tail keyword 1",
    "semantic keyword",
    "related topic"
  ]
}

Ensure the titles are captivating, reflect the writer's unique personality and expertise, and the keywords are highly relevant for ranking on Google.
`;

        let rawText = await callAI(prompt);
        rawText = cleanJSONResponse(rawText);
        const data = JSON.parse(rawText);

        document.getElementById('ai-suggested-title').value = data.suggested_titles[0] || `Guide to ${topic}`;
        const kwContainer = document.getElementById('ai-keywords-container');
        kwContainer.innerHTML = '';
        data.seo_keywords.forEach(k => kwContainer.innerHTML += `<span class="suggestion-chip selected">${k}</span>`);

        const titleContainer = document.getElementById('ai-title-options-container') || document.createElement('div');
        if (!titleContainer.id) {
            titleContainer.id = 'ai-title-options-container';
            document.querySelector('#step-2 .form-group').insertAdjacentElement('afterend', titleContainer);
        }
        titleContainer.innerHTML = '<label class="form-label" style="margin-top:15px;">Title Suggestions</label>';
        data.suggested_titles.forEach(title => {
            const chip = document.createElement('span');
            chip.className = 'suggestion-chip';
            chip.innerText = title;
            chip.onclick = () => {
                document.getElementById('ai-suggested-title').value = title;
                document.querySelectorAll('#ai-title-options-container .suggestion-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
            };
            titleContainer.appendChild(chip);
        });

        document.getElementById('step-1').classList.remove('active');
        document.getElementById('step-2').style.opacity = '1';
        document.getElementById('step-2').style.pointerEvents = 'auto';
        document.getElementById('step-2').classList.add('active');
        document.getElementById('ai-img-query').value = topic + " aesthetic";

    } catch (e) {
        alert("AI Error: " + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

window.runAIPhase2 = async () => {
    const title = document.getElementById('ai-suggested-title').value;
    const topic = document.getElementById('ai-topic').value;
    const keywords = Array.from(document.querySelectorAll('#ai-keywords-container .suggestion-chip')).map(el => el.innerText);
    const personaId = document.getElementById('ai-persona-select').value;

    if (!title) return alert('Please generate or select a title first.');

    const btn = document.querySelector('#step-2 .btn-primary');
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Fetching images & writing...';
    btn.disabled = true;

    let persona = availablePersonas.find(p => p.id === personaId);
    if (!persona) {
        persona = {
            name: "Korea Decode Editor",
            nationality: "Seoul",
            job: "Travel Guide",
            likes: "everything",
            age: "30s",
            gender: "Non-binary",
            bio: "Your guide to all things Korea."
        };
    }

    // 1. Fetch Images from Unsplash
    let allImages = [];
    const searchQuery = encodeURIComponent(`${topic} ${keywords.slice(0, 2).join(' ')} korea`);
    try {
        console.log("[Unsplash] Searching:", searchQuery);
        const res = await fetch(`https://api.unsplash.com/search/photos?page=1&per_page=5&query=${searchQuery}&orientation=landscape&client_id=${UNSPLASH_ACCESS_KEY}`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            allImages = data.results.map(img => ({
                url: img.urls.regular,
                alt: img.alt_description || title,
                user: img.user.name,
                user_link: img.user.links.html
            }));
        }
    } catch (e) {
        console.error("Unsplash Error:", e);
    }

    if (allImages.length < 3) {
        try {
            const res = await fetch(`https://api.unsplash.com/search/photos?page=1&per_page=5&query=${encodeURIComponent(topic)}&orientation=landscape&client_id=${UNSPLASH_ACCESS_KEY}`);
            const data = await res.json();
            if (data.results) {
                const existingUrls = new Set(allImages.map(i => i.url));
                data.results.forEach(img => {
                    if (!existingUrls.has(img.urls.regular)) {
                        allImages.push({
                            url: img.urls.regular,
                            alt: img.alt_description || title,
                            user: img.user.name,
                            user_link: img.user.links.html
                        });
                    }
                });
            }
        } catch (e) {
            console.error("Unsplash fallback error:", e);
        }
    }

    if (allImages.length > 0) {
        activeImage = allImages[0].url;
        document.getElementById('selected-ai-img').src = activeImage;
        document.getElementById('selected-ai-img').style.display = 'block';
        document.getElementById('ai-img-placeholder').style.display = 'none';
    }
    const contentImages = allImages.slice(1, 4);
    const imgCount = contentImages.length;

    // 2. Generate Content with AI
    let content = '';

    try {
        // Build persona-specific voice guidelines
        let voiceGuide = '';
        if (persona.nationality === 'USA') voiceGuide = 'Write in casual American English. Use modern slang, pop-culture references, and enthusiastic energy. Say things like "honestly," "literally," "game-changer," "vibe check." Be upbeat and relatable like a popular American vlogger.';
        else if (persona.nationality === 'UK') voiceGuide = 'Write in British English with dry wit and understated humor. Use phrases like "rather brilliant," "spot on," "quite frankly." Be charming but not over-the-top. Think educated British travel writer.';
        else if (persona.nationality === 'Australia') voiceGuide = 'Write in laid-back Australian English. Use phrases like "no worries," "heaps of," "reckon," "arvo." Be friendly, adventurous, and down-to-earth like a backpacker sharing stories at a hostel.';
        else if (persona.nationality === 'France') voiceGuide = 'Write with a sophisticated European sensibility. Compare Korean culture to French equivalents. Appreciate aesthetics, food quality, and craftsmanship. Use occasional French expressions naturally.';
        else if (persona.nationality === 'Germany') voiceGuide = 'Write with precision and thoroughness. Be practical and detail-oriented. Include specific facts, prices, and logistics. Compare efficiency and systems to German standards.';
        else if (persona.nationality === 'Singapore') voiceGuide = 'Write from a Southeast Asian multicultural perspective. Draw comparisons with Singaporean culture, food, and lifestyle. Use Singlish-flavored expressions occasionally. Be warm and community-oriented.';
        else if (persona.nationality === 'Japan') voiceGuide = 'Write with attention to aesthetics and cultural nuance. Draw comparisons between Korean and Japanese culture. Appreciate the subtle details. Be polite yet personal.';
        else if (persona.nationality === 'Canada') voiceGuide = 'Write in friendly Canadian English. Be polite, inclusive, and warm. Compare to Canadian multicultural experience. Use phrases like "for sure," "pretty solid." Be genuine and approachable.';
        else voiceGuide = 'Write with a unique international perspective. Share how Korean culture looks through your cultural lens. Be authentic and personal.';

        let jobVoice = '';
        if (persona.job.includes('Blogger') || persona.job.includes('Nomad')) jobVoice = 'Write like an experienced travel content creator — practical tips, hidden gems, budget advice, personal anecdotes from the road.';
        else if (persona.job.includes('Beauty') || persona.job.includes('Skincare')) jobVoice = 'Write like a beauty industry insider — ingredient knowledge, product comparisons, application techniques, before/after experiences.';
        else if (persona.job.includes('Food') || persona.job.includes('Critic')) jobVoice = 'Write like a food journalist — flavor descriptions, cooking techniques, restaurant atmosphere, cultural context of dishes.';
        else if (persona.job.includes('K-Pop') || persona.job.includes('Stan')) jobVoice = 'Write like a passionate K-Pop fan with deep knowledge — fandom terminology, comeback analysis, concert experiences, idol culture insights.';
        else if (persona.job.includes('Student')) jobVoice = 'Write like a young student abroad — budget-conscious, discovering things for the first time, relatable struggles and excitement.';
        else jobVoice = 'Write with professional authority in your field while keeping it accessible to general readers.';

        const prompt = `
**You ARE ${persona.name}. Stay in character for the ENTIRE article.**

**Your Identity:**
- ${persona.age} ${persona.gender} from ${persona.nationality}, working as a ${persona.job}
- Passionate about: ${persona.likes}
- Bio: "${persona.bio}"

**YOUR UNIQUE VOICE (CRITICAL — follow strictly):**
${voiceGuide}
${jobVoice}

**Task:** Write a blog post for 'Korea Decode'.

**Topic:** "${title}"
**Core Subject:** "${topic}"
**Target Keywords:** ${keywords.join(', ')}

**RULES:**
1. **Voice:** First person ("I", "my"). Share personal opinions, experiences, and reactions that fit YOUR background. A ${persona.nationality} ${persona.job} would notice different things than other writers — highlight THOSE unique observations. NEVER sound like a generic AI blog post.
2. **Structure:**
   - Hook intro (NO self-introduction like "Hello, I'm..."). Jump straight into an engaging opening.
   - 3-5 sections with <h2>/<h3> tags. Use <ul><li> for lists, <strong> for key terms, <blockquote> for personal tips.
   - Strong conclusion with call-to-action.
3. **IMAGES — MANDATORY:** You MUST place exactly **${imgCount}** image markers in the article. Write the text **[IMG]** alone on its own line, wrapped in a paragraph tag like this: <p>[IMG]</p>. Space them evenly through the article (roughly every 2-3 paragraphs). This is REQUIRED — do not skip this.
4. **HTML only.** No <html>, <body>, <h1>, or markdown. Use <p>, <h2>, <h3>, <ul>, <blockquote>.

**Output:** Only the article HTML body. No explanations before or after.`;

        let rawContent = await callAI(prompt);

        // Clean markdown code blocks from response
        rawContent = rawContent.trim();
        if (rawContent.startsWith('```html')) {
            rawContent = rawContent.replace(/^```html\s*/, '').replace(/\s*```$/, '');
        } else if (rawContent.startsWith('```')) {
            rawContent = rawContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        // Replace image placeholders with actual Unsplash images
        contentImages.forEach(img => {
            const imgHtml = `<figure><img src="${img.url}" alt="${img.alt}" style="width:100%;border-radius:8px;"><figcaption>Photo by <a href="${img.user_link}?utm_source=korea_decode&utm_medium=referral" target="_blank">${img.user}</a> on <a href="https://unsplash.com/?utm_source=korea_decode&utm_medium=referral" target="_blank">Unsplash</a></figcaption></figure>`;
            // Match multiple placeholder formats
            if (rawContent.includes('<p>[IMG]</p>')) {
                rawContent = rawContent.replace('<p>[IMG]</p>', imgHtml);
            } else if (rawContent.includes('[IMG]')) {
                rawContent = rawContent.replace('[IMG]', imgHtml);
            } else if (rawContent.includes('[INSERT_IMAGE_HERE]')) {
                rawContent = rawContent.replace('[INSERT_IMAGE_HERE]', imgHtml);
            }
        });
        // Remove any leftover placeholders
        rawContent = rawContent.replace(/<p>\[IMG\]<\/p>/g, '');
        rawContent = rawContent.replace(/\[IMG\]/g, '');
        rawContent = rawContent.replace(/\[INSERT_IMAGE_HERE\]/g, '');
        content = rawContent;

    } catch (e) {
        alert("AI Error: " + e.message + "\nFalling back to template.");
        content = generateTemplateContent(persona, topic, title, '');
    }

    quill.clipboard.dangerouslyPasteHTML(content);

    document.getElementById('step-2').classList.remove('active');
    document.getElementById('step-3').style.opacity = '1';
    document.getElementById('step-3').style.pointerEvents = 'auto';
    document.getElementById('step-3').classList.add('active');
    document.getElementById('ai-img-query').value = topic;
    btn.innerHTML = '<i class="ph ph-pen-nib"></i> Write Full Article';
    btn.disabled = false;
};

function generateTemplateContent(persona, topic, title, imgHtml) {
    return `
                <p>Hello! I'm <strong>${persona.name}</strong>, a ${persona.age} ${persona.nationality} ${persona.job}. 👋</p>
                <p>As someone who loves <strong>${persona.likes}</strong>, I was so excited to check out <strong>${topic}</strong>.</p>
                <br>
                <h2>Why ${persona.name} Recommends This</h2>
                <p>Coming from ${persona.nationality}, I've always found Korean ${topic} fascinating. It's totally different from what I'm used to!</p>
                <br>
                ${imgHtml}
                <br>
                <h3>My Professional Tip</h3>
                <p>Since I work as a ${persona.job}, I noticed the details that others might miss.</p>
                <ul>
                    <li><strong>Vibe Check:</strong> Perfect for ${persona.age}'s Gen Z aesthetic.</li>
                    <li><strong>Must Try:</strong> Don't leave without experiencing it fully!</li>
                </ul>
                <br>
                <p>Hope this helps you on your Korea trip! Let me know if you want more tips from a ${persona.nationality} local. 😉</p>
            `;
}

window.runSEOPolish = () => {
    const btn = document.getElementById('btn-seo-polish');
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Polishing...';
    setTimeout(() => {
        let title = document.getElementById('ai-suggested-title').value;
        if (!title.includes("2026")) title += " (Updated 2026)";
        if (!title.includes("Guide") && !title.includes("Review")) title = "Ultimate Guide: " + title;
        document.getElementById('ai-suggested-title').value = title;
        let content = quill.root.innerHTML;
        if (!content.includes("In this article")) {
            content = `<p><em>In this article, we'll explore ${title} and why it's a must-visit.</em></p>` + content;
            quill.clipboard.dangerouslyPasteHTML(content);
        }
        alert("SEO Polish Complete!");
        calculateSEOScore();
        btn.innerHTML = '<i class="ph ph-sparkle"></i> AI SEO Polish';
    }, 1000);
};

window.searchUnsplashAI = async () => {
    const q = document.getElementById('ai-img-query').value;
    const container = document.getElementById('unsplash-results');
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;">Searching...</div>';
    document.getElementById('modal-unsplash').style.display = 'flex';
    try {
        const res = await fetch(`https://api.unsplash.com/search/photos?page=1&per_page=12&query=${q}&client_id=${UNSPLASH_ACCESS_KEY}`);
        const data = await res.json();
        container.innerHTML = '';
        data.results.forEach(img => {
            const el = document.createElement('img');
            el.src = img.urls.small;
            el.className = 'modal-img-item';
            el.onclick = () => {
                activeImage = img.urls.regular;
                document.getElementById('selected-ai-img').src = activeImage;
                document.getElementById('selected-ai-img').style.display = 'block';
                document.getElementById('ai-img-placeholder').style.display = 'none';
                document.getElementById('modal-unsplash').style.display = 'none';
            };
            container.appendChild(el);
        });
    } catch (e) {
        container.innerHTML = 'API Error';
    }
};

async function runAutomation() {
    const topics = document.getElementById('auto-topics').value.split('\n').filter(t => t.trim() !== '');
    const category = document.getElementById('auto-category').value;
    const startStr = document.getElementById('auto-start-date').value;
    const intervalHours = parseInt(document.getElementById('auto-interval').value);
    if (topics.length === 0) return alert('Enter topics');
    if (!startStr) return alert('Select start date');
    const btn = document.querySelector('#view-automation .btn-ai');
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Scheduling...';
    let currentDate = new Date(startStr);
    for (const topic of topics) {
        const title = `[Auto] ${topic} - Korea Decode Report`;
        const content = `<p>Automatically generated article about <strong>${topic}</strong>.</p>`;
        let imgUrl = '';
        try {
            const res = await fetch(`https://api.unsplash.com/search/photos?page=1&per_page=1&query=${topic}&client_id=${UNSPLASH_ACCESS_KEY}`);
            const data = await res.json();
            if (data.results.length > 0) imgUrl = data.results[0].urls.regular;
        } catch (e) {}
        await supabase.from('posts').insert({
            title,
            category,
            content,
            image: imgUrl,
            views: 0,
            created_at: new Date(currentDate).toISOString(),
            status: 'scheduled'
        });
        currentDate.setHours(currentDate.getHours() + intervalHours);
    }
    alert(`Successfully scheduled ${topics.length} posts!`);
    document.getElementById('auto-topics').value = '';
    btn.innerHTML = '<i class="ph ph-robot"></i> Generate & Schedule All';
    loadQueue();
}

async function loadQueue() {
    const tbody = document.getElementById('auto-queue-list');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';

    const { data, error } = await supabase.from('posts').select('id, title, status, created_at').order('created_at', { ascending: true });
    if (error) { console.error(error); return; }

    const now = new Date();
    tbody.innerHTML = '';
    (data || []).forEach(p => {
        const pDate = new Date(p.created_at);
        if (pDate > now) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span style="padding:4px 8px; background:#f59e0b20; color:#f59e0b; font-size:12px;">Scheduled</span></td><td>${p.title}</td><td>${pDate.toLocaleString()}</td><td><button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deletePost('${p.id}')">Cancel</button></td>`;
            tbody.appendChild(tr);
        }
    });
    if (tbody.innerHTML === '') tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888;">No scheduled posts.</td></tr>';
}

window.deletePost = async (id) => {
    if (confirm('Cancel this post?')) {
        await supabase.from('posts').delete().eq('id', id);
        loadQueue();
    }
}

function calculateSEOScore() {
    let score = 0;
    const text = quill.getText();
    const title = document.getElementById('ai-suggested-title').value;
    if (text.trim().split(/\s+/).length > 300) score += 50;
    if (title.length >= 10) score += 50;
    document.getElementById('seo-bar').style.width = score + '%';
    document.getElementById('seo-score-text').innerText = score + '%';
}

window.showMobilePreview = () => {
    document.getElementById('prev-cat').innerText = document.getElementById('ai-category').value;
    document.getElementById('prev-title').innerText = document.getElementById('ai-suggested-title').value;
    document.getElementById('prev-img').src = activeImage;
    document.getElementById('prev-img').style.display = activeImage ? 'block' : 'none';
    document.getElementById('prev-content').innerHTML = quill.root.innerHTML;
    document.getElementById('modal-preview').style.display = 'flex';
};

window.publishPost = async () => {
    const title = document.getElementById('ai-suggested-title').value;
    const category = document.getElementById('ai-category').value;
    const content = quill.root.innerHTML;
    const scheduleStr = document.getElementById('post-schedule').value;

    if (!title) return alert("Title is required");

    // Get selected Persona info (flattened for Supabase)
    const personaId = document.getElementById('ai-persona-select').value;
    let persona = availablePersonas.find(p => p.id === personaId);
    if (!persona) {
        persona = {
            name: "Korea Decode Editor",
            job: "Editor",
            bio: "Your guide to all things Korea."
        };
    }

    try {
        if (editingPostId) {
            const updateData = {
                title,
                category,
                content,
                image: activeImage || '',
                writer_name: persona.name,
                writer_job: persona.job,
                writer_bio: persona.bio || "Writer at Korea Decode",
                writer_avatar: persona.name[0] || "E"
            };
            if (scheduleStr) {
                updateData.status = 'scheduled';
                updateData.created_at = new Date(scheduleStr).toISOString();
            }
            const { error } = await supabase.from('posts').update(updateData).eq('id', editingPostId);
            if (error) throw error;
            alert('Post Updated!');
        } else {
            const postData = {
                title,
                category,
                content,
                image: activeImage || '',
                views: 0,
                status: scheduleStr ? 'scheduled' : 'published',
                writer_name: persona.name,
                writer_job: persona.job,
                writer_bio: persona.bio || "Writer at Korea Decode",
                writer_avatar: persona.name[0] || "E"
            };
            if (scheduleStr) {
                postData.created_at = new Date(scheduleStr).toISOString();
            }
            const { error } = await supabase.from('posts').insert(postData);
            if (error) throw error;
            alert('Post Published!');
        }
        resetAI();
        loadDashboard();
    } catch (e) {
        console.error("Publish Error:", e);
        alert("Error publishing post: " + e.message);
    }
};

async function loadPosts() {
    const grid = document.getElementById('posts-grid');
    grid.innerHTML = 'Loading...';

    const { data, error } = await supabase.from('posts').select('id, title, category, views, status, writer_name').order('created_at', { ascending: false });
    if (error) { console.error(error); grid.innerHTML = 'Error loading posts.'; return; }

    grid.innerHTML = '';
    (data || []).forEach(p => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '16px';
        div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:700; font-size:16px;">${p.title}</div>
                            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                                ${p.category} • ${p.views || 0} views • ${p.writer_name || 'Admin'}
                            </div>
                        </div>
                        <div style="display:flex; gap: 8px;">
                            <a href="/post.html?id=${p.id}" target="_blank" class="btn btn-outline" style="padding:6px 12px; font-size:12px;">View</a>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:12px; color:var(--accent); border-color:var(--accent);" onclick="editPost('${p.id}')">Edit</button>
                        </div>
                    </div>
                `;
        grid.appendChild(div);
    });
}

// Mock migrationList if migration-list.js is not loaded
const migrationList = self.migrationList || [];

window.startMigration = async () => {
    const logBox = document.getElementById('migration-log');
    logBox.innerHTML = 'Starting... (Check console for full details)';
    const parser = new DOMParser();
    for (const path of migrationList) {
        try {
            const res = await fetch(path);
            if (!res.ok) continue;
            const html = await res.text();
            const d = parser.parseFromString(html, 'text/html');
            let title = d.querySelector('title')?.innerText.split(' - ')[0] || "Untitled";
            let contentEl = d.querySelector('.elementor-widget-theme-post-content') || d.querySelector('article') || d.body;
            let content = contentEl.innerHTML;

            content = content.replace(/http:\/\/koreadecode.mycafe24.com/g, '');
            content = content.replace(/https:\/\/koreadecode.mycafe24.com/g, '');
            content = content.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "");
            content = content.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gm, "");

            await supabase.from('posts').insert({
                title,
                category: 'Archive',
                content,
                image: 'https://images.unsplash.com/photo-1576085898323-218337e3e43c?w=800',
                views: 0,
                status: 'published',
                writer_name: "Korea Decode Archive",
                writer_job: "System",
                writer_bio: "Legacy content from our previous blog.",
                writer_avatar: "K"
            });
            logBox.innerHTML += `> Imported ${title}\n`;
        } catch (e) {}
    }
    alert('Migration Done');
};

init();
