// Import initialized Firebase services from our config file
import {
    auth,
    db,
    storage
} from '/js/firebase-config.js';

// Import the specific Firebase functions we need
import {
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collection,
    addDoc,
    getDocs,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    query,
    orderBy,
    where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const UNSPLASH_ACCESS_KEY = 'TMpRwGXIoEuszwIoROwgwukRP5iqf08ej2mk4Pdbz8s';

// --- HELPER: UNIFIED AI CALL (Via Cloudflare Proxy) ---
async function callAI(prompt, geminiKey, openaiKey, openrouterKey) {
    try {
        const response = await fetch('/ai-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                geminiKey,
                openaiKey,
                openrouterKey
            })
        });

        // Handle HTML error pages (like 404 or 500 from Cloudflare)
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            throw new Error(`Server Error (${response.status}): ${text.substring(0, 100)}...`);
        }

        const json = await response.json();

        if (!response.ok || json.error) {
            throw new Error(json.error + (json.details ? "\nDetails:\n" + json.details.join('\n') : ""));
        }

        return json.text;

    } catch (e) {
        throw new Error(`AI Proxy Error: ${e.message}`);
    }
}

function cleanJSONResponse(text) {
    // Remove markdown code blocks if present
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
function init() {
    // Initialize Quill Editor
    quill = new Quill('#editor-container', {
        theme: 'snow',
        modules: {
            toolbar: [
                [{
                    'header': [1, 2, 3, false]
                }],
                ['bold', 'italic', 'underline', 'blockquote'],
                [{
                    'list': 'ordered'
                }, {
                    'list': 'bullet'
                }],
                ['link', 'clean']
            ]
        }
    });
    quill.on('text-change', calculateSEOScore);

    // Firebase Auth State Listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            document.getElementById('login-section').style.display = 'none';
            loadDashboard();
            loadPersonas();
        } else {
            document.getElementById('login-section').style.display = 'flex';
        }
    });

    // --- STATIC EVENT LISTENERS ---
    // Main Navigation
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
        el.addEventListener('click', () => switchView(el.dataset.view));
    });

    // Login/Logout
    document.getElementById('btn-login').addEventListener('click', doLogin);
    document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

    // AI Writer Buttons
    document.getElementById('btn-reset-ai').addEventListener('click', resetAI);
    document.getElementById('btn-seo-polish').addEventListener('click', runSEOPolish);
    document.getElementById('btn-run-ai-phase1').addEventListener('click', runAIPhase1);
    document.getElementById('btn-run-ai-phase2').addEventListener('click', runAIPhase2);
    document.getElementById('btn-search-unsplash').addEventListener('click', searchUnsplashAI);
    document.getElementById('btn-save-post').addEventListener('click', publishPost);
    document.getElementById('btn-show-preview').addEventListener('click', showMobilePreview);


    // Settings Page Buttons
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-remove-duplicates').addEventListener('click', removeDuplicates);
    document.getElementById('btn-generate-persona').addEventListener('click', generateRandomPersona);
    document.getElementById('btn-save-persona').addEventListener('click', saveOrUpdatePersona);
    document.getElementById('btn-cancel-persona').addEventListener('click', resetPersonaForm);

    // Migration
    document.getElementById('btn-start-migration').addEventListener('click', startMigration);

    // Modals
    document.getElementById('btn-close-unsplash').addEventListener('click', () => closeModal('modal-unsplash'));
    document.getElementById('btn-close-preview').addEventListener('click', () => closeModal('modal-preview'));

    // --- DELEGATED EVENT LISTENERS ---
    // For dynamically created persona buttons
    const personaList = document.getElementById('persona-list');
    personaList.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;

        const action = button.dataset.action;
        const id = button.dataset.id;

        if (action === 'edit') {
            editPersona(id);
        } else if (action === 'delete') {
            deletePersona(id);
        }
    });

    // --- INITIAL DATA LOAD ---
    const savedKey = localStorage.getItem('gemini_key');
    if (savedKey) document.getElementById('setting-gemini-key').value = savedKey;
    
    const savedOpenAIKey = localStorage.getItem('openai_key');
    if (savedOpenAIKey) document.getElementById('setting-openai-key').value = savedOpenAIKey;

    const savedOpenRouterKey = localStorage.getItem('openrouter_key');
    if (savedOpenRouterKey) document.getElementById('setting-openrouter-key').value = savedOpenRouterKey;

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
        await signInWithEmailAndPassword(auth, e, p);
    } catch (err) {
        document.getElementById('login-error').innerText = err.message;
    }
}

