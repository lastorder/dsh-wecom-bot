import { basename } from 'node:path';
export const UNGROUPED_TITLE = '未分组';
const DEFAULT_WORKSPACE_DIRECTORY = 'default-workspace';
export function workspaceDisplayTitle(title, path) {
    const trimmed = title?.trim();
    if (trimmed === DEFAULT_WORKSPACE_DIRECTORY)
        return '默认工作区';
    return trimmed || basename(path) || path;
}
export function sessionTitle(summary) {
    const title = summary?.projections?.values?.title;
    return typeof title === 'string' && title.trim() ? title.trim() : null;
}
export function buildCatalog(items, registry, generatedAt = Date.now()) {
    const byId = new Map(items.map(item => [item.sessionId, item]));
    const archived = new Set(registry?.archivedSessionIds ?? []);
    const pinned = new Set(registry?.pinnedSessionIds ?? []);
    function hiddenReason(sessionId) {
        const summary = byId.get(sessionId);
        if (!summary)
            return archived.has(sessionId) ? 'archived' : 'missing';
        if (archived.has(sessionId))
            return 'archived';
        if (summary.origin === 'subagent')
            return 'subagent';
        if (summary.blank === true)
            return 'blank';
        return undefined;
    }
    const toSession = (summary) => ({
        sessionId: summary.sessionId,
        title: sessionTitle(summary),
        running: summary.running === true,
        pinned: pinned.has(summary.sessionId),
        updatedAt: summary.updatedAt ?? 0,
    });
    const byDisplayOrder = (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt;
    const visible = (summary) => hiddenReason(summary.sessionId) === undefined;
    const groups = [];
    if (registry) {
        const accounted = new Set();
        for (const workspace of registry.list()) {
            const members = [];
            for (const id of workspace.sessionIds) {
                const summary = byId.get(id);
                if (!summary || accounted.has(id))
                    continue;
                accounted.add(id);
                if (visible(summary))
                    members.push(toSession(summary));
            }
            if (!members.length)
                continue;
            groups.push({
                key: String(workspace.id), kind: 'workspace',
                title: workspaceDisplayTitle(workspace.title, workspace.path), path: workspace.path,
                sessions: members.sort(byDisplayOrder),
            });
        }
        const stray = items.filter(item => !accounted.has(item.sessionId) && visible(item)).map(toSession);
        if (stray.length)
            groups.push({ key: 'ungrouped', kind: 'ungrouped', title: UNGROUPED_TITLE, sessions: stray.sort(byDisplayOrder) });
    }
    else {
        const directories = new Map();
        for (const item of items) {
            if (!visible(item))
                continue;
            const cwd = item.cwd ?? '';
            const list = directories.get(cwd) ?? [];
            list.push(toSession(item));
            directories.set(cwd, list);
        }
        for (const [cwd, sessions] of directories) {
            sessions.sort(byDisplayOrder);
            groups.push(cwd
                ? { key: `dir:${cwd}`, kind: 'directory', title: basename(cwd) || cwd, path: cwd, sessions }
                : { key: 'ungrouped', kind: 'ungrouped', title: UNGROUPED_TITLE, sessions });
        }
        groups.sort((a, b) => (a.kind === 'ungrouped' ? 1 : 0) - (b.kind === 'ungrouped' ? 1 : 0)
            || (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0));
    }
    const entries = groups.flatMap(group => group.sessions.map(session => ({ ...session, group })));
    const entryById = new Map(entries.map(entry => [entry.sessionId, entry]));
    return {
        generatedAt,
        groups,
        entries,
        archivedCount: items.filter(item => archived.has(item.sessionId)).length,
        get: id => entryById.get(id),
        hiddenReason,
        titleOf: id => sessionTitle(byId.get(id)),
    };
}
export function catalogView(catalog, selectedIds) {
    return {
        groups: catalog.groups,
        total: catalog.entries.length,
        archived: catalog.archivedCount,
        generatedAt: catalog.generatedAt,
        hiddenSelections: selectedIds.filter(id => !catalog.get(id)).map(id => ({
            sessionId: id, title: catalog.titleOf(id), reason: catalog.hiddenReason(id) ?? 'missing',
        })),
    };
}
export function createCatalogService(source, options = {}) {
    const ttl = options.ttlMs ?? 3000;
    const timeout = options.timeoutMs ?? 15000;
    const now = options.now ?? Date.now;
    let cached;
    let inflight;
    async function fetchCatalog() {
        const items = await source.list(AbortSignal.timeout(timeout));
        const catalog = buildCatalog(items, source.registry(), now());
        cached = { catalog, at: now() };
        return catalog;
    }
    return {
        load(loadOptions = {}) {
            if (!loadOptions.force && cached && now() - cached.at < ttl)
                return Promise.resolve(cached.catalog);
            inflight ??= fetchCatalog().finally(() => { inflight = undefined; });
            return inflight;
        },
        invalidate() { cached = undefined; },
    };
}
//# sourceMappingURL=catalog.js.map