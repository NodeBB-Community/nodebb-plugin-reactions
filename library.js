'use strict';

const meta = nodebb.require('./src/meta');
const user = nodebb.require('./src/user');
const posts = nodebb.require('./src/posts');
const topics = nodebb.require('./src/topics');
const messaging = nodebb.require('./src/messaging');
const privileges = nodebb.require('./src/privileges');
const db = nodebb.require('./src/database');
const translator = nodebb.require('./src/translator');
const notifications = nodebb.require('./src/notifications');
const routesHelpers = nodebb.require('./src/routes/helpers');
const nconf = nodebb.require('nconf');
const categories = nodebb.require('./src/categories');
const activitypub = nodebb.require('./src/activitypub');
const websockets = nodebb.require('./src/socket.io/index');
const SocketPlugins = nodebb.require('./src/socket.io/plugins');

const emojiParser = nodebb.require('nodebb-plugin-emoji/build/lib/parse.js');
const helpers = require('./helpers');

const DEFAULT_MAX_EMOTES = 4;

function nameToEmoji(name) {
	return helpers.getEmojiTable()[name];
}

function parse(name) {
	const emoji = nameToEmoji(name) || helpers.getEmojiTable()[helpers.getEmojiAliases()[name]];
	return emoji ? emojiParser.buildEmoji(emoji, '') : '';
}

async function parseReaction(name) {
	// Local emoji: name has no colon, resolve from table
	const emoji = nameToEmoji(name) || helpers.getEmojiTable()[helpers.getEmojiAliases()[name]];
	if (emoji) {
		return emojiParser.buildEmoji(emoji, '');
	}

	// Custom emoji: name is stored as shortcode:hostname (buildFieldKey format)
	const idx = name.indexOf(':');
	if (idx !== -1) {
		const shortcode = name.slice(0, idx);
		const hostname = name.slice(idx + 1);
		const metadata = await activitypub.emoji.getEmoji(shortcode, hostname);
		if (metadata) {
			const proxyUrl = activitypub.emoji.getProxyUrl(shortcode, hostname);
			return `<img class="not-responsive emoji" src="${proxyUrl}" title=":${shortcode}:" />`;
		}
	}

	return '';
}

const ReactionsPlugin = module.exports;

ReactionsPlugin.init = async function (params) {
	routesHelpers.setupAdminPageRoute(params.router, '/admin/plugins/reactions', (req, res) => {
		res.render('admin/plugins/reactions', {
			title: '[[reactions:reactions]]',
		});
	});
};

ReactionsPlugin.addAdminNavigation = async function (header) {
	header.plugins.push({
		route: '/plugins/reactions',
		icon: 'fa-paint-brush',
		name: '[[reactions:reactions]]',
	});
	return header;
};

ReactionsPlugin.getPluginConfig = async function (config) {
	const settings = await loadPluginConfig();
	config.maximumReactions = settings.maximumReactions;
	config.maximumReactionsPerUserPerPost = settings.maximumReactionsPerUserPerPost;
	config.maximumReactionsPerMessage = settings.maximumReactionsPerMessage;
	config.maximumReactionsPerUserPerMessage = settings.maximumReactionsPerUserPerMessage;

	config.enablePostReactions = settings.enablePostReactions;
	config.enableMessageReactions = settings.enableMessageReactions;
	return config;
};

async function loadPluginConfig() {
	const settings = await meta.settings.get('reactions');
	function parseNum(val, defaultValue) {
		const parsed = parseInt(val, 10);
		return Number.isNaN(parsed) ? defaultValue : parsed;
	}
	// posts
	settings.maximumReactions = parseNum(settings.maximumReactions, DEFAULT_MAX_EMOTES);
	settings.maximumReactionsPerUserPerPost = parseNum(settings.maximumReactionsPerUserPerPost, 0);

	// chats
	settings.maximumReactionsPerMessage = parseNum(settings.maximumReactionsPerMessage, DEFAULT_MAX_EMOTES);
	settings.maximumReactionsPerUserPerMessage = parseNum(settings.maximumReactionsPerUserPerMessage, 0);

	settings.enablePostReactions = settings.enablePostReactions === 'on';
	settings.enableMessageReactions = settings.enableMessageReactions === 'on';
	return settings;
}