// --- SETTINGS ---
const saveSettings = () => {
    const k = document.getElementById('setting-gemini-key').value;
    const o = document.getElementById('setting-openai-key').value;
    const or = document.getElementById('setting-openrouter-key').value;
    localStorage.setItem('gemini_key', k);
    localStorage.setItem('openai_key', o);
    localStorage.setItem('openrouter_key', or);
    alert('Settings Saved');
};

// --- MODALS ---
const closeModal = (id) => document.getElementById(id).style.display = 'none';


// --- PERSONA MANAGEMENT ---
async function loadPersonas() {
    const list = document.getElementById('persona-list');
    list.innerHTML = 'Loading...';
    try {
        const snap = await getDocs(collection(db, "personas"));
        availablePersonas = [];
        list.innerHTML = '';
        snap.forEach(doc => {
            const p = doc.data();
            p.id = doc.id;
            availablePersonas.push(p);
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
                        <button class="btn btn-outline" data-action="edit" data-id="${doc.id}" style="padding: 4px 8px; font-size:12px;"><i class="ph ph-pencil"></i></button>
                        <button class="btn btn-outline" data-action="delete" data-id="${doc.id}" style="color:var(--danger); border-color:var(--danger); padding: 4px 8px; font-size:12px;"><i class="ph ph-trash"></i></button>
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

    document.getElementById('persona-form-title').scrollIntoView({
        behavior: "smooth"
    });
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

    const personaData = {
        name,
        age,
        gender,
        nationality,
        job,
        likes,
        bio
    };

    if (editingPersonaId) {
        await updateDoc(doc(db, "personas", editingPersonaId), personaData);
        alert('Persona Updated!');
    } else {
        await addDoc(collection(db, "personas"), personaData);
        alert('Persona Created!');
    }

    resetPersonaForm();
    loadPersonas();
};

const deletePersona = async (id) => {
    if (confirm('Are you sure you want to delete this persona?')) {
        await deleteDoc(doc(db, "personas", id));
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
    const postsSnap = await getDocs(collection(db, "posts"));
    let totalViews = 0;
    let scheduled = 0;
    let posts = [];

    postsSnap.forEach(doc => {
        const d = doc.data();
        if (d.status === 'scheduled') scheduled++;
        totalViews += (d.views || 0);
        posts.push({
            title: d.title,
            views: d.views || 0
        });
    });

    document.getElementById('stat-posts').innerText = postsSnap.size;
    document.getElementById('stat-views').innerText = totalViews.toLocaleString();
    document.getElementById('stat-scheduled').innerText = scheduled;

    posts.sort((a, b) => b.views - a.views);
    const top5 = posts.slice(0, 5);
    const tbody = document.querySelector('#dashboard-top-posts tbody');
    tbody.innerHTML = '';
    top5.forEach(p => {
        tbody.innerHTML += `<tr><td>${p.title}</td><td style="text-align:right; font-weight:bold;">${p.views.toLocaleString()}</td></tr>`;
    });
}

window.removeDuplicates = async () => {
    if (!confirm("This will delete duplicate posts (keeping oldest). Continue?")) return;
    const btn = document.querySelector('button[onclick="removeDuplicates()"]');
    btn.innerText = "Processing...";
    btn.disabled = true;
    try {
        const q = query(collection(db, "posts"), orderBy("createdAt", "asc"));
        const snap = await getDocs(q);
        const seen = new Set();
        let count = 0;
        for (const d of snap.docs) {
            const t = d.data().title;
            if (seen.has(t)) {
                await deleteDoc(doc(db, "posts", d.id));
                count++;
            } else seen.add(t);
        }
        alert(`Deleted ${count} duplicates.`);
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "Remove Duplicate Posts";
        btn.disabled = false;
    }
};

window.editPost = async (id) => {
    editingPostId = id;
    switchView('ai-writer');
    document.getElementById('writer-heading').innerText = "Edit Post";
    document.getElementById('btn-save-post').innerHTML = '<i class="ph ph-floppy-disk"></i> Update';
    const docRef = doc(db, "posts", id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const p = docSnap.data();
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
    }
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
    const geminiKey = localStorage.getItem('gemini_key');
    const openaiKey = localStorage.getItem('openai_key');
    const openrouterKey = localStorage.getItem('openrouter_key');
    
    if (!topic) return alert('Please enter a topic');
    if (!geminiKey && !openaiKey && !openrouterKey) {
        return alert("No valid AI API Key found in settings. Please add Gemini, OpenAI, or OpenRouter key.");
    }

    const btn = document.querySelector('#step-1 .btn-ai');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Brainstorming SEO Plan...';
    btn.disabled = true;

    try {
        const prompt = `
                Analyze the topic: "${topic}".
                
                Your task is to generate a comprehensive SEO plan for a blog post on this topic for the website 'Korea Decode'.
                
                Provide your response in a clean JSON format, like this: 
                {
                  "suggested_titles": [
                    "Unique, engaging, SEO-friendly title 1",
                    "Alternative creative title 2",
                    "Another compelling title option 3"
                  ],
                  "seo_keywords": [
                    "primary keyword",
                    "secondary keyword",
                    "long-tail keyword 1",
                    "semantic keyword",
                    "related topic"
                  ]
                }

                Ensure the titles are captivating and the keywords are highly relevant for ranking on Google.
                `;

        // USE NEW UNIFIED AI CALL
        let rawText = await callAI(prompt, geminiKey, openaiKey, openrouterKey);
        rawText = cleanJSONResponse(rawText);
        const data = JSON.parse(rawText);

        document.getElementById('ai-suggested-title').value = data.suggested_titles[0] || `Guide to ${topic}`;
        const kwContainer = document.getElementById('ai-keywords-container');
        kwContainer.innerHTML = '';
        data.seo_keywords.forEach(k => kwContainer.innerHTML += `<span class="suggestion-chip selected">${k}</span>`);

        // Add title options
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
    const geminiKey = localStorage.getItem('gemini_key');
    const openaiKey = localStorage.getItem('openai_key');
    const openrouterKey = localStorage.getItem('openrouter_key');

    if (!title) return alert('Please generate or select a title first.');

    const btn = document.querySelector('#step-2 .btn-primary');
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Writing Full Article...';
    btn.disabled = true;

    // Find Persona
    let persona = availablePersonas.find(p => p.id === personaId);
    if (!persona) {
        persona = {
            name: "Korea Decode Editor",
            nationality: "Seoul",
            job: "Travel Guide",
            likes: "everything",
            age: "30s",
            bio: "Your guide to all things Korea."
        };
    }

    // 1. Fetch Images from Unsplash
    let contentImages = [];
    try {
        const res = await fetch(`https://api.unsplash.com/search/photos?page=1&per_page=3&query=${topic} korea&client_id=${UNSPLASH_ACCESS_KEY}`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            activeImage = data.results[0].urls.regular;
            document.getElementById('selected-ai-img').src = activeImage;
            document.getElementById('selected-ai-img').style.display = 'block';
            document.getElementById('ai-img-placeholder').style.display = 'none';
            contentImages = data.results.slice(1).map(img => ({
                url: img.urls.regular,
                alt: img.alt_description || title,
                user: img.user.name,
                user_link: img.user.links.html
            }));
        }
    } catch (e) {
        console.error("Unsplash Error:", e);
    }

    // 2. Generate Content with AI
    let content = '';

    if (geminiKey || openaiKey || openrouterKey) {
        try {
            const prompt = `
                    **Act as an expert content creator for the 'Korea Decode' blog.**

                    **Your Persona:**
                    - **Name:** ${persona.name}
                    - **Identity:** You are a ${persona.age}, ${persona.gender}, ${persona.nationality} ${persona.job}.
                    - **Expertise & Passion:** You are deeply passionate about ${persona.likes}.
                    - **Bio:** "${persona.bio}"

                    **Task:** Write a high-quality, engaging, and SEO-optimized blog post.

                    **Topic:** "${title}"
                    **Core Subject:** "${topic}"
                    **Target Keywords:** ${keywords.join(', ')}

                    **Content & Style Guidelines (Strictly Follow):**
                    1.  **Tone of Voice:** Write in a **conversational, authentic, and expert** human voice. Use "I," "we," and "you." Be relatable and engaging, sharing personal opinions and simulated experiences based on your persona. **AVOID** robotic, academic, or generic marketing language.
                    2.  **Structure:**
                        - **Hook Introduction:** Start with a compelling hook that grabs the reader's attention immediately. Do **NOT** introduce yourself (e.g., "Hello, I'm...").
                        - **Main Body:** Divide the content into logical sections using 
<h2>
 and 
<h3>
 tags. Use bullet points (
<ul><li>...</li></ul>
) for lists, and 
<strong>
 for emphasis on key terms.
                        - **Conclusion:** End with a strong summary and a call-to-action (e.g., asking a question, encouraging comments).
                    3.  **Image Placeholder:** You have TWO images to place. To insert an image, use the placeholder **[INSERT_IMAGE_HERE]** on its own line where it would best fit visually and contextually within the article. Use both placeholders.
                    4.  **Formatting:**
                        - Use clean HTML. **DO NOT** include 
<html>
, 
<body>
, or 
<h1>
 tags. The main title is handled separately.
                        - Use 
<p>
 for paragraphs.
                        - Use 
<blockquote>
 for highlighting quotes or important tips.
                    
                    **Final Output:** Produce only the HTML content for the article body.
                    `;

            // USE NEW UNIFIED AI CALL
            let rawContent = await callAI(prompt, geminiKey, openaiKey, openrouterKey);

            // Inject images into placeholders
            contentImages.forEach(img => {
                const imgHtml = `<figure><img src="${img.url}" alt="${img.alt}"><figcaption>Photo by <a href="${img.user_link}" target="_blank">${img.user}</a> on Unsplash</figcaption></figure>`;
                rawContent = rawContent.replace('[INSERT_IMAGE_HERE]', imgHtml);
            });
            content = rawContent;

        } catch (e) {
            alert("AI Error: " + e.message + "\nPlease check your API key in settings or the browser console for details. Falling back to template.");
            content = generateTemplateContent(persona, topic, title, '');
        }
    } else {
        alert("No valid AI API Key found in settings. Using template mode.");
        content = generateTemplateContent(persona, topic, title, '');
    }

    quill.clipboard.dangerouslyPasteHTML(content);

    document.getElementById('step-2').classList.remove('active');
    document.getElementById('step-3').style.opacity = '1';
    document.getElementById('step-3').style.pointerEvents = 'auto';
    document.getElementById('step-3').classList.add('active');
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

window.runAutomation = async () => {
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
        await addDoc(collection(db, "posts"), {
            title,
            category,
            content,
            image: imgUrl,
            views: 0,
            createdAt: new Date(currentDate),
            status: 'scheduled'
        });
        currentDate.setHours(currentDate.getHours() + intervalHours);
    }
    alert(`Successfully scheduled ${topics.length} posts!`);
    document.getElementById('auto-topics').value = '';
    btn.innerHTML = '<i class="ph ph-robot"></i> Generate & Schedule All';
    loadQueue();
};

async function loadQueue() {
    const tbody = document.getElementById('auto-queue-list');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';
    const q = query(collection(db, "posts"), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    const now = new Date();
    tbody.innerHTML = '';
    snap.forEach(doc => {
        const p = doc.data();
        const pDate = p.createdAt.toDate();
        if (pDate > now) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span style="padding:4px 8px; background:#f59e0b20; color:#f59e0b; font-size:12px;">Scheduled</span></td><td>${p.title}</td><td>${pDate.toLocaleString()}</td><td><button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deletePost('${doc.id}')">Cancel</button></td>`;
            tbody.appendChild(tr);
        }
    });
    if (tbody.innerHTML === '') tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888;">No scheduled posts.</td></tr>';
}

window.deletePost = async (id) => {
    if (confirm('Cancel this post?')) {
        await deleteDoc(doc(db, "posts", id));
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
    const schedule = document.getElementById('post-schedule').value;

    // Get selected Persona info
    const personaId = document.getElementById('ai-persona-select').value;
    let persona = availablePersonas.find(p => p.id === personaId);
    if (!persona) {
        persona = {
            name: "Korea Decode Editor",
            job: "Editor",
            bio: "Your guide to all things Korea."
        };
    }

    const writerData = {
        name: persona.name,
        job: persona.job,
        bio: persona.bio || "Writer at Korea Decode",
        avatar: persona.name[0]
    };

    try {
        if (editingPostId) {
            await updateDoc(doc(db, "posts", editingPostId), {
                title,
                category,
                content,
                image: activeImage,
                writer: writerData
            });
            alert('Post Updated!');
        } else {
            await addDoc(collection(db, "posts"), {
                title,
                category,
                content,
                image: activeImage,
                views: 0,
                createdAt: schedule ? new Date(schedule) : serverTimestamp(),
                status: schedule ? 'scheduled' : 'published',
                writer: writerData
            });
            alert('Post Published!');
        }
        resetAI();
    } catch (e) {
        alert(e.message);
    }
};

async function loadPosts() {
    const grid = document.getElementById('posts-grid');
    grid.innerHTML = 'Loading...';
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    grid.innerHTML = '';
    snap.forEach(doc => {
        const p = doc.data();
        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '16px';
        div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:700; font-size:16px;">${p.title}</div>
                            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                                ${p.category} • ${p.views || 0} views • ${p.writer?.name || 'Admin'}
                            </div>
                        </div>
                        <div style="display:flex; gap: 8px;">
                            <a href="/post.html?id=${doc.id}" target="_blank" class="btn btn-outline" style="padding:6px 12px; font-size:12px;">View</a>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:12px; color:var(--accent); border-color:var(--accent);" onclick="editPost('${doc.id}')">Edit</button>
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
            const doc = parser.parseFromString(html, 'text/html');
            let title = doc.querySelector('title')?.innerText.split(' - ')[0] || "Untitled";
            let contentEl = doc.querySelector('.elementor-widget-theme-post-content') || doc.querySelector('article') || doc.body;
            let content = contentEl.innerHTML;

            content = content.replace(/http:\/\/koreadecode.mycafe24.com/g, '');
            content = content.replace(/https:\/\/koreadecode.mycafe24.com/g, '');
            content = content.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "");
            content = content.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gm, "");

            await addDoc(collection(db, "posts"), {
                title,
                category: 'Archive',
                content,
                image: 'https://images.unsplash.com/photo-1576085898323-218337e3e43c?w=800',
                views: 0,
                createdAt: serverTimestamp(),
                status: 'published',
                writer: {
                    name: "Korea Decode Archive",
                    job: "System",
                    bio: "Legacy content from our previous blog."
                }
            });
            logBox.innerHTML += `> Imported ${title}
`;
        } catch (e) {}
    }
    alert('Migration Done');
};

init();
