"use strict";

var meta = module.parent.require('./meta');
var user = module.parent.require('./user');
var db = module.parent.require('./database');
var SocketPlugins = module.parent.require('./socket.io/plugins');
var websockets = module.parent.require('./socket.io/index');
var async = require('async');
var emojiParser = require('nodebb-plugin-emoji/build/lib/parse');
var emojiTable = require('nodebb-plugin-emoji/build/emoji/table.json');
var emojiAliases = require('nodebb-plugin-emoji/build/emoji/aliases.json');
var reactions = {};

function parse(name) {
	return emojiParser.buildEmoji(emojiTable[name] || emojiTable[emojiAliases[name]], '');
}

reactions.init = function (params, callback) {

	SocketPlugins.reactions = {
		addPostReaction: function (socket, data, callback) {
			if (!socket.uid) {
				return callback(new Error('[[error:not-logged-in]]'));
			}


			if (!emojiTable[data.reaction]) {
				return callback(new Error('Invalid reaction'));
			}

			data.uid = socket.uid;
			meta.settings.get('reactions', function (err, settings) {
				var maximumReactions = settings.maximumReactions || 5;

				async.series({
					totalReactions: function (next) {
						db.setCount('pid:' + data.pid + ':reactions', next);
					},
					isMember: function (next) {
						db.isSetMember('pid:' + data.pid + ':reactions', data.reaction, next);
					}
				}, function (err, results) {
					if (!results.isMember && results.totalReactions >= maximumReactions) {
						callback(new Error('Maximum reactions reached'));
					} else {
						db.setAdd('pid:' + data.pid + ':reactions', data.reaction, function (err) {
							db.setAdd('pid:' + data.pid + ':reaction:' + data.reaction, socket.uid, function (err) {
								sendEvent(data, 'event:reactions.addPostReaction', callback);
							});
						});
					}
				});
			});
		},
		removePostReaction: function (socket, data, callback) {
			if (!socket.uid) {
				return callback(new Error('[[error:not-logged-in]]'));
			}

			if (!emojiTable[data.reaction]) {
				return callback(new Error('Invalid reaction'));
			}

			data.uid = socket.uid;
			db.setRemove('pid:' + data.pid + ':reaction:' + data.reaction, socket.uid, function (err) {
				db.setCount('pid:' + data.pid + ':reaction:' + data.reaction, function (err, reactionCount) {
					if (reactionCount === 0) {
						db.setRemove('pid:' + data.pid + ':reactions', data.reaction, function (err) {
							sendEvent(data, 'event:reactions.removePostReaction', callback);
						});
					} else {
						sendEvent(data, 'event:reactions.removePostReaction', callback);
					}
				});
			});
		}
	};

	function sendEvent(data, eventName, callback) {
		async.series({
			reactionCount: function (next) {
				db.setCount('pid:' + data.pid + ':reaction:' + data.reaction, next);
			},
			totalReactions: function (next) {
				db.setCount('pid:' + data.pid + ':reactions', next);
			},
			usernames: function (next) {
				db.getSetMembers('pid:' + data.pid + ':reaction:' + data.reaction, function (err, uids) {
					user.getUsersFields(uids, ['uid', 'username'], function (err, userdata) {
						next(null, userdata.map(function (user) {
							return user.username
						}).join(', '));
					});
				});
			}
		}, function (err, results) {
			if (parseInt(results.reactionCount, 10) === 0) {
				db.setRemove('pid:' + data.pid + ':reactions', data.reaction, function (err) {
					if (err) {
						callback(err);
					}
				});
			}
			websockets.in('topic_' + data.tid).emit(eventName, {
				pid: data.pid,
				uid: data.uid,
				reaction: data.reaction,
				reactionCount: results.reactionCount,
				totalReactions: results.totalReactions,
				usernames: results.usernames,
				reactionImage: parse(data.reaction),
			});
			callback();
		});
	}

	params.router.get('/admin/plugins/reactions', params.middleware.admin.buildHeader, renderAdmin);
	params.router.get('/api/admin/plugins/reactions', renderAdmin);

	callback();
};

reactions.addAdminNavigation = function (header, callback) {
	header.plugins.push({
		route: '/plugins/reactions',
		icon: 'fa-paint-brush',
		name: 'Reactions'
	});

	callback(null, header);
};