ReactionsPlugin.filterSettingsGet = async function (hookData) {
	if (hookData.plugin === 'reactions') {
		const { values } = hookData;
		if (!values.hasOwnProperty('enablePostReactions')) {
			values.enablePostReactions = 'on';
		}
		if (!values.hasOwnProperty('enableMessageReactions')) {
			values.enableMessageReactions = 'on';
		}
	}
	return hookData;
};

ReactionsPlugin.addNotificationFilters = async (data) => {
	data.regularFilters.push({ name: '[[reactions:reactions]]', filter: 'reaction' });
	return data;
};

ReactionsPlugin.notificationTypes = async (data) => {
	data.types.push('notificationType_reaction');
	return data;
};

ReactionsPlugin.getPostReactions = async function (data) {
	if (data.uid === 0) {
		return data;
	}

	try {
		const settings = await loadPluginConfig();
		if (!settings.enablePostReactions) {
			return data;
		}
		const { maximumReactions } = settings;

		const pids = data.posts.map(post => post && parseInt(post.pid, 10));
		const allReactionsForPids = await db.getSetsMembers(pids.map(pid => `pid:${pid}:reactions`));

		const pidToIsMaxReactionsReachedMap = new Map(); // pid -> IsMaxReactionsReached (boolean)
		const pidToReactionsMap = new Map(); // pid -> reactions (string[])
		let reactionSets = [];

		for (let i = 0, len = pids.length; i < len; i++) {
			try {
				const pid = pids[i];
				const reactionsList = allReactionsForPids[i];
				const reactionsCount = reactionsList.length;

				if (reactionsList && reactionsList.length > 0) {
					pidToReactionsMap.set(pid, reactionsList);
					pidToIsMaxReactionsReachedMap.set(pid, maximumReactions > 0 && reactionsCount >= maximumReactions);
					reactionSets = reactionSets.concat(reactionsList.map(reaction => `pid:${pid}:reaction:${reaction}`));
				}
			} catch (e) {
				console.error(e);
			}
		}

		const reactionSetToUsersMap = await getReactionSetsUidsMap(reactionSets);

		for (const post of data.posts) {
			if (post) {
				post.maxReactionsReached = pidToIsMaxReactionsReachedMap.get(post.pid);
				post.reactions = [];

				const reactions = pidToReactionsMap.get(post.pid);
				if (reactions) {
					for (const reaction of reactions) {
						const reactionSet = `pid:${post.pid}:reaction:${reaction}`;
						const uids = reactionSetToUsersMap.get(reactionSet);
						const reactionImage = await parseReaction(reaction);
						if (Array.isArray(uids) && reactionImage) {
							post.reactions.push({
								pid: post.pid,
								reacted: uids.includes(String(data.uid)),
								reaction,
								reactionImage: reactionImage,
								reactionCount: uids.length,
							});
						}
					}
				}
			}
		}
	} catch (e) {
		console.error(e);
	}
	return data;
};

ReactionsPlugin.getMessageReactions = async function (data) {
	if (data.uid === 0) {
		return data;
	}

	try {
		const settings = await loadPluginConfig();
		if (!settings.enableMessageReactions) {
			return data;
		}
		const { maximumReactionsPerMessage } = settings;

		const mids = data.messages.map(message => message && parseInt(message.mid, 10));
		const allReactionsForMids = await db.getSetsMembers(mids.map(mid => `mid:${mid}:reactions`));

		const midToIsMaxReactionsReachedMap = new Map(); // mid -> IsMaxReactionsReached (boolean)
		const midToReactionsMap = new Map(); // mid -> reactions (string[])
		let reactionSets = [];

		for (let i = 0, len = mids.length; i < len; i++) {
			const mid = mids[i];
			const reactionsList = allReactionsForMids[i];
			const reactionsCount = reactionsList.length;

			if (reactionsList && reactionsList.length > 0) {
				midToReactionsMap.set(mid, reactionsList);
				midToIsMaxReactionsReachedMap.set(
					mid,
					maximumReactionsPerMessage > 0 && reactionsCount >= maximumReactionsPerMessage
				);
				reactionSets = reactionSets.concat(reactionsList.map(reaction => `mid:${mid}:reaction:${reaction}`));
			}
		}

		const reactionSetToUsersMap = await getReactionSetsUidsMap(reactionSets);

		for (const msg of data.messages) {
			if (msg) {
				msg.maxReactionsReached = midToIsMaxReactionsReachedMap.get(msg.mid);
				msg.reactions = [];
				const reactions = midToReactionsMap.get(msg.mid);
				if (reactions) {
					for (const reaction of reactions) {
						const reactionSet = `mid:${msg.mid}:reaction:${reaction}`;
						const uids = reactionSetToUsersMap.get(reactionSet);
						const reactionImage = await parseReaction(reaction);
						if (Array.isArray(uids) && reactionImage) {
							msg.reactions.push({
								mid: msg.mid,
								reacted: uids.includes(String(data.uid)),
								reaction,
								reactionImage: reactionImage,
								reactionCount: uids.length,
							});
						}
					}
				}
			}
		}
	} catch (e) {
		console.error(e);
	}
	return data;
};


