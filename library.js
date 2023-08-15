'use strict';

const _ = require.main.require('lodash');
const meta = require.main.require('./src/meta');
const user = require.main.require('./src/user');
const posts = require.main.require('./src/posts');
const messaging = require.main.require('./src/messaging');
const privileges = require.main.require('./src/privileges');
const db = require.main.require('./src/database');
const routesHelpers = require.main.require('./src/routes/helpers');
const websockets = require.main.require('./src/socket.io/index');
const SocketPlugins = require.main.require('./src/socket.io/plugins');

const emojiParser = require.main.require('nodebb-plugin-emoji/build/lib/parse.js');
const emojiTable = require.main.require('nodebb-plugin-emoji/build/emoji/table.json');
const emojiAliases = require.main.require('nodebb-plugin-emoji/build/emoji/aliases.json');

const DEFAULT_MAX_EMOTES = 4;

function parse(name) {
	return emojiParser.buildEmoji(emojiTable[name] || emojiTable[emojiAliases[name]], '');
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
	try {
		const settings = await meta.settings.get('reactions');
		config.maximumReactions = settings.maximumReactions ? parseInt(settings.maximumReactions, 10) : DEFAULT_MAX_EMOTES;
		config.maximumReactionsPerMessage = settings.maximumReactionsPerMessage ?
			parseInt(settings.maximumReactionsPerMessage, 10) : DEFAULT_MAX_EMOTES;
	} catch (e) {
		console.error(e);
	}
	return config;
};