reactions.getPluginConfig = function (config, callback) {
	meta.settings.get('reactions', function (err, settings) {
		config.maximumReactions = settings.maximumReactions ? parseInt(settings.maximumReactions, 10) : 5;
	});

	callback(false, config);
};

reactions.getReactions = function (data, callback) {
	if (data.uid === 0) {
		callback(null, data);
	} else {
		async.eachSeries(data.posts, function (post, next) {

			async.series({
				maximumReactions: function (cb) {
					meta.settings.get('reactions', function (err, settings) {
						var maximumReactions = settings.maximumReactions || 5;
						cb(null, maximumReactions);
					});
				},
				totalReactions: function (cb) {
					db.setCount('pid:' + post.pid + ':reactions', cb);
				},
				reactions: function (cb) {
					async.waterfall([
						function (callback) {
							db.getSetMembers('pid:' + post.pid + ":reactions", function (err, reactions) {
								callback(null, reactions);
							});
						},
						function (reactions, callback) {
							var reactionData = [];

							async.each(reactions, function (reaction, next) {
								db.getSetMembers('pid:' + post.pid + ':reaction:' + reaction, function (err, uids) {
									user.getUsersFields(uids, ['uid', 'username'], function (err, userdata) {
										reactionData.push({
											reaction,
											userdata,
											memberCount: uids.length,
											reacted: uids.indexOf(data.uid.toString()) >= 0
										});
										next();
									});
								});
							}, function (err) {
								callback(null, reactionData);
							});
						},
						function (uidData, callback) {
							callback(null, uidData);
						}
					], function (err, result) {
						cb(null, result);
					});
				}
			}, function (err, results) {
				var reactionInfo = '<span class="reactions" component="post/reactions" data-pid="' + post.pid + '">';
				var maxReactionsReached = results.totalReactions >= results.maximumReactions ? ' max-reactions' : '';
				reactionInfo = reactionInfo + '<span class="reaction-add' + maxReactionsReached + '" component="post/reaction/add" data-pid="' + post.pid + '" title="Add reaction"><i class="fa fa-plus-square-o"></i></span>';

				results.reactions.forEach(function (reaction, index) {
					var usernames = reaction.userdata.map(function (user) {
						return user.username
					}).join(', ');

					var reactionImage = parse(reaction.reaction);
					var reacted = reaction.reacted ? 'reacted' : '';
					reactionInfo = reactionInfo + '<span class="reaction ' + reacted + '" component="post/reaction" data-pid="' + post.pid + '" data-reaction="' + reaction.reaction + '" title="' + usernames + '">' + reactionImage + '<span class="reaction-emoji-count" data-count="' + reaction.memberCount + '"></span></span>';
				});

				post.reactions = reactionInfo + '</span>';
				next();
			});
		}, function (err) {
			if (err) {
				console.log(err.message);
			}
			callback(null, data);
		});
	}
}

reactions.onReply = function (data, callback) {
	if (data.uid !== 0) {
		var reactionInfo = '<span class="reactions" component="post/reactions" data-pid="' + data.pid + '">';
		reactionInfo = reactionInfo + '<span class="reaction-add" component="post/reaction/add" data-pid="' + data.pid + '" title="Add reaction"><i class="fa fa-plus-square-o"></i></span>';
		data.reactions = reactionInfo + '</span>';
	}
	callback(null, data);
}

reactions.deleteReactions = function (pid) {
	db.getSetMembers('pid:' + pid + ":reactions", function (err, reactions) {
		if (reactions.length > 0) {
			async.waterfall([
				function (callback) {
					var keys = reactions.map(function (reaction) {
						return 'pid:' + pid + ':reaction:' + reaction;
					});
					callback(null, keys);
				},
				function (keys, callback) {
					db.deleteAll(keys, callback);
				},
				function (callback) {
					db.deleteAll(['pid:' + pid + ':reactions'], callback);
				}
			], function (err) {
				if (err) {
					console.log(err.message);
				}
			});
		}
	});
}

function renderAdmin(req, res, next) {
	res.render('admin/plugins/reactions', {});
}

module.exports = reactions;
