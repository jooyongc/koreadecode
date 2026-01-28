# Korea Decode Project Blueprint

## Project Overview
This project is a single-page web application ("Korea Decode") designed to present content dynamically fetched from a WordPress API (`https://koreadecode.mycafe24.com`). It features a modern, dark-themed UI with a side navigation dock, a news ticker, and a magazine-style grid for displaying posts. Detailed post views are presented via an overlay.

## Current State & Problem
The website was rejected from Google AdSense due to "Google-served ads on screens without publisher content" (콘텐츠가 없거나 가치가 낮은 콘텐츠를 포함한 화면). This indicates that the site lacks sufficient static, high-quality, and crawlable content that provides value to users, especially before dynamic content is loaded via JavaScript. The existing content is primarily loaded dynamically from a WordPress API, and the initial `index.html` might appear sparse to AdSense crawlers. Affiliate ad banners are present, which are placed on pages perceived as lacking publisher content.

## Objective
To address the Google AdSense rejection by:
1.  Adding static, high-quality, and descriptive publisher content directly into `index.html` that explains the purpose and value of "Korea Decode".
2.  Ensuring the new content is semantically structured and styled appropriately.
3.  Connecting the modified codebase to the user's new GitHub repository: `https://github.com/jooyongc/koreadecode`.

## Current Task: Implement AdSense Policy Compliance & GitHub Integration

### Plan for AdSense Compliance (Content Improvement)
1.  **Modify `index.html`:**
    *   **Add an "About Us" / "Mission" Section:** Insert a prominent section within the `content-area` (before the "hero" and "magazine grid" sections) that clearly describes "Korea Decode." This content will introduce the website's purpose, what it offers to users (e.g., insights into Korean culture, trends, language, etc.), and its unique value proposition. This ensures that even before dynamic content loads, there is valuable, crawlable publisher content.
    *   **Content Details:** The content will be a few paragraphs of well-written, engaging text using semantic HTML tags (`<p>`, `<h2>`, etc.).
    *   **Visual Integration:** Ensure the new section seamlessly integrates with the existing dark theme and modern aesthetic.

### Plan for GitHub Integration
1.  **Check Git Remote:** Verify the current Git remote origin. If it's not `https://github.com/jooyongc/koreadecode`, update it.
2.  **Stage Changes:** Use `git add .` to stage all modified files (`index.html`, `blueprint.md`).
3.  **Commit Changes:** Create a clear commit message: "feat: Implement static content for AdSense compliance and improve site description".
4.  **Push to GitHub:** Push the changes to the `main` branch of the specified GitHub repository.

### Notification for Gemini 3 Pro
Acknowledge the user's request to be notified when Gemini 3 Pro is available. This will be done as part of the final response after completing the current task.