ReactionsPlugin.getPostReactions = async function (data) {
	if (data.uid === 0) {
		return data;
	}

	try {
		const settings = await meta.settings.get('reactions');
		const maximumReactions = settings.maximumReactions || DEFAULT_MAX_EMOTES;

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
					pidToIsMaxReactionsReachedMap.set(pid, reactionsCount > maximumReactions);
					reactionSets = reactionSets.concat(reactionsList.map(reaction => `pid:${pid}:reaction:${reaction}`));
				}
			} catch (e) {
				console.error(e);
			}
		}

		const reactionSetToUsersMap = await getReactionSetsUidsMap(reactionSets);

		for (const post of data.posts) {
			post.maxReactionsReached = pidToIsMaxReactionsReachedMap.get(post.pid);
			post.reactions = [];

			const reactions = pidToReactionsMap.get(post.pid);
			if (reactions) {
				for (const reaction of reactions) {
					const reactionSet = `pid:${post.pid}:reaction:${reaction}`;
					const uids = reactionSetToUsersMap.get(reactionSet);
					if (Array.isArray(uids)) {
						post.reactions.push({
							pid: post.pid,
							reacted: uids.includes(String(data.uid)),
							reaction,
							reactionImage: parse(reaction),
							reactionCount: uids.length,
						});
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
		const settings = await meta.settings.get('reactions');
		const maximumReactionsPerMessage = settings.maximumReactionsPerMessage || DEFAULT_MAX_EMOTES;

		const mids = data.messages.map(message => message && parseInt(message.mid, 10));
		const allReactionsForMids = await db.getSetsMembers(mids.map(pid => `mid:${pid}:reactions`));

		const midToIsMaxReactionsReachedMap = new Map(); // mid -> IsMaxReactionsReached (boolean)
		const midToReactionsMap = new Map(); // mid -> reactions (string[])
		let reactionSets = [];

		for (let i = 0, len = mids.length; i < len; i++) {
			const mid = mids[i];
			const reactionsList = allReactionsForMids[i];
			const reactionsCount = reactionsList.length;

			if (reactionsList && reactionsList.length > 0) {
				midToReactionsMap.set(mid, reactionsList);
				midToIsMaxReactionsReachedMap.set(mid, reactionsCount > maximumReactionsPerMessage);
				reactionSets = reactionSets.concat(reactionsList.map(reaction => `mid:${mid}:reaction:${reaction}`));
			}
		}

		const reactionSetToUsersMap = await getReactionSetsUidsMap(reactionSets);

		for (const msg of data.messages) {
			msg.maxReactionsReached = midToIsMaxReactionsReachedMap.get(msg.mid);
			msg.reactions = [];
			const reactions = midToReactionsMap.get(msg.mid);
			if (reactions) {
				for (const reaction of reactions) {
					const reactionSet = `mid:${msg.mid}:reaction:${reaction}`;
					const uids = reactionSetToUsersMap.get(reactionSet);
					if (Array.isArray(uids)) {
						msg.reactions.push({
							mid: msg.mid,
							reacted: uids.includes(String(data.uid)),
							reaction,
							reactionImage: parse(reaction),
							reactionCount: uids.length,
						});
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
			reactionImage: parse(data.reaction),
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
			reactionImage: parse(data.reaction),
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

SocketPlugins.reactions = {
	addPostReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!emojiTable[data.reaction]) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const settings = await meta.settings.get('reactions');
		const maximumReactions = settings.maximumReactions || DEFAULT_MAX_EMOTES;
		const [tid, totalReactions, emojiIsAlreadyExist, alreadyReacted, reactionReputation] = await Promise.all([
			posts.getPostField(data.pid, 'tid'),
			db.setCount(`pid:${data.pid}:reactions`),
			db.isSetMember(`pid:${data.pid}:reactions`, data.reaction),
			db.isSetMember(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid),
			getReactionReputation(data.reaction),
		]);
		if (!tid) {
			throw new Error('[[error:no-post]]');
		}
		data.uid = socket.uid;
		data.tid = tid;
		if (!emojiIsAlreadyExist) {
			if (totalReactions > maximumReactions) {
				throw new Error(`[[reactions:error.maximum-reached]] (${maximumReactions})`);
			}

			const maximumReactionsPerUserPerPost = settings.maximumReactionsPerUserPerPost ?
				parseInt(settings.maximumReactionsPerUserPerPost, 10) : 0;
			if (maximumReactionsPerUserPerPost > 0) {
				const emojiesInPost = await db.getSetMembers(`pid:${data.pid}:reactions`);
				const userPostReactions = await db.isMemberOfSets(emojiesInPost.map(emojiName => `pid:${data.pid}:reaction:${emojiName}`), socket.uid);
				const userPostReactionCount = userPostReactions.filter(Boolean).length;
				if (userPostReactionCount > maximumReactionsPerUserPerPost) {
					throw new Error(`[[reactions:error.maximum-per-user-per-post-reached]] (${maximumReactionsPerUserPerPost})`);
				}
			}
		}

		await Promise.all([
			db.setAdd(`pid:${data.pid}:reactions`, data.reaction),
			db.setAdd(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid),
		]);

		if (!alreadyReacted && reactionReputation > 0) {
			await giveOwnerReactionReputation(reactionReputation, data.pid);
		}

		await sendPostEvent(data, 'event:reactions.addPostReaction');
	},
	removePostReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!emojiTable[data.reaction]) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const [tid, hasReacted, reactionReputation] = await Promise.all([
			posts.getPostField(data.pid, 'tid'),
			db.isSetMember(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid),
			getReactionReputation(data.reaction),
		]);
		if (!tid) {
			throw new Error('[[error:no-post]]');
		}
		data.uid = socket.uid;
		data.tid = tid;

		if (hasReacted) {
			await db.setRemove(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid);
		}

		const reactionCount = await db.setCount(`pid:${data.pid}:reaction:${data.reaction}`);
		if (reactionCount === 0) {
			await db.setRemove(`pid:${data.pid}:reactions`, data.reaction);
		}
		if (hasReacted && reactionReputation > 0) {
			await giveOwnerReactionReputation(-reactionReputation, data.pid);
		}

		await sendPostEvent(data, 'event:reactions.removePostReaction');
	},
	addMessageReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!emojiTable[data.reaction]) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const settings = await meta.settings.get('reactions');
		const maximumReactionsPerMessage = settings.maximumReactionsPerMessage || DEFAULT_MAX_EMOTES;
		const [roomId, totalReactions, emojiIsAlreadyExist] = await Promise.all([
			messaging.getMessageField(data.mid, 'roomId'),
			db.setCount(`mid:${data.mid}:reactions`),
			db.isSetMember(`mid:${data.mid}:reactions`, data.reaction),
		]);

		if (!roomId) {
			throw new Error('[[error:no-message]]');
		}

		data.uid = socket.uid;
		data.roomId = roomId;

		if (!emojiIsAlreadyExist) {
			if (totalReactions > maximumReactionsPerMessage) {
				throw new Error(`[[reactions:error.maximum-reached]] (${maximumReactionsPerMessage})`);
			}

			const maximumReactionsPerUserPerMessage = settings.maximumReactionsPerUserPerMessage ?
				parseInt(settings.maximumReactionsPerUserPerMessage, 10) : 0;
			if (maximumReactionsPerUserPerMessage > 0) {
				const emojiesInMessage = await db.getSetMembers(`mid:${data.mid}:reactions`);
				const userPostReactions = await db.isMemberOfSets(emojiesInMessage.map(emojiName => `mid:${data.mid}:reaction:${emojiName}`), socket.uid);
				const userPostReactionCount = userPostReactions.filter(Boolean).length;
				if (userPostReactionCount > maximumReactionsPerUserPerMessage) {
					throw new Error(`[[reactions:error.maximum-per-user-per-post-reached]] (${maximumReactionsPerUserPerMessage})`);
				}
			}
		}

		await Promise.all([
			db.setAdd(`mid:${data.mid}:reactions`, data.reaction),
			db.setAdd(`mid:${data.mid}:reaction:${data.reaction}`, socket.uid),
		]);

		await sendMessageEvent(data, 'event:reactions.addMessageReaction');
	},
	removeMessageReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!emojiTable[data.reaction]) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const [roomId, hasReacted] = await Promise.all([
			messaging.getMessageField(data.mid, 'roomId'),
			db.isSetMember(`mid:${data.mid}:reaction:${data.reaction}`, socket.uid),
		]);
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
		if (!emojiTable[data.reaction]) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}
		let set = '';
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

