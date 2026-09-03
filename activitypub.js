'use strict';

const nconf = nodebb.require('nconf');
const posts = nodebb.require('./src/posts');
const activitypub = nodebb.require('./src/activitypub');
const helpers = require('./helpers');

const Ap = module.exports;

/**
 * Build an EmojiReact (FEP-c0e0) or Like-with-content activity
 * by reusing the core mocks.activities.like as a base.
 */
async function buildActivity(pid, uid, reaction, type) {
	const base = await activitypub.mocks.activities.like(pid, uid);
	const cleanName = reaction.replace(/^:+|:+$/g, '');

	if (type === 'EmojiReact') {
		const content = `:${cleanName}:`;
		const overrides = {
			id: base.id.replace('like', 'emojireact'),
			type: 'EmojiReact',
			content,
		};

		// For custom emoji (shortcode:hostname), attach Emoji tag
		const idx = reaction.indexOf(':');
		if (idx !== -1) {
			const shortcode = reaction.slice(0, idx);
			const hostname = reaction.slice(idx + 1);
			const metadata = await activitypub.emoji.getEmoji(shortcode, hostname);
			if (metadata) {
				overrides.tag = [{
					type: 'Emoji',
					mediaType: metadata.mediaType || null,
					name: `:${shortcode}:`,
					icon: {
						url: metadata.remoteUrl,
					},
				}];
			}
		}

		return { ...base, ...overrides };
	}

	// Like with content
	return {
		...base,
		content: `:${cleanName}:`,
	};
}

/**
 * Build an Undo activity wrapping the given reaction activity.
 */
async function buildUndoActivity(pid, uid, reaction, innerType) {
	const inner = await buildActivity(pid, uid, reaction, innerType);
	return {
		id: `${nconf.get('url')}/uid/${uid}#activity/undo:emojireact/${encodeURIComponent(pid)}/${Date.now()}`,
		type: 'Undo',
		actor: `${nconf.get('url')}/uid/${uid}`,
		object: {
			actor: inner.actor,
			id: inner.id,
			type: inner.type,
			object: inner.object,
			...(inner.content ? { content: inner.content } : {}),
			...(inner.tag ? { tag: inner.tag } : {}),
		},
	};
}

/**
 * Send a reaction activity to the remote post author and announce via FEPs.
 */
async function send(pid, uid, reaction, innerType) {
	const isRemotePost = activitypub.helpers.isUri(pid);

	const activity = await buildActivity(pid, uid, reaction, innerType);

	if (!isRemotePost) {
		// Local post: only announce via FEPs (1b12 relay)
		await activitypub.feps.announce(pid, activity);
		return;
	}

	// Remote post: send to author + announce
	const author = await posts.getPostField(pid, 'uid');
	if (!activitypub.helpers.isUri(author)) {
		// Post author is local — nothing to send
		await activitypub.feps.announce(pid, activity);
		return;
	}

	await Promise.all([
		activitypub.send('uid', uid, [author], activity),
		activitypub.feps.announce(pid, activity),
	]);
}

/**
 * Send an Undo activity for a reaction.
 */
async function sendUndo(pid, uid, reaction, innerType) {
	if (!activitypub.helpers.isUri(pid)) {
		return;
	}

	const author = await posts.getPostField(pid, 'uid');
	if (!activitypub.helpers.isUri(author)) {
		return;
	}

	const undo = await buildUndoActivity(pid, uid, reaction, innerType);
	await Promise.all([
		activitypub.send('uid', uid, [author], undo),
		activitypub.feps.announce(pid, undo),
	]);
}

Ap.send = send;
Ap.sendUndo = sendUndo;