async function getReactionSetsUidsMap(reactionSets) {
	const reactionSetToUsersMap = new Map(); // reactionSet -> uids
	if (reactionSets.length > 0) {
		const uidsForReactions = await db.getSetsMembers(reactionSets);

		for (let i = 0, len = reactionSets.length; i < len; i++) {
			const uidsForReaction = uidsForReactions[i];
			if (uidsForReaction && uidsForReaction.length > 0) {
				reactionSetToUsersMap.set(reactionSets[i], uidsForReaction);
			}
		}
	}
	return reactionSetToUsersMap;
}

ReactionsPlugin.onReply = async function (data) {
	if (data.uid !== 0) {
		data.reactions = [];
	}
	return data;
};

ReactionsPlugin.deleteReactions = async function (hookData) {
	const pids = hookData.posts.map(post => post && post.pid);
	const pidsReactions = await db.getSetsMembers(pids.map(pid => `pid:${pid}:reactions`));

	const keys = [];
	pidsReactions.forEach((reactions, index) => {
		keys.push(
			...reactions.map(reaction => `pid:${pids[index]}:reaction:${reaction}`),
			`pid:${pids[index]}:reactions`,
		);
	});

	await db.deleteAll(keys);
};

async function sendPostEvent(data, eventName) {
	try {
		const [reactionCount, totalReactions] = await Promise.all([
			db.setCount(`pid:${data.pid}:reaction:${data.reaction}`),
			db.setCount(`pid:${data.pid}:reactions`),
		]);

		if (parseInt(reactionCount, 10) === 0) {
			await db.setRemove(`pid:${data.pid}:reactions`, data.reaction);
		}

		await websockets.in(`topic_${data.tid}`).emit(eventName, {
			pid: data.pid,
			uid: data.uid,
			reaction: data.reaction,
			reactionCount,
			totalReactions,
			reactionImage: await parseReaction(data.reaction),
		});
	} catch (e) {
		console.error(e);
	}
}

async function sendMessageEvent(data, eventName) {
	try {
		const [reactionCount, totalReactions] = await Promise.all([
			db.setCount(`mid:${data.mid}:reaction:${data.reaction}`),
			db.setCount(`mid:${data.mid}:reactions`),
		]);

		if (parseInt(reactionCount, 10) === 0) {
			await db.setRemove(`mid:${data.mid}:reactions`, data.reaction);
		}

		await websockets.in(`chat_room_${data.roomId}`).emit(eventName, {
			mid: data.mid,
			uid: data.uid,
			reaction: data.reaction,
			reactionCount,
			totalReactions,
			reactionImage: await parseReaction(data.reaction),
		});
	} catch (e) {
		console.error(e);
	}
}

async function getReactionReputation(reaction) {
	const settings = await meta.settings.get('reactions');
	const reactionsReps = settings['reaction-reputations'] || [];
	const foundReaction = reactionsReps.find(r => r.reaction === reaction);
	return foundReaction ? parseInt(foundReaction.reputation, 10) || 0 : 0;
}

async function giveOwnerReactionReputation(reactionReputation, pid) {
	const ownerUid = await posts.getPostField(pid, 'uid');
	if (parseInt(ownerUid, 10) > 0) {
		await user.incrementUserReputationBy(ownerUid, reactionReputation);
	}
}

/**
 * Core reaction logic, shared by the socket handlers and the ActivityPub
 * (FEP-c0e0) inbox integration. `uid` may be a local numeric uid or a remote
 * actor URL.
 */
