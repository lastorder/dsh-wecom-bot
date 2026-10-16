export function createAccessPolicy(settings) {
    const chatIds = new Set(settings.chatIds);
    const userIds = new Set(settings.allowedUserIds);
    const sessionIds = new Set(settings.sessionIds);
    const chatAllowed = (chat) => !chatIds.size || chatIds.has(chat);
    const userAllowed = (user) => !userIds.size || userIds.has(user);
    return {
        chatIds, userIds, sessionIds,
        chatAllowed,
        userAllowed,
        sessionListed: id => !sessionIds.size || sessionIds.has(id),
        evaluate(chat, user) {
            const chatOk = chatAllowed(chat);
            const userOk = userAllowed(user);
            if (chatOk && userOk)
                return { accepted: true };
            return { accepted: false, reason: !chatOk && !userOk ? 'user+chat' : !chatOk ? 'chat' : 'user' };
        },
    };
}
//# sourceMappingURL=policy.js.map