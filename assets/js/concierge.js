/**
 * Korea Decode — Concierge Page JavaScript
 * Manages multi-step form, itinerary display, affiliate links
 */

import { trackEvent } from '/assets/js/analytics.js';

export function initConcierge() {
  // --- DOM Elements ---
  const vibeGrid = document.getElementById('vibe-grid');
  const durationGrid = document.getElementById('duration-grid');
  const cityGrid = document.getElementById('city-grid');
  const budgetGrid = document.getElementById('budget-grid');
  const extraInput = document.getElementById('concierge-extra');
  const generateBtn = document.getElementById('concierge-generate');
  const formEl = document.getElementById('concierge-form');
  const loadingEl = document.getElementById('concierge-loading');
  const errorEl = document.getElementById('concierge-error');
  const errorText = document.getElementById('concierge-error-text');
  const resultEl = document.getElementById('concierge-result');
  const itineraryDays = document.getElementById('itinerary-days');
  const itinerarySummary = document.getElementById('itinerary-summary');
  const affiliateSection = document.getElementById('affiliate-section');
  const affiliateLinksEl = document.getElementById('affiliate-links');

  if (!vibeGrid || !generateBtn) return;

  // --- Form State ---
  const state = {
    vibes: [],
    duration: '',
    city: '',
    budget: '',
    extra: '',
  };

  // --- Vibe Chip Toggle (multiple selection) ---
  vibeGrid.querySelectorAll('.vibe-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const vibe = chip.dataset.vibe;
      const idx = state.vibes.indexOf(vibe);
      if (idx === -1) {
        state.vibes.push(vibe);
        chip.classList.add('selected');
      } else {
        state.vibes.splice(idx, 1);
        chip.classList.remove('selected');
      }
    });
  });

  // --- Single Select for Duration ---
  setupSingleSelect(durationGrid, 'duration', 'duration');

  // --- Single Select for City ---
  setupSingleSelect(cityGrid, 'city', 'city');

  // --- Single Select for Budget ---
  setupSingleSelect(budgetGrid, 'budget', 'budget');

  function setupSingleSelect(grid, dataAttr, stateKey) {
    if (!grid) return;
    grid.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Deselect siblings
        grid.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        // Select this one
        btn.classList.add('selected');
        state[stateKey] = btn.dataset[dataAttr];
      });
    });
  }

  // --- Generate Button ---
  generateBtn.addEventListener('click', () => {
    submitConcierge();
  });

  async function submitConcierge() {
    // Update extra notes from textarea
    state.extra = (extraInput ? extraInput.value : '').trim();

    // --- Validation ---
    if (state.vibes.length === 0) {
      showError('Please select at least one vibe to get started.');
      return;
    }
    if (!state.duration) {
      showError('Please select your trip duration.');
      return;
    }
    if (!state.city) {
      showError('Please select a destination city.');
      return;
    }
    if (!state.budget) {
      showError('Please select a budget level.');
      return;
    }

    // Show loading, hide previous results and errors
    showLoading(true);
    hideError();
    hideResult();
    generateBtn.disabled = true;

    trackEvent('concierge_submit', 'Concierge', `${state.city} - ${state.duration} - ${state.budget}`);

    try {
      const response = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vibes: state.vibes,
          duration: state.duration,
          city: state.city,
          budget: state.budget,
          extra: state.extra,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }

      // Display itinerary and affiliate links
      displayItinerary(data.itinerary, data.affiliateLinks || []);
      trackEvent('concierge_success', 'Concierge', state.city);

    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
      trackEvent('concierge_error', 'Concierge', err.message);
    } finally {
      showLoading(false);
      generateBtn.disabled = false;
    }
  }

  function displayItinerary(itinerary, affiliateLinks) {
    itineraryDays.innerHTML = '';

    // Handle different response shapes
    const days = itinerary.days || itinerary.itinerary || [];
    const title = itinerary.title || itinerary.trip_title || '';
    const summary = itinerary.summary || itinerary.overview || '';

    // Summary line
    itinerarySummary.textContent = summary || `${state.duration} in ${state.city} — ${state.vibes.join(', ')}`;

    if (!Array.isArray(days) || days.length === 0) {
      itineraryDays.innerHTML = '<p style="text-align:center; color:var(--text-muted);">No itinerary data was returned. Please try again.</p>';
      resultEl.classList.add('visible');
      return;
    }

    days.forEach((day, index) => {
      const dayEl = document.createElement('div');
      dayEl.classList.add('itinerary-day', 'fade-in-up');
      dayEl.style.animationDelay = `${index * 100}ms`;

      const dayNumber = day.day || `Day ${index + 1}`;
      const dayTheme = day.theme || day.title || '';
      const activities = day.activities || day.items || day.schedule || [];

      let activitiesHtml = '';
      if (Array.isArray(activities)) {
        activities.forEach(activity => {
          const time = activity.time || activity.hour || '';
          const name = activity.activity || activity.name || activity.title || '';
          const description = activity.description || activity.details || activity.note || '';

          activitiesHtml += `
            <div class="itinerary-item">
              <div class="item-time">${escapeHtml(time)}</div>
              <div class="item-details">
                <h4>${escapeHtml(name)}</h4>
                ${description ? `<p>${escapeHtml(description)}</p>` : ''}
              </div>
            </div>
          `;
        });
      }

      dayEl.innerHTML = `
        <div class="itinerary-day-header">
          <span class="day-number">${escapeHtml(String(dayNumber))}</span>
          ${dayTheme ? `<span class="day-theme">${escapeHtml(dayTheme)}</span>` : ''}
        </div>
        ${activitiesHtml}
      `;

      itineraryDays.appendChild(dayEl);
    });

    // Display affiliate links
    if (affiliateLinks.length > 0) {
      affiliateLinksEl.innerHTML = '';
      affiliateLinks.forEach(link => {
        const a = document.createElement('a');
        a.href = link.url || link.link || '#';
        a.target = '_blank';
        a.rel = 'noopener noreferrer sponsored';
        a.classList.add('affiliate-link');
        a.textContent = link.title || link.name || 'Book Now';
        a.addEventListener('click', () => {
          trackEvent('affiliate_click', 'Concierge', link.title || link.name);
        });
        affiliateLinksEl.appendChild(a);
      });
      affiliateSection.style.display = 'block';
    } else {
      affiliateSection.style.display = 'none';
    }

    resultEl.classList.add('visible');

    // Scroll to results
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showLoading(show) {
    if (show) {
      loadingEl.classList.add('visible');
    } else {
      loadingEl.classList.remove('visible');
    }
  }

  function showError(message) {
    errorText.textContent = message;
    errorEl.style.display = 'block';
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    errorEl.style.display = 'none';
    errorText.textContent = '';
  }

  function hideResult() {
    resultEl.classList.remove('visible');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