ReactionsPlugin.addPostReaction = async function (pid, uid, reaction) {
	const settings = await loadPluginConfig();
	if (!settings.enablePostReactions) {
		throw new Error('[[error:post-reactions-disabled]]');
	}

	const [postData, totalReactions, emojiIsAlreadyExist, alreadyReacted, reactionReputation] = await Promise.all([
		posts.getPostFields(pid, ['pid', 'tid', 'uid', 'content', 'sourceContent']),
		db.setCount(`pid:${pid}:reactions`),
		db.isSetMember(`pid:${pid}:reactions`, reaction),
		db.isSetMember(`pid:${pid}:reaction:${reaction}`, uid),
		getReactionReputation(reaction),
	]);
	const { tid } = postData;
	if (!tid) {
		throw new Error('[[error:no-post]]');
	}

	if (!emojiIsAlreadyExist) {
		const { maximumReactions, maximumReactionsPerUserPerPost } = settings;
		if (maximumReactions > 0 && totalReactions >= maximumReactions) {
			throw new Error(`[[reactions:error.maximum-reached, ${maximumReactions}]]`);
		}

		if (maximumReactionsPerUserPerPost > 0) {
			const emojiesInPost = await db.getSetMembers(`pid:${pid}:reactions`);
			const userPostReactions = await db.isMemberOfSets(emojiesInPost.map(emojiName => `pid:${pid}:reaction:${emojiName}`), uid);
			const userPostReactionCount = userPostReactions.filter(Boolean).length;
			if (userPostReactionCount >= maximumReactionsPerUserPerPost) {
				throw new Error(`[[reactions:error.maximum-per-user-per-post-reached, ${maximumReactionsPerUserPerPost}]]`);
			}
		}
	}

	await Promise.all([
		db.setAdd(`pid:${pid}:reactions`, reaction),
		db.setAdd(`pid:${pid}:reaction:${reaction}`, uid),
	]);

	if (!alreadyReacted && reactionReputation > 0) {
		await giveOwnerReactionReputation(reactionReputation, pid);
	}

	if (postData.uid && postData.uid !== uid) {
		const [displayname, topicTitle, parsedPostData] = await Promise.all([
			user.getNotificationDisplayname(uid),
			topics.getNotificationTitle(tid),
			posts.parsePost(postData),
		]);
		const notifObj = await notifications.create({
			type: 'reaction',
			bodyShort: translator.compile(
				'reactions:notification.user-has-reacted-with-to-your-post-in-topic',
				displayname,
				`:${reaction}:`,
				topicTitle
			),
			bodyLong: parsedPostData.content,
			nid: `uid:${uid}:pid:${pid}:reaction:${reaction}`,
			pid: pid,
			tid: tid,
			from: uid,
			path: `/post/${pid}`,
		});

		await notifications.push(notifObj, [postData.uid]);
	}

	await sendPostEvent({ pid, uid, tid, reaction }, 'event:reactions.addPostReaction');
};

ReactionsPlugin.removePostReaction = async function (pid, uid, reaction) {
	const settings = await loadPluginConfig();
	if (!settings.enablePostReactions) {
		throw new Error('[[error:post-reactions-disabled]]');
	}

	const [tid, hasReacted, reactionReputation] = await Promise.all([
		posts.getPostField(pid, 'tid'),
		db.isSetMember(`pid:${pid}:reaction:${reaction}`, uid),
		getReactionReputation(reaction),
	]);
	if (!tid) {
		throw new Error('[[error:no-post]]');
	}

	if (hasReacted) {
		await db.setRemove(`pid:${pid}:reaction:${reaction}`, uid);
	}

	const reactionCount = await db.setCount(`pid:${pid}:reaction:${reaction}`);
	if (reactionCount === 0) {
		await db.setRemove(`pid:${pid}:reactions`, reaction);
	}
	if (hasReacted && reactionReputation > 0) {
		await giveOwnerReactionReputation(-reactionReputation, pid);
	}

	await sendPostEvent({ pid, uid, tid, reaction }, 'event:reactions.removePostReaction');
};

ReactionsPlugin.rescindPostReaction = async function (pid, uid, reaction) {
	await notifications.rescind(`uid:${uid}:pid:${pid}:reaction:${reaction}`);
};

