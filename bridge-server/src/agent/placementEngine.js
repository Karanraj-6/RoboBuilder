/**
 * Placement Engine
 * Generates spatial guidance from current project state so workers can place
 * assets based on existing occupancy instead of hallucinated coordinates.
 */

class PlacementEngine {
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

    // ================================================================
    // PUBLIC: Collect all occupied objects from project state
    // Returns array of { path, className, position: [X,Y,Z], size: [W,H,D] }
    // ================================================================
    collectAllOccupied(projectState) {
        const workspace = projectState?.Workspace || {};
        return this._collectSpatialNodes(workspace, 'Workspace', []);
    }

    // Also collect Models with PivotPosition + BoundingSize
    _collectSpatialNodes(node, currentPath = '', out = []) {
        if (!node || typeof node !== 'object') return out;

        const props = node._properties || {};

        // BasePart: has Position + Size
        const pos = Array.isArray(props.Position) && props.Position.length === 3 ? props.Position : null;
        const size = Array.isArray(props.Size) && props.Size.length === 3 ? props.Size : null;

        // Model: has PivotPosition + BoundingSize
        const pivotPos = Array.isArray(props.PivotPosition) && props.PivotPosition.length === 3 ? props.PivotPosition : null;
        const boundSize = Array.isArray(props.BoundingSize) && props.BoundingSize.length === 3 ? props.BoundingSize : null;

        if (pos) {
            out.push({
                path: currentPath,
                className: node._class || 'Unknown',
                name: node._name || currentPath.split('.').pop(),
                position: pos,
                size: size || [8, 8, 8]
            });
        } else if (pivotPos) {
            out.push({
                path: currentPath,
                className: node._class || 'Unknown',
                name: node._name || currentPath.split('.').pop(),
                position: pivotPos,
                size: boundSize || [8, 8, 8]
            });
        }

        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith('_')) continue;
            const nextPath = currentPath ? `${currentPath}.${key}` : key;
            this._collectSpatialNodes(value, nextPath, out);
        }

        return out;
    }

    // ================================================================
    // PUBLIC: Check if a box at (pos, size) overlaps any occupied object
    // Excludes ground/terrain/roads from collision (they're flat surfaces everything sits on)
    // Returns { overlaps: boolean, overlappingWith: [...] }
    // ================================================================
    checkCollision(pos, size, occupied) {
        const halfW = size[0] / 2;
        const halfH = size[1] / 2;
        const halfD = size[2] / 2;

        const minX = pos[0] - halfW;
        const maxX = pos[0] + halfW;
        const minY = pos[1] - halfH;
        const maxY = pos[1] + halfH;
        const minZ = pos[2] - halfD;
        const maxZ = pos[2] + halfD;

        const overlapping = [];

        for (const obj of occupied) {
            // Skip ground-like objects (large flat surfaces)
            const oSize = obj.size || [8, 8, 8];
            const oName = (obj.name || obj.path || '').toLowerCase();
            const isFlat = oSize[1] <= 2;
            const isWide = oSize[0] >= 80 || oSize[2] >= 80;
            const isGroundLike = isFlat && isWide;
            const isNamedGround = oName.includes('ground') || oName.includes('baseplate') || 
                                   oName.includes('terrain') || oName.includes('road') || 
                                   oName.includes('street') || oName.includes('sidewalk') ||
                                   oName.includes('path') || oName.includes('floor');
            if (isGroundLike || isNamedGround) continue;

            const oPos = obj.position;
            const oHalfW = oSize[0] / 2;
            const oHalfH = oSize[1] / 2;
            const oHalfD = oSize[2] / 2;

            const oMinX = oPos[0] - oHalfW;
            const oMaxX = oPos[0] + oHalfW;
            const oMinY = oPos[1] - oHalfH;
            const oMaxY = oPos[1] + oHalfH;
            const oMinZ = oPos[2] - oHalfD;
            const oMaxZ = oPos[2] + oHalfD;

            // AABB overlap test with padding (8 studs breathing room)
            const pad = 8;
            if (minX - pad < oMaxX && maxX + pad > oMinX &&
                minY - pad < oMaxY && maxY + pad > oMinY &&
                minZ - pad < oMaxZ && maxZ + pad > oMinZ) {
                overlapping.push(obj);
            }
        }

        return { overlaps: overlapping.length > 0, overlappingWith: overlapping };
    }

    // ================================================================
    // PUBLIC: Compute a collision-free placement for an object
    // 
    // modelSize: [W, H, D] — actual bounding size of the model
    // intendedPos: [X, Y, Z] — LLM's suggested position (hint)
    // occupied: array from collectAllOccupied()
    // groundY: top surface of ground
    // bounds: { minX, maxX, minZ, maxZ }
    //
    // Returns: { position: [X, Y, Z], adjusted: boolean, reason: string }
    // ================================================================
    computePlacement(modelSize, intendedPos, occupied, groundY, bounds) {
        const w = modelSize[0] || 8;
        const h = modelSize[1] || 8;
        const d = modelSize[2] || 8;

        // First: correct the Y so model sits ON the ground
        const correctY = groundY + (h / 2);

        // Start with intended position, Y-corrected
        let bestPos = [
            intendedPos[0] || 0,
            correctY,
            intendedPos[2] || 0
        ];

        // Clamp to world bounds
        const bnd = bounds || { minX: -240, maxX: 240, minZ: -240, maxZ: 240 };
        bestPos[0] = Math.max(bnd.minX + w / 2, Math.min(bnd.maxX - w / 2, bestPos[0]));
        bestPos[2] = Math.max(bnd.minZ + d / 2, Math.min(bnd.maxZ - d / 2, bestPos[2]));

        // Check for collision at intended position
        const collision = this.checkCollision(bestPos, [w, h, d], occupied);
        if (!collision.overlaps) {
            return { position: bestPos, adjusted: false, reason: 'No collision at intended position' };
        }

        // Collision detected — try to find a free spot nearby
        // Strategy: spiral outward from intended position in XZ plane
        const stepSize = Math.max(w, d) + 20; // Move at least one object-width + generous gap
        const maxRings = 10; // More rings = larger search area (up to ~10x object size away)

        for (let ring = 1; ring <= maxRings; ring++) {
            const dist = ring * stepSize;
            for (let angle = 0; angle < 360; angle += 45) { // 8 directions per ring = 80 positions total
                const rad = (angle * Math.PI) / 180;
                const testPos = [
                    bestPos[0] + dist * Math.cos(rad),
                    correctY,
                    bestPos[2] + dist * Math.sin(rad)
                ];

                // Clamp to bounds
                testPos[0] = Math.max(bnd.minX + w / 2, Math.min(bnd.maxX - w / 2, testPos[0]));
                testPos[2] = Math.max(bnd.minZ + d / 2, Math.min(bnd.maxZ - d / 2, testPos[2]));

                const testCollision = this.checkCollision(testPos, [w, h, d], occupied);
                if (!testCollision.overlaps) {
                    return {
                        position: [Math.round(testPos[0]), Math.round(testPos[1] * 10) / 10, Math.round(testPos[2])],
                        adjusted: true,
                        reason: `Moved ${Math.round(dist)} studs from intended to avoid collision with ${collision.overlappingWith.map(o => o.name || o.path).join(', ')}`
                    };
                }
            }
        }

        // Last resort: find ANY free slot in the world
        const gridStep = Math.max(w, d) + 15;
        for (let x = bnd.minX + w; x < bnd.maxX - w; x += gridStep) {
            for (let z = bnd.minZ + d; z < bnd.maxZ - d; z += gridStep) {
                const testPos = [x, correctY, z];
                const testCollision = this.checkCollision(testPos, [w, h, d], occupied);
                if (!testCollision.overlaps) {
                    return {
                        position: [Math.round(x), Math.round(correctY * 10) / 10, Math.round(z)],
                        adjusted: true,
                        reason: `Fallback grid placement — could not fit near intended position`
                    };
                }
            }
        }

        // Absolute last resort — just use the intended position Y-corrected
        return {
            position: [Math.round(bestPos[0]), Math.round(correctY * 10) / 10, Math.round(bestPos[2])],
            adjusted: true,
            reason: 'Could not find collision-free spot, using Y-corrected intended position'
        };
    }

    // ================================================================
    // PUBLIC: Get ground Y and world bounds from current state
    // ================================================================
    getWorldInfo(projectState) {
        const workspace = projectState?.Workspace || {};
        const occupied = this._collectSpatialNodes(workspace, 'Workspace', []);
        const baseplateBounds = this._getBaseplateBounds(workspace);
        const bounds = this._adaptiveBounds(occupied, baseplateBounds);
        const groundY = this._estimateGroundY(workspace, occupied);
        return { groundY, bounds, occupied };
    }

    // ================================================================
    // PUBLIC: Analyze spatial coverage — find empty zones and object counts
    // Returns { zones: [...], totalObjects, objectCounts, emptyZones, sparseZones, coverageReport }
    // ================================================================
    analyzeCoverage(projectState) {
        const worldInfo = this.getWorldInfo(projectState);
        const occupied = worldInfo.occupied;
        const bounds = worldInfo.bounds;

        // Filter out ground-like objects for counting
        const placedObjects = occupied.filter(obj => {
            const s = obj.size || [0, 0, 0];
            const n = (obj.name || obj.path || '').toLowerCase();
            const isFlat = s[1] <= 2 && (s[0] >= 80 || s[2] >= 80);
            const isInfra = n.includes('ground') || n.includes('baseplate') || n.includes('terrain');
            return !isFlat && !isInfra;
        });

        // Divide world into a grid of zones (4x4 = 16 zones)
        const gridSize = 4;
        const zoneW = (bounds.maxX - bounds.minX) / gridSize;
        const zoneD = (bounds.maxZ - bounds.minZ) / gridSize;
        const zones = [];

        for (let gx = 0; gx < gridSize; gx++) {
            for (let gz = 0; gz < gridSize; gz++) {
                const zMinX = bounds.minX + gx * zoneW;
                const zMaxX = zMinX + zoneW;
                const zMinZ = bounds.minZ + gz * zoneD;
                const zMaxZ = zMinZ + zoneD;
                const centerX = Math.round((zMinX + zMaxX) / 2);
                const centerZ = Math.round((zMinZ + zMaxZ) / 2);

                const objectsInZone = placedObjects.filter(obj => {
                    const p = obj.position;
                    return p[0] >= zMinX && p[0] < zMaxX && p[2] >= zMinZ && p[2] < zMaxZ;
                });

                zones.push({
                    label: `Zone_${gx}_${gz}`,
                    bounds: { minX: Math.round(zMinX), maxX: Math.round(zMaxX), minZ: Math.round(zMinZ), maxZ: Math.round(zMaxZ) },
                    center: [centerX, centerZ],
                    objectCount: objectsInZone.length,
                    objects: objectsInZone.map(o => o.name || o.path)
                });
            }
        }

        // Count by type (heuristic from names)
        const objectCounts = { buildings: 0, vehicles: 0, trees: 0, lights: 0, props: 0, other: 0 };
        for (const obj of placedObjects) {
            const n = (obj.name || obj.path || '').toLowerCase();
            if (n.includes('road') || n.includes('street') || n.includes('sidewalk')) continue;
            if (n.includes('building') || n.includes('house') || n.includes('apart') || n.includes('office') || n.includes('shop') || n.includes('skyscraper') || n.includes('warehouse') || n.includes('factory') || n.includes('restaurant')) objectCounts.buildings++;
            else if (n.includes('car') || n.includes('taxi') || n.includes('bus') || n.includes('truck') || n.includes('sedan') || n.includes('vehicle') || n.includes('police')) objectCounts.vehicles++;
            else if (n.includes('tree') || n.includes('oak') || n.includes('pine') || n.includes('bush') || n.includes('plant')) objectCounts.trees++;
            else if (n.includes('light') || n.includes('lamp')) objectCounts.lights++;
            else if (n.includes('bench') || n.includes('hydrant') || n.includes('cone') || n.includes('dumpster') || n.includes('sign') || n.includes('fountain') || n.includes('trash')) objectCounts.props++;
            else objectCounts.other++;
        }

        const emptyZones = zones.filter(z => z.objectCount === 0);
        const sparseZones = zones.filter(z => z.objectCount > 0 && z.objectCount <= 2);

        // Build human-readable coverage report
        const zoneLines = zones.map(z =>
            `  ${z.label}: ${z.objectCount} objects (center: [${z.center.join(', ')}], X: ${z.bounds.minX} to ${z.bounds.maxX}, Z: ${z.bounds.minZ} to ${z.bounds.maxZ})${z.objectCount === 0 ? ' ← EMPTY' : z.objectCount <= 2 ? ' ← SPARSE' : ''}`
        );

        const coverageReport = [
            `COVERAGE ANALYSIS:`,
            `Total placed objects (excluding ground/roads): ${placedObjects.length}`,
            `Object counts: Buildings=${objectCounts.buildings}, Vehicles=${objectCounts.vehicles}, Trees=${objectCounts.trees}, Lights=${objectCounts.lights}, Props=${objectCounts.props}, Other=${objectCounts.other}`,
            `Zones (${gridSize}x${gridSize} grid):`,
            ...zoneLines,
            `Empty zones: ${emptyZones.length}/${zones.length}`,
            `Sparse zones (1-2 objects): ${sparseZones.length}/${zones.length}`
        ].join('\n');

        return {
            zones,
            totalObjects: placedObjects.length,
            objectCounts,
            emptyZones,
            sparseZones,
            coverageReport,
            groundY: worldInfo.groundY,
            bounds
        };
    }
}

module.exports = new PlacementEngine();
