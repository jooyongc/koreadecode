import { supabase } from '/assets/js/supabase-config.js';

// --- AI CALL: via server-side proxy (functions/ai-proxy.js) ---
async function callAI(prompt, options = {}) {
    console.log("[AI] Calling AI via proxy...");
    try {
        const body = { prompt };
        const userKey = localStorage.getItem('gemini_key');
        if (userKey) body.userGeminiKey = userKey;
        if (options.model) body.model = options.model;
        if (options.generationConfig) body.generationConfig = options.generationConfig;

        const resp = await fetch('/ai-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        if (!data.text) throw new Error("Empty response from AI");
        console.log("[AI] Proxy success");
        // Ensure we always return a string
        return typeof data.text === 'string' ? data.text : JSON.stringify(data.text);
    } catch (e) {
        console.error("[AI] Proxy failed:", e);
        throw new Error("AI Error: " + e.message);
    }
}

function cleanJSONResponse(text) {
    if (typeof text !== 'string') text = JSON.stringify(text);
    text = text.trim();
    if (text.startsWith("```json")) {
        text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (text.startsWith("```")) {
        text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    return text;
}

/**
 * Attempt to repair truncated JSON from AI responses.
 * Fixes unterminated strings, missing brackets/braces, trailing commas.
 */
function repairJSON(text) {
    if (typeof text !== 'string') text = JSON.stringify(text);
    text = text.trim();

    // Remove trailing comma before attempting to close
    text = text.replace(/,\s*$/, '');

    // Count open/close brackets and braces
    let inString = false;
    let escape = false;
    let openBraces = 0;
    let openBrackets = 0;
    let lastCharWasBackslash = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') openBraces++;
        if (ch === '}') openBraces--;
        if (ch === '[') openBrackets++;
        if (ch === ']') openBrackets--;
    }

    // If we're inside an unterminated string, close it
    if (inString) {
        text += '"';
    }

    // Remove trailing comma after fixing string
    text = text.replace(/,\s*$/, '');

    // Close any open brackets and braces
    for (let i = 0; i < openBrackets; i++) text += ']';
    for (let i = 0; i < openBraces; i++) text += '}';

    return text;
}

/**
 * Parse JSON from AI with automatic repair on failure.
 */
function parseAIJSON(rawText) {
    const cleaned = cleanJSONResponse(rawText);
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn("[AI] JSON parse failed, attempting repair:", e.message);
        const repaired = repairJSON(cleaned);
        return JSON.parse(repaired);
    }
}

// --- SLUG GENERATION ---
function generateSlug(title) {
    if (!title) return '';
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')      // Remove non-word chars except spaces and hyphens
        .replace(/\s+/g, '-')           // Replace spaces with hyphens
        .replace(/-+/g, '-')            // Collapse multiple hyphens
        .replace(/^-+|-+$/g, '')        // Trim leading/trailing hyphens
        .substring(0, 80);              // Limit length
}



let quill;
let activeImage = '';
let currentUser = null;
let editingPostId = null;
let editingPersonaId = null;
let availablePersonas = [];
let unsplashMode = 'featured'; // 'featured' | 'body'
let affiliateCodes = {}; // Map of aff-id → raw HTML code
let pendingUploadFile = null; // File object waiting to be uploaded
let imgSearchPage = 1; // current image search page

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
    initImageResizer();

    // Auto-generate slug when title changes
    const titleInput = document.getElementById('ai-suggested-title');
    if (titleInput) {
        titleInput.addEventListener('input', () => {
            const slugInput = document.getElementById('ai-slug');
            if (slugInput && !editingPostId) {
                slugInput.value = generateSlug(titleInput.value);
            }
        });
    }

    // Supabase Auth: Check existing session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        document.getElementById('login-section').style.display = 'none';
        restoreGeminiKeyFromCloud(session.user);
        loadDashboard();
        loadPersonas();
        ensureStorageBucket();
    } else {
        document.getElementById('login-section').style.display = 'flex';
    }

    // Supabase Auth State Listener
    supabase.auth.onAuthStateChange((event, session) => {
        if (session) {
            currentUser = session.user;
            document.getElementById('login-section').style.display = 'none';
            restoreGeminiKeyFromCloud(session.user);
            loadDashboard();
            loadPersonas();
            ensureStorageBucket();
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
    document.getElementById('login-email').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const pw = document.getElementById('login-password');
            if (!pw.value) pw.focus();
            else doLogin();
        }
    });
    document.getElementById('login-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLogin();
    });
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
    document.getElementById('btn-toggle-html').addEventListener('click', toggleHtmlSource);

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-save-hero').addEventListener('click', saveHeroSettings);
    document.getElementById('btn-hero-search-img').addEventListener('click', searchHeroImages);
    document.getElementById('hero-img-query').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchHeroImages();
    });
    // Live preview update
    ['hero-label', 'hero-title-before', 'hero-title-highlight', 'hero-title-after', 'hero-bg-image'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateHeroPreview);
    });
    document.getElementById('btn-remove-duplicates').addEventListener('click', removeDuplicates);
    document.getElementById('btn-generate-persona').addEventListener('click', generateRandomPersona);
    document.getElementById('btn-save-persona').addEventListener('click', saveOrUpdatePersona);
    document.getElementById('btn-cancel-persona').addEventListener('click', resetPersonaForm);

    document.getElementById('btn-run-automation').addEventListener('click', runAutomation);
    document.getElementById('btn-save-auto-profile').addEventListener('click', saveAutoProfile);
    document.getElementById('btn-delete-auto-profile').addEventListener('click', deleteAutoProfile);
    document.getElementById('auto-profile-select').addEventListener('change', loadAutoProfile);
    document.getElementById('btn-batch-publish').addEventListener('click', batchPublishDrafts);
    document.getElementById('btn-batch-delete').addEventListener('click', batchDeleteDrafts);
    document.getElementById('auto-select-all').addEventListener('change', (e) => {
        document.querySelectorAll('.auto-draft-check').forEach(cb => cb.checked = e.target.checked);
    });
    document.querySelectorAll('.auto-queue-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auto-queue-tab').forEach(t => {
                t.classList.remove('active');
                t.style.borderBottomColor = 'transparent';
            });
            tab.classList.add('active');
            tab.style.borderBottomColor = 'var(--accent)';
            const tabName = tab.dataset.tab;
            document.getElementById('auto-tab-drafts').style.display = tabName === 'drafts' ? 'block' : 'none';
            document.getElementById('auto-tab-scheduled').style.display = tabName === 'scheduled' ? 'block' : 'none';
            document.getElementById('auto-batch-actions').style.display = tabName === 'drafts' ? 'flex' : 'none';
        });
    });
    document.getElementById('btn-start-migration').addEventListener('click', startMigration);

    document.getElementById('btn-insert-body-img').addEventListener('click', openUnsplashForBody);
    document.getElementById('btn-unsplash-modal-search').addEventListener('click', searchUnsplashModal);
    document.getElementById('unsplash-modal-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchUnsplashModal();
    });
    document.getElementById('btn-close-unsplash').addEventListener('click', () => { resetUploadUI(); closeModal('modal-unsplash'); });
    document.getElementById('btn-close-preview').addEventListener('click', () => closeModal('modal-preview'));

    // Image modal tab switching
    document.querySelectorAll('.img-modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.img-modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('img-tab-search').style.display = tabName === 'search' ? 'block' : 'none';
            document.getElementById('img-tab-upload').style.display = tabName === 'upload' ? 'block' : 'none';
        });
    });

    // Upload file input
    document.getElementById('upload-file-input').addEventListener('change', (e) => {
        if (e.target.files[0]) handleUploadFile(e.target.files[0]);
    });

    // Drag & drop
    const dropZone = document.getElementById('upload-drop-zone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleUploadFile(e.dataTransfer.files[0]);
    });

    // Upload confirm / cancel
    document.getElementById('btn-confirm-upload').addEventListener('click', confirmUpload);
    document.getElementById('btn-cancel-upload').addEventListener('click', resetUploadUI);

    // Featured image upload button
    document.getElementById('btn-upload-featured').addEventListener('click', () => {
        unsplashMode = 'featured';
        document.getElementById('unsplash-modal-title').innerText = 'Featured Image';
        resetUploadUI();
        // Switch to Upload tab
        document.querySelectorAll('.img-modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.img-modal-tab[data-tab="upload"]').classList.add('active');
        document.getElementById('img-tab-search').style.display = 'none';
        document.getElementById('img-tab-upload').style.display = 'block';
        document.getElementById('modal-unsplash').style.display = 'flex';
    });
    document.getElementById('btn-insert-affiliate').addEventListener('click', openAffiliateModal);
    document.getElementById('btn-confirm-affiliate').addEventListener('click', insertAffiliateCode);
    document.getElementById('btn-save-aff-preset').addEventListener('click', saveAffiliatePresetLegacy);
    document.getElementById('btn-close-affiliate').addEventListener('click', () => closeModal('modal-affiliate'));
    // New: DB-backed preset UI
    document.getElementById('btn-insert-shortcode').addEventListener('click', insertAffiliateShortcode);
    document.getElementById('btn-aff-preset-save').addEventListener('click', saveAffiliatePresetToDB);
    document.getElementById('btn-aff-preset-delete').addEventListener('click', deleteAffiliatePresetFromDB);
    document.getElementById('aff-preset-select').addEventListener('change', onPresetSelectChange);
    document.querySelectorAll('.aff-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchAffiliateTab(btn.dataset.affTab));
    });

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

    loadAutoProfiles();
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
    if (viewName === 'personas') loadPersonas();
    if (viewName === 'settings') loadPersonas();
    if (viewName === 'site-settings') loadHeroSettings();
    if (viewName === 'ai-writer') {
        if (!editingPostId) resetAI();
        refreshPersonaSelect();
    }
};
// Expose switchView globally for onclick handlers in HTML
window.switchView = switchView;

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
const saveSettings = async () => {
    const k = document.getElementById('setting-gemini-key').value.trim();
    if (!k) return alert('Gemini API Key를 입력해주세요.');
    localStorage.setItem('gemini_key', k);
    // Cloud save to Supabase user metadata
    try {
        await supabase.auth.updateUser({ data: { gemini_key: k } });
        updateKeyStatusIndicator(true);
    } catch (e) {
        console.warn('Cloud sync failed:', e);
        updateKeyStatusIndicator(false);
    }
    alert('Gemini API Key 저장 완료! (Cloud synced)');
};

function restoreGeminiKeyFromCloud(user) {
    const cloudKey = user?.user_metadata?.gemini_key;
    if (cloudKey && !localStorage.getItem('gemini_key')) {
        localStorage.setItem('gemini_key', cloudKey);
        const input = document.getElementById('setting-gemini-key');
        if (input) input.value = cloudKey;
        console.log('[Settings] Gemini key restored from cloud');
    }
    updateKeyStatusIndicator(!!cloudKey);
}

function updateKeyStatusIndicator(synced) {
    let indicator = document.getElementById('key-sync-status');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'key-sync-status';
        indicator.style.cssText = 'font-size: 12px; margin-top: 8px; display: flex; align-items: center; gap: 6px;';
        const btn = document.getElementById('btn-save-settings');
        if (btn) btn.insertAdjacentElement('afterend', indicator);
    }
    if (synced) {
        indicator.innerHTML = '<i class="ph ph-cloud-check" style="color: var(--success);"></i> <span style="color: var(--success);">Cloud synced</span>';
    } else {
        indicator.innerHTML = '<i class="ph ph-cloud-slash" style="color: var(--text-muted);"></i> <span style="color: var(--text-muted);">Local only</span>';
    }
}

// --- SITE SETTINGS: HERO ---
async function loadHeroSettings() {
    try {
        const { data, error } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'hero')
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        const hero = data?.value || {};
        document.getElementById('hero-label').value = hero.label || '';
        document.getElementById('hero-title-before').value = hero.title_before || '';
        document.getElementById('hero-title-highlight').value = hero.title_highlight || '';
        document.getElementById('hero-title-after').value = hero.title_after || '';
        document.getElementById('hero-description').value = hero.description || '';
        document.getElementById('hero-bg-image').value = hero.bg_image || '';
        document.getElementById('hero-cta1-text').value = hero.cta_primary_text || '';
        document.getElementById('hero-cta1-url').value = hero.cta_primary_url || '';
        document.getElementById('hero-cta2-text').value = hero.cta_secondary_text || '';
        document.getElementById('hero-cta2-url').value = hero.cta_secondary_url || '';
        updateHeroPreview();
    } catch (e) {
        console.error('[Site Settings] Failed to load hero:', e);
    }
}