/*
	ActivityPub (FEP-c0e0) integration.

	Core fires `filter:activitypub.<type>` for every incoming activity before
	built-in handling. The filter payload is `{ req, activity, claimed }` — a
	plugin may claim the activity (core then skips its built-in handler) and/or
	transparently rewrite `activity` for the rest of the chain.

	This plugin claims:
	- `EmojiReact` (always — it is the implementation)
	- `Like` with `content` (FEP-c0e0 requires identical handling)
	- `Undo` of either of the above
	- `Announce` of either of the above (category sync / relays)
*/

/**
 * Resolve the (local or remote) post referenced by an EmojiReact activity.
 * Returns a pid for local posts, the note URL for remote posts, or null when
 * the post cannot be found.
 * Handles both full objects (object.id) and bare URL strings.
 */
async function resolveReactionPost(object) {
	// Normalize: bare URL string or { id: '...' }
	const objectUrl = typeof object === 'string' ? object : (object?.id || null);
	if (!objectUrl) {
		return null;
	}

	let id;
	let exists;
	if (objectUrl.startsWith(nconf.get('url'))) {
		const { type, id: localId } = await activitypub.helpers.resolveLocalId(objectUrl);
		if (type === 'post') {
			id = localId;
			exists = await posts.exists(id);
		}
	} else {
		id = objectUrl;
		exists = await posts.exists(id);
		if (!exists) {
			// Proactively pull in the note
			const asserted = await activitypub.notes.assert(0, id, { skipChecks: 1 });
			if (!asserted) {
				return null;
			}
			exists = true;
		}
	}
	return id && exists ? id : null;
}

ReactionsPlugin.applyEmojiReact = async function (activity) {
	const { actor, object, content, tag } = activity;

	const id = await resolveReactionPost(object);
	if (!id) {
		return false;
	}

	const resolved = helpers.resolveReaction(content, tag);
	if (!resolved) {
		activitypub.helpers.log(`[reactions/ap] Unresolvable reaction content (${JSON.stringify(content)}), ignoring.`);
		return false;
	}

	let reaction;
	let emojiTag;
	if (typeof resolved === 'object' && resolved.emoji) {
		reaction = resolved.emoji;
		emojiTag = resolved.emojiTag;
	} else {
		reaction = resolved;
	}

	if (emojiTag) {
		const cacheTag = { name: emojiTag.name };
		if (emojiTag.icon && emojiTag.icon.url) {
			cacheTag.icon = emojiTag.icon;
		} else if (emojiTag.id) {
			cacheTag.icon = { url: emojiTag.id, mediaType: emojiTag.mediaType || null };
		} else {
			cacheTag = null;
		}
		if (cacheTag) {
			const cached = await activitypub.emoji.cacheEmoji(cacheTag);
			if (cached) {
				// Use the normalized icon from cacheTag to extract hostname
				const hostname = activitypub.emoji.extractHostname(cacheTag.icon);
				if (hostname) {
					// Store reaction as qualified name: shortcode:hostname
					// (matches the emoji:ap:lookup field key for direct lookup)
					reaction = activitypub.emoji.buildFieldKey(reaction, hostname);
				}
			}
		}
	}

	const allowed = await privileges.posts.can('posts:upvote', id, activitypub._constants.uid);
	if (!allowed) {
		activitypub.helpers.log(`[reactions/ap] ${id} not allowed to be reacted on.`);
		throw new Error('[[error:no-privileges]]');
	}

	activitypub.helpers.log(`[reactions/ap] id ${id} (${reaction}) via ${actor}`);
	await ReactionsPlugin.addPostReaction(id, actor, reaction);
	await activitypub.feps.announce(object.id, activity);
	return true;
};

ReactionsPlugin.undoEmojiReact = async function (activity) {
	const { actor, object, content, tag } = activity;

	const id = await resolveReactionPost(object);
	if (!id) {
		return false;
	}

	const resolved = helpers.resolveReaction(content, tag);
	if (!resolved) {
		activitypub.helpers.log(`[reactions/ap] Unresolvable reaction content in undo, ignoring.`);
		return false;
	}

	let reaction;
	let emojiTag;
	if (typeof resolved === 'object' && resolved.emoji) {
		reaction = resolved.emoji;
		emojiTag = resolved.emojiTag;
	} else {
		reaction = resolved;
	}

	// Rebuild qualified name for custom emoji (must match the stored name)
	if (emojiTag) {
		const icon = emojiTag.icon || (emojiTag.id ? { url: emojiTag.id } : null);
		const hostname = activitypub.emoji.extractHostname(icon);
		if (hostname) {
			reaction = activitypub.emoji.buildFieldKey(reaction, hostname);
		}
	}

	activitypub.helpers.log(`[reactions/ap] undo id ${id} (${reaction}) via ${actor}`);
	await ReactionsPlugin.removePostReaction(id, actor, reaction);
	await ReactionsPlugin.rescindPostReaction(id, actor, reaction);
	await activitypub.feps.announce(object.id, activity);
	return true;
};

