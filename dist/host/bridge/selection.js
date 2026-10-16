export function createSelectionStore(maxEntries = 500) {
    const selected = new Map();
    const listings = new Map();
    const key = (chat, user) => `${chat}\0${user}`;
    function put(map, k, value) {
        map.delete(k);
        map.set(k, value);
        if (map.size > maxEntries)
            map.delete(map.keys().next().value);
    }
    return {
        get: (chat, user) => selected.get(key(chat, user)),
        set: (chat, user, sessionId) => put(selected, key(chat, user), sessionId),
        listing: (chat, user) => listings.get(key(chat, user)),
        setListing: (chat, user, ids) => put(listings, key(chat, user), [...ids]),
    };
}
//# sourceMappingURL=selection.js.map