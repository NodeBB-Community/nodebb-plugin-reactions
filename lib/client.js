"use strict";

/*globals $, app, utils, socket, templates, config*/

$(document).ready(function () {

	var env = utils.findBootstrapEnvironment();
	setupPostReactions();

	function setupPostReactions() {
		$(window).on('action:ajaxify.end', function (ev, data) {
			if (data.url && data.url.match('^topic/')) {
				setupReactionSockets();
				createReactionTooltips();
				$('[component="topic"]').on('click', '[component="post/reaction"]', function (e) {
					var tid = $('[component="topic"]').attr("data-tid");
					var reactionElement = $(this);
					var pid = reactionElement.attr("data-pid");
					var reaction = reactionElement.attr("data-reaction");
					var reacted = reactionElement.hasClass("reacted");
					var event = 'plugins.reactions.' + (reacted ? 'removePostReaction' : 'addPostReaction');
					socket.emit(event, {
						tid: tid,
						pid: pid,
						reaction: reaction
					}, function (err) {
						if (err) {
							app.alertError(err.message);
						}
					});
				});

				$('[component="topic"]').on('click', '[component="post/reaction/add"]', function (e) {
					var reactionAddEl = $(this);
					var tid = $('[component="topic"]').attr("data-tid");
					var pid = reactionAddEl.attr("data-pid");
					require(['plugin/emoji-extended/composer/modal'], function (modal) {
						modal.open().then(function (item) {
							socket.emit('plugins.reactions.addPostReaction', {
								tid: tid,
								pid: pid,
								reaction: item.id
							}, function (err) {
								if (err) {
									app.alertError(err.message);
								}

								$('[component="post/reaction"][data-pid="' + pid + '"][data-reaction="' + item.id + '"]').addClass("reacted");
							});
						});
					});
				});
			}
		});

		socket.on('event:post_deleted', function (data) {
			$('[component="post/reactions"][data-pid="' + data.pid + '"]').addClass("hidden");
		});

		socket.on('event:post_restored', function (data) {
			$('[component="post/reactions"][data-pid="' + data.pid + '"]').removeClass("hidden");
		});
	}

	function setupReactionSockets() {
		socket.on('event:reactions.addPostReaction', function (data) {
			updateReactionCount(data);
		});

		socket.on('event:reactions.removePostReaction', function (data) {
			updateReactionCount(data);
		});
	}

	function updateReactionCount(data) {
		var maxReactionsReached = parseInt(data.totalReactions, 10) >= config.maximumReactions;
		$('[component="post/reaction/add"][data-pid="' + data.pid + '"]').toggleClass("max-reactions", maxReactionsReached);

		var reactionEl = $('[component="post/reaction"][data-pid="' + data.pid + '"][data-reaction="' + data.reaction + '"]');

		if (parseInt(data.reactionCount, 10) === 0) {
			reactionEl.tooltip('destroy');
			reactionEl.remove();
		}

		if (reactionEl.length === 0) {
			templates.parse('partials/topic/reaction', {
				"posts": {
					"pid": data.pid,
					"reactions": {
						"pid": data.pid,
						"reaction": data.reaction,
						"memberCount": data.reactionCount,
						"usernames": data.usernames,
						"reacted": (parseInt(data.uid, 10) === app.user.uid),
						"reactionImage": data.reactionImage
					}
				}
			}, function (html) {
				$('[component="post/reactions"][data-pid="' + data.pid + '"]').append(html);
			});
		} else {
			reactionEl.find(".reaction-emoji-count").attr("data-count", data.reactionCount);
			reactionEl.attr("data-original-title", data.usernames);
			reactionEl.toggleClass("reacted", !(parseInt(data.uid, 10) === app.user.uid));
		}
	}

	function createReactionTooltips() {
		$('.reaction, .reaction-add').each(function () {
			if (!utils.isTouchDevice()) {
				$(this).tooltip({
					placement: 'top',
					title: $(this).attr('title')
				});
			}
		});
	}
});