ReactionsPlugin.handleEmojiReact = async function (context) {
	await ReactionsPlugin.applyEmojiReact(context.activity);
	return { ...context, claimed: true };
};

ReactionsPlugin.handleLike = async function (context) {
	if (typeof context.activity.content === 'string' && context.activity.content.trim()) {
		const applied = await ReactionsPlugin.applyEmojiReact(context.activity);
		if (applied) {
			return { ...context, claimed: true };
		}
	}
	return context;
};

ReactionsPlugin.handleUndo = async function (context) {
	const { object } = context.activity;
	if (!object || (object.type !== 'EmojiReact' && !(object.type === 'Like' && typeof object.content === 'string' && object.content.trim()))) {
		return context;
	}
	await ReactionsPlugin.undoEmojiReact(object);
	return { ...context, claimed: true };
};

ReactionsPlugin.handleAnnounce = async function (context) {
	const { actor } = context.activity;

	// Unwrap nested Announces and resolve string references, mirroring core
	let { object } = context.activity;
	while (object && object.type === 'Announce') {
		object = object.object;
	}
	if (typeof object === 'string') {
		try {
			object = await activitypub.helpers.resolveObjects(object);
		} catch (e) {
			object = { id: object };
		}
	}
	if (!object || (object.type !== 'EmojiReact' && !(object.type === 'Like' && typeof object.content === 'string' && object.content.trim()))) {
		return context;
	}

	// Only category-synced or relayed announces reach local posts
	const fromRelay = await activitypub.relays.is(actor);
	const categoryActor = await categories.exists(actor);
	if (!categoryActor && !fromRelay) {
		return context;
	}

	if (categoryActor) {
		// Mirrors core's protection: category actors can only announce activities
		// concerning posts in said category (the post's cid is the category actor URL)
		let id = (object.object && object.object.id) || object.object;
		const { id: localId } = await activitypub.helpers.resolveLocalId(id);
		id = localId || id;

		if (!(await posts.exists(id)) || (await posts.getCidByPid(id)) !== actor) {
			return context;
		}
	}

	if (!(await activitypub.actors.assert(object.actor))) {
		throw new Error('[[error:activitypub.invalid-id]]');
	}

	if (typeof object.object === 'string') {
		try {
			object.object = await activitypub.helpers.resolveObjects(object.object);
		} catch (e) {
			activitypub.helpers.log(`[reactions/ap] Failed to resolve announced object, using raw id: ${object.object}`);
			object.object = { id: object.object };
		}
	}

	const applied = await ReactionsPlugin.applyEmojiReact(object);
	if (applied) {
		return { ...context, claimed: true };
	}
	return context;
};

