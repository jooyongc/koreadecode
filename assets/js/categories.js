/**
 * Korea Decode — Category System
 *
 * The site runs on four categories: Book, Plan, Shop, Food.
 *
 * 'Food' was called 'Eat' until the 2026 label pass; 'eat' stays in the alias
 * list so every post already stored that way still lands in the right bucket.
 *
 * Posts written before the 2026 redesign are stored with the old labels
 * (K-Food, K-Beauty, Travel, K-Pop, Culture...). Rather than migrating the
 * database, every read path maps the stored value onto one of the four
 * buckets, and every filter expands a bucket back into the stored values it
 * covers. New posts save the new labels directly.
 *
 * Mapping:
 *   Book — K-Pop, Culture, K-Drama, entertainment, tours, tickets
 *   Plan — Travel, itineraries, transport, city guides
 *   Shop — K-Beauty, skincare, fashion, souvenirs
 *   Food — K-Food, restaurants, recipes, cafes, drinks
 */

export const CATEGORIES = ['Book', 'Plan', 'Shop', 'Food'];

/** Short tagline shown under each category heading. */
export const CATEGORY_TAGLINES = {
    Book: 'tickets & tours',
    Plan: 'routes & logistics',
    Shop: 'beauty & souvenirs',
    Food: 'food & drinking',
};

/** Every legacy / alternate label that resolves to each new category (lower-case). */
export const CATEGORY_ALIASES = {
    Book: ['book', 'booking', 'tours', 'tour', 'tickets', 'ticket', 'experience', 'experiences',
           'k-pop', 'kpop', 'k-drama', 'kdrama', 'culture', 'entertainment', 'hallyu'],
    Plan: ['plan', 'planning', 'travel', 'trip', 'itinerary', 'transport', 'transportation',
           'guide', 'seoul', 'busan', 'jeju'],
    Shop: ['shop', 'shopping', 'k-beauty', 'kbeauty', 'beauty', 'skincare', 'cosmetics',
           'fashion', 'souvenir', 'souvenirs', 'k-fashion'],
    Food: ['food', 'eat', 'k-food', 'kfood', 'restaurant', 'restaurants', 'recipe', 'recipes',
           'drink', 'drinks', 'cafe', 'street food'],
};

/** Reverse lookup: alias -> new category. Built once at module load. */
const ALIAS_TO_CATEGORY = (() => {
    const map = {};
    Object.entries(CATEGORY_ALIASES).forEach(([category, aliases]) => {
        aliases.forEach(alias => { map[alias] = category; });
    });
    return map;
})();

/**
 * Resolve any stored category value to one of Book / Plan / Shop / Eat.
 * Unknown values fall back to 'Plan', the most general bucket.
 * @param {string} raw - Category value as stored on the post
 * @returns {string} One of CATEGORIES
 */
export function normalizeCategory(raw) {
    if (!raw) return 'Plan';
    const key = String(raw).trim().toLowerCase();
    return ALIAS_TO_CATEGORY[key] || 'Plan';
}

/**
 * All stored category values that belong to a given new category.
 * Feed this to a Supabase `.in('category', ...)` filter so legacy posts
 * still appear under the new chips.
 * @param {string} category - One of CATEGORIES
 * @returns {string[]}
 */
export function categoryFilterValues(category) {
    const aliases = CATEGORY_ALIASES[category] || [];
    const values = new Set([category]);
    aliases.forEach(alias => {
        values.add(alias);
        // Title-case each word so 'k-food' also matches 'K-Food'
        values.add(alias.replace(/(^|[\s-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase()));
    });
    return Array.from(values);
}