function updateHeroPreview() {
    const bgUrl = document.getElementById('hero-bg-image').value;
    const label = document.getElementById('hero-label').value;
    const before = document.getElementById('hero-title-before').value;
    const highlight = document.getElementById('hero-title-highlight').value;
    const after = document.getElementById('hero-title-after').value;

    const img = document.getElementById('hero-preview-img');
    if (img) img.src = bgUrl || '';

    const labelEl = document.getElementById('hero-preview-label');
    if (labelEl) labelEl.textContent = label;

    const titleEl = document.getElementById('hero-preview-title');
    if (titleEl) titleEl.innerHTML = `${escHtml(before)} <span class="hl">${escHtml(highlight)}</span>${escHtml(after)}`;
}

function escHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function saveHeroSettings() {
    const statusEl = document.getElementById('hero-save-status');
    const btn = document.getElementById('btn-save-hero');
    btn.disabled = true;
    statusEl.innerHTML = '<span style="color:var(--text-muted);">Saving...</span>';

    const heroData = {
        label: document.getElementById('hero-label').value.trim(),
        title_before: document.getElementById('hero-title-before').value.trim(),
        title_highlight: document.getElementById('hero-title-highlight').value.trim(),
        title_after: document.getElementById('hero-title-after').value.trim(),
        description: document.getElementById('hero-description').value.trim(),
        bg_image: document.getElementById('hero-bg-image').value.trim(),
        cta_primary_text: document.getElementById('hero-cta1-text').value.trim(),
        cta_primary_url: document.getElementById('hero-cta1-url').value.trim(),
        cta_secondary_text: document.getElementById('hero-cta2-text').value.trim(),
        cta_secondary_url: document.getElementById('hero-cta2-url').value.trim(),
    };

    try {
        // Upsert: try update first, then insert
        const { data: existing } = await supabase
            .from('site_settings')
            .select('id')
            .eq('key', 'hero')
            .single();

        if (existing) {
            const { error } = await supabase
                .from('site_settings')
                .update({ value: heroData, updated_at: new Date().toISOString() })
                .eq('key', 'hero');
            if (error) throw error;
        } else {
            const { error } = await supabase
                .from('site_settings')
                .insert({ key: 'hero', value: heroData });
            if (error) throw error;
        }

        statusEl.innerHTML = '<span style="color:var(--success);"><i class="ph ph-check-circle"></i> Saved successfully!</span>';
        setTimeout(() => { statusEl.innerHTML = ''; }, 3000);
    } catch (e) {
        console.error('[Site Settings] Save failed:', e);
        statusEl.innerHTML = `<span style="color:var(--danger);"><i class="ph ph-warning-circle"></i> Error: ${e.message}</span>`;
    }
    btn.disabled = false;
}

