'use strict';

/* globals nodebb, describe, it, before, after, beforeEach */

const assert = require('assert');
const util = require('util');

const sleep = util.promisify(setTimeout);

const db = nodebb.require('./test/mocks/databasemock');
const nconf = nodebb.require('nconf');
const meta = nodebb.require('./src/meta');
const install = nodebb.require('./src/install');
const user = nodebb.require('./src/user');
const categories = nodebb.require('./src/categories');
const topics = nodebb.require('./src/topics');
const posts = nodebb.require('./src/posts');
const privileges = nodebb.require('./src/privileges');
const controllers = nodebb.require('./src/controllers');
const activitypub = nodebb.require('./src/activitypub');
const utils = nodebb.require('./src/utils');
const SocketPlugins = nodebb.require('./src/socket.io/plugins');
const apHelpers = nodebb.require('./test/activitypub/helpers');

const plugin = require('../library');
const helpers = require('../helpers');

describe('helpers.resolveReaction', () => {
	it('should resolve a unicode grapheme', () => {
		assert.strictEqual(helpers.resolveReaction('🔥'), 'fire');
	});

	it('should resolve a :shortcode:', () => {
		assert.strictEqual(helpers.resolveReaction(':fire:'), 'fire');
	});

	it('should resolve a bare name', () => {
		assert.strictEqual(helpers.resolveReaction('fire'), 'fire');
	});

	it('should resolve an aliased :shortcode:', () => {
		assert.strictEqual(helpers.resolveReaction(':telephone:'), 'phone');
	});

	it('should resolve the character of an aliased emoji', () => {
		assert.strictEqual(helpers.resolveReaction('☎'), 'phone');
	});

	it('should resolve a keycap with a variation selector', () => {
		assert.strictEqual(helpers.resolveReaction('1️⃣'), 'one'); // "1" + U+FE0F + U+20E3
	});

	it('should resolve a keycap without a variation selector', () => {
		assert.strictEqual(helpers.resolveReaction('1⃣'), 'one'); // "1" + U+20E3
	});

	it('should resolve by first codepoint when the full grapheme is not in the table', () => {
		// waving hand + medium-light skin tone → wave
		assert.strictEqual(helpers.resolveReaction('👋🏻'), 'wave');
	});

	it('should resolve a custom emoji tag that matches a local emoji', () => {
		assert.strictEqual(helpers.resolveReaction(':blobwtf:', [{ type: 'Emoji', name: ':fire:' }]), 'fire');
	});

	it('should return null for a custom emoji tag that does not match locally', () => {
		assert.strictEqual(helpers.resolveReaction(':blobwtf:', [{ type: 'Emoji', name: ':blobwtf:' }]), null);
	});

	it('should return null for unresolvable content', () => {
		assert.strictEqual(helpers.resolveReaction(':nope:'), null);
		assert.strictEqual(helpers.resolveReaction('🛸'), null);
		assert.strictEqual(helpers.resolveReaction('blobwtf'), null);
		assert.strictEqual(helpers.resolveReaction(''), null);
		assert.strictEqual(helpers.resolveReaction(null), null);
	});
});

