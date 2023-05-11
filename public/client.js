'use strict';

$(document).ready(function () {
	setupPostReactions();

	function setupPostReactions() {
		require(['hooks', 'alerts'], function (hooks, alerts) {
			hooks.on('action:ajaxify.end', function () {
				if (ajaxify.data.template.topic) {
					setupReactionSockets();
					createReactionTooltips();
					$('[component="topic"]').on('click', '[component="post/reaction"]', function () {
						var tid = $('[component="topic"]').attr('data-tid');
						var reactionElement = $(this);
						var pid = reactionElement.attr('data-pid');
						var reaction = reactionElement.attr('data-reaction');
						var reacted = reactionElement.hasClass('reacted');
						var event = 'plugins.reactions.' + (reacted ? 'removePostReaction' : 'addPostReaction');
						socket.emit(event, {
							tid: tid,
							pid: pid,
							reaction: reaction,
						}, function (err) {
							if (err) {
								alerts.error(err.message);
							}
						});
					});

					$('[component="topic"]').on('click', '[component="post/reaction/add"]', function () {
						var reactionAddEl = $(this);
						var tid = $('[component="topic"]').attr('data-tid');
						var pid = reactionAddEl.attr('data-pid');
						require(['emoji-dialog'], function (emojiDialog) {
							emojiDialog.toggle(reactionAddEl[0], function (_, name, dialog) {
								emojiDialog.dialogActions.close(dialog);

								socket.emit('plugins.reactions.addPostReaction', {
									tid: tid,
									pid: pid,
									reaction: name,
								}, function (err) {
									if (err) {
										alerts.error(err.message);
										throw err;
									}

									$('[component="post/reaction"][data-pid="' + pid + '"][data-reaction="' + name + '"]').addClass('reacted');
								});
							});
						});
					});
				}
			});
		});

		socket.on('event:post_deleted', function (data) {
			$('[component="post/reactions"][data-pid="' + data.pid + '"]').addClass('hidden');
		});

		socket.on('event:post_restored', function (data) {
			$('[component="post/reactions"][data-pid="' + data.pid + '"]').removeClass('hidden');
		});
	}

	function setupReactionSockets() {
		socket.off('event:reactions.addPostReaction').on('event:reactions.addPostReaction', function (data) {
			updateReactionCount(data);
		});

		socket.off('event:reactions.removePostReaction').on('event:reactions.removePostReaction', function (data) {
			updateReactionCount(data);
		});
	}

	function updateReactionCount(data) {
		var maxReactionsReached = parseInt(data.totalReactions, 10) > config.maximumReactions;
		$('[component="post/reaction/add"][data-pid="' + data.pid + '"]').toggleClass('max-reactions', maxReactionsReached);

		var reactionEl = $(`[component="post/reaction"][data-pid="${data.pid}"][data-reaction="${data.reaction}"]`);

		if (parseInt(data.reactionCount, 10) === 0) {
			reactionEl.tooltip('dispose');
			reactionEl.remove();
		}

		if (reactionEl.length === 0) {
			app.parseAndTranslate('partials/topic/reaction', {
				pid: data.pid,
				reaction: data.reaction,
				reactionCount: data.reactionCount,
				usernames: data.usernames,
				reacted: (parseInt(data.uid, 10) === app.user.uid),
				reactionImage: data.reactionImage,
			}, function (html) {
				$('[component="post/reactions"][data-pid="' + data.pid + '"]').append(html);
			});
		} else {
			reactionEl.find('.reaction-emoji-count').attr('data-count', data.reactionCount);
			reactionEl.attr('data-bs-original-title', data.usernames);
			reactionEl.attr('aria-label', data.usernames);
			reactionEl.toggleClass('reacted', !(parseInt(data.uid, 10) === app.user.uid));
		}
		createReactionTooltips();
	}

	function createReactionTooltips() {
		$('.reaction, .reaction-add').each(function () {
			if (!utils.isTouchDevice()) {
				$(this).tooltip('dispose');
				$(this).tooltip({
					placement: 'top',
					title: $(this).attr('title') || $(this).attr('data-bs-original-title'),
				});
			}
		});
	}
});
