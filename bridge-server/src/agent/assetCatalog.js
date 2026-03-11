/**
 * Roblox Toolbox Model Search Service
 * Uses the Toolbox Service API (marketplace/10 = Models) to find real insertable 3D models.
 * Then fetches details to rank by quality (endorsed, scripts, votes).
 * This is the correct API for free models — NOT the Catalog v2 API which returns avatar items.
 */
const https = require('https');

class AssetCatalog {
    constructor() {
        this._cache = new Map(); // keyword → { results: [...], ts }
    }

    /**
     * Get the single best model asset for a query — ranked by quality.
     * Returns { id, name, hasScripts, scriptCount, isEndorsed, upVotes } or null.
     */
    async getBestAsset(query) {
        try {
            const results = await this.searchToolbox(query, 5);
            return results.length > 0 ? results[0] : null;
        } catch (e) {
            console.warn(`[Toolbox] getBestAsset failed for "${query}": ${e.message}`);
            return null;
        }
    }

    /**
     * Search the Roblox Toolbox for insertable 3D models, then fetch details and rank by quality.
     * Step 1: Search via toolbox-service/v1/marketplace/10 (category 10 = Models)
     * Step 2: Fetch details via toolbox-service/v1/items/details for script/vote/endorsement info
     * Step 3: Rank — endorsed first, then by (hasScripts bonus + upVotes)
     */
    async searchToolbox(query, limit = 5) {
        const cleanQuery = String(query || '').replace(/[^a-zA-Z0-9\s]/g, '').trim();
        if (!cleanQuery) return [];

        // Check cache (5 min TTL)
        const cacheKey = cleanQuery.toLowerCase();
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < 300000) return cached.results.slice(0, limit);

        // Step 1: Search for model IDs
        const encoded = encodeURIComponent(cleanQuery);
        const searchUrl = `https://apis.roblox.com/toolbox-service/v1/marketplace/10?keyword=${encoded}&num=${limit}&sort=1`;
        const searchResults = await this._fetchJson(searchUrl);
        const ids = (searchResults.data || []).map(item => item.id).slice(0, 10);

        if (ids.length === 0) return [];

        // Step 2: Fetch details for these IDs
        const detailsUrl = `https://apis.roblox.com/toolbox-service/v1/items/details?assetIds=${ids.join(',')}`;
        const detailsResult = await this._fetchJson(detailsUrl);
        const details = detailsResult.data || [];

        // Step 3: Map — keep Toolbox's relevance order (already optimized for keyword)
        // but expose quality metadata for logging
        const idOrder = new Map(ids.map((id, i) => [id, i]));
        const mapped = details.map(item => {
            const asset = item.asset || {};
            const voting = item.voting || {};
            return {
                id: asset.id,
                name: asset.name || `Model_${asset.id}`,
                hasScripts: asset.hasScripts || false,
                scriptCount: asset.scriptCount || 0,
                isEndorsed: asset.isEndorsed || false,
                upVotes: voting.upVotes || 0,
                downVotes: voting.downVotes || 0,
                triangles: asset.modelTechnicalDetails?.objectMeshSummary?.triangles || 0,
                _order: idOrder.get(asset.id) ?? 999
            };
        }).sort((a, b) => a._order - b._order);

        // Cache results
        if (mapped.length > 0) {
            this._cache.set(cacheKey, { results: mapped, ts: Date.now() });
        }

        return mapped.slice(0, limit);
    }

    /**
     * Legacy wrapper — redirects to searchToolbox
     */
    async searchCatalog(query) {
        return this.searchToolbox(query);
    }

    _fetchJson(url) {
        return new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'RoboBuilder/1.0' } }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) { reject(e); }
                });
            }).on('error', reject);
        });
    }
}

module.exports = new AssetCatalog();