async function searchHeroImages() {
    const query = document.getElementById('hero-img-query').value.trim();
    if (!query) return;

    const container = document.getElementById('hero-img-results');
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:16px;">Searching...</div>';

    try {
        const resp = await fetch(`/image-proxy?source=unsplash&query=${encodeURIComponent(query)}&count=8&orientation=landscape`);
        const data = await resp.json();
        if (!data.images || data.images.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:16px;">No images found</div>';
            return;
        }
        container.innerHTML = data.images.map(img => `
            <div class="image-grid-item" data-url="${img.url}">
                <img src="${img.thumb}" alt="${img.alt || query}" loading="lazy">
            </div>
        `).join('');

        // Click to select
        container.querySelectorAll('.image-grid-item').forEach(item => {
            item.addEventListener('click', () => {
                const url = item.dataset.url;
                document.getElementById('hero-bg-image').value = url;
                updateHeroPreview();
                container.innerHTML = '';
            });
        });
    } catch (e) {
        container.innerHTML = `<div style="color:var(--danger); padding:16px;">${e.message}</div>`;
    }
}

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
        refreshAutoPersonaSelect();
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
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    // --- First Names by region/gender ---
    const firstNames = {
        western_f: ["Emma", "Olivia", "Sophia", "Ava", "Isabella", "Mia", "Charlotte", "Harper", "Amelia", "Ella", "Chloe", "Grace", "Lily", "Zoe", "Hannah", "Natalie", "Victoria", "Audrey", "Claire", "Scarlett", "Lucy", "Nora", "Stella", "Violet", "Ruby"],
        western_m: ["Liam", "Noah", "James", "William", "Oliver", "Benjamin", "Lucas", "Henry", "Alexander", "Daniel", "Matthew", "Sebastian", "Jack", "Owen", "Ethan", "Ryan", "Nathan", "Dylan", "Samuel", "Caleb", "Leo", "Max", "Theo", "Miles", "Finn"],
        korean_f: ["Jiyeon", "Minji", "Soojin", "Yuna", "Haeun", "Soyeon", "Dahyun", "Eunbi", "Chaeyoung", "Nayeon", "Seulgi", "Jisoo", "Yeji", "Hyejin", "Subin"],
        korean_m: ["Minjun", "Jiwoo", "Seohan", "Hyunwoo", "Taeyang", "Dongwook", "Junhyuk", "Siwon", "Jaehyun", "Seojun", "Doyoon", "Yoonho", "Jihoon", "Wonjin", "Hajun"],
        japanese_f: ["Yuki", "Sakura", "Hana", "Aoi", "Mei", "Rin", "Mio", "Saki", "Nanami", "Koharu"],
        japanese_m: ["Haruto", "Ren", "Sota", "Yuto", "Kaito", "Riku", "Hinata", "Takumi", "Kenta", "Daichi"],
        chinese_f: ["Mei Lin", "Xiao Wei", "Li Na", "Jing Yi", "Xin Yue", "Yan Yan", "Zi Han", "Yu Xin", "Shu Qi", "Wen Xin"],
        chinese_m: ["Wei", "Jun", "Hao", "Zhi Yuan", "Yi Fan", "Tian Yu", "Chen Xi", "Ming Hao", "Zi Xuan", "Bo Wen"],
        southeast_asian_f: ["Priya", "Ananya", "Nurul", "Putri", "Mai", "Thao", "Arisa", "Kamala", "Siti", "Nadia"],
        southeast_asian_m: ["Arjun", "Raj", "Ahmad", "Rizky", "Duc", "Minh", "Kiran", "Ravi", "Budi", "Tariq"],
        european_f: ["Léa", "Camille", "Lena", "Freya", "Elsa", "Chiara", "Marta", "Ingrid", "Katya", "Petra", "Amelie", "Bianca", "Sofie", "Astrid", "Elena"],
        european_m: ["Hugo", "Louis", "Matteo", "Lars", "Erik", "Marco", "Pablo", "Andrei", "Niklas", "Felix", "Anton", "Luca", "Sven", "Pierre", "Dmitri"],
        latin_f: ["Valentina", "Camila", "Luciana", "Gabriela", "Mariana", "Fernanda", "Daniela", "Renata", "Isabela", "Paloma"],
        latin_m: ["Santiago", "Mateo", "Diego", "Alejandro", "Carlos", "Miguel", "Rafael", "Andrés", "Gabriel", "Felipe"],
        african_f: ["Amara", "Zara", "Nia", "Aisha", "Fatima", "Kemi", "Thandiwe", "Amina", "Chioma", "Naledi"],
        african_m: ["Kwame", "Emeka", "Tariq", "Jabari", "Kofi", "Chidi", "Oluwaseun", "Tendai", "Amadi", "Sekou"]
    };

    // --- Last Names by region ---
    const lastNames = {
        western: ["Smith", "Johnson", "Williams", "Brown", "Jones", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Clark", "Harris", "Lewis", "Walker", "Hall", "Allen", "Young", "King", "Wright"],
        korean: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Song", "Ahn", "Ryu", "Bae", "Moon"],
        japanese: ["Tanaka", "Suzuki", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Sato", "Kato", "Yoshida"],
        chinese: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Wu", "Zhou", "Xu"],
        european: ["Müller", "Schmidt", "Dubois", "Martin", "García", "Rossi", "Silva", "Andersen", "Johansson", "Petrov", "Larsson", "Bernard", "Meyer", "Moreau", "Ferreira"],
        latin: ["García", "Rodríguez", "Martínez", "López", "Hernández", "González", "Pérez", "Sánchez", "Ramírez", "Torres"],
        southeast_asian: ["Patel", "Sharma", "Nguyen", "Tran", "Pham", "Rahman", "Singh", "Tan", "Wong", "Das"],
        african: ["Okafor", "Mensah", "Adeyemi", "Nkosi", "Diallo", "Osei", "Kamara", "Mwangi", "Abara", "Dlamini"]
    };

    // --- Jobs (expanded) ---
    const jobs = [
        "Travel Blogger", "K-Beauty Editor", "Food Critic", "K-Pop Journalist", "Digital Nomad",
        "Expat Living in Seoul", "Culture Columnist", "Lifestyle Vlogger", "Skincare Researcher",
        "Korean Food Recipe Developer", "K-Drama Reviewer", "Language Learning Coach",
        "Photography Enthusiast", "Fashion & Style Writer", "Hallyu Culture Analyst",
        "Freelance Journalist", "Study Abroad Student", "ESL Teacher in Korea",
        "Seoul City Guide", "Wellness & Health Writer", "K-Pop Fan Community Leader",
        "Travel Photographer", "Street Food Explorer", "Cultural Anthropologist",
        "Korean History Researcher", "Sustainable Travel Advocate"
    ];

    // --- Countries (expanded) ---
    const countries = [
        "USA", "UK", "Canada", "Australia", "France", "Germany", "Singapore", "Japan",
        "South Korea", "Philippines", "Indonesia", "India", "Vietnam", "Thailand", "Malaysia",
        "Brazil", "Mexico", "Colombia", "Spain", "Italy", "Netherlands", "Sweden", "Norway",
        "Nigeria", "South Africa", "Kenya", "Ghana", "New Zealand", "Ireland", "Portugal",
        "Poland", "Turkey", "UAE", "Saudi Arabia", "Argentina", "Chile", "Taiwan", "Hong Kong"
    ];

    // --- Likes (expanded) ---
    const likesList = [
        "Spicy tteokbokki", "Hidden cafes in Hongdae", "Indie Korean music", "Skincare routines",
        "Korean history", "Street food markets", "K-Drama binge watching", "Soju tastings",
        "Temple stays", "Korean BBQ", "Jeju Island hikes", "Hanbok fashion", "Night markets",
        "Korean pottery and ceramics", "Bukchon Hanok Village walks", "Seoul subway exploration",
        "Korean language learning", "Vintage shopping in Itaewon", "PC bang culture",
        "Makgeolli brewing", "Cherry blossom season", "Korean fried chicken", "Jimjilbang spa days",
        "K-Pop album collecting", "Traditional tea ceremonies", "Busan beach culture",
        "Korean calligraphy", "Seoul rooftop bars", "Korean cooking classes"
    ];

    // --- Ages ---
    const ages = ["20", "22", "24", "25", "27", "28", "30", "32", "33", "35", "38", "40", "42", "45", "50", "55"];
    const genders = ["Female", "Male", "Non-binary"];

    // Pick a random region group
    const regionGroups = [
        { first_f: 'western_f', first_m: 'western_m', last: 'western' },
        { first_f: 'korean_f', first_m: 'korean_m', last: 'korean' },
        { first_f: 'japanese_f', first_m: 'japanese_m', last: 'japanese' },
        { first_f: 'chinese_f', first_m: 'chinese_m', last: 'chinese' },
        { first_f: 'european_f', first_m: 'european_m', last: 'european' },
        { first_f: 'latin_f', first_m: 'latin_m', last: 'latin' },
        { first_f: 'southeast_asian_f', first_m: 'southeast_asian_m', last: 'southeast_asian' },
        { first_f: 'african_f', first_m: 'african_m', last: 'african' }
    ];

    const region = pick(regionGroups);
    const gender = pick(genders);
    const isFemale = gender === 'Female';
    const firstKey = isFemale ? region.first_f : (gender === 'Male' ? region.first_m : pick([region.first_f, region.first_m]));
    const firstName = pick(firstNames[firstKey]);
    const lastName = pick(lastNames[region.last]);
    const rName = `${firstName} ${lastName}`;
    const rJob = pick(jobs);
    const rCountry = pick(countries);
    const rAge = pick(ages);
    const rLikes = pick(likesList);

    document.getElementById('p-name').value = rName;
    document.getElementById('p-job').value = rJob;
    document.getElementById('p-nationality').value = rCountry;
    document.getElementById('p-likes').value = rLikes;
    document.getElementById('p-age').value = rAge;
    document.getElementById('p-gender').value = gender;

    const bio = `Hi, I'm ${rName}! I'm a ${rAge}-year-old ${rJob} from ${rCountry} currently exploring every corner of Korea. I'm obsessed with ${rLikes} and love sharing my honest experiences. Follow along for my local tips!`;
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
const SOURCE_COLORS = ['var(--accent)', '#E1306C', '#f59e0b', '#10b981', '#8b5cf6', 'var(--text-muted)'];

async function loadDashboard() {
    // 1. Supabase stats (posts count, scheduled)
    const { data: posts, error } = await supabase.from('posts').select('title, views, status');
    if (error) { console.error(error); return; }

    let scheduled = 0;
    (posts || []).forEach(d => { if (d.status === 'scheduled') scheduled++; });

    document.getElementById('stat-posts').innerText = (posts || []).length;
    document.getElementById('stat-scheduled').innerText = scheduled;

    // 2. Fetch real GA4 data
    try {
        const gaRes = await fetch('/ga-proxy', { method: 'POST' });
        if (!gaRes.ok) throw new Error('GA proxy returned ' + gaRes.status);
        const ga = await gaRes.json();
        if (ga.error) throw new Error(ga.error);

        // Overview stats
        document.getElementById('stat-views').innerText = (ga.pageViews || 0).toLocaleString();
        document.getElementById('stat-users').innerText = (ga.totalUsers || 0).toLocaleString();

        // Traffic sources
        renderTrafficSources(ga.sources || []);

        // Top pages
        renderTopPages(ga.topPages || []);

        // Daily trend chart
        renderDailyTrend(ga.dailyTrend || []);

    } catch (e) {
        console.warn("GA4 Fetch Failed:", e);
        // Fallback to Supabase views
        let totalViews = 0;
        (posts || []).forEach(d => { totalViews += (d.views || 0); });
        document.getElementById('stat-views').innerText = totalViews.toLocaleString();
        document.getElementById('stat-users').innerText = '-';
        document.getElementById('traffic-sources-container').innerHTML = '<div style="color:var(--text-muted); padding:10px;">GA4 연결 실패 - Supabase 조회수 표시 중</div>';

        // Fallback top posts from Supabase
        const postList = (posts || []).map(d => ({ title: d.title, views: d.views || 0 }));
        postList.sort((a, b) => b.views - a.views);
        const tbody = document.querySelector('#dashboard-top-posts tbody');
        tbody.innerHTML = '';
        postList.slice(0, 10).forEach(p => {
            tbody.innerHTML += `<tr><td>${p.title}</td><td style="text-align:right; font-weight:bold;">${p.views.toLocaleString()}</td></tr>`;
        });
    }
}

function renderTrafficSources(sources) {
    const container = document.getElementById('traffic-sources-container');
    if (!sources.length) {
        container.innerHTML = '<div style="color:var(--text-muted); padding:10px;">No traffic data yet</div>';
        return;
    }
    container.innerHTML = '';
    sources.forEach((s, i) => {
        const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
        container.innerHTML += `
            <div class="stat-row"><span>${s.name}</span> <span>${s.percent}% (${s.sessions.toLocaleString()})</span></div>
            <div class="stat-bar"><div class="stat-bar-fill" style="width: ${s.percent}%; background-color: ${color};"></div></div>
        `;
    });
}

function renderTopPages(pages) {
    const tbody = document.querySelector('#dashboard-top-posts tbody');
    tbody.innerHTML = '';
    if (!pages.length) {
        tbody.innerHTML = '<tr><td colspan="2" style="color:var(--text-muted);">No page data yet</td></tr>';
        return;
    }
    pages.forEach(p => {
        const displayPath = p.path === '/' ? 'Homepage' : decodeURIComponent(p.path);
        tbody.innerHTML += `<tr><td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${displayPath}</td><td style="text-align:right; font-weight:bold;">${p.views.toLocaleString()}</td></tr>`;
    });
}

function renderDailyTrend(trend) {
    const chart = document.getElementById('daily-trend-chart');
    const labels = document.getElementById('daily-trend-labels');
    if (!trend.length) {
        chart.innerHTML = '<div style="color:var(--text-muted);">No trend data</div>';
        return;
    }
    const maxViews = Math.max(...trend.map(d => d.views), 1);
    chart.innerHTML = '';
    labels.innerHTML = '';
    trend.forEach(d => {
        const height = Math.max((d.views / maxViews) * 100, 4);
        const dateStr = d.date.substring(4, 6) + '/' + d.date.substring(6, 8);
        chart.innerHTML += `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
                <span style="font-size:11px; color:var(--text-muted);">${d.views}</span>
                <div style="width:100%; height:${height}px; background:var(--accent); border-radius:4px 4px 0 0; min-height:4px;" title="${d.views} views, ${d.users} users"></div>
            </div>
        `;
        labels.innerHTML += `<div style="flex:1; text-align:center;">${dateStr}</div>`;
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

    // Reset HTML mode if active
    if (isHtmlMode) {
        toggleHtmlSource();
    }

    const { data: p, error } = await supabase.from('posts').select('*').eq('id', id).single();
    if (error || !p) return;

    document.getElementById('ai-suggested-title').value = p.title;
    document.getElementById('ai-category').value = p.category;

    // Load slug field
    const slugInput = document.getElementById('ai-slug');
    if (slugInput) {
        slugInput.value = p.slug || generateSlug(p.title);
    }

    // Clear editor before loading new content
    quill.setContents([]);

    // Pre-process affiliate blocks before loading into Quill
    const editorContent = processContentForEdit(p.content || '');
    quill.clipboard.dangerouslyPasteHTML(editorContent);
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
    affiliateCodes = {}; // Clear affiliate codes
    document.getElementById('writer-heading').innerText = "AI Content Creator";
    document.getElementById('btn-save-post').innerHTML = '<i class="ph ph-paper-plane-right"></i> Publish';

    // Reset HTML mode if active
    if (isHtmlMode) {
        toggleHtmlSource();
    }

    document.getElementById('step-1').classList.add('active');
    document.getElementById('step-2').style.opacity = '0.5';
    document.getElementById('step-2').style.pointerEvents = 'none';
    document.getElementById('step-2').classList.remove('active');
    document.getElementById('step-3').style.opacity = '0.5';
    document.getElementById('step-3').style.pointerEvents = 'none';
    document.getElementById('step-3').classList.remove('active');
    document.getElementById('ai-topic').value = '';
    document.getElementById('ai-suggested-title').value = '';
    document.getElementById('ai-slug').value = '';
    document.getElementById('ai-img-query').value = '';
    document.getElementById('ai-category').selectedIndex = 0;
    document.getElementById('post-schedule').value = '';
    document.getElementById('ai-keywords-container').innerHTML = '';
    const titleOptions = document.getElementById('ai-title-options-container');
    if (titleOptions) titleOptions.innerHTML = '';
    quill.setText('');
    activeImage = '';
    imgSearchPage = 1;
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
        const voiceGuide = getVoiceGuide(persona.nationality);
        const jobVoice = getJobVoice(persona.job);
        const likesAngle = persona.likes ? `\n- Since this writer is passionate about "${persona.likes}", angle the titles to connect the topic with that interest where possible. For example, if their interest is "Spicy food" and the topic is "Myeongdong", lean into the spicy food angle.` : '';
        personaContext = `
**Writer Persona Context (titles MUST reflect this voice):**
- Name: ${persona.name}, a ${persona.age} ${persona.gender} ${persona.nationality} ${persona.job}
- Passionate about: ${persona.likes}${likesAngle}

**VOICE GUIDE (follow this carefully for title tone):**
${voiceGuide}

**PROFESSIONAL ANGLE:**
${jobVoice}

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

        let rawText = await callAI(prompt, {
            generationConfig: { temperature: 0.4, topP: 0.85 }
        });
        const data = parseAIJSON(rawText);

        document.getElementById('ai-suggested-title').value = data.suggested_titles[0] || `Guide to ${topic}`;

        // Auto-generate slug from the selected title
        document.getElementById('ai-slug').value = generateSlug(data.suggested_titles[0] || topic);

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
                document.getElementById('ai-slug').value = generateSlug(title);
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

    // 1. Fetch Images from multi-source (Unsplash + Pexels via proxy)
    let allImages = [];
    try {
        // Generate diverse image search queries via AI
        let imageQueries = [
            `${topic} ${keywords.slice(0, 2).join(' ')} korea`,
            topic
        ];
        try {
            const iqPrompt = `Generate 3 diverse image search queries for a blog post about "${topic}" in Korea. Return JSON array only: ["food closeup query", "street/scenery query", "cultural activity query"]. Short queries (2-4 words each). No explanation.`;
            const iqRaw = await callAI(iqPrompt, { generationConfig: { temperature: 0.3 } });
            const iqParsed = parseAIJSON(iqRaw);
            if (Array.isArray(iqParsed) && iqParsed.length >= 2) imageQueries = iqParsed;
        } catch (e) {
            console.warn("[Images] AI query generation failed, using defaults:", e);
        }

        console.log("[Images] Queries:", imageQueries);

        // Fetch from Unsplash (first 2 queries) and Pexels (3rd query) in parallel
        const fetchPromises = [];
        imageQueries.slice(0, 2).forEach(q => {
            fetchPromises.push(
                fetch(`/image-proxy?source=unsplash&query=${encodeURIComponent(q)}&count=3`)
                    .then(r => r.json()).catch(() => ({ images: [] }))
            );
        });
        if (imageQueries.length >= 3) {
            fetchPromises.push(
                fetch(`/image-proxy?source=pexels&query=${encodeURIComponent(imageQueries[2])}&count=3`)
                    .then(r => r.json()).catch(() => ({ images: [] }))
            );
        }

        const results = await Promise.all(fetchPromises);
        const seenUrls = new Set();
        // Interleave sources for diversity
        const maxLen = Math.max(...results.map(r => (r.images || []).length));
        for (let i = 0; i < maxLen; i++) {
            for (const result of results) {
                const imgs = result.images || [];
                if (i < imgs.length && !seenUrls.has(imgs[i].url)) {
                    seenUrls.add(imgs[i].url);
                    allImages.push(imgs[i]);
                }
            }
        }
        console.log(`[Images] Found ${allImages.length} unique images from ${results.length} sources`);
    } catch (e) {
        console.error("Image fetch error:", e);
    }

    // Fallback: try simple Unsplash proxy search if we got nothing
    if (allImages.length < 3) {
        try {
            const res = await fetch(`/image-proxy?source=unsplash&query=${encodeURIComponent(topic + ' korea')}&count=5`);
            const data = await res.json();
            const existingUrls = new Set(allImages.map(i => i.url));
            (data.images || []).forEach(img => {
                if (!existingUrls.has(img.url)) allImages.push(img);
            });
        } catch (e) {
            console.error("Image fallback error:", e);
        }
    }

    if (allImages.length > 0 && !activeImage) {
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
        const voiceGuide = getVoiceGuide(persona.nationality);
        const jobVoice = getJobVoice(persona.job);
        const personaConfig = getPersonaConfig(persona);
        const exampleOpening = getExampleOpening(persona);

        const likesIntegration = persona.likes ? `\n5. **PERSONAL INTERESTS:** Naturally weave "${persona.likes}" into the article. Don't force it — find organic connections between the topic and this interest. Maybe a comparison, a personal anecdote, or a specific recommendation related to it.` : '';

        const prompt = `
**You ARE ${persona.name}. Stay in character for the ENTIRE article.**

**Your Identity:**
- ${persona.age} ${persona.gender} from ${persona.nationality}, working as a ${persona.job}
- Passionate about: ${persona.likes}
- Bio: "${persona.bio}"

**YOUR UNIQUE VOICE (CRITICAL — follow strictly):**
${voiceGuide}

**YOUR PROFESSIONAL LENS:**
${jobVoice}

**EXAMPLE OPENING (match this energy and style, but DO NOT copy it verbatim):**
"${exampleOpening}"

**Task:** Write a blog post for 'Korea Decode'.

**Topic:** "${title}"
**Core Subject:** "${topic}"
**Target Keywords:** ${keywords.join(', ')}

**RULES:**
1. **Voice:** First person ("I", "my"). Share personal opinions, experiences, and reactions that fit YOUR background. A ${persona.nationality} ${persona.job} would notice different things than other writers — highlight THOSE unique observations. NEVER sound like a generic AI blog post.
2. **Structure:**
   - Hook intro (NO self-introduction like "Hello, I'm..."). Jump straight into an engaging opening that matches the example style above.
   - 3-5 sections with <h2>/<h3> tags. Use <ul><li> for lists, <strong> for key terms, <blockquote> for personal tips.
   - Strong conclusion with call-to-action.
3. **IMAGES — MANDATORY:** You MUST place exactly **${imgCount}** image markers in the article. Write the text **[IMG]** alone on its own line, wrapped in a paragraph tag like this: <p>[IMG]</p>. Space them evenly through the article (roughly every 2-3 paragraphs). This is REQUIRED — do not skip this.
4. **HTML only.** No <html>, <body>, <h1>, or markdown. Use <p>, <h2>, <h3>, <ul>, <blockquote>.${likesIntegration}

**Output:** Only the article HTML body. No explanations before or after.`;

        let rawContent = await callAI(prompt, {
            generationConfig: { temperature: personaConfig.temperature, topP: personaConfig.topP }
        });

        // Clean markdown code blocks from response
        rawContent = rawContent.trim();
        if (rawContent.startsWith('```html')) {
            rawContent = rawContent.replace(/^```html\s*/, '').replace(/\s*```$/, '');
        } else if (rawContent.startsWith('```')) {
            rawContent = rawContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        // Replace image placeholders with actual images (multi-source attribution)
        contentImages.forEach(img => {
            const sourceName = img.source === 'pexels' ? 'Pexels' : 'Unsplash';
            const sourceUrl = img.source === 'pexels'
                ? 'https://www.pexels.com/'
                : 'https://unsplash.com/?utm_source=korea_decode&utm_medium=referral';
            const userLink = img.source === 'pexels'
                ? img.user_link
                : `${img.user_link}?utm_source=korea_decode&utm_medium=referral`;
            const imgHtml = `<figure><img src="${img.url}" alt="${img.alt}" style="width:100%;border-radius:8px;"><figcaption>Photo by <a href="${userLink}" target="_blank">${img.user}</a> on <a href="${sourceUrl}" target="_blank">${sourceName}</a></figcaption></figure>`;
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
                <p>Hello! I'm <strong>${persona.name}</strong>, a ${persona.age} ${persona.nationality} ${persona.job}.</p>
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
                <p>Hope this helps you on your Korea trip! Let me know if you want more tips from a ${persona.nationality} local.</p>
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
        // Update slug after SEO polish
        document.getElementById('ai-slug').value = generateSlug(title);
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
    unsplashMode = 'featured';
    const q = document.getElementById('ai-img-query').value;
    document.getElementById('unsplash-modal-search').value = q;
    document.getElementById('unsplash-modal-title').innerText = 'Featured Image';
    resetUploadUI();
    switchImageModalTab('search');
    searchUnsplashModal();
};

function openUnsplashForBody() {
    unsplashMode = 'body';
    document.getElementById('unsplash-modal-title').innerText = 'Insert Image into Body';
    document.getElementById('unsplash-modal-search').value = document.getElementById('ai-topic')?.value || '';
    document.getElementById('unsplash-results').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);">Search for an image to insert</div>';
    resetUploadUI();
    switchImageModalTab('search');
    document.getElementById('modal-unsplash').style.display = 'flex';
    document.getElementById('unsplash-modal-search').focus();
}

function switchImageModalTab(tabName) {
    document.querySelectorAll('.img-modal-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector(`.img-modal-tab[data-tab="${tabName}"]`);
    if (activeTab) activeTab.classList.add('active');
    document.getElementById('img-tab-search').style.display = tabName === 'search' ? 'block' : 'none';
    document.getElementById('img-tab-upload').style.display = tabName === 'upload' ? 'block' : 'none';
}

async function searchUnsplashModal(loadMore = false) {
    const q = document.getElementById('unsplash-modal-search').value.trim();
    if (!q) return;
    const container = document.getElementById('unsplash-results');

    if (!loadMore) {
        imgSearchPage = 1;
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;">Searching...</div>';
    } else {
        // Remove existing load-more button
        const existingBtn = container.querySelector('.load-more-btn');
        if (existingBtn) {
            existingBtn.textContent = 'Loading...';
            existingBtn.disabled = true;
        }
    }

    document.getElementById('modal-unsplash').style.display = 'flex';
    try {
        const [unsplashRes, pexelsRes] = await Promise.all([
            fetch(`/image-proxy?source=unsplash&query=${encodeURIComponent(q)}&count=12&page=${imgSearchPage}`).then(r => r.json()).catch(() => ({ images: [], totalPages: 0 })),
            fetch(`/image-proxy?source=pexels&query=${encodeURIComponent(q)}&count=6&page=${imgSearchPage}`).then(r => r.json()).catch(() => ({ images: [], totalPages: 0 }))
        ]);

        // Interleave: 2 unsplash, 1 pexels, repeat
        const combined = [];
        const uImgs = unsplashRes.images || [];
        const pImgs = pexelsRes.images || [];
        let ui = 0, pi = 0;
        while (ui < uImgs.length || pi < pImgs.length) {
            if (ui < uImgs.length) combined.push(uImgs[ui++]);
            if (ui < uImgs.length) combined.push(uImgs[ui++]);
            if (pi < pImgs.length) combined.push(pImgs[pi++]);
        }

        if (!loadMore) container.innerHTML = '';
        else {
            const oldBtn = container.querySelector('.load-more-btn');
            if (oldBtn) oldBtn.remove();
        }

        if (combined.length === 0 && !loadMore) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No results found</div>';
            return;
        }

        combined.forEach(img => {
            const el = document.createElement('img');
            el.src = img.thumb || img.url;
            el.className = 'modal-img-item';
            el.title = `${img.user} (${img.source === 'pexels' ? 'Pexels' : 'Unsplash'})`;
            el.onclick = () => {
                if (unsplashMode === 'body') {
                    insertImageIntoBody({
                        url: img.url,
                        alt: img.alt || q,
                        user: img.user,
                        user_link: img.user_link,
                        source: img.source
                    });
                } else {
                    activeImage = img.url;
                    document.getElementById('selected-ai-img').src = activeImage;
                    document.getElementById('selected-ai-img').style.display = 'block';
                    document.getElementById('ai-img-placeholder').style.display = 'none';
                }
                document.getElementById('modal-unsplash').style.display = 'none';
            };
            container.appendChild(el);
        });

        // Add Load More button if there are more pages
        const hasMore = (unsplashRes.totalPages || 0) > imgSearchPage || (pexelsRes.totalPages || 0) > imgSearchPage;
        if (hasMore && combined.length > 0) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'btn btn-outline load-more-btn';
            loadMoreBtn.style.cssText = 'grid-column:1/-1; margin-top:8px; padding:10px;';
            loadMoreBtn.innerHTML = '<i class="ph ph-arrow-down"></i> Load More';
            loadMoreBtn.onclick = () => {
                imgSearchPage++;
                searchUnsplashModal(true);
            };
            container.appendChild(loadMoreBtn);
        }
    } catch (e) {
        if (!loadMore) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--danger);">API Error</div>';
        }
    }
}

function selectFeaturedImage(img) {
    activeImage = img.urls.regular;
    document.getElementById('selected-ai-img').src = activeImage;
    document.getElementById('selected-ai-img').style.display = 'block';
    document.getElementById('ai-img-placeholder').style.display = 'none';
}

function insertImageIntoBody(img) {
    const range = quill.getSelection(true);
    const index = range ? range.index : quill.getLength() - 1;
    const sourceName = img.source === 'pexels' ? 'Pexels' : 'Unsplash';
    const sourceUrl = img.source === 'pexels'
        ? 'https://www.pexels.com/'
        : 'https://unsplash.com/?utm_source=korea_decode&utm_medium=referral';
    const userLink = img.source === 'pexels'
        ? img.user_link
        : `${img.user_link}?utm_source=korea_decode&utm_medium=referral`;
    const figureHtml = `<figure><img src="${img.url}" alt="${img.alt}" style="width:100%;border-radius:8px;"><figcaption>Photo by <a href="${userLink}" target="_blank">${img.user}</a> on <a href="${sourceUrl}" target="_blank">${sourceName}</a></figcaption></figure>`;
    quill.insertText(index, '\n');
    quill.clipboard.dangerouslyPasteHTML(index + 1, figureHtml);
    quill.setSelection(index + 2);
}

// --- SHARED VOICE GUIDE FUNCTIONS ---
function getVoiceGuide(nationality) {
    const guides = {
        'USA': `**VOCABULARY:** Use "honestly," "literally," "game-changer," "vibe check," "I'm obsessed," "low-key," "no cap." Comfortable with internet slang and Gen Z/millennial crossover language.
**STRUCTURE:** Mix short punchy sentences with longer stream-of-consciousness ones. Use rhetorical questions ("Is it just me or...?"). Love em-dashes and parenthetical asides.
**CULTURAL LENS:** Compare Korean experiences to American equivalents — Target vs Daiso, Starbucks vs Korean cafes, NYC subway vs Seoul metro. Reference American pop culture naturally.
**QUIRKS:** Start sentences with "Okay so," "Listen," "Not gonna lie." Tend to hype things up. Use capitalization for emphasis ("THIS place").
**EXAMPLE PHRASES:** "Okay so hear me out—", "This might be controversial but...", "I literally cannot stress this enough", "If you know, you know (IYKYK)"`,

        'UK': `**VOCABULARY:** Use "rather," "spot on," "proper," "brilliant," "cheeky," "dodgy," "sorted." Comfortable with understatement and irony. Occasional "bloody" for emphasis.
**STRUCTURE:** Longer, more complex sentences with subordinate clauses. Dry observations followed by a wry aside. Build up to the point with gentle preamble.
**CULTURAL LENS:** Compare to British institutions — Greggs vs Korean bakeries, the Tube vs Seoul metro, pub culture vs Korean drinking culture. Reference British weather as universal benchmark.
**QUIRKS:** Understate strong emotions ("not entirely terrible" = amazing). Self-deprecating humor. Hedge opinions with "one might argue" or "I dare say."
**EXAMPLE PHRASES:** "I'd heard the claims, of course—", "Right then, let's get into it", "which, frankly, is no small feat", "I was pleasantly surprised, if I'm being honest"`,

        'Australia': `**VOCABULARY:** Use "heaps," "reckon," "arvo," "brekkie," "no worries," "keen," "suss out," "chucked." Drop the g in -ing occasionally ("goin'," "lovin'").
**STRUCTURE:** Casual, conversational flow. Short sentences mixed with friendly run-ons. Pose questions to the reader as if chatting at a pub.
**CULTURAL LENS:** Compare to Australian outdoors/beach culture, BBQ vs Korean BBQ, Australian coffee culture vs Korean cafes. Reference distance and travel ("back home you'd drive 4 hours for this").
**QUIRKS:** Abbreviate everything — "defs," "arvo," "brekkie." Call everyone "mate." Play down impressive things ("yeah it was alright" = incredible).
**EXAMPLE PHRASES:** "Look, I'm not gonna sugarcoat it—", "Mate, you absolutely have to try this", "Reckon this is one of the best I've had", "No worries if that's not your thing, but—"`,

        'France': `**VOCABULARY:** Naturally weave in French words — "ambiance," "je ne sais quoi," "quartier," "rapport qualite-prix." Use refined adjectives like "exquisite," "nuanced," "sophisticated."
**STRUCTURE:** Elegant longer sentences with multiple clauses. Build atmosphere before delivering opinions. Philosophical observations woven into practical content.
**CULTURAL LENS:** Compare Korean aesthetics and cuisine to French standards — patisserie vs Korean desserts, fashion sensibility, cafe culture. Always note quality and craftsmanship.
**QUIRKS:** Strong opinions about food quality and presentation. Appreciate artistry in everyday things. Slightly skeptical first, then won over.
**EXAMPLE PHRASES:** "One must admit, the attention to detail here is remarkable—", "As a Parisian, I was initially skeptical, but...", "There's a certain je ne sais quoi about this place", "The presentation alone deserves recognition"`,

        'Germany': `**VOCABULARY:** Use precise language — "specifically," "particularly noteworthy," "efficiently organized," "practical." Occasional German terms like "Gemutlichkeit," "Wanderlust."
**STRUCTURE:** Well-organized with clear progression. Topic sentences followed by supporting evidence. Include specifics — prices, hours, distances, transit details.
**CULTURAL LENS:** Compare systems and efficiency — Korean transit punctuality, organizational methods, recycling systems, work culture. Appreciate engineering and infrastructure.
**QUIRKS:** Include practical logistics that other writers skip. Rate value-for-money. Appreciate well-designed systems. Slightly structured even in casual writing.
**EXAMPLE PHRASES:** "What immediately stands out is the efficiency of—", "From a practical standpoint, here's what you need to know", "The attention to systematic organization here is impressive", "At approximately 15,000 KRW, this represents excellent value"`,

        'Singapore': `**VOCABULARY:** Use Singlish-flavored expressions — "shiok," "can lah," "wah," "damn power," "not bad leh." Mix formal English with casual Singlish naturally.
**STRUCTURE:** Conversational and warm. Short exclamatory sentences mixed with detailed descriptions. Direct comparisons and food-focused observations.
**CULTURAL LENS:** Compare Korean hawker/street food to Singapore's, MRT systems, multicultural neighborhoods, shopping culture. Note the Asian similarities and surprising differences.
**QUIRKS:** Food-centric observations in every post. Note cleanliness and organization. Appreciate good deals and value. Community-oriented perspective.
**EXAMPLE PHRASES:** "Wah, this one really not bad—", "Okay this is like our hawker center but level up sia", "Damn shiok, must try when you go", "Can lah, very worth the trip one"`,

        'Japan': `**VOCABULARY:** Use precise, aesthetically-minded language. Occasional Japanese terms — "kawaii," "sugoi," "oishii." Appreciate "wabi-sabi" beauty and subtle details.
**STRUCTURE:** Balanced, measured sentences. Observe small details that others miss. Build narrative through sensory descriptions — sight, sound, taste, texture.
**CULTURAL LENS:** Korean-Japanese cultural bridge — similar yet different customs, food similarities (ramen vs ramyeon), aesthetic sensibilities, convenience store culture, fashion subcultures.
**QUIRKS:** Notice textures, presentation, packaging. Appreciate seasonality. Quiet enthusiasm rather than loud excitement. Thoughtful comparisons that show deep cultural understanding.
**EXAMPLE PHRASES:** "What struck me first was the delicate balance of—", "There's a quiet beauty to this place that reminded me of...", "The level of care in the presentation is something I truly appreciate", "As someone from Japan, the subtle differences are fascinating"`,

        'Canada': `**VOCABULARY:** Use "for sure," "pretty solid," "eh," "toonie/loonie" references. Polite qualifiers like "I think," "in my experience." Comfortable multicultural vocabulary.
**STRUCTURE:** Warm, inclusive, and well-balanced. Mix personal experience with helpful advice. Acknowledging multiple perspectives before sharing own opinion.
**CULTURAL LENS:** Compare to Canadian multiculturalism — diverse food scenes, winter gear needs, politeness culture, nature appreciation, Tim Hortons vs Korean coffee chains.
**QUIRKS:** Apologize unnecessarily. Compare weather constantly. Appreciate inclusivity and accessibility. Mention poutine at least once in food posts.
**EXAMPLE PHRASES:** "Sorry, but I have to gush about this for a second—", "If you're coming from Canada, you'll really appreciate", "Pretty solid experience overall, I'd say", "This might remind you of home, but with a Korean twist"`
    };

    return guides[nationality] || `**VOCABULARY:** Use natural expressions from your cultural background. Be authentic to your linguistic heritage.
**STRUCTURE:** Write with your natural rhythm — let your cultural background shape sentence patterns.
**CULTURAL LENS:** Compare Korean experiences to what you know from home. Highlight surprising similarities and fascinating differences.
**QUIRKS:** Let your unique perspective shine through. The most interesting observations come from unexpected cultural angles.
**EXAMPLE PHRASES:** Share your genuine reactions. Write as you would naturally tell a friend about your Korea experience.`;
}

function getJobVoice(job) {
    if (job.includes('Blogger') || job.includes('Nomad')) return `**EXPERTISE:** Travel logistics, hidden gems, budget optimization, destination comparison. Years of road-tested knowledge.
**WRITING PATTERN:** Open with a hook from personal experience. Organize by practical sections (Getting There, What to Do, Budget Tips). End with "insider tip" that shows real expertise.
**CONTENT FOCUS:** Actionable travel advice, honest cost breakdowns, off-the-beaten-path discoveries, "what I wish I knew before going" insights.`;

    if (job.includes('Beauty') || job.includes('Skincare')) return `**EXPERTISE:** Ingredient science, product formulation, Korean beauty innovation, skincare routines, before/after analysis.
**WRITING PATTERN:** Lead with the product/trend discovery moment. Break down technical details accessibly. Include personal skin journey and results.
**CONTENT FOCUS:** Product deep-dives, ingredient breakdowns, K-Beauty vs Western beauty comparisons, routine building, shopping guides for beauty districts.`;

    if (job.includes('Food') || job.includes('Critic')) return `**EXPERTISE:** Flavor profiling, cooking technique analysis, ingredient sourcing, restaurant ambiance assessment, food history and cultural context.
**WRITING PATTERN:** Set the scene with atmosphere description. Analyze dishes systematically — appearance, aroma, taste, texture. Use precise culinary vocabulary. Rate with nuanced judgment, not simple stars.
**CONTENT FOCUS:** Detailed dish analysis, restaurant reviews with context, street food deep-dives, regional cuisine differences, cooking class experiences, market tours.`;

    if (job.includes('K-Pop') || job.includes('Stan')) return `**EXPERTISE:** Fandom culture, comeback analysis, idol training system, concert/fan event logistics, K-Pop industry business, music show voting.
**WRITING PATTERN:** High energy opening that matches fandom excitement. Mix deep industry knowledge with personal fan reactions. Use fandom terminology naturally. Shift between analytical and emotional.
**CONTENT FOCUS:** Concert venue reviews, fan pilgrimage locations, album/merch shopping, entertainment district guides, fandom meet-up culture, trainee life insights.`;

    if (job.includes('Student')) return `**EXPERTISE:** Student life hacks, budget survival, campus culture, language learning journey, making Korean friends, navigating bureaucracy as a young foreigner.
**WRITING PATTERN:** Relatable "figuring it out" narrative. Mix struggles with discoveries. Honest about challenges. Excited about small wins. Write like texting a friend back home about your day.
**CONTENT FOCUS:** Affordable eats, student neighborhoods, language exchange tips, university culture, nightlife on a budget, dorm/housing reality, study cafe culture.`;

    return `**EXPERTISE:** Professional knowledge in your field applied to Korean cultural context.
**WRITING PATTERN:** Authoritative but accessible. Lead with unique professional insight, then broaden to general reader appeal.
**CONTENT FOCUS:** Niche expertise applied to Korean experiences, professional observations that casual visitors would miss.`;
}

function getPersonaConfig(persona) {
    const job = persona.job || '';
    if (job.includes('K-Pop') || job.includes('Stan')) return { temperature: 0.9, topP: 0.95 };
    if (job.includes('Food') || job.includes('Critic')) return { temperature: 0.6, topP: 0.9 };
    if (job.includes('Student')) return { temperature: 0.85, topP: 0.92 };
    if (job.includes('Beauty') || job.includes('Skincare')) return { temperature: 0.7, topP: 0.9 };
    if (job.includes('Blogger') || job.includes('Nomad')) return { temperature: 0.75, topP: 0.92 };
    return { temperature: 0.75, topP: 0.9 };
}

function getExampleOpening(persona) {
    const nat = persona.nationality || '';
    const job = persona.job || '';

    const openings = {
        'USA|Travel Blogger': "Okay, so I know literally everyone says you HAVE to visit this place — but hear me out, because there's a side of it nobody talks about.",
        'USA|Digital Nomad': "Real talk: I've worked from cafes in 23 countries, and Korea just completely reset my standards for what a workspace can be.",
        'USA|K-Pop Stan': "NOT ME literally screaming in the middle of the street when I realized where I was standing — this is THE spot, you guys.",
        'USA|Food Critic': "I'll be honest — I walked in expecting the usual tourist trap situation. What I got instead completely changed my mind.",
        'USA|Student': "So I'm sitting in my dorm room at 2am, scrolling through my photos from today, and I still can't believe this is my actual life right now.",
        'UK|Travel Blogger': "I'll confess I arrived with a healthy dose of British skepticism — which lasted approximately forty-five minutes.",
        'UK|Food Critic': "I'd heard the claims, of course — 'life-changing,' 'best you'll ever have,' the usual hyperbole. Reader, they were not exaggerating.",
        'UK|Student': "Right, so nobody warned me that studying abroad in Korea would basically rewire my entire understanding of what 'going out' means.",
        'UK|K-Pop Stan': "I flew twelve hours for a concert and an overpriced lightstick, and I'd do it again tomorrow without a moment's hesitation.",
        'UK|Digital Nomad': "Finding a proper workspace abroad is rather like finding a decent cup of tea — far more difficult than it has any right to be. Until Seoul.",
        'Australia|Travel Blogger': "Look, I've backpacked through most of Southeast Asia, but Korea hit different and I need to talk about why.",
        'Australia|Food Critic': "Mate, I thought I knew good BBQ — we practically invented the thing in Australia. Then Seoul absolutely humbled me.",
        'Australia|Student': "So my mates back home keep asking if I've gone 'full Korean' yet, and honestly? Yeah, kind of.",
        'Australia|K-Pop Stan': "I dragged my travel mate to three different fan merch shops before breakfast and no, I do not feel bad about it.",
        'France|Travel Blogger': "There are places that charm you slowly, and then there are places that seduce you immediately. This was undeniably the latter.",
        'France|Food Critic': "As someone raised on French cuisine, I approach foreign kitchens with both curiosity and — I'll admit — a certain standard. This exceeded it.",
        'Germany|Travel Blogger': "I'll start with what impressed me most: the infrastructure. Then we'll get to everything else, which was equally remarkable.",
        'Germany|Food Critic': "I approached this with a systematic plan — five restaurants, three markets, two cooking classes. Here's my comprehensive assessment.",
        'Singapore|Travel Blogger': "Wah, okay — coming from Singapore, I thought I knew Asian city life. Korea is like a parallel universe version that keeps surprising me.",
        'Singapore|Food Critic': "As someone who grew up in Singapore's hawker culture, I have strong opinions about street food. Korea's street food scene? Damn shiok.",
        'Japan|Travel Blogger': "The similarities between Korean and Japanese culture make the differences even more fascinating — and this experience perfectly illustrated why.",
        'Japan|Food Critic': "There's a precision in Korean cooking that resonates deeply with Japanese culinary philosophy, yet the approach is entirely its own.",
        'Canada|Travel Blogger': "Sorry in advance for how long this post is going to be — I just have SO many things to share about this experience.",
        'Canada|Food Critic': "As a Canadian, I thought nothing could beat our multicultural food scene. Korea has entered the chat, and it's a serious contender."
    };

    // Try exact match
    const key = `${nat}|${job}`;
    if (openings[key]) return openings[key];

    // Try partial job match
    for (const [k, v] of Object.entries(openings)) {
        const [oNat, oJob] = k.split('|');
        if (oNat === nat && job.includes(oJob.split(' ')[0])) return v;
    }

    // Fallback by nationality
    for (const [k, v] of Object.entries(openings)) {
        if (k.startsWith(nat + '|')) return v;
    }

    return "There's something about Korea that gets under your skin — not all at once, but in small, unforgettable moments.";
}

// --- AUTOMATION PROFILES ---
function loadAutoProfiles() {
    const profiles = JSON.parse(localStorage.getItem('auto_profiles') || '[]');
    const sel = document.getElementById('auto-profile-select');
    sel.innerHTML = '<option value="">New Profile</option>';
    profiles.forEach((p, i) => {
        sel.innerHTML += `<option value="${i}">${p.name}</option>`;
    });
}

function saveAutoProfile() {
    const name = document.getElementById('auto-profile-name').value.trim();
    if (!name) return alert('Enter a profile name');
    const profile = {
        name,
        persona: document.getElementById('auto-persona').value,
        category: document.getElementById('auto-category').value,
        wordcount: document.getElementById('auto-wordcount').value,
        imgCount: document.getElementById('auto-img-count').value,
        outputStatus: document.getElementById('auto-output-status').value,
        tone: document.getElementById('auto-tone').value,
        interval: document.getElementById('auto-interval').value
    };
    const profiles = JSON.parse(localStorage.getItem('auto_profiles') || '[]');
    const selVal = document.getElementById('auto-profile-select').value;
    if (selVal !== '') {
        profiles[parseInt(selVal)] = profile;
    } else {
        profiles.push(profile);
    }
    localStorage.setItem('auto_profiles', JSON.stringify(profiles));
    loadAutoProfiles();
    document.getElementById('auto-profile-select').value = selVal !== '' ? selVal : String(profiles.length - 1);
    alert('Profile saved!');
}

function deleteAutoProfile() {
    const idx = document.getElementById('auto-profile-select').value;
    if (idx === '') return;
    if (!confirm('Delete this profile?')) return;
    const profiles = JSON.parse(localStorage.getItem('auto_profiles') || '[]');
    profiles.splice(parseInt(idx), 1);
    localStorage.setItem('auto_profiles', JSON.stringify(profiles));
    loadAutoProfiles();
    document.getElementById('auto-profile-name').value = '';
}

function loadAutoProfile() {
    const idx = document.getElementById('auto-profile-select').value;
    if (idx === '') {
        document.getElementById('auto-profile-name').value = '';
        return;
    }
    const profiles = JSON.parse(localStorage.getItem('auto_profiles') || '[]');
    const p = profiles[parseInt(idx)];
    if (!p) return;
    document.getElementById('auto-profile-name').value = p.name;
    document.getElementById('auto-persona').value = p.persona || 'default';
    document.getElementById('auto-category').value = p.category || 'News';
    document.getElementById('auto-wordcount').value = p.wordcount || '1200';
    document.getElementById('auto-img-count').value = p.imgCount || '2';
    document.getElementById('auto-output-status').value = p.outputStatus || 'draft';
    document.getElementById('auto-tone').value = p.tone || '';
    document.getElementById('auto-interval').value = p.interval || '24';
}

function refreshAutoPersonaSelect() {
    const sel = document.getElementById('auto-persona');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="default">Default AI (Generic)</option>';
    availablePersonas.forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${p.name} - ${p.job} (${p.nationality})</option>`;
    });
    if (currentVal) sel.value = currentVal;
}

// --- AUTOMATION AI GENERATION ---
async function generateAutomationSEOPlan(topic, persona) {
    let personaContext = '';
    if (persona && persona.name !== 'Korea Decode Editor') {
        const voiceGuide = getVoiceGuide(persona.nationality);
        const likesAngle = persona.likes && persona.likes !== 'everything' ? `\nAngle the title to connect with their interest in "${persona.likes}" where natural.` : '';
        personaContext = `Writer: ${persona.name}, a ${persona.age} ${persona.gender} ${persona.nationality} ${persona.job}.
Voice summary: ${voiceGuide.split('\n')[0]}${likesAngle}
Titles must reflect their unique voice — not generic blog titles.`;
    }
    const prompt = `Generate an SEO plan for a Korea Decode blog post.
Topic: "${topic}"
${personaContext}
Return JSON only: { "title": "SEO-optimized engaging title", "keywords": ["kw1","kw2","kw3","kw4","kw5"] }`;
    const raw = await callAI(prompt, {
        generationConfig: { temperature: 0.4, topP: 0.85 }
    });
    return parseAIJSON(raw);
}

async function fetchAutomationImages(topic, keywords, count) {
    const images = [];
    const q1 = `${topic} ${(keywords || []).slice(0, 2).join(' ')} korea`;
    const q2 = topic + ' korea';
    try {
        // Fetch from Unsplash and Pexels in parallel via proxy
        const [unsplashRes, pexelsRes] = await Promise.all([
            fetch(`/image-proxy?source=unsplash&query=${encodeURIComponent(q1)}&count=${count}`).then(r => r.json()).catch(() => ({ images: [] })),
            fetch(`/image-proxy?source=pexels&query=${encodeURIComponent(q2)}&count=${Math.ceil(count / 2)}`).then(r => r.json()).catch(() => ({ images: [] }))
        ]);
        const seenUrls = new Set();
        // Interleave: 2 unsplash, 1 pexels
        const uImgs = unsplashRes.images || [];
        const pImgs = pexelsRes.images || [];
        let ui = 0, pi = 0;
        while (images.length < count + 1 && (ui < uImgs.length || pi < pImgs.length)) {
            if (ui < uImgs.length && !seenUrls.has(uImgs[ui].url)) { seenUrls.add(uImgs[ui].url); images.push(uImgs[ui]); }
            ui++;
            if (ui < uImgs.length && !seenUrls.has(uImgs[ui].url)) { seenUrls.add(uImgs[ui].url); images.push(uImgs[ui]); }
            ui++;
            if (pi < pImgs.length && !seenUrls.has(pImgs[pi].url)) { seenUrls.add(pImgs[pi].url); images.push(pImgs[pi]); }
            pi++;
        }
    } catch (e) {
        console.error('Automation image fetch error:', e);
    }
    return images;
}

async function generateAutomationArticle(topic, title, keywords, persona, wordCount, imgCount, toneOverride, images) {
    const voiceGuide = getVoiceGuide(persona.nationality);
    const jobVoice = getJobVoice(persona.job);
    const personaConfig = getPersonaConfig(persona);
    const exampleOpening = getExampleOpening(persona);
    const contentImages = images.slice(1, imgCount + 1);
    const actualImgCount = contentImages.length;

    const likesIntegration = persona.likes && persona.likes !== 'everything' ? `\n6. **PERSONAL INTERESTS:** Naturally weave "${persona.likes}" into the article where it fits organically.` : '';

    const prompt = `
**You ARE ${persona.name}. Stay in character for the ENTIRE article.**

**Your Identity:**
- ${persona.age} ${persona.gender} from ${persona.nationality}, working as a ${persona.job}
- Passionate about: ${persona.likes}

**YOUR UNIQUE VOICE:**
${voiceGuide}

**YOUR PROFESSIONAL LENS:**
${jobVoice}
${toneOverride ? `**TONE OVERRIDE:** ${toneOverride}` : ''}

**EXAMPLE OPENING (match this energy and style, but DO NOT copy verbatim):**
"${exampleOpening}"

**Task:** Write a ~${wordCount}-word blog post for 'Korea Decode'.
**Topic:** "${title}"
**Core Subject:** "${topic}"
**Target Keywords:** ${keywords.join(', ')}

**RULES:**
1. First person ("I", "my"). Share personal opinions and experiences fitting YOUR background. NEVER sound like a generic AI blog.
2. Structure: Hook intro (NO self-intro). 3-5 sections with <h2>/<h3>. Use <ul><li>, <strong>, <blockquote>.
3. Place exactly **${actualImgCount}** image markers: <p>[IMG]</p> spaced evenly through the article.
4. HTML only. No <html>, <body>, <h1>, or markdown.
5. Strong conclusion with call-to-action.${likesIntegration}

**Output:** Only the article HTML body.`;

    let rawContent = await callAI(prompt, {
        generationConfig: { temperature: personaConfig.temperature, topP: personaConfig.topP }
    });
    rawContent = rawContent.trim();
    if (rawContent.startsWith('```html')) rawContent = rawContent.replace(/^```html\s*/, '').replace(/\s*```$/, '');
    else if (rawContent.startsWith('```')) rawContent = rawContent.replace(/^```\s*/, '').replace(/\s*```$/, '');

    // Replace [IMG] with actual images (multi-source attribution)
    contentImages.forEach(img => {
        const sourceName = img.source === 'pexels' ? 'Pexels' : 'Unsplash';
        const sourceUrl = img.source === 'pexels'
            ? 'https://www.pexels.com/'
            : 'https://unsplash.com/?utm_source=korea_decode&utm_medium=referral';
        const userLink = img.source === 'pexels'
            ? img.user_link
            : `${img.user_link}?utm_source=korea_decode&utm_medium=referral`;
        const imgHtml = `<figure><img src="${img.url}" alt="${img.alt}" style="width:100%;border-radius:8px;"><figcaption>Photo by <a href="${userLink}" target="_blank">${img.user}</a> on <a href="${sourceUrl}" target="_blank">${sourceName}</a></figcaption></figure>`;
        if (rawContent.includes('<p>[IMG]</p>')) rawContent = rawContent.replace('<p>[IMG]</p>', imgHtml);
        else if (rawContent.includes('[IMG]')) rawContent = rawContent.replace('[IMG]', imgHtml);
    });
    rawContent = rawContent.replace(/<p>\[IMG\]<\/p>/g, '').replace(/\[IMG\]/g, '');

    return rawContent;
}

async function runAutomation() {
    const topics = document.getElementById('auto-topics').value.split('\n').filter(t => t.trim() !== '');
    const category = document.getElementById('auto-category').value;
    const startStr = document.getElementById('auto-start-date').value;
    const intervalHours = parseInt(document.getElementById('auto-interval').value);
    const wordCount = parseInt(document.getElementById('auto-wordcount').value);
    const imgCount = parseInt(document.getElementById('auto-img-count').value);
    const outputStatus = document.getElementById('auto-output-status').value;
    const toneOverride = document.getElementById('auto-tone').value.trim();
    const personaId = document.getElementById('auto-persona').value;

    if (topics.length === 0) return alert('Enter topics (one per line)');
    if (!startStr) return alert('Select start date');

    let persona = availablePersonas.find(p => p.id === personaId);
    if (!persona) {
        persona = { name: 'Korea Decode Editor', nationality: 'Seoul', job: 'Travel Guide', likes: 'everything', age: '30s', gender: 'Non-binary', bio: 'Your guide to all things Korea.' };
    }

    const btn = document.getElementById('btn-run-automation');
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Generating...';
    btn.disabled = true;

    // Show progress card
    const progressCard = document.getElementById('auto-progress-card');
    const progressBar = document.getElementById('auto-progress-bar');
    const progressText = document.getElementById('auto-progress-text');
    const progressLog = document.getElementById('auto-progress-log');
    progressCard.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.innerText = `0/${topics.length}`;
    progressLog.innerHTML = '';

    const logMsg = (msg) => {
        progressLog.innerHTML += `> ${msg}\n`;
        progressLog.scrollTop = progressLog.scrollHeight;
    };

    let currentDate = new Date(startStr);
    let completed = 0;

    for (const topic of topics) {
        const topicTrimmed = topic.trim();
        logMsg(`Processing: "${topicTrimmed}"...`);

        try {
            // Step 1: Generate SEO Plan
            logMsg('  -> Generating SEO plan...');
            const seoPlan = await generateAutomationSEOPlan(topicTrimmed, persona);
            const title = seoPlan.title || `${topicTrimmed} - Korea Decode`;
            const keywords = seoPlan.keywords || [];
            logMsg(`  -> Title: "${title}"`);

            // Step 2: Fetch Images
            logMsg('  -> Fetching images...');
            const images = await fetchAutomationImages(topicTrimmed, keywords, imgCount + 1);
            logMsg(`  -> Found ${images.length} images`);

            // Step 3: Generate Full Article
            logMsg('  -> Writing article (~' + wordCount + ' words)...');
            const content = await generateAutomationArticle(topicTrimmed, title, keywords, persona, wordCount, imgCount, toneOverride, images);

            // Step 4: Save to Supabase (with auto-generated slug)
            const slug = generateSlug(title);
            const postData = {
                title,
                slug,
                category,
                content,
                image: images.length > 0 ? images[0].url : '',
                views: 0,
                status: outputStatus === 'scheduled' ? 'scheduled' : 'draft',
                created_at: new Date(currentDate).toISOString(),
                writer_name: persona.name,
                writer_job: persona.job,
                writer_bio: persona.bio || 'Writer at Korea Decode',
                writer_avatar: persona.name[0] || 'E'
            };

            const { error } = await supabase.from('posts').insert(postData);
            if (error) throw error;

            logMsg(`  [OK] Saved as ${postData.status}`);
            currentDate.setHours(currentDate.getHours() + intervalHours);

        } catch (e) {
            logMsg(`  [ERR] ${e.message} - skipping`);
            console.error('Automation error for topic:', topicTrimmed, e);
        }

        completed++;
        const pct = Math.round((completed / topics.length) * 100);
        progressBar.style.width = pct + '%';
        progressText.innerText = `${completed}/${topics.length}`;
    }

    logMsg(`\nDone! ${completed}/${topics.length} topics processed.`);
    btn.innerHTML = '<i class="ph ph-robot"></i> Generate All with AI';
    btn.disabled = false;
    loadQueue();
}

async function loadQueue() {
    const draftsTbody = document.getElementById('auto-drafts-list');
    const schedTbody = document.getElementById('auto-queue-list');
    draftsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';
    schedTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';

    const { data, error } = await supabase.from('posts').select('id, title, category, status, created_at').order('created_at', { ascending: false });
    if (error) { console.error(error); return; }

    const drafts = (data || []).filter(p => p.status === 'draft');
    const scheduled = (data || []).filter(p => p.status === 'scheduled');

    // Update counts
    document.getElementById('auto-draft-count').innerText = drafts.length;
    document.getElementById('auto-sched-count').innerText = scheduled.length;

    // Render drafts
    draftsTbody.innerHTML = '';
    if (drafts.length === 0) {
        draftsTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No drafts to review</td></tr>';
    } else {
        drafts.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="checkbox" class="auto-draft-check" value="${p.id}"></td>
                <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.title}</td>
                <td>${p.category || '-'}</td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-primary" style="padding:4px 10px; font-size:12px;" onclick="publishDraft('${p.id}')">Publish</button>
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px; color:var(--accent); border-color:var(--accent);" onclick="editPost('${p.id}')">Edit</button>
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:12px; color:var(--danger); border-color:var(--danger);" onclick="deletePost('${p.id}')">Delete</button>
                </td>
            `;
            draftsTbody.appendChild(tr);
        });
    }

    // Render scheduled
    schedTbody.innerHTML = '';
    if (scheduled.length === 0) {
        schedTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No scheduled posts</td></tr>';
    } else {
        scheduled.forEach(p => {
            const pDate = new Date(p.created_at);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="status-badge status-scheduled">Scheduled</span></td>
                <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.title}</td>
                <td>${pDate.toLocaleString()}</td>
                <td><button class="btn btn-outline" style="padding:4px 8px; font-size:12px;" onclick="deletePost('${p.id}')">Cancel</button></td>
            `;
            schedTbody.appendChild(tr);
        });
    }

    // Refresh persona select for automation
    refreshAutoPersonaSelect();
}