describe('ActivityPub (FEP-c0e0)', () => {
	const remoteActor = 'https://example.org/user/reactions-tester';
	const defaultSettings = {
		enablePostReactions: 'on',
		'reaction-reputations': [{ reaction: 'fire', reputation: 5 }],
	};

	let apEnabled;
	let cid;
	let ownerUid;
	let postData;

	before(async () => {
		apEnabled = meta.config.activitypubEnabled;
		meta.config.activitypubEnabled = 1;
		nconf.set('runJobs', 1);
		await install.giveWorldPrivileges();
		await meta.settings.set('reactions', defaultSettings);
		({ cid } = await categories.create({ name: utils.generateUUID().slice(0, 8) }));
	});

	after(async () => {
		meta.config.activitypubEnabled = apEnabled;
		nconf.set('runJobs', undefined);
		await meta.settings.set('reactions', defaultSettings);
	});

	beforeEach(async () => {
		ownerUid = await user.create({ username: utils.generateUUID().slice(0, 10) });
		({ postData } = await topics.post({
			uid: ownerUid,
			cid,
			title: utils.generateUUID(),
			content: utils.generateUUID(),
		}));
	});

	function reactionActivity(override = {}) {
		const activity = {
			'@context': 'https://www.w3.org/ns/activitystreams',
			id: `https://example.org/activity/${utils.generateUUID()}`,
			type: 'EmojiReact',
			actor: remoteActor,
			object: {
				type: 'Note',
				id: `${nconf.get('url')}/post/${postData.pid}`,
			},
			content: '🔥',
		};
		Object.assign(activity, override);
		return activity;
	}

	function mockRes() {
		const res = { req: { method: 'POST', loggedIn: false }, statusCode: null, payload: null };
		res.set = (key, value) => {
			res[key] = value;
		};
		res.status = (code) => {
			res.statusCode = code;
			return res;
		};
		res.json = (payload) => {
			res.payload = payload;
			return res;
		};
		res.sendStatus = (code) => {
			res.statusCode = code;
		};
		return res;
	}

	it('should still ignore unknown activity types (200) when the plugin is installed', async () => {
		const res = mockRes();
		await controllers.activitypub.postInbox({
			body: {
				id: `https://example.org/activity/${utils.generateUUID()}`,
				type: 'BlowAWhistle',
				actor: remoteActor,
				object: { id: `${nconf.get('url')}/post/${postData.pid}` },
			},
		}, res);

		assert.strictEqual(res.statusCode, 200);
	});

	describe('EmojiReact', () => {
		it('should store a reaction from a unicode grapheme on a local post', async () => {
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: reactionActivity() }, res);

			assert.strictEqual(res.statusCode, 202);
			assert(await db.isSetMember(`pid:${postData.pid}:reactions`, 'fire'));
			assert(await db.isSetMember(`pid:${postData.pid}:reaction:fire`, remoteActor));
		});

		it('should store a reaction from a :shortcode:', async () => {
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: reactionActivity({ content: ':fire:' }) }, res);

			assert.strictEqual(res.statusCode, 202);
			assert(await db.isSetMember(`pid:${postData.pid}:reactions`, 'fire'));
		});

		it('should notify the post owner', async () => {
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: reactionActivity() }, res);

			// notifications.push is deferred (500ms) through the batch queue
			await sleep(700);
			const nid = `uid:${remoteActor}:pid:${postData.pid}:reaction:fire`;
			assert(await db.isSortedSetMember(`uid:${ownerUid}:notifications:unread`, nid));
		});

		it('should grant reaction reputation only once per reactor', async () => {
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: reactionActivity() }, res);
			await controllers.activitypub.postInbox({ body: reactionActivity() }, res);

			assert.strictEqual(parseInt(await user.getUserField(ownerUid, 'reputation'), 10), 5);
			assert.strictEqual(await db.setCount(`pid:${postData.pid}:reaction:fire`), 1);
		});

		it('should not upvote the post', async () => {
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: reactionActivity() }, res);

			const { upvoted } = await posts.hasVoted(postData.pid, remoteActor);
			assert.strictEqual(upvoted, false);
			assert.strictEqual(await posts.getPostField(postData.pid, 'upvotes'), 0);
		});

		it('should ignore unresolvable custom emoji', async () => {
			const res = mockRes();
			await controllers.activitypub.postInbox({
				body: reactionActivity({
					content: ':blobwtf:',
					tag: [{ type: 'Emoji', name: ':blobwtf:' }],
				}),
			}, res);

			assert.strictEqual(res.statusCode, 202);
			assert.strictEqual(await db.setCount(`pid:${postData.pid}:reactions`), 0);
		});

		describe('with posts:upvote revoked from the fediverse pseudo-user', () => {
			before(async () => {
				await privileges.categories.rescind(['groups:posts:upvote'], cid, 'fediverse');
			});

			after(async () => {
				await privileges.categories.give(['groups:posts:upvote'], cid, 'fediverse');
			});

			it('should throw [[error:no-privileges]]', async () => {
				try {
					await plugin.applyEmojiReact(reactionActivity());
					assert.fail('expected applyEmojiReact to throw');
				} catch (e) {
					assert.strictEqual(e.message, '[[error:no-privileges]]');
				}
			});
		});
	});

	describe('Like with content', () => {
		it('should store a reaction, not an upvote', async () => {
			const res = mockRes();
			await controllers.activitypub.postInbox({
				body: { ...reactionActivity({ type: 'Like' }) },
			}, res);

			assert.strictEqual(res.statusCode, 202);
			assert(await db.isSetMember(`pid:${postData.pid}:reactions`, 'fire'));
			const { upvoted } = await posts.hasVoted(postData.pid, remoteActor);
			assert.strictEqual(upvoted, false);
		});
	});

	describe('Undo', () => {
		async function react() {
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: reactionActivity() }, res);
			assert.strictEqual(res.statusCode, 202);
		}

		it('should remove an EmojiReact reaction', async () => {
			await react();
			const original = reactionActivity();

			const res = mockRes();
			await controllers.activitypub.postInbox({
				body: {
					id: `https://example.org/activity/${utils.generateUUID()}`,
					type: 'Undo',
					actor: remoteActor,
					object: original,
				},
			}, res);

			assert.strictEqual(res.statusCode, 202);
			assert(!(await db.isSetMember(`pid:${postData.pid}:reactions`, 'fire')));
			assert(!(await db.isSetMember(`pid:${postData.pid}:reaction:fire`, remoteActor)));
		});

		it('should rescind the post owner notification', async () => {
			await react();
			await sleep(700);
			const nid = `uid:${remoteActor}:pid:${postData.pid}:reaction:fire`;
			assert(await db.isSortedSetMember(`uid:${ownerUid}:notifications:unread`, nid));

			const res = mockRes();
			await controllers.activitypub.postInbox({
				body: {
					id: `https://example.org/activity/${utils.generateUUID()}`,
					type: 'Undo',
					actor: remoteActor,
					object: reactionActivity(),
				},
			}, res);

			// the notification object is deleted (stale entries are pruned lazily)
			assert(!(await db.exists(`notifications:${nid}`)));
			assert(!(await db.isSortedSetMember('notifications', nid)));
		});

		it('should remove a Like-with-content reaction without touching the vote', async () => {
			const like = { ...reactionActivity({ type: 'Like' }) };
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: like }, res);
			assert.strictEqual(res.statusCode, 202);

			const undoRes = mockRes();
			await controllers.activitypub.postInbox({
				body: {
					id: `https://example.org/activity/${utils.generateUUID()}`,
					type: 'Undo',
					actor: remoteActor,
					object: like,
				},
			}, undoRes);

			assert.strictEqual(undoRes.statusCode, 202);
			assert(!(await db.isSetMember(`pid:${postData.pid}:reactions`, 'fire')));
			assert.strictEqual(await posts.getPostField(postData.pid, 'upvotes'), 0);
		});

		it('should not claim undos of plain activities (core handles them)', async () => {
			// plain Like (no content) → core upvotes
			const plainLike = {
				id: `https://example.org/activity/${utils.generateUUID()}`,
				type: 'Like',
				actor: remoteActor,
				object: { type: 'Note', id: `${nconf.get('url')}/post/${postData.pid}` },
			};
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: plainLike }, res);
			assert.strictEqual(res.statusCode, 202);
			const { upvoted } = await posts.hasVoted(postData.pid, remoteActor);
			assert.strictEqual(upvoted, true);

			// plain Undo(Like) → core unvotes
			const undoRes = mockRes();
			await controllers.activitypub.postInbox({
				body: {
					id: `https://example.org/activity/${utils.generateUUID()}`,
					type: 'Undo',
					actor: remoteActor,
					object: plainLike,
				},
			}, undoRes);
			assert.strictEqual(undoRes.statusCode, 202);
			const { upvoted: stillUpvoted } = await posts.hasVoted(postData.pid, remoteActor);
			assert.strictEqual(stillUpvoted, false);
		});
	});

	describe('Announce', () => {
		let remoteCid;
		let remotePostId;
		let emojiReact;

		before(async function () {
			({ id: remoteCid } = apHelpers.mocks.group());
			await activitypub.actors.assertGroup([remoteCid]);

			// A remote post that lands in the remote category
			const { note, id } = apHelpers.mocks.note({ audience: [remoteCid] });
			const { activity } = apHelpers.mocks.create(note);
			await activitypub.inbox.create({ body: activity });
			this.remotePostId = id;
			remotePostId = id;

			emojiReact = {
				id: `https://example.org/activity/${utils.generateUUID()}`,
				type: 'EmojiReact',
				actor: remoteActor,
				object: { type: 'Note', id },
				content: '🔥',
			};
		});

		it('should ignore EmojiReact announces from non-category, non-relay actors', async () => {
			const { activity } = apHelpers.mocks.announce({ actor: remoteActor, object: emojiReact });
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: activity }, res);

			// falls through to core's announce handler, which also does nothing for this
			assert.strictEqual(res.statusCode, 202);
			assert.strictEqual(await db.setCount(`pid:${remotePostId}:reactions`), 0);
		});

		it('should apply a reaction announced by the remote category', async () => {
			const { activity } = apHelpers.mocks.announce({ actor: remoteCid, object: emojiReact });
			const res = mockRes();
			await controllers.activitypub.postInbox({ body: activity }, res);

			assert.strictEqual(res.statusCode, 202);
			assert(await db.isSetMember(`pid:${remotePostId}:reactions`, 'fire'));
			assert(await db.isSetMember(`pid:${remotePostId}:reaction:fire`, remoteActor));
		});
	});
});

