'use strict';

$(document).ready(function () {
	setupReactions();
	let alerts;
	let mouseOverReactionEl;
	let tooltipTimeoutId = 0;
	function setupReactions() {
		createReactionTooltips();
		require(['hooks', 'alerts'], function (hooks, _alerts) {
			alerts = _alerts;
			hooks.on('action:ajaxify.end', function () {
				if (ajaxify.data.template.topic) {
					setupPostReactions();
				}
			});
			// switchChat uses action:chat.loaded and not action:ajaxify.end
			hooks.on('action:chat.loaded', function () {
				if (ajaxify.data.template.chats && ajaxify.data.roomId) {
					setupMessageReactions();
				}
			});
		});

		socket.on('event:post_deleted', function (data) {
			$('[component="post/reactions"][data-pid="' + data.pid + '"]').addClass('hidden');
		});

		socket.on('event:post_restored', function (data) {
			$('[component="post/reactions"][data-pid="' + data.pid + '"]').removeClass('hidden');
		});

		socket.on('event:chats.delete', function (mid) {
			$('[component="message/reactions"][data-mid="' + mid + '"]').addClass('hidden');
		});

		socket.on('event:chats.restore', function (msg) {
			$('[component="message/reactions"][data-mid="' + msg.mid + '"]').removeClass('hidden');
		});
	}

	function setupPostReactions() {
		setupPostReactionSockets();

		$('[component="topic"]').on('click', '[component="post/reaction"]', function () {
			var reactionElement = $(this);
			var pid = reactionElement.attr('data-pid');
			var reaction = reactionElement.attr('data-reaction');
			var reacted = reactionElement.hasClass('reacted');
			var event = 'plugins.reactions.' + (reacted ? 'removePostReaction' : 'addPostReaction');
			socket.emit(event, {
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
			var pid = reactionAddEl.attr('data-pid');
			require(['emoji-dialog'], function (emojiDialog) {
				emojiDialog.toggle(reactionAddEl[0], function (_, name, dialog) {
					emojiDialog.dialogActions.close(dialog);

					socket.emit('plugins.reactions.addPostReaction', {
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

	function setupMessageReactions() {
		setupMessageReactionSockets();

		const messageContent = $('[component="chat/message/content"]');
		messageContent.on('click', '[component="message/reaction"]', function () {
			var reactionElement = $(this);
			var mid = reactionElement.attr('data-mid');
			var reaction = reactionElement.attr('data-reaction');
			var reacted = reactionElement.hasClass('reacted');
			var event = 'plugins.reactions.' + (reacted ? 'removeMessageReaction' : 'addMessageReaction');
			socket.emit(event, {
				mid: mid,
				reaction: reaction,
			}, function (err) {
				if (err) {
					alerts.error(err.message);
				}
			});
		});

		messageContent.on('click', '[component="message/reaction/add"]', function () {
			const reactionAddEl = $(this);
			const mid = reactionAddEl.attr('data-mid');

			require(['emoji-dialog'], function (emojiDialog) {
				emojiDialog.toggle(reactionAddEl[0], function (_, name, dialog) {
					emojiDialog.dialogActions.close(dialog);

					socket.emit('plugins.reactions.addMessageReaction', {
						mid: mid,
						reaction: name,
					}, function (err) {
						if (err) {
							return alerts.error(err.message);
						}

						$('[component="message/reaction"][data-mid="' + mid + '"][data-reaction="' + name + '"]').addClass('reacted');
					});
				});
			});
		});
	}

	function setupPostReactionSockets() {
		socket.off('event:reactions.addPostReaction').on('event:reactions.addPostReaction', function (data) {
			updatePostReactionCount(data, 'add');
		});

		socket.off('event:reactions.removePostReaction').on('event:reactions.removePostReaction', function (data) {
			updatePostReactionCount(data, 'remove');
		});
	}

	function setupMessageReactionSockets() {
		socket.off('event:reactions.addMessageReaction').on('event:reactions.addMessageReaction', function (data) {
			updateMessageReactionCount(data, 'add');
		});

		socket.off('event:reactions.removeMessageReaction').on('event:reactions.removeMessageReaction', function (data) {
			updateMessageReactionCount(data, 'remove');
		});
	}

	function updatePostReactionCount(data, type) {
		var maxReactionsReached = parseInt(data.totalReactions, 10) > config.maximumReactions;
		$('[component="post/reaction/add"][data-pid="' + data.pid + '"]').toggleClass('max-reactions', maxReactionsReached);

		var reactionEl = $(`[component="post/reaction"][data-pid="${data.pid}"][data-reaction="${data.reaction}"]`);

		if (parseInt(data.reactionCount, 10) === 0) {
			reactionEl.tooltip('dispose');
			reactionEl.remove();
		}
		const isSelf = parseInt(data.uid, 10) === app.user.uid;
		if (reactionEl.length === 0) {
			app.parseAndTranslate('partials/topic/reaction', {
				pid: data.pid,
				reaction: data.reaction,
				reactionCount: data.reactionCount,
				usernames: data.usernames,
				reacted: isSelf && type === 'add',
				reactionImage: data.reactionImage,
			}, function (html) {
				$('[component="post/reactions"][data-pid="' + data.pid + '"]').append(html);
			});
		} else {
			reactionEl.find('.reaction-emoji-count').attr('data-count', data.reactionCount);
			reactionEl.attr('data-bs-original-title', data.usernames);
			reactionEl.attr('aria-label', data.usernames);
			if (isSelf) {
				reactionEl.toggleClass('reacted', type === 'add');
			}
		}
	}

	function updateMessageReactionCount(data, type) {
		var maxReactionsReached = parseInt(data.totalReactions, 10) > config.maximumReactionsPerMessage;
		$('[component="message/reaction/add"][data-mid="' + data.mid + '"]').toggleClass('max-reactions', maxReactionsReached);

		var reactionEl = $(`[component="message/reaction"][data-mid="${data.mid}"][data-reaction="${data.reaction}"]`);

		if (parseInt(data.reactionCount, 10) === 0) {
			reactionEl.tooltip('dispose');
			reactionEl.remove();
		}
		const isSelf = (parseInt(data.uid, 10) === app.user.uid);
		if (reactionEl.length === 0) {
			app.parseAndTranslate('partials/chats/reaction', {
				mid: data.mid,
				reaction: data.reaction,
				reactionCount: data.reactionCount,
				reacted: isSelf && type === 'add',
				reactionImage: data.reactionImage,
			}, function (html) {
				require(['forum/chats/messages'], function (messages) {
					const reactionEl = $('[component="message/reactions"][data-mid="' + data.mid + '"]');
					const chatContentEl = reactionEl.parents('[component="chat/message/content"]');
					const isAtBottom = messages.isAtBottom(chatContentEl);
					reactionEl.append(html);
					if (isAtBottom) {
						messages.scrollToBottom(chatContentEl);
					}
				});
			});
		} else {
			reactionEl.find('.reaction-emoji-count').attr('data-count', data.reactionCount);
			reactionEl.attr('data-bs-original-title', data.usernames);
			reactionEl.attr('aria-label', data.usernames);
			if (isSelf) {
				reactionEl.toggleClass('reacted', type === 'add');
			}
		}
	}

	function createReactionTooltips() {
		require(['bootstrap', 'translator'], function (bootstrap, translator) {
			async function createTooltip(data) {
				const el = mouseOverReactionEl;
				let usernames = data.usernames.filter(name => name !== '[[global:former_user]]');
				if (!usernames.length) {
					return;
				}
				if (usernames.length + data.otherCount > data.cutoff) {
					usernames = usernames.join(', ').replace(/,/g, '|');
					usernames = await translator.translate('[[topic:users_and_others, ' + usernames + ', ' + data.otherCount + ']]');
					usernames = usernames.replace(/\|/g, ',');
				} else {
					usernames = usernames.join(', ');
				}

				el.attr('title', usernames);
				(new bootstrap.Tooltip(el, {
					container: '#content',
					html: true,
					placement: 'top',
					animation: false,
				})).show();
			}
			function clearTooltipTimeout() {
				if (tooltipTimeoutId) {
					clearTimeout(tooltipTimeoutId);
					tooltipTimeoutId = 0;
				}
			}

			if (!utils.isTouchDevice()) {
				$('#content').on('mouseenter', '.reaction', function () {
					const $this = $(this);
					mouseOverReactionEl = $this;
					clearTooltipTimeout();
					tooltipTimeoutId = setTimeout(async () => {
						if (mouseOverReactionEl && mouseOverReactionEl.length) {
							const pid = mouseOverReactionEl.attr('data-pid');
							const mid = mouseOverReactionEl.attr('data-mid');
							const type = pid ? 'post' : 'message';
							const data = await socket.emit('plugins.reactions.getReactionUsernames', {
								type: type,
								mid: mid,
								pid: pid,
								reaction: mouseOverReactionEl.attr('data-reaction'),
							});

							if (mouseOverReactionEl && mouseOverReactionEl.length &&
								(
									(type === 'post' && pid === mouseOverReactionEl.attr('data-pid')) ||
									(type === 'message' && mid === mouseOverReactionEl.attr('data-mid'))
								)
							) {
								createTooltip(data);
							}
						}
					}, 200);
				});
				$('#content').on('mouseleave', '.reaction', function () {
					clearTooltipTimeout();
					mouseOverReactionEl = null;
					const $this = $(this);
					const tooltip = bootstrap.Tooltip.getInstance(this);
					if (tooltip) {
						tooltip.dispose();
						$this.attr('title', '');
					}
				});
			}
		});
	}
});