window.deletePost = async (id) => {
    if (confirm('Delete this post?')) {
        await supabase.from('posts').delete().eq('id', id);
        loadQueue();
        loadPosts();
    }
};

window.publishDraft = async (id) => {
    const { error } = await supabase.from('posts').update({ status: 'published' }).eq('id', id);
    if (error) return alert('Error: ' + error.message);
    loadQueue();
};

async function batchPublishDrafts() {
    const checked = Array.from(document.querySelectorAll('.auto-draft-check:checked'));
    if (checked.length === 0) return alert('Select drafts to publish');
    if (!confirm(`Publish ${checked.length} draft(s)?`)) return;
    for (const cb of checked) {
        await supabase.from('posts').update({ status: 'published' }).eq('id', cb.value);
    }
    alert(`Published ${checked.length} posts!`);
    loadQueue();
}

async function batchDeleteDrafts() {
    const checked = Array.from(document.querySelectorAll('.auto-draft-check:checked'));
    if (checked.length === 0) return alert('Select drafts to delete');
    if (!confirm(`Delete ${checked.length} draft(s)? This cannot be undone.`)) return;
    for (const cb of checked) {
        await supabase.from('posts').delete().eq('id', cb.value);
    }
    alert(`Deleted ${checked.length} drafts.`);
    loadQueue();
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

// --- AFFILIATE WIDGET FUNCTIONS ---

// In-memory cache of DB presets (refreshed on modal open)
let dbAffiliatePresets = [];

function openAffiliateModal() {
    // Reset manual tab fields
    document.getElementById('aff-label').value = 'Klook Widget';
    document.getElementById('aff-code-input').value = '';
    // Reset manage fields
    document.getElementById('aff-manage-id').value = '';
    document.getElementById('aff-manage-label').value = '';
    document.getElementById('aff-manage-code').value = '';
    document.getElementById('aff-manage-provider').value = 'custom';
    document.getElementById('aff-manage-category').value = '';
    // Default to presets tab
    switchAffiliateTab('presets');
    // Load DB presets
    loadAffiliatePresetsFromDB();
    document.getElementById('modal-affiliate').style.display = 'flex';
}

// --- Tab switching ---
function switchAffiliateTab(tabName) {
    document.querySelectorAll('.aff-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.affTab === tabName));
    document.getElementById('aff-tab-presets').style.display = tabName === 'presets' ? 'block' : 'none';
    document.getElementById('aff-tab-manual').style.display = tabName === 'manual' ? 'block' : 'none';
}

// --- DB-backed Preset Functions ---

async function loadAffiliatePresetsFromDB() {
    const select = document.getElementById('aff-preset-select');
    select.innerHTML = '<option value="">-- Loading... --</option>';
    try {
        const { data, error } = await supabase
            .from('affiliate_presets')
            .select('*')
            .eq('is_active', true)
            .order('label', { ascending: true });
        if (error) throw error;
        dbAffiliatePresets = data || [];
        select.innerHTML = '<option value="">-- Select a preset --</option>';
        dbAffiliatePresets.forEach(p => {
            const providerIcon = { klook: '🎫', coupang: '🛒', amazon: '📦', custom: '🔗' }[p.provider] || '🔗';
            select.innerHTML += `<option value="${escHtml(p.id)}">${providerIcon} ${escHtml(p.label)}</option>`;
        });
    } catch (err) {
        console.error('[Affiliate] Failed to load presets:', err);
        select.innerHTML = '<option value="">-- Failed to load --</option>';
    }
}

function onPresetSelectChange() {
    const presetId = document.getElementById('aff-preset-select').value;
    const previewEl = document.getElementById('aff-preset-preview');
    if (!presetId) {
        previewEl.style.display = 'none';
        return;
    }
    const preset = dbAffiliatePresets.find(p => p.id === presetId);
    if (preset) {
        previewEl.textContent = preset.code;
        previewEl.style.display = 'block';
        // Fill manage fields for easy editing
        document.getElementById('aff-manage-id').value = preset.id;
        document.getElementById('aff-manage-label').value = preset.label;
        document.getElementById('aff-manage-provider').value = preset.provider || 'custom';
        document.getElementById('aff-manage-category').value = preset.category || '';
        document.getElementById('aff-manage-code').value = preset.code;
    }
}

function insertAffiliateShortcode() {
    const presetId = document.getElementById('aff-preset-select').value;
    if (!presetId) return alert('Please select a preset first.');
    const preset = dbAffiliatePresets.find(p => p.id === presetId);
    const label = preset ? preset.label : presetId;

    const shortcode = `[affiliate preset="${presetId}"]`;

    if (isHtmlMode) {
        const ta = document.getElementById('html-source-editor');
        const start = ta.selectionStart;
        ta.value = ta.value.substring(0, start) + shortcode + ta.value.substring(ta.selectionEnd);
    } else {
        // In Quill visual mode: insert shortcode as plain text (safe, no script issues)
        const range = quill.getSelection();
        const pos = range ? range.index : quill.getLength() - 1;
        quill.insertText(pos, '\n' + shortcode + '\n');
    }

    closeModal('modal-affiliate');
}

async function saveAffiliatePresetToDB() {
    const id = document.getElementById('aff-manage-id').value.trim();
    const label = document.getElementById('aff-manage-label').value.trim();
    const code = document.getElementById('aff-manage-code').value.trim();
    const provider = document.getElementById('aff-manage-provider').value;
    const category = document.getElementById('aff-manage-category').value;

    if (!id || !label || !code) return alert('ID, Label, and Code are all required.');

    // Validate ID is slug-friendly
    if (!/^[a-z0-9-]+$/.test(id)) return alert('Preset ID must be lowercase letters, numbers, and hyphens only.');

    try {
        const { error } = await supabase
            .from('affiliate_presets')
            .upsert({
                id,
                label,
                provider,
                category: category || null,
                code,
                is_active: true,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
        if (error) throw error;
        alert('Preset saved to database!');
        loadAffiliatePresetsFromDB();
    } catch (err) {
        console.error('[Affiliate] Save preset error:', err);
        alert('Failed to save preset: ' + err.message);
    }
}

async function deleteAffiliatePresetFromDB() {
    const id = document.getElementById('aff-manage-id').value.trim();
    if (!id) return alert('Select or enter a preset ID to delete.');
    if (!confirm(`Delete preset "${id}"? This will not remove shortcodes from existing posts, but they will stop rendering.`)) return;

    try {
        const { error } = await supabase
            .from('affiliate_presets')
            .delete()
            .eq('id', id);
        if (error) throw error;
        alert('Preset deleted.');
        document.getElementById('aff-manage-id').value = '';
        document.getElementById('aff-manage-label').value = '';
        document.getElementById('aff-manage-code').value = '';
        loadAffiliatePresetsFromDB();
    } catch (err) {
        console.error('[Affiliate] Delete preset error:', err);
        alert('Failed to delete: ' + err.message);
    }
}

// --- Legacy localStorage Preset Functions (backward compat for manual tab) ---

function getAffiliatePresetsLegacy() {
    return JSON.parse(localStorage.getItem('aff_presets') || '[]');
}

function saveAffiliatePresetLegacy() {
    const label = document.getElementById('aff-label').value.trim();
    const code = document.getElementById('aff-code-input').value.trim();
    if (!label || !code) return alert('Label and code are both required to save a preset.');
    const presets = getAffiliatePresetsLegacy();
    const idx = presets.findIndex(p => p.label === label);
    if (idx >= 0) presets[idx].code = code;
    else presets.push({ label, code });
    localStorage.setItem('aff_presets', JSON.stringify(presets));
    alert('Preset saved locally!');
}

function insertAffiliateCode() {
    const code = document.getElementById('aff-code-input').value.trim();
    const label = document.getElementById('aff-label').value.trim() || 'Affiliate Widget';
    if (!code) return alert('Please paste the affiliate HTML code.');

    const affId = 'aff-' + Date.now();
    affiliateCodes[affId] = code;

    // Build placeholder HTML
    const placeholderHTML = `<div class="affiliate-placeholder" data-aff-id="${affId}" contenteditable="false"><span class="aff-icon">📦</span><span class="aff-label">${escHtml(label)}</span><span class="aff-hint">Affiliate widget — renders on live blog</span></div>`;

    if (isHtmlMode) {
        // In HTML mode, insert at cursor position in textarea
        const ta = document.getElementById('html-source-editor');
        const start = ta.selectionStart;
        const before = ta.value.substring(0, start);
        const after = ta.value.substring(ta.selectionEnd);
        ta.value = before + placeholderHTML + after;
    } else {
        // In visual mode, insert at end of content
        const len = quill.getLength();
        quill.clipboard.dangerouslyPasteHTML(len - 1, placeholderHTML);
    }

    closeModal('modal-affiliate');
}

/**
 * Process editor content for saving: replace affiliate placeholders with real code.
 * Wraps each affiliate block in HTML comments for roundtrip identification.
 */
function processContentForSave(html) {
    // Replace placeholder divs with actual affiliate code wrapped in comment markers
    return html.replace(/<div class="affiliate-placeholder"[^>]*data-aff-id="([^"]+)"[^>]*>[\s\S]*?<\/div>/g, (match, affId) => {
        const code = affiliateCodes[affId];
        if (code) {
            return `<!--AFFILIATE_START-->\n<div class="affiliate-widget">\n${code}\n</div>\n<!--AFFILIATE_END-->`;
        }
        return match; // Keep placeholder if no code found
    });
}

/**
 * Process content from DB before loading into Quill:
 * Find affiliate blocks (wrapped in comment markers) and convert to placeholders.
 */
function processContentForEdit(html) {
    affiliateCodes = {}; // Reset
    return html.replace(/<!--AFFILIATE_START-->\s*<div class="affiliate-widget">\s*([\s\S]*?)\s*<\/div>\s*<!--AFFILIATE_END-->/g, (match, code) => {
        const affId = 'aff-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
        affiliateCodes[affId] = code.trim();
        // Extract label from code (try to detect provider)
        let label = 'Affiliate Widget';
        if (code.includes('klk-aff-widget') || code.includes('klook.com')) label = 'Klook Widget';
        else if (code.includes('amazon')) label = 'Amazon Widget';
        else if (code.includes('coupang')) label = 'Coupang Widget';
        return `<div class="affiliate-placeholder" data-aff-id="${affId}" contenteditable="false"><span class="aff-icon">📦</span><span class="aff-label">${escHtml(label)}</span><span class="aff-hint">Affiliate widget — renders on live blog</span></div>`;
    });
}

// --- HTML Source Toggle ---
let isHtmlMode = false;
window.toggleHtmlSource = () => {
    const btn = document.getElementById('btn-toggle-html');
    const quillContainer = document.querySelector('#editor-container');
    const htmlEditor = document.getElementById('html-source-editor');

    if (!isHtmlMode) {
        // Switch to HTML source mode
        htmlEditor.value = quill.root.innerHTML;
        quillContainer.style.display = 'none';
        htmlEditor.style.display = 'block';
        btn.classList.add('active');
        btn.innerHTML = '<i class="ph ph-eye"></i> Visual';
        isHtmlMode = true;
    } else {
        // Warn if HTML contains script tags that Quill will strip
        const htmlContent = htmlEditor.value;
        if (/<script[\s>]/i.test(htmlContent)) {
            if (!confirm('Warning: Switching to Visual mode will strip <script> tags (affiliate widgets, embeds). Your content will be saved correctly if you publish while staying in HTML mode.\n\nSwitch anyway?')) {
                return;
            }
        }
        // Switch back to visual mode
        quill.root.innerHTML = htmlContent;
        htmlEditor.style.display = 'none';
        quillContainer.style.display = 'flex';
        btn.classList.remove('active');
        btn.innerHTML = '<i class="ph ph-code"></i> HTML';
        isHtmlMode = false;
        calculateSEOScore();
    }
};

// Helper: get current editor content (works in both visual and HTML mode)
// Processes affiliate placeholders into real code for saving.
function getEditorContent() {
    let html;
    if (isHtmlMode) {
        html = document.getElementById('html-source-editor').value;
    } else {
        html = quill.root.innerHTML;
    }
    // Replace affiliate placeholders with actual code
    return processContentForSave(html);
}

window.showMobilePreview = () => {
    document.getElementById('prev-cat').innerText = document.getElementById('ai-category').value;
    document.getElementById('prev-title').innerText = document.getElementById('ai-suggested-title').value;
    document.getElementById('prev-img').src = activeImage;
    document.getElementById('prev-img').style.display = activeImage ? 'block' : 'none';
    document.getElementById('prev-content').innerHTML = getEditorContent();
    document.getElementById('modal-preview').style.display = 'flex';
};

window.publishPost = async () => {
    const title = document.getElementById('ai-suggested-title').value;
    const slug = document.getElementById('ai-slug').value || generateSlug(title);
    const category = document.getElementById('ai-category').value;
    const content = getEditorContent();
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
                slug,
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
                slug,
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

    const { data, error } = await supabase.from('posts').select('id, title, slug, category, views, status, writer_name').order('created_at', { ascending: false });
    if (error) { console.error(error); grid.innerHTML = 'Error loading posts.'; return; }

    grid.innerHTML = '';
    (data || []).forEach(p => {
        const statusClass = p.status === 'published' ? 'status-published' : p.status === 'scheduled' ? 'status-scheduled' : 'status-draft';
        const statusLabel = p.status || 'draft';
        const postSlug = p.slug || generateSlug(p.title);
        const viewUrl = `/blog/${postSlug}`;

        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '16px';
        div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:700; font-size:16px;">${p.title}</div>
                            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                                <span class="status-badge ${statusClass}">${statusLabel}</span>
                                ${p.category} | ${p.views || 0} views | ${p.writer_name || 'Admin'}
                            </div>
                            <div style="font-size:11px; color:var(--accent); margin-top:4px; font-family:monospace; opacity:0.7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                /blog/${postSlug}
                            </div>
                        </div>
                        <div style="display:flex; gap: 8px; flex-shrink:0; margin-left:12px;">
                            <a href="${viewUrl}" target="_blank" class="btn btn-outline" style="padding:6px 12px; font-size:12px;">View</a>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:12px; color:var(--accent); border-color:var(--accent);" onclick="editPost('${p.id}')">Edit</button>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:12px; color:var(--danger); border-color:var(--danger);" onclick="deletePost('${p.id}')">Delete</button>
                        </div>
                    </div>
                `;
        grid.appendChild(div);
    });
    if ((data || []).length === 0) {
        grid.innerHTML = '<div class="card" style="padding:20px; text-align:center; color:var(--text-muted);">No posts yet. Create your first post with AI Writer!</div>';
    }
}


// Mock migrationList if migration-list.js is not loaded
const migrationList = self.migrationList || [];

window.startMigration = async () => {
    const logBox = document.getElementById('migration-log');
    logBox.style.display = 'block';
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

            const slug = generateSlug(title);
            await supabase.from('posts').insert({
                title,
                slug,
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

// --- IMAGE RESIZER ---
function initImageResizer() {
    let toolbar = null;
    let selectedImg = null;

    const sizes = [
        { label: '25%', value: '25%' },
        { label: '50%', value: '50%' },
        { label: '75%', value: '75%' },
        { label: '100%', value: '100%' },
    ];

    function removeToolbar() {
        if (toolbar) { toolbar.remove(); toolbar = null; }
        if (selectedImg) { selectedImg.classList.remove('img-selected'); selectedImg = null; }
    }

    function applySize(img, width) {
        img.style.width = width;
        toolbar.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.size === width);
        });
    }

    function showToolbar(img) {
        removeToolbar();
        selectedImg = img;
        img.classList.add('img-selected');

        toolbar = document.createElement('div');
        toolbar.className = 'img-resize-toolbar';

        sizes.forEach(s => {
            const btn = document.createElement('button');
            btn.textContent = s.label;
            btn.dataset.size = s.value;
            if (img.style.width === s.value) btn.classList.add('active');
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                applySize(img, s.value);
            });
            toolbar.appendChild(btn);
        });

        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="ph ph-trash"></i>';
        delBtn.title = 'Remove image';
        delBtn.style.color = 'var(--danger)';
        delBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const figure = img.closest('figure');
            if (figure) figure.remove();
            else img.remove();
            removeToolbar();
        });
        toolbar.appendChild(delBtn);

        const editorEl = document.querySelector('.ql-editor');
        const editorRect = editorEl.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        toolbar.style.left = (imgRect.left + imgRect.width / 2 - editorRect.left) + 'px';
        toolbar.style.top = (imgRect.top - editorRect.top - 44) + 'px';

        editorEl.style.position = 'relative';
        editorEl.appendChild(toolbar);
    }

    document.querySelector('.ql-editor').addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
            showToolbar(e.target);
        } else if (!e.target.closest('.img-resize-toolbar')) {
            removeToolbar();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') removeToolbar();
    });
}


// --- STORAGE BUCKET ---
async function ensureStorageBucket() {
    try {
        const { data, error } = await supabase.storage.getBucket('images');
        if (error && error.message.includes('not found')) {
            console.warn('[Storage] "images" bucket does not exist. Please create it in Supabase Dashboard → Storage → New Bucket (name: images, public: true).');
        } else if (data) {
            console.log('[Storage] images bucket ready');
        }
    } catch (e) {
        console.warn('[Storage] Bucket check failed:', e.message);
    }
}

// --- IMAGE UPLOAD FUNCTIONS ---
function handleUploadFile(file) {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
        alert('Only JPG, PNG, GIF, WebP images are allowed.');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        alert('File too large. Max 5MB.');
        return;
    }
    pendingUploadFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('upload-preview-img').src = e.target.result;
        document.getElementById('upload-file-name').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        document.getElementById('upload-preview-area').style.display = 'block';
        document.getElementById('upload-drop-zone').style.display = 'none';
        const actions = document.getElementById('upload-actions');
        actions.style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

async function confirmUpload() {
    if (!pendingUploadFile) return;
    const btn = document.getElementById('btn-confirm-upload');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner spinner"></i> Uploading...';

    document.getElementById('upload-progress-area').style.display = 'block';
    document.getElementById('upload-progress-bar').style.width = '30%';

    try {
        const ext = pendingUploadFile.name.split('.').pop().toLowerCase();
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const filePath = `uploads/${fileName}`;

        document.getElementById('upload-progress-bar').style.width = '60%';

        const { data, error } = await supabase.storage
            .from('images')
            .upload(filePath, pendingUploadFile, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) throw error;

        document.getElementById('upload-progress-bar').style.width = '90%';

        const { data: urlData } = supabase.storage
            .from('images')
            .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        document.getElementById('upload-progress-bar').style.width = '100%';
        document.getElementById('upload-progress-text').textContent = 'Done!';

        if (unsplashMode === 'body') {
            insertUploadedImageIntoBody(publicUrl, pendingUploadFile.name);
        } else {
            activeImage = publicUrl;
            document.getElementById('selected-ai-img').src = publicUrl;
            document.getElementById('selected-ai-img').style.display = 'block';
            document.getElementById('ai-img-placeholder').style.display = 'none';
        }

        setTimeout(() => {
            resetUploadUI();
            closeModal('modal-unsplash');
        }, 500);

    } catch (e) {
        console.error('[Upload]', e);
        document.getElementById('upload-progress-text').textContent = 'Upload failed: ' + e.message;
        document.getElementById('upload-progress-bar').style.width = '0%';
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-check"></i> Use This Image';
    }
}

function insertUploadedImageIntoBody(url, fileName) {
    const range = quill.getSelection(true);
    const index = range ? range.index : quill.getLength() - 1;
    const alt = fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const figureHtml = `<figure><img src="${url}" alt="${alt}" style="width:100%;border-radius:8px;"><figcaption>${alt}</figcaption></figure>`;
    quill.insertText(index, '\n');
    quill.clipboard.dangerouslyPasteHTML(index + 1, figureHtml);
    quill.setSelection(index + 2);
}

function resetUploadUI() {
    pendingUploadFile = null;
    document.getElementById('upload-preview-area').style.display = 'none';
    document.getElementById('upload-preview-img').src = '';
    document.getElementById('upload-file-name').textContent = '';
    document.getElementById('upload-progress-area').style.display = 'none';
    document.getElementById('upload-progress-bar').style.width = '0%';
    document.getElementById('upload-progress-text').textContent = 'Uploading...';
    document.getElementById('upload-drop-zone').style.display = 'flex';
    const actions = document.getElementById('upload-actions');
    actions.style.display = 'none';
    const btn = document.getElementById('btn-confirm-upload');
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-check"></i> Use This Image';
    document.getElementById('upload-file-input').value = '';
}

init();