describe('Socket handlers', () => {
	const defaultSettings = {
		enablePostReactions: 'on',
		'reaction-reputations': [{ reaction: 'fire', reputation: 5 }],
	};

	let cid;
	let uid;
	let postData;

	before(async () => {
		({ cid } = await categories.create({ name: utils.generateUUID().slice(0, 8) }));
		await meta.settings.set('reactions', defaultSettings);
	});

	after(async () => {
		await meta.settings.set('reactions', defaultSettings);
	});

	beforeEach(async () => {
		uid = await user.create({ username: utils.generateUUID().slice(0, 10) });
		({ postData } = await topics.post({
			uid,
			cid,
			title: utils.generateUUID(),
			content: utils.generateUUID(),
		}));
	});

	it('should add a reaction', async () => {
		await SocketPlugins.reactions.addPostReaction({ uid }, { pid: postData.pid, reaction: 'fire' });
		assert(await db.isSetMember(`pid:${postData.pid}:reaction:fire`, uid));
	});

	it('should require a logged-in socket', async () => {
		try {
			await SocketPlugins.reactions.addPostReaction({}, { pid: postData.pid, reaction: 'fire' });
			assert.fail('expected addPostReaction to throw');
		} catch (e) {
			assert.strictEqual(e.message, '[[error:not-logged-in]]');
		}
	});

	it('should reject unknown reaction names', async () => {
		try {
			await SocketPlugins.reactions.addPostReaction({ uid }, { pid: postData.pid, reaction: 'notarealemoji' });
			assert.fail('expected addPostReaction to throw');
		} catch (e) {
			assert.strictEqual(e.message, '[[reactions:error.invalid-reaction]]');
		}
	});

	it('should remove a reaction', async () => {
		await SocketPlugins.reactions.addPostReaction({ uid }, { pid: postData.pid, reaction: 'fire' });
		await SocketPlugins.reactions.removePostReaction({ uid }, { pid: postData.pid, reaction: 'fire' });
		assert(!(await db.isSetMember(`pid:${postData.pid}:reaction:fire`, uid)));
		assert(!(await db.isSetMember(`pid:${postData.pid}:reactions`, 'fire')));
	});

	it('should enforce the maximumReactions cap', async () => {
		await meta.settings.set('reactions', { ...defaultSettings, maximumReactions: '2' });
		await SocketPlugins.reactions.addPostReaction({ uid }, { pid: postData.pid, reaction: 'fire' });
		await SocketPlugins.reactions.addPostReaction({ uid }, { pid: postData.pid, reaction: 'phone' });
		try {
			await SocketPlugins.reactions.addPostReaction({ uid }, { pid: postData.pid, reaction: 'smile' });
			assert.fail('expected addPostReaction to throw');
		} catch (e) {
			assert(e.message.startsWith('[[reactions:error.maximum-reached, '));
		}
	});

	it('should throw when post reactions are disabled', async () => {
		await meta.settings.set('reactions', { ...defaultSettings, enablePostReactions: 'off' });
		try {
			await SocketPlugins.reactions.addPostReaction({ uid }, { pid: postData.pid, reaction: 'fire' });
			assert.fail('expected addPostReaction to throw');
		} catch (e) {
			assert.strictEqual(e.message, '[[error:post-reactions-disabled]]');
		}
	});
});