SocketPlugins.reactions = {
	addPostReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		data.uid = socket.uid;
		await ReactionsPlugin.addPostReaction(data.pid, socket.uid, data.reaction);
	},
	removePostReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		data.uid = socket.uid;
		await ReactionsPlugin.removePostReaction(data.pid, socket.uid, data.reaction);
	},
	addMessageReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const settings = await loadPluginConfig();
		if (!settings.enableMessageReactions) {
			throw new Error('[[error:message-reactions-disabled]]');
		}

		const [msgData, totalReactions, emojiIsAlreadyExist] = await Promise.all([
			messaging.getMessageFields(data.mid, ['roomId', 'fromuid', 'content']),
			db.setCount(`mid:${data.mid}:reactions`),
			db.isSetMember(`mid:${data.mid}:reactions`, data.reaction),
		]);
		const { roomId } = msgData;
		if (!roomId) {
			throw new Error('[[error:no-message]]');
		}

		data.uid = socket.uid;
		data.roomId = roomId;

		if (!emojiIsAlreadyExist) {
			const { maximumReactionsPerMessage, maximumReactionsPerUserPerMessage } = settings;
			if (maximumReactionsPerMessage > 0 && totalReactions >= maximumReactionsPerMessage) {
				throw new Error(`[[reactions:error.maximum-reached, ${maximumReactionsPerMessage}]]`);
			}

			if (maximumReactionsPerUserPerMessage > 0) {
				const emojiesInMessage = await db.getSetMembers(`mid:${data.mid}:reactions`);
				const userPostReactions = await db.isMemberOfSets(emojiesInMessage.map(emojiName => `mid:${data.mid}:reaction:${emojiName}`), socket.uid);
				const userPostReactionCount = userPostReactions.filter(Boolean).length;
				if (userPostReactionCount >= maximumReactionsPerUserPerMessage) {
					throw new Error(`[[reactions:error.maximum-per-user-per-message-reached, ${maximumReactionsPerUserPerMessage}]]`);
				}
			}
		}

		await Promise.all([
			db.setAdd(`mid:${data.mid}:reactions`, data.reaction),
			db.setAdd(`mid:${data.mid}:reaction:${data.reaction}`, socket.uid),
		]);

		if (msgData.fromuid && msgData.fromuid !== socket.uid) {
			const [userData, roomData, parsedMessage] = await Promise.all([
				user.getUserFields(socket.uid, ['username', 'userslug', 'fullname']),
				messaging.getRoomData(roomId),
				messaging.parse(msgData.content, socket.uid, msgData.fromuid, roomId, false),
			]);
			const roomName = roomData.roomName || `[[modules:chat.room-id, ${roomId}]]`;
			const icon = messaging.getRoomIcon(roomData);

			const notifObj = await notifications.create({
				type: 'reaction',
				bodyShort: translator.compile(
					'reactions:notification.user-has-reacted-with-to-your-message-in-room',
					userData.displayname,
					`:${data.reaction}:`,
					icon,
					roomName
				),
				bodyLong: parsedMessage,
				roomIcon: icon,
				nid: `uid:${socket.uid}:mid:${data.mid}:reaction:${data.reaction}`,
				mid: data.mid,
				roomId: roomId,
				from: socket.uid,
				path: `/message/${data.mid}`,
			});

			await notifications.push(notifObj, [msgData.fromuid]);
		}

		await sendMessageEvent(data, 'event:reactions.addMessageReaction');
	},
	removeMessageReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const [settings, roomId, hasReacted] = await Promise.all([
			loadPluginConfig(),
			messaging.getMessageField(data.mid, 'roomId'),
			db.isSetMember(`mid:${data.mid}:reaction:${data.reaction}`, socket.uid),
		]);
		if (!settings.enableMessageReactions) {
			throw new Error('[[error:message-reactions-disabled]]');
		}
		if (!roomId) {
			throw new Error('[[error:no-message]]');
		}
		data.uid = socket.uid;
		data.roomId = roomId;
		if (hasReacted) {
			await db.setRemove(`mid:${data.mid}:reaction:${data.reaction}`, socket.uid);
		}

		const reactionCount = await db.setCount(`mid:${data.mid}:reaction:${data.reaction}`);
		if (reactionCount === 0) {
			await db.setRemove(`mid:${data.mid}:reactions`, data.reaction);
		}

		await sendMessageEvent(data, 'event:reactions.removeMessageReaction');
	},
	getReactionUsernames: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}
		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}
		let set;
		if (data.type === 'post') {
			if (!await privileges.posts.can('topics:read', data.pid, socket.uid)) {
				throw new Error('[[error:not-allowed]]');
			}
			set = `pid:${data.pid}:reaction:${data.reaction}`;
		} else if (data.type === 'message') {
			const roomId = await messaging.getMessageField(data.mid, 'roomId');
			if (!await messaging.canViewMessage(data.mid, roomId, socket.uid)) {
				throw new Error('[[error:not-allowed]]');
			}
			set = `mid:${data.mid}:reaction:${data.reaction}`;
		} else {
			throw new Error('[[error:invalid-data]]');
		}
		let uids = await db.getSetMembers(set);
		const cutoff = 6;

		let otherCount = 0;
		if (uids.length > cutoff) {
			otherCount = uids.length - (cutoff - 1);
			uids = uids.slice(0, cutoff - 1);
		}

		const usernames = await user.getUsernamesByUids(uids);
		return {
			cutoff: cutoff,
			otherCount,
			usernames,
		};
	},
};

