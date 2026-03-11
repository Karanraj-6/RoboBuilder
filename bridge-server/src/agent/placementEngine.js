/**
 * Placement Engine
 * Generates spatial guidance from current project state so workers can place
 * assets based on existing occupancy instead of hallucinated coordinates.
 */

class PlacementEngine {
    _collectSpatialNodes(node, currentPath = '', out = []) {
        if (!node || typeof node !== 'object') return out;

        const props = node._properties || {};
        const pos = Array.isArray(props.Position) && props.Position.length === 3 ? props.Position : null;
        const size = Array.isArray(props.Size) && props.Size.length === 3 ? props.Size : null;

        if (pos) {
            out.push({
                path: currentPath,
                className: node._class || 'Unknown',
                position: pos,
                size: size || [8, 8, 8]
            });
        }

        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith('_')) continue;
            const nextPath = currentPath ? `${currentPath}.${key}` : key;
            this._collectSpatialNodes(value, nextPath, out);
        }

        return out;
    }

    _inferMinDistance(stepDescription) {
        const text = (stepDescription || '').toLowerCase();
        if (text.includes('building') || text.includes('city') || text.includes('skyscraper')) return 70;
        if (text.includes('road')) return 45;
        if (text.includes('tree') || text.includes('lamp') || text.includes('prop')) return 25;
        if (text.includes('car') || text.includes('vehicle')) return 35;
        return 30;
    }

    _distance2D(a, b) {
        const dx = (a[0] || 0) - (b[0] || 0);
        const dz = (a[2] || 0) - (b[2] || 0);
        return Math.sqrt(dx * dx + dz * dz);
    }

    _isSlotFree(slot, occupied, minDistance) {
        return occupied.every(item => this._distance2D(slot, item.position) >= minDistance);
    }

    _getBaseplateBounds(workspace) {
        if (!workspace || typeof workspace !== 'object') return null;
        for (const [key, node] of Object.entries(workspace)) {
            if (key.startsWith('_')) continue;
            if (!node || typeof node !== 'object') continue;
            const keyNorm = key.toLowerCase().replace(/[\s_-]+/g, '');
            const cls = String(node._class || '');
            if (!keyNorm.includes('baseplate')) continue;
            if (!(cls.endsWith('Part') || cls === 'MeshPart')) continue;
            const pos = node?._properties?.Position;
            const size = node?._properties?.Size;
            if (!Array.isArray(pos) || pos.length !== 3 || !Array.isArray(size) || size.length !== 3) continue;
            return {
                minX: pos[0] - (size[0] / 2),
                maxX: pos[0] + (size[0] / 2),
                minZ: pos[2] - (size[2] / 2),
                maxZ: pos[2] + (size[2] / 2),
                topY: pos[1] + (size[1] / 2)
            };
        }
        return null;
    }

    _adaptiveBounds(occupied, baseplateBounds) {
        if (baseplateBounds) return baseplateBounds;
        if (!Array.isArray(occupied) || occupied.length === 0) {
            return { minX: -512, maxX: 512, minZ: -512, maxZ: 512 };
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const item of occupied) {
            const p = item.position || [0, 0, 0];
            minX = Math.min(minX, p[0]);
            maxX = Math.max(maxX, p[0]);
            minZ = Math.min(minZ, p[2]);
            maxZ = Math.max(maxZ, p[2]);
        }

        const margin = 180;
        minX -= margin;
        maxX += margin;
        minZ -= margin;
        maxZ += margin;

        const minSpan = 320;
        if ((maxX - minX) < minSpan) {
            const cx = (maxX + minX) / 2;
            minX = cx - (minSpan / 2);
            maxX = cx + (minSpan / 2);
        }
        if ((maxZ - minZ) < minSpan) {
            const cz = (maxZ + minZ) / 2;
            minZ = cz - (minSpan / 2);
            maxZ = cz + (minSpan / 2);
        }

        return {
            minX: Math.max(-4096, minX),
            maxX: Math.min(4096, maxX),
            minZ: Math.max(-4096, minZ),
            maxZ: Math.min(4096, maxZ)
        };
    }

    _estimateGroundY(workspace, occupied) {
        const base = this._getBaseplateBounds(workspace);
        if (base && Number.isFinite(base.topY)) return base.topY;

        const candidates = [];
        for (const item of occupied || []) {
            const size = Array.isArray(item.size) ? item.size : null;
            const pos = Array.isArray(item.position) ? item.position : null;
            if (!size || !pos) continue;

            const key = String(item.path || '').toLowerCase();
            const isWide = size[0] >= 80 || size[2] >= 80;
            const isThin = size[1] <= 24;
            const looksGround = isWide && isThin && (
                key.includes('baseplate') ||
                key.includes('ground') ||
                key.includes('terrain') ||
                key.includes('grass') ||
                key.includes('floor') ||
                key.includes('plane')
            );
            if (looksGround) {
                candidates.push(pos[1] + (size[1] / 2));
            }
        }

        if (candidates.length === 0) return 0;
        candidates.sort((a, b) => a - b);
        return candidates[Math.floor(candidates.length / 2)] || 0;
    }

    _buildCandidateSlots(bounds) {
        const b = bounds || { minX: -240, maxX: 240, minZ: -240, maxZ: 240 };
        const margin = 24;
        const minX = b.minX + margin;
        const maxX = b.maxX - margin;
        const minZ = b.minZ + margin;
        const maxZ = b.maxZ - margin;
        const step = 60;

        const slots = [[0, 0, 0]];
        for (let x = minX; x <= maxX; x += step) {
            for (let z = minZ; z <= maxZ; z += step) {
                slots.push([Math.round(x), 0, Math.round(z)]);
            }
        }
        return slots;
    }

    generateGuidance(stepDescription, projectState) {
        const workspace = projectState?.Workspace || {};
        const occupied = this._collectSpatialNodes(workspace, 'Workspace', []);
        const minDistance = this._inferMinDistance(stepDescription);
        const baseplateBounds = this._getBaseplateBounds(workspace);
        const bounds = this._adaptiveBounds(occupied, baseplateBounds);
        const groundY = this._estimateGroundY(workspace, occupied);
        const slots = this._buildCandidateSlots(bounds)
            .map(s => [s[0], groundY, s[2]])
            .filter(slot => this._isSlotFree(slot, occupied, minDistance))
            .slice(0, 8);

        const occupiedPreview = occupied.slice(0, 20).map(o =>
            `- ${o.path} @ [${o.position.map(n => Number(n).toFixed(1)).join(', ')}]`
        );

        const slotPreview = slots.map((s, i) =>
            `- Slot ${i + 1}: [${s[0]}, ${s[1]}, ${s[2]}]`
        );

        return {
            minDistance,
            suggestedSlots: slots,
            text: [
                'RUNTIME PLACEMENT GUIDANCE:',
                `- Minimum spacing for this feature: ${minDistance} studs (2D XZ).`,
                `- Keep placement inside world bounds: [${Math.round(bounds.minX)}, ${Math.round(bounds.maxX)}] x [${Math.round(bounds.minZ)}, ${Math.round(bounds.maxZ)}].`,
                `- Estimated ground surface Y: ${Number(groundY).toFixed(1)}. Place assets so bottom sits on ground (Position.Y = groundY + Size.Y/2).`,
                '- Use Roblox character scale (5.3 studs tall) to choose realistic asset size. Avoid tiny/unreadable assets.',
                '- Sub-agent decides final position and size AFTER discovery from current Explorer state. Do not use supervisor-fixed unknown paths.',
                '- Prefer these currently free candidate slots:',
                ...(slotPreview.length > 0 ? slotPreview : ['- No clear slots found; compute a new empty region away from existing objects.']),
                '- Existing occupied sample:',
                ...(occupiedPreview.length > 0 ? occupiedPreview : ['- Workspace appears mostly empty.']),
                '- Decide final asset placement from ACTUAL Explorer state. Do not assume fixed paths or names.'
            ].join('\n')
        };
    }
}

module.exports = new PlacementEngine();
