"use strict";

const _ = require.main.require('lodash');
const meta = require.main.require('./src/meta');
const user = require.main.require('./src/user');
const db = require.main.require('./src/database');
const SocketPlugins = require.main.require('./src/socket.io/plugins');
const websockets = require.main.require('./src/socket.io/index');

const emojiParser = require.main.require('nodebb-plugin-emoji/build/lib/parse.js');
const emojiTable = require.main.require('nodebb-plugin-emoji/build/emoji/table.json');
const emojiAliases = require.main.require('nodebb-plugin-emoji/build/emoji/aliases.json');

const DEFAULT_MAX_EMOTES = 5;

function parse(name) {
	return emojiParser.buildEmoji(emojiTable[name] || emojiTable[emojiAliases[name]], '');
}

const ReactionsPlugin = {};

ReactionsPlugin.init = async function (params) {

	function renderAdmin(_, res) {
		res.render('admin/plugins/reactions', {});
	}

	params.router.get('/admin/plugins/reactions', params.middleware.admin.buildHeader, renderAdmin);
	params.router.get('/api/admin/plugins/reactions', renderAdmin);
};

ReactionsPlugin.addAdminNavigation = async function (header) {
	header.plugins.push({
		route: '/plugins/reactions',
		icon: 'fa-paint-brush',
		name: '[[reactions:reactions]]'
	});
	return header;
};

ReactionsPlugin.getPluginConfig = async function (config) {
	try {
		const settings = await meta.settings.get('reactions');
		config.maximumReactions = settings.maximumReactions ? parseInt(settings.maximumReactions, 10) : DEFAULT_MAX_EMOTES;
	} finally {
		return config;
	}
};

ReactionsPlugin.getReactions = async function (data) {

	if (data.uid === 0) {
		return data;
	}

	try {
		const settings = await meta.settings.get('reactions');
		const maximumReactions = settings.maximumReactions || DEFAULT_MAX_EMOTES;

		const pids = data.posts.map(post => parseInt(post.pid, 10));
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
					pidToIsMaxReactionsReachedMap.set(pid, reactionsCount >= maximumReactions);
					reactionSets = reactionSets.concat(reactionsList.map(reaction => `pid:${pid}:reaction:${reaction}`));
				}
			} catch (e) {
				console.error(e);
			}
		}

		const reactionSetToUsersMap = new Map(); // reactionSet -> { uid, username }
		if (reactionSets.length > 0) {
			const uidsForReactions = await db.getSetsMembers(reactionSets);
			const allUids = _.union(...uidsForReactions).filter(Boolean);
			const usersData = await user.getUsersFields(allUids, ['uid', 'username']);
			const uidToUserdataMap = _.keyBy(usersData, 'uid');

			for (let i = 0, len = reactionSets.length; i < len; i++) {
				const uidsForReaction = uidsForReactions[i];
				if (uidsForReaction && uidsForReaction.length > 0) {
					const usersData = uidsForReaction.map(uid => uidToUserdataMap[uid]).filter(Boolean);
					reactionSetToUsersMap.set(reactionSets[i], usersData);
				}
			}
		}

		for (const post of data.posts) {

			post.maxReactionsReached = pidToIsMaxReactionsReachedMap.get(post.pid);
			post.reactions = [];

			if (!pidToReactionsMap.has(post.pid)) {
				continue;
			}

			for (const reaction of pidToReactionsMap.get(post.pid)) {

				const reactionSet = `pid:${post.pid}:reaction:${reaction}`;
				if (!reactionSetToUsersMap.has(reactionSet)) {
					continue;
				}

				const usersData = reactionSetToUsersMap.get(reactionSet);
				const reactionCount = usersData.length;
				const reactedUsernames = usersData.map(userData => userData.username).join(', ');
				const reactedUids = usersData.map(userData => userData.uid)

				post.reactions.push({
					pid: post.pid,
					reacted: reactedUids.includes(data.uid),
					reaction,
					usernames: reactedUsernames,
					reactionImage: parse(reaction),
					reactionCount,
				});
			}
		}
	} catch (e) {
		console.error(e);
	} finally {
		return data;
	}
}

ReactionsPlugin.onReply = async function (data) {
	if (data.uid !== 0) {
		data.reactions = [];
	}
	return data;
}

ReactionsPlugin.deleteReactions = async function (pid) {

	const reactions = await db.getSetMembers(`pid:${pid}:reactions`);
	if (reactions.length > 0) {
		return;
	}

	const keys = [
		...reactions.map(reaction => `pid:${pid}:reaction:${reaction}`),
		`pid:${pid}:reactions`,
	];
	try {
		await db.deleteAll(keys);
	} catch (e) {
		console.error(e);
	}
}

async function sendEvent(data, eventName) {

	try {
		const [reactionCount, totalReactions, uids] = await Promise.all([
			db.setCount(`pid:${data.pid}:reaction:${data.reaction}`),
			db.setCount(`pid:${data.pid}:reactions`),
			db.getSetMembers(`pid:${data.pid}:reaction:${data.reaction}`)
		]);

		const userdata = await user.getUsersFields(uids, ['uid', 'username']);
		const usernames = userdata.map(user => user.username).join(', ');

		if (parseInt(reactionCount, 10) === 0) {
			await db.setRemove(`pid:${data.pid}:reactions`, data.reaction);
		}

		await websockets.in('topic_' + data.tid).emit(eventName, {
			pid: data.pid,
			uid: data.uid,
			reaction: data.reaction,
			reactionCount,
			totalReactions,
			usernames,
			reactionImage: parse(data.reaction),
		});
	} catch (e) {
		console.error(e);
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

		data.uid = socket.uid;

		try {
			const settings = await meta.settings.get('reactions');
			const maximumReactions = settings.maximumReactions || DEFAULT_MAX_EMOTES;

			const [totalReactions, isMember] = await Promise.all([
				db.setCount(`pid:${data.pid}:reactions`),
				db.isSetMember(`pid:${data.pid}:reactions`, data.reaction)
			]);

			if (!isMember && totalReactions >= maximumReactions) {
				throw new Error('[[reactions:error.maximum-reached]]');
			}

			await Promise.all([
				db.setAdd('pid:' + data.pid + ':reactions', data.reaction),
				db.setAdd('pid:' + data.pid + ':reaction:' + data.reaction, socket.uid)
			]);

			await sendEvent(data, 'event:reactions.addPostReaction');
		} catch (e) {
			console.error(e);
		}
	},
	removePostReaction: async function (socket, data) {

		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!emojiTable[data.reaction]) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		data.uid = socket.uid;

		try {
			await db.setRemove(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid);

			const reactionCount = await db.setCount('pid:' + data.pid + ':reaction:' + data.reaction);
			if (reactionCount === 0) {
				await db.setRemove(`pid:${data.pid}:reactions`, data.reaction);
			}

			await sendEvent(data, 'event:reactions.removePostReaction');
		} catch (e) {
			console.error(e);
		}
	}
};


module.exports = ReactionsPlugin;
