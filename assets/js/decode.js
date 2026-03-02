/**
 * Korea Decode — Decode This Page JavaScript
 * Handles question submission, loading states, result display
 */

import { trackEvent } from '/assets/js/analytics.js';

export function initDecode() {
  const input = document.getElementById('decode-input');
  const submitBtn = document.getElementById('decode-submit');
  const loadingEl = document.getElementById('decode-loading');
  const errorEl = document.getElementById('decode-error');
  const errorText = document.getElementById('decode-error-text');
  const resultEl = document.getElementById('decode-result');
  const answerText = document.getElementById('decode-answer-text');
  const relatedEl = document.getElementById('decode-related');
  const relatedLinks = document.getElementById('decode-related-links');
  const exampleChips = document.querySelectorAll('.example-chip');

  if (!input || !submitBtn) return;

  // Submit on button click
  submitBtn.addEventListener('click', () => {
    submitQuestion();
  });

  // Submit on Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitQuestion();
    }
  });

  // Example chip clicks — fill input and auto-submit
  exampleChips.forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent.trim();
      submitQuestion();
      trackEvent('decode_example_click', 'Decode', chip.textContent.trim());
    });
  });

  async function submitQuestion() {
    const question = input.value.trim();

    if (!question) {
      input.focus();
      return;
    }

    if (question.length > 500) {
      showError('Your question is too long. Please keep it under 500 characters.');
      return;
    }

    // Show loading, hide previous results and errors
    showLoading(true);
    hideError();
    hideResult();
    submitBtn.disabled = true;

    trackEvent('decode_submit', 'Decode', question);

    try {
      const response = await fetch('/api/decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }

      // Display the answer
      displayAnswer(data.answer, data.relatedPosts || []);
      trackEvent('decode_success', 'Decode', question);

    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
      trackEvent('decode_error', 'Decode', err.message);
    } finally {
      showLoading(false);
      submitBtn.disabled = false;
    }
  }

  function displayAnswer(answer, relatedPosts) {
    // Format answer text: convert markdown-style bold and line breaks
    let formatted = escapeHtml(answer);
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\n\n/g, '</p><p>');
    formatted = formatted.replace(/\n/g, '<br>');
    formatted = `<p>${formatted}</p>`;

    answerText.innerHTML = formatted;

    // Display related posts
    if (relatedPosts.length > 0) {
      relatedLinks.innerHTML = '';
      relatedPosts.forEach(post => {
        const slug = post.slug || '';
        const link = document.createElement('a');
        link.href = slug ? `/blog/${slug}` : '#';
        link.textContent = post.title;
        link.addEventListener('click', () => {
          trackEvent('decode_related_click', 'Decode', post.title);
        });
        relatedLinks.appendChild(link);
      });
      relatedEl.style.display = 'block';
    } else {
      relatedEl.style.display = 'none';
    }

    resultEl.classList.add('visible');

    // Scroll result into view
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
